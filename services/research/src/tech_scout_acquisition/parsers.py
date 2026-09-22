"""Pure parsers. Source assertions remain separate from identity decisions."""

import hashlib
import json
import re
import unicodedata
from datetime import UTC, datetime
from urllib.parse import urlencode, urljoin
from uuid import NAMESPACE_URL, uuid5

from bs4 import BeautifulSoup

from .models import AcquisitionBlocked


def stable_id(value):
    return str(uuid5(NAMESPACE_URL, value))


def normalized(value):
    return re.sub(r"[\W_]+", "", unicodedata.normalize("NFKC", value).casefold())


USCC_ALPHABET = "0123456789ABCDEFGHJKLMNPQRTUWXY"
USCC_WEIGHTS = (1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28)
MAINLAND_REGION_PREFIXES = {
    "11", "12", "13", "14", "15", "21", "22", "23", "31", "32", "33", "34",
    "35", "36", "37", "41", "42", "43", "44", "45", "46", "50", "51", "52",
    "53", "54", "61", "62", "63", "64", "65",
}


def valid_mainland_uscc(value):
    if len(value) != 18 or any(char not in USCC_ALPHABET for char in value):
        return False
    if value[2:4] not in MAINLAND_REGION_PREFIXES:
        return False
    checksum = sum(
        USCC_ALPHABET.index(char) * weight
        for char, weight in zip(value[:17], USCC_WEIGHTS, strict=True)
    )
    return value[-1] == USCC_ALPHABET[(31 - checksum % 31) % 31]


def attribute(node, name):
    value = node.get(name)
    return value if isinstance(value, str) else ""


def source(url, content, suffix="html", parser_version="google-patents-browser-v2"):
    digest = hashlib.sha256(content.encode()).hexdigest()
    return {
        "source_url": url,
        "source_path": f"browser/{digest}.{suffix}",
        "source_sha256": digest,
        "source_row_number": None,
        "observed_at": datetime.now(UTC).isoformat(),
        "parser_version": parser_version,
        "content": content,
    }


def search_url(direction, plan, page, keyword=None):
    # Send one literal user-approved keyword per request. Company domicile and
    # title-language checks are enforced again from parsed records.
    terms = direction["keywords"] or [direction["name"]]
    query = (keyword or terms[0]).strip()
    params = {
        "q": query,
        "page": page,
        "num": 10,
        "before": f"publication:{plan['to_year'] + 1}0101",
        "after": f"publication:{plan['from_year']}0101",
        "country": "CN",
        "language": "CHINESE",
        "dedup": "family",
    }
    return "https://patents.google.com/?" + urlencode(params)


def parse_results(html, url=None):
    soup = BeautifulSoup(html, "html.parser")
    records = []
    for item in soup.select("search-result-item"):
        link = item.select_one('[data-result^="patent/"], a[href*="/patent/"]')
        if not link:
            continue
        target = attribute(link, "data-result") or attribute(link, "href")
        match = re.search(r"(?:^|/)patent/([A-Z]{2}\d+[A-Z]\d?)(?:/|$)", target)
        if not match:
            continue
        publication_number = match[1]
        title_text = link.get_text(" ", strip=True)
        applicants = list(
            dict.fromkeys(
                attribute(node, "content") or node.get_text(" ", strip=True)
                for node in item.select('[itemprop="assignee"]')
                if attribute(node, "content") or node.get_text(" ", strip=True)
            )
        )
        if not applicants:
            metadata = item.select("h4.metadata > span > span.bullet-before raw-html")
            if len(metadata) >= 2:
                applicants = [metadata[-1].get_text(" ", strip=True)]
        if (
            not re.fullmatch(r"CN\d+[A-Z]\d?", publication_number)
            or not re.search(r"[\u4e00-\u9fff]", title_text)
            or not any(domestic_candidate(name) for name in applicants)
        ):
            continue

        def date(prop, item=item):
            node = item.select_one(f'[itemprop="{prop}"]')
            if node:
                return (
                    attribute(node, "content")
                    or attribute(node, "datetime")
                    or node.get_text(" ", strip=True)
                    or None
                )
            labels = {"filingDate": "Filed", "publicationDate": "Published"}
            dates = item.select_one("h4.dates")
            match = re.search(
                rf"\b{labels[prop]}\s+(\d{{4}}-\d{{2}}-\d{{2}})",
                dates.get_text(" ", strip=True) if dates else "",
            )
            return match[1] if match else None

        records.append(
            {
                "publication_number": publication_number,
                "list_assignees": [
                    name for name in applicants if domestic_candidate(name)
                ],
                "list_title": title_text,
                "filing_date": date("filingDate"),
                "publication_date": date("publicationDate"),
                "detail_url": urljoin(
                    "https://patents.google.com",
                    f"/patent/{publication_number}/zh",
                ),
                "list_source": source(url, str(item)) if url else None,
            }
        )
    return records


def parse_patent(html, url):
    soup = BeautifulSoup(html, "html.parser")

    def values(prop):
        selector = (
            f'dd[itemprop="{prop}"]'
            if prop in {"assigneeOriginal", "assigneeCurrent", "inventor"}
            else f'[itemprop="{prop}"]'
        )
        return list(
            dict.fromkeys(
                value
                for node in soup.select(selector)
                if (
                    value := attribute(node, "content")
                    or attribute(node, "datetime")
                    or node.get_text(" ", strip=True)
                )
            )
        )

    def first(prop):
        return next(iter(values(prop)), None)

    def section(selector):
        node = soup.select_one(selector)
        return node.get_text(" ", strip=True) if node else None

    def meta(name, scheme=None):
        selector = f'meta[name="{name}"]'
        if scheme:
            selector += f'[scheme="{scheme}"]'
        node = soup.select_one(selector)
        return attribute(node, "content").strip() if node else None

    def labeled_values(label):
        result = []
        for name in soup.select("dl.important-people dt"):
            if name.get_text(" ", strip=True).casefold() != label.casefold():
                continue
            for sibling in name.find_next_siblings():
                if sibling.name == "dt":
                    break
                if sibling.name == "dd" and (
                    value := sibling.get_text(" ", strip=True)
                ):
                    result.append(value)
            break
        return result

    citation = soup.select_one(
        'meta[name="citation_patent_number"], '
        'meta[name="citation_patent_publication_number"]'
    )
    publication_text = (
        attribute(citation, "content")
        if citation
        else first("publicationNumber") or ""
    )
    publication = re.sub(r"[:\s-]", "", publication_text).upper()
    title_meta = soup.select_one('meta[name="DC.title"]')
    title = (
        attribute(title_meta, "content").strip()
        if title_meta
        else section('h1#title, h1[itemprop="title"], #title')
    )
    abstract = section('[itemprop="abstract"], .abstract') or meta("DC.description")
    if (
        not re.fullmatch(r"CN\d+[A-Z]\d?", publication)
        or not title
        or not re.search(r"[\u4e00-\u9fff]", title)
    ):
        raise AcquisitionBlocked(
            "PARSE_CHANGED", "专利详情缺少公开号或标题，等待检查页面"
        )
    return {
        "publication_number": publication,
        "title": title,
        "abstract": abstract,
        "description": section(
            '[itemprop="description"], patent-text[name="description"], '
            "#descriptionText"
        ),
        "claims": section('[itemprop="claims"], .claims'),
        "publication_date": first("publicationDate") or meta("DC.date", "issue"),
        "filing_date": first("filingDate") or meta("DC.date", "dateSubmitted"),
        "priority_date": first("priorityDate") or meta("DC.date", "dateSubmitted"),
        "grant_date": first("grantDate")
        or (
            meta("DC.date", "issue")
            if re.search(r"[BUY]\d?$", publication[-2:], re.I)
            else None
        ),
        "application_number": first("applicationNumber")
        or re.sub(r"[:\s]", "", meta("citation_patent_application_number") or "")
        or None,
        "family_id": first("familyID"),
        "country": first("countryCode") or "CN",
        "current_assignees": [
            name
            for name in dict.fromkeys(
                values("assigneeCurrent")
                + labeled_values("Current Assignee")
                + [
                    attribute(node, "content").strip()
                    for node in soup.select(
                        'meta[name="DC.contributor"][scheme="assignee"]'
                    )
                    if attribute(node, "content").strip()
                ]
            )
            if domestic_candidate(name)
        ],
        "original_assignees": [
            name for name in values("assigneeOriginal") if domestic_candidate(name)
        ],
        "cpcs": list(
            dict.fromkeys(
                values("Code")
                + [
                    attribute(node, "data-cpc")
                    for node in soup.select("[data-cpc]")
                    if attribute(node, "data-cpc")
                ]
            )
        ),
        "inventors": list(
            dict.fromkeys(
                values("inventor")
                + labeled_values("Inventor")
                + [
                    attribute(node, "content").strip()
                    for node in soup.select(
                        'meta[name="DC.contributor"][scheme="inventor"]'
                    )
                    if attribute(node, "content").strip()
                ]
            )
        ),
        **source(url, str(soup)),
    }


def parse_company_item(item, url):
    mapping = {
        "统一社会信用代码": "creditCode",
        "企业名称": "name",
        "法定代表人": "legalPersonName",
        "经营状态": "regStatus",
        "成立日期": "estiblishTime",
        "注册资本": "regCapital",
        "公司类型": "companyOrgType",
        "所在城市": "city",
        "所在区县": "district",
        "所属行业": "categoryStr",
        "英文名": "englishName",
        "注册地址": "regLocation",
        "经营业务范围": "businessScope",
        "企业规模": "companyScale",
        "登记机关": "registerInstitute",
        "参保人数": "socialSecurityStaffNum",
    }

    def clean(value):
        if value is None:
            return ""
        return re.sub(
            r"\s+", " ", BeautifulSoup(str(value), "html.parser").get_text(" ")
        ).strip()

    fields = {
        label: value
        for label, key in mapping.items()
        if (value := clean(item.get(key)))
    }
    credit = fields.get("统一社会信用代码", "")
    if not credit or credit in {"-", "--", "无", "暂无", "未公示"}:
        raise AcquisitionBlocked(
            "UNSUPPORTED_COMPANY", "该主体没有中国统一社会信用代码"
        )
    if not valid_mainland_uscc(credit):
        if item.get("companyType") == 2 or clean(item.get("base")) in {
            "香港",
            "澳门",
            "台湾",
        }:
            raise AcquisitionBlocked(
                "UNSUPPORTED_COMPANY", "该主体不是中国大陆登记企业"
            )
        raise AcquisitionBlocked("UNSUPPORTED_COMPANY", "企业信用代码无效")
    name = fields.get("企业名称", "")
    if not name:
        raise AcquisitionBlocked("PARSE_CHANGED", "企业名称缺失")
    history = item.get("historyNames") or []
    if not isinstance(history, list):
        history = re.split(r"[；;\t]+", str(history))
    aliases = list(dict.fromkeys(clean(value) for value in history if clean(value)))
    preserved = {
        key: item.get(key)
        for key in {*mapping.values(), "historyNames", "id"}
        if item.get(key) is not None
    }
    content = json.dumps(
        preserved, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    return {
        "company_id": stable_id("CN:" + credit),
        "credit_code": credit,
        "name": name,
        "aliases": aliases,
        "english_name": fields.get("英文名") or None,
        "country": "CN",
        "fields": fields,
        "provider": "tianyancha",
        **source(url, content, "json", "tianyancha-company-search-v1"),
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
