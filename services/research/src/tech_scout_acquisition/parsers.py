"""Pure parsers. Source assertions remain separate from identity decisions."""

import hashlib
import json
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
        "parser_version": "wanfang-browser-v1",
        "content": content,
    }


def search_url(direction, plan, page):
    # Terms are quoted literals, not model-controlled query operators.  Keep
    # exclusions out of the remote query; they are applied to preserved text by
    # the research workflow so a useful candidate is not discarded too early.
    def literal(term):
        return '"' + term.replace('"', " ").strip() + '"'

    terms = direction["keywords"] or [direction["name"]]
    query = "(" + " OR ".join(map(literal, terms)) + ")"
    # WanFang uses IPC.  The protocol field keeps its historical name for API
    # compatibility, while the query and UI describe it as IPC.
    if direction["cpc_prefixes"]:
        ipc = " OR ".join(map(literal, direction["cpc_prefixes"]))
        query += f" 分类号:({ipc})"

    years = [str(year) for year in range(plan["from_year"], plan["to_year"] + 1)]
    params = {"q": query, "p": page + 1, "s": 20}
    # WanFang's facet UI supports at most 30 simultaneous values.  Wider ranges
    # are still enforced locally by the worker and the research workset.
    if len(years) <= 30:
        params["facet"] = json.dumps(
            [
                {
                    "PublishYear": {
                        "label": years,
                        "title": "公开/公告年份",
                        "value": years,
                    }
                }
            ],
            ensure_ascii=False,
            separators=(",", ":"),
        )
    return "https://s.wanfangdata.com.cn/patent?" + urlencode(params)


def parse_results(html, url=None):
    soup = BeautifulSoup(html, "html.parser")
    records = []
    for item in soup.select(".normal-list"):
        hidden_id = item.select_one(".title-id-hidden")
        title = item.select_one(".title-area .title")
        author_area = item.select_one(".author-area")
        if not hidden_id or not title or not author_area:
            continue
        detail_id = hidden_id.get_text(" ", strip=True)
        detail_id = re.sub(r"^patent_", "", detail_id, flags=re.I)
        match = re.search(
            r"\b([A-Z]{2}\d+(?:[A-Z]\d?)?)\b", author_area.get_text(" ", strip=True)
        )
        if not match:
            continue
        assignees = list(
            dict.fromkeys(
                n.get_text(" ", strip=True)
                for n in author_area.select(".authors")
                if n.get_text(" ", strip=True)
            )
        )
        dates = author_area.select_one(".applyDate")
        date_text = dates.get_text(" ", strip=True) if dates else ""
        filing = re.search(r"申请日[：:]\s*(\d{4}-\d{2}-\d{2})", date_text)
        publication = re.search(r"公开日[：:]\s*(\d{4}-\d{2}-\d{2})", date_text)
        abstract_node = item.select_one(".abstract-area")
        abstract = abstract_node.get_text(" ", strip=True) if abstract_node else None
        if abstract:
            abstract = re.sub(r"^摘要[：:]\s*", "", abstract)
        records.append(
            {
                "publication_number": match[1],
                "list_assignees": assignees,
                "list_title": title.get_text(" ", strip=True),
                "filing_date": filing[1] if filing else None,
                "publication_date": publication[1] if publication else None,
                "abstract": abstract,
                "detail_id": detail_id,
                "detail_url": "https://d.wanfangdata.com.cn/patent/" + detail_id,
                "list_source": source(url, str(item)) if url else None,
            }
        )
    return records


def select_patent_html(html):
    """Keep WanFang's public bibliographic block, excluding account/navigation UI."""
    soup = BeautifulSoup(html, "html.parser")
    essential = soup.select_one("#essential")
    return str(essential) if essential else ""


def parse_patent(html, url):
    soup = BeautifulSoup(html, "html.parser")

    def text(selector):
        node = soup.select_one(selector)
        return node.get_text(" ", strip=True) if node else None

    def field(label):
        for row in soup.select("#essential .detailList > .list"):
            name = row.select_one(".item")
            if name and name.get_text(" ", strip=True).rstrip("：:") == label:
                value = row.select_one(".itemUrl, .text-overflow")
                return value.get_text(" ", strip=True) if value else None
        return None

    def linked_field(label):
        for row in soup.select("#essential .detailList > .list"):
            name = row.select_one(".item")
            if not name or name.get_text(" ", strip=True).rstrip("：:") != label:
                continue
            values = [
                node.get_text(" ", strip=True)
                for node in row.select(".itemUrl > a, .itemUrl > .multi-sep")
                if node.get_text(" ", strip=True)
            ]
            if values:
                return list(dict.fromkeys(values))
            value = row.select_one(".itemUrl")
            return [value.get_text(" ", strip=True)] if value else []
        return []

    publication_text = field("公开/公告号") or ""
    publication_match = re.search(
        r"[A-Z]{2}\d+(?:[A-Z]\d?)?",
        re.sub(r"[\s-]", "", publication_text),
        re.I,
    )
    publication = publication_match[0].upper() if publication_match else None
    title = text("#essential .detailTitleCN")
    abstract = text("#essential .summary .text-overflow") or None
    if not publication or not title:
        raise AcquisitionBlocked(
            "PARSE_CHANGED", "专利详情缺少公开号或标题，等待检查页面"
        )
    assignees = linked_field("申请/专利权人")
    publication_date = field("公开/公告日")
    kind_code = publication[-2:]
    return {
        "publication_number": publication,
        "title": title,
        "abstract": abstract,
        "description": None,
        "claims": field("主权项"),
        "publication_date": publication_date,
        "filing_date": field("申请日期"),
        "priority_date": None,
        "grant_date": publication_date
        if re.search(r"[BUY]\d?$", kind_code, re.I)
        else None,
        "application_number": field("申请/专利号"),
        "family_id": None,
        "country": publication[:2].upper(),
        # WanFang exposes a combined applicant/patentee field.  Preserve the
        # names as current parties so downstream identity matching remains
        # conservative and does not invent a distinction absent from source.
        "current_assignees": assignees,
        "original_assignees": [],
        "cpcs": list(
            dict.fromkeys(
                node.get_text(" ", strip=True)
                for node in soup.select("#essential .classify .patentCode > span")
                if node.get_text(" ", strip=True)
            )
        ),
        "inventors": linked_field("发明/设计人"),
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
    if not credit or credit in {"-", "--", "无", "暂无", "未公示"}:
        raise AcquisitionBlocked(
            "UNSUPPORTED_COMPANY", "该主体没有中国统一社会信用代码"
        )
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
