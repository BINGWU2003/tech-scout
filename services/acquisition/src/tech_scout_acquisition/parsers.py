"""Pure parsers. Source assertions remain separate from identity decisions."""

import hashlib
import re
import unicodedata
from datetime import UTC, datetime
from urllib.parse import urlencode
from uuid import NAMESPACE_URL, uuid5

from bs4 import BeautifulSoup

from .models import AcquisitionBlocked


def stable_id(value):
    return str(uuid5(NAMESPACE_URL, value))


def normalized(value):
    return re.sub(r"[\W_]+", "", unicodedata.normalize("NFKC", value).casefold())


def source(url, content):
    digest = hashlib.sha256(content.encode()).hexdigest()
    return {
        "source_url": url,
        "source_path": f"browser/{digest}.html",
        "source_sha256": digest,
        "source_row_number": None,
        "observed_at": datetime.now(UTC).isoformat(),
        "parser_version": "browser-v2",
        "content": content,
    }


def search_url(direction, plan, page):
    # Terms are quoted literals, not model-controlled query operators.
    def literal(term):
        return '"' + term.replace('"', " ").strip() + '"'

    terms = direction["keywords"] or [direction["name"]]
    query = "(" + " OR ".join(map(literal, terms)) + ")"
    for term in direction["excluded_keywords"]:
        query += " -" + literal(term)
    params = {
        "q": query,
        "page": page,
        "num": 10,
        "before": f"publication:{plan['to_year'] + 1}0101",
        "after": f"publication:{plan['from_year']}0101",
        "dedup": "family",
    }
    if direction["cpc_prefixes"]:
        params["cpc"] = ",".join(direction["cpc_prefixes"])
    return "https://patents.google.com/?" + urlencode(params)


def parse_results(html, url=None):
    soup = BeautifulSoup(html, "html.parser")
    records = []
    for item in soup.select("search-result-item"):
        link = item.select_one('[data-result^="patent/"], a[href*="/patent/"]')
        if not link:
            continue
        target = link.get("data-result") or link.get("href", "")
        match = re.search(r"patent/([A-Z]{2}\d+[A-Z]\d?)", target)
        if not match:
            continue
        assignees = [
            n.get_text(" ", strip=True) for n in item.select('[itemprop="assignee"]')
        ]
        if not assignees:
            metadata = item.select("h4.metadata > span > span.bullet-before raw-html")
            if len(metadata) >= 2:
                assignees = [metadata[-1].get_text(" ", strip=True)]
        records.append(
            {
                "publication_number": match[1],
                "list_assignees": assignees,
                "list_title": link.get_text(" ", strip=True),
                "list_source": source(url, str(item)) if url else None,
            }
        )
    return records


def parse_patent(html, url):
    soup = BeautifulSoup(html, "html.parser")

    def values(prop):
        # Citation tables reuse assigneeOriginal for OTHER patents' applicants.
        selector = (
            f'dd[itemprop="{prop}"]'
            if prop in {"assigneeOriginal", "assigneeCurrent", "inventor"}
            else f'[itemprop="{prop}"]'
        )
        return list(
            dict.fromkeys(
                n.get("content") or n.get_text(" ", strip=True)
                for n in soup.select(selector)
                if n.get("content") or n.get_text(" ", strip=True)
            )
        )

    def first(prop):
        return next(iter(values(prop)), None)

    def section(selector):
        node = soup.select_one(selector)
        return node.get_text(" ", strip=True) if node else None

    citation = soup.select_one('meta[name="citation_patent_number"]')
    publication = (
        citation.get("content", "").replace(":", "")
        if citation
        else first("publicationNumber")
    )
    title_meta = soup.select_one('meta[name="DC.title"]')
    title = (
        title_meta.get("content", "").strip()
        if title_meta
        else section('h1#title, h1[itemprop="title"], #title')
    )
    abstract = section('[itemprop="abstract"], .abstract, #abstract')
    if not publication or not title or not abstract:
        raise AcquisitionBlocked(
            "PARSE_CHANGED", "专利详情缺少公开号、标题或摘要，等待检查页面"
        )
    current = values("assigneeCurrent")
    original = values("assigneeOriginal")
    # Keep both roles even when the same entity occurs in each.
    return {
        "publication_number": re.sub(r"[\s-]", "", publication),
        "title": title,
        "abstract": abstract,
        "description": section('[itemprop="description"], .description, #description'),
        "claims": section('[itemprop="claims"], .claims, #claims'),
        "publication_date": first("publicationDate"),
        "filing_date": first("filingDate"),
        "priority_date": first("priorityDate"),
        "grant_date": first("grantDate"),
        "application_number": first("applicationNumber"),
        "family_id": first("familyID"),
        "country": first("countryCode"),
        "current_assignees": current,
        "original_assignees": original,
        "cpcs": values("Code"),
        "inventors": values("inventor"),
        **source(url, str(soup)),
    }


def parse_company(html, url):
    soup = BeautifulSoup(html, "html.parser")
    # Only the business-information table is persisted, never account/navigation HTML.
    table = next(
        (
            t
            for t in soup.select("table")
            if "统一社会信用代码" in t.get_text() and "企业名称" in t.get_text()
        ),
        None,
    )
    if table is None:
        raise AcquisitionBlocked("PARSE_CHANGED", "未读到企业工商信息表")
    cells = [
        c.get_text(" ", strip=True).replace("点击复制", "").replace("复制", "").strip()
        for c in table.select("th, td")
    ]
    labels = {
        "统一社会信用代码",
        "企业名称",
        "法定代表人",
        "经营状态",
        "成立日期",
        "注册资本",
        "实缴资本",
        "所属地区",
        "所属行业",
        "英文名",
        "注册地址",
        "经营业务范围",
        "参保人数",
    }
    fields = {
        value: cells[i + 1] for i, value in enumerate(cells[:-1]) if value in labels
    }
    credit = fields.get("统一社会信用代码", "")
    if not re.fullmatch(r"[0-9A-Z]{18}", credit):
        raise AcquisitionBlocked("PARSE_CHANGED", "企业信用代码缺失或格式异常")
    name_field = fields.get("企业名称", "")
    names = re.split(r"曾用名[：:]\s*", name_field)
    if not names[0].strip():
        raise AcquisitionBlocked("PARSE_CHANGED", "企业名称缺失")
    return {
        "company_id": stable_id("CN:" + credit),
        "credit_code": credit,
        "name": names[0].strip(),
        "aliases": [s.strip() for s in names[1:]],
        "english_name": fields.get("英文名"),
        "country": "CN",
        "fields": fields,
        **source(url, str(table)),
    }


def domestic_candidate(name):
    # Deliberately conservative; CN patent jurisdiction is not company domicile.
    return bool(
        re.search(r"[\u4e00-\u9fff]", name)
        and re.search(r"(?:有限责任公司|有限公司|股份公司)$", name)
        and not re.search(r"株式会社|研究所|大学|协会", name)
    )


def identity_match(query, company):
    names = [company["name"], *company["aliases"]]
    return normalized(query) in {normalized(n) for n in names}


def assignee_matches(name, company):
    def english(value):
        tokens = re.findall(
            r"[a-z0-9]+", unicodedata.normalize("NFKC", value).casefold()
        )
        suffixes = {"company", "corporation", "limited", "co", "ltd", "inc"}
        while tokens and tokens[-1] in suffixes:
            tokens.pop()
        return "".join(tokens)

    return (
        identity_match(name, company)
        or bool(company.get("english_name"))
        and bool(english(name))
        and english(name) == english(company["english_name"])
    )
