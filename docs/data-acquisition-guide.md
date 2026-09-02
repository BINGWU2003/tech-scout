# TechScout 离线公司—专利数据库构建与导入说明

> 文档状态：离线方案基线 v2.0  
> 适用阶段：Data Foundation、Data Gate 与 MVP  
> 更新日期：2026-09-01  
> 关联文档：[TechScout 产品需求文档](./product-requirements.md)

## 1. 文档目的

本文档定义 TechScout 在运行时不调用第三方数据 API 的前提下，如何通过官方批量文件建立一个规模可控、可重复构建、只覆盖指定技术领域的公司—专利数据库。

重点回答：

- 公司和专利批量文件从哪里获得。
- 如何从大型原始文件中只保留目标领域数据。
- 数据如何经过 Raw、Bronze、Silver 再进入 PostgreSQL。
- 如何从专利申请人和受让人识别规范公司主体。
- PostgreSQL 的表、导入顺序、幂等和版本如何设计。
- 数据底座达到什么条件后才能进入完整产品开发。

## 2. 最终方案

TechScout MVP 采用完全离线的数据运行方式：

1. 从官方数据门户手动或定期下载 ZIP、XML、TSV、CSV、JSON 等批量文件。
2. 原始批量文件保存在本地 Raw 层，不直接进入业务数据库。
3. 使用 DuckDB、Polars、PyArrow 和 XML 流式解析构建 Bronze Parquet。
4. 根据领域规则只筛选 AI 芯片、工业视觉等目标数据，生成 Silver 数据包。
5. 使用本地 GLEIF、SEC 等公司文件完成公司身份匹配，不调用在线查询 API。
6. Silver 数据通过 PostgreSQL `COPY` 进入 staging，再通过事务性 `UPSERT` 发布到 catalog。
7. React、NestJS 和 Agent 运行时只查询本地 PostgreSQL、MinIO 和本地检索索引。
8. 数据更新通过下载下一期官方批量文件并发布新的 dataset release 完成。

```text
官方批量文件
  ↓
Raw 原始归档
  ↓
Bronze 源结构 Parquet
  ↓
领域规则过滤 + 标准化 + 实体消歧
  ↓
Silver 垂直领域数据包
  ↓
PostgreSQL staging
  ↓
catalog 公司—专利数据库
  ↓
React / NestJS / Agent 只查询本地数据
```

## 3. 范围与非目标

### 3.1 首批领域

- AI 芯片 / 边缘推理加速。
- 工业视觉 / AI 质检。

若 Data Gate 表明其中一个领域的公司产出率或准确率明显不足，可以用自动驾驶感知替换。

### 3.2 初始时间与区域

- 时间范围：2015–2026 年。
- 专利区域：第一版以美国 USPTO 数据为主。
- 公司区域：优先美国和能够通过 GLEIF 映射的全球主体。
- 英国公司：需要时加入 Companies House 批量数据。
- 全球专利：后续通过正式 PATSTAT 等批量数据产品扩展。

### 3.3 PostgreSQL 只保存

- 命中目标领域的专利和专利族。
- 这些专利涉及的申请人、受让人和规范公司。
- 公司别名、外部 ID、母子关系和公司—专利关系。
- 领域匹配规则、分数和命中原因。
- 来源文件、数据版本、导入记录和人工审核结果。

### 3.4 暂不保存

- 全球全部专利。
- 与目标领域无关的全部 GLEIF 公司。
- 专利图片和完整 PDF。
- 全量权利要求全文。
- 全量新闻、网页和论文。
- 来源不明的 Kaggle 公司或专利数据。

完整 GLEIF、USPTO 等文件可以保存在 Raw/Bronze 层用于离线匹配，但不需要全部写进 PostgreSQL。

## 4. 官方批量数据来源

### 4.1 USPTO 专利批量数据

官方入口：

- [USPTO Open Data Portal](https://data.uspto.gov/)
- [USPTO Bulk Data](https://bulkdata.uspto.gov/)

第一优先级是 USPTO ODP 中当前可下载的 PatentsView 分析型批量表，选择以下数据类别：

- 专利或申请基础信息。
- 专利摘要。
- 申请人和受让人。
- 专利—受让人关联表。
- CPC 分类。
- 发明人和地址，可在需要时加入。

PatentsView 分析表的优势是部分受让人和发明人已经经过消歧，适合直接建立公司—专利关系。

如果当前 ODP 产品不包含需要的分析表，则下载 USPTO 授权专利和申请公开 XML：

- 按年份或批次下载 ZIP。
- 使用流式 XML 解析，不能一次性加载整个文件到内存。
- 不同年份的 XML schema 可能变化，解析器必须按文档版本路由。

旧 `api.patentsview.org` 及旧 API schema 不作为新项目依赖。

### 4.2 GLEIF 公司身份批量数据

官方入口：[GLEIF Golden Copy](https://www.gleif.org/en/lei-data/gleif-golden-copy/download-the-golden-copy#/)

建议下载：

- Level 1 法律实体数据。
- 可用的 Level 2 关系数据。
- CSV、JSON 或 XML 中选择一种固定格式，MVP 优先 CSV。

用途：

- 根据 LEI、公司名、国家和地址匹配专利受让人。
- 获取规范名称、其他名称、注册地址和实体状态。
- 补充直接母公司和最终母公司关系。

GLEIF 采用 CC0，但只覆盖拥有 LEI 的主体。未命中 GLEIF 不能推导公司不存在。

完整 GLEIF 文件保留在 Raw/Bronze；只有与目标专利主体匹配的公司进入 PostgreSQL catalog。

### 4.3 SEC 公司批量数据

官方入口：

- [SEC Company Tickers](https://www.sec.gov/files/company_tickers_exchange.json)
- [SEC EDGAR Bulk Data](https://www.sec.gov/edgar/sec-api-documentation)

MVP 先使用 Company Tickers 文件获取：

- CIK。
- 公司名称。
- ticker。
- 交易所。

Company Tickers 文件较小，可以完整保存在 Bronze；只有匹配到目标领域公司的主体进入 catalog。EDGAR submissions 和 company facts 批量文件属于后续公司详情扩展，不是 Data Gate 必需项。

### 4.4 Companies House 批量数据

官方入口：[Companies House Free Company Data](https://download.companieshouse.gov.uk/en_output.html)

提供 ZIP + CSV 形式的英国公司基础数据。只有当首批领域出现较多英国主体时才下载和处理，不作为第一轮硬依赖。

### 4.5 全球专利扩展

需要全球批量专利数据时，优先评估：

- EPO PATSTAT 等正式批量数据产品。
- 已经合法导出的 Google Patents Public Datasets 垂直领域文件。

EPO OPS 是查询 API，不属于本离线方案。MVP 不使用 EPO OPS，也不批量爬取 Google Patents、Espacenet 或 CNIPA 网页。

## 5. 本地数据目录

建议目录：

```text
data/
  inbound/                 人工放入、尚未登记的下载文件
  raw/                     已登记、不可修改的官方原始文件
    2026-09/
      gleif/
      sec/
      uspto/
  bronze/                  保持来源结构的 Parquet
    gleif/
    sec/
    uspto/
  silver/                  规范化后的垂直领域数据
    ai-domains/
      2026-09-v1/
  releases/                manifest、统计、审核结果和发布记录
  fixtures/                许可明确的小型测试数据
  replay/                  Agent 和工具事件重放数据
```

目录规则：

- `raw` 文件不可原地修改。
- `bronze` 可以从 `raw` 重新生成。
- `silver` 可以从 `bronze`、领域规则和审核结果重新生成。
- `data` 大型目录默认加入 `.gitignore`。
- Git 只保存 schema、构建代码、领域规则、manifest 模板、审核映射和小型 Fixture。

## 6. 数据文件登记

每个下载文件进入处理流程前必须登记：

- 来源机构。
- 官方下载页面。
- 原始文件名。
- 数据发布日期。
- 下载时间。
- 文件大小。
- SHA-256。
- 格式和压缩类型。
- schema 或文档版本。
- 许可和本地使用说明。

示例：

```json
{
  "release": "uspto-ai-domains-2026-09-v1",
  "files": [
    {
      "provider": "uspto",
      "path": "raw/2026-09/uspto/patent.tsv.zip",
      "sha256": "...",
      "publishedAt": "2026-09-01",
      "format": "tsv.zip",
      "schemaVersion": "..."
    }
  ]
}
```

相同 hash 的文件不得重复处理；相同文件名但 hash 变化时必须生成新的来源版本。

## 7. Raw、Bronze、Silver 与 Catalog

### 7.1 Raw

保存官方 ZIP、XML、CSV 和 JSON，不做字段或编码修改。

### 7.2 Bronze

将不同来源转换为容易本地查询的 Parquet，尽量保持源字段：

```text
bronze/uspto/patent.parquet
bronze/uspto/abstract.parquet
bronze/uspto/assignee.parquet
bronze/uspto/patent_assignee.parquet
bronze/uspto/cpc.parquet
bronze/gleif/entities.parquet
bronze/gleif/relationships.parquet
bronze/sec/companies.parquet
```

推荐工具：

- Polars：CSV、TSV 清洗和分批处理。
- PyArrow：Parquet schema 和输出。
- DuckDB：本地 SQL 过滤、连接和聚合。
- `lxml.iterparse`：USPTO 大型 XML 流式解析。

### 7.3 Silver

只保存目标领域的规范数据：

```text
silver/ai-domains/2026-09-v1/
  manifest.json
  domains.jsonl
  companies.parquet
  company_aliases.parquet
  external_identifiers.parquet
  company_relations.parquet
  patents.parquet
  patent_families.parquet
  patent_parties.parquet
  patent_classifications.parquet
  patent_domain_matches.parquet
  company_patent_relations.parquet
  entity_review.csv
  quality_report.json
```

### 7.4 Catalog

Catalog 是 PostgreSQL 中供 NestJS、Python Agent 和本地检索使用的正式数据。只有已经通过验证的 Silver release 可以发布到 catalog。

## 8. 领域规则

领域选择不能只依赖关键词，也不能只依赖 CPC。每个领域使用“CPC + 关键词 + 排除词 + 时间范围”的确定性规则。

示例：

```yaml
version: ai-domain-rules-v1
domains:
  - id: ai-edge-accelerator
    name: AI 芯片与边缘推理
    year_from: 2015
    year_to: 2026
    cpc_prefixes:
      - G06N
      - G06N3/063
    keywords:
      - neural accelerator
      - neural processing unit
      - edge inference
      - tensor processor
      - in-memory computing
    exclude_keywords:
      - generic processor
      - thermal package

  - id: industrial-vision
    name: 工业视觉与 AI 质检
    year_from: 2015
    year_to: 2026
    cpc_prefixes:
      - G06V
      - G06T
      - B07C
      - G01N
    keywords:
      - automated optical inspection
      - surface defect detection
      - machine vision inspection
    exclude_keywords:
      - medical imaging
      - surveillance
      - autonomous driving
```

领域规则需要版本化。任何规则变化必须生成新的 Silver release，不直接修改已发布结果。

## 9. 专利过滤与标准化

### 9.1 CPC 粗筛

先使用 DuckDB 从 Bronze CPC 表筛选候选专利：

```sql
SELECT DISTINCT patent_id
FROM bronze_patent_cpc
WHERE cpc_code LIKE 'G06N%'
   OR cpc_code LIKE 'G06V%'
   OR cpc_code LIKE 'G06T%'
   OR cpc_code LIKE 'B07C%'
   OR cpc_code LIKE 'G01N%';
```

### 9.2 关键词精筛

建议初始规则：

- 标题关键词命中：4 分。
- 摘要关键词命中：2 分。
- 权利要求关键词命中：1 分，若当前数据包含权利要求。
- CPC 精确分类命中：4 分。
- 排除词命中：减分或直接排除。

每个判断必须保存：

```text
patent_id
domain_id
rule_version
matched_cpc
matched_keywords
excluded_keywords
relevance_score
decision
```

导入流水线不使用 LLM 决定专利是否进入数据库，以保证可重复性。后续 Agent 可以对已入库数据重新排序，但不能静默修改领域归属。

### 9.3 专利标准字段

- 来源和来源外部 ID。
- 出版号、申请号。
- 标题、摘要。
- 优先权日、申请日、公开日。
- 申请人、受让人、发明人。
- CPC/IPC。
- 专利族 ID，来源支持时保存。
- 引用关系，来源支持时保存。
- 来源文件 ID、数据版本和原始记录定位信息。

## 10. 公司候选与实体消歧

### 10.1 候选来源

从目标领域专利中提取：

- 申请人。
- 原始受让人。
- 当前受让人，来源支持时保存。
- 国家、地址和来源专利。

### 10.2 名称归一化

- 统一 Unicode、大小写、标点和多余空白。
- 仅用于比较时移除 `Inc.`、`Ltd.`、`LLC` 等常见后缀。
- 永远保留来源原始名称。
- 中文名、英文名和历史名称建成别名，不相互覆盖。

### 10.3 本地匹配顺序

1. LEI、CIK、注册号等强 ID。
2. 规范名称 + 国家。
3. 名称 + 地址。
4. 名称 + 官网域名，批量文件包含时使用。
5. 名称相似度。

使用 DuckDB 在本地连接 Bronze GLEIF/SEC，而不是调用查询 API：

```sql
SELECT
  candidate.original_name,
  gleif.lei,
  gleif.legal_name,
  gleif.country
FROM company_candidates candidate
JOIN gleif_entities gleif
  ON candidate.normalized_name = gleif.normalized_name
 AND candidate.country = gleif.country;
```

### 10.4 审核状态

- `auto_accepted`：强 ID 或名称、国家、地址高度一致。
- `needs_review`：存在多个候选或仅名称近似。
- `unmatched`：没有匹配到本地公司参考数据。
- `rejected`：人工确认不是同一主体。

待审核结果导出为 CSV，可直接使用 Excel 查看和填写：

```text
candidate_name
candidate_country
matched_company
lei
cik
confidence
match_reason
decision
reviewer_note
```

人工审核是 Silver 构建输入的一部分，必须版本化。人工确认不能被后续自动导入覆盖。

## 11. PostgreSQL schema

推荐使用三个 schema：

```text
staging   批量导入暂存
catalog   正式公司—专利数据
app       后续产品业务数据
```

### 11.1 staging

```text
staging.company_candidate
staging.company_match
staging.patent
staging.patent_family
staging.patent_party
staging.patent_classification
staging.patent_domain_match
staging.company_patent_relation
```

Staging 可以按 import job 清空或分区，不作为产品查询来源。

### 11.2 catalog

```text
catalog.company_entity
catalog.company_alias
catalog.external_identifier
catalog.company_relation

catalog.patent
catalog.patent_family
catalog.patent_party
catalog.patent_classification
catalog.patent_domain_match
catalog.company_patent_relation

catalog.source_file
catalog.dataset_release
catalog.dataset_record
catalog.import_job
catalog.entity_review
```

### 11.3 app

完整产品开发后再增加：

```text
app.research_project
app.research_run
app.candidate_company
app.report
app.citation
```

数据库 migration 必须只有一个所有者。建议使用独立、工具无关的 SQL migration 目录，NestJS 和 Python 都不能自行修改 catalog schema。

## 12. 导入顺序

按外键依赖导入：

```text
1. source_file
2. dataset_release
3. staging 数据
4. company_entity
5. company_alias
6. external_identifier
7. company_relation
8. patent_family
9. patent
10. patent_classification
11. patent_party
12. patent_domain_match
13. company_patent_relation
14. dataset_record
15. entity_review
```

公司主体可以先于专利导入，但公司—专利关系必须在两侧实体都成功发布后创建。

## 13. COPY 与 UPSERT

禁止通过 ORM 逐行插入大型数据集。推荐：

```text
Silver Parquet
  ↓
PyArrow 分批读取
  ↓
psycopg COPY 到 staging
  ↓
数据质量检查
  ↓
事务内 UPSERT 到 catalog
  ↓
记录导入统计
```

伪代码：

```python
def import_release(release_path):
    manifest = validate_manifest(release_path)
    job = create_import_job(manifest)

    copy_to_staging("patents", release_path / "patents.parquet", job)
    copy_to_staging("companies", release_path / "companies.parquet", job)
    copy_to_staging(
        "company_patent_relations",
        release_path / "company_patent_relations.parquet",
        job,
    )

    validate_staging(job)

    with transaction():
        upsert_companies(job)
        upsert_company_aliases(job)
        upsert_external_identifiers(job)
        upsert_patent_families(job)
        upsert_patents(job)
        upsert_patent_classifications(job)
        upsert_patent_parties(job)
        upsert_domain_matches(job)
        upsert_company_patent_relations(job)
        publish_dataset_release(job)
```

## 14. 幂等与版本控制

每次发布使用唯一版本，例如：

```text
uspto-ai-domains-2026-09-v1
```

建议唯一约束：

```sql
UNIQUE (source, external_id)
UNIQUE (source, publication_number)
UNIQUE (company_id, patent_id, relation_type)
UNIQUE (patent_id, domain_id, rule_version)
UNIQUE (dataset_release_id, entity_type, entity_id)
```

同一个 release 重复导入必须满足：

- 不产生重复专利、公司或关系。
- 不覆盖人工审核结果。
- 不改变已发布历史版本。
- 数据量和质量统计一致。

发布状态：

```text
registered → parsing → building → validated → published
```

失败状态必须记录失败阶段和可否重试。

## 15. 索引与本地查询

MVP 使用 PostgreSQL 即可：

- `patent.publication_number`。
- `patent.application_number`。
- `patent.filing_date`。
- `patent_classification.cpc_code`。
- `patent_party.normalized_name`。
- `company_entity.canonical_name`。
- `external_identifier(identifier_type, identifier_value)`。
- `company_patent_relation(company_id, patent_id)`。
- `patent_domain_match(domain_id, relevance_score)`。

标题和摘要使用 PostgreSQL 全文检索。pgvector 在 Agent/RAG 阶段按需加入，不是 Data Gate 必需项。

本地数据库必须支持：

- 按领域查相关专利。
- 按领域统计唯一申请人和受让人。
- 按技术发现公司。
- 按公司查询专利和技术分类。
- 查看公司匹配依据和人工审核状态。
- 从任何正式记录追溯到来源文件和数据版本。

## 16. 数据质量检查

每个 release 发布前检查：

- 原始文件 SHA-256 是否匹配。
- 文件行数是否出现异常变化。
- 专利号、申请号是否重复。
- 专利是否缺少标题、日期或来源定位。
- CPC 是否能够解析。
- 申请人和受让人缺失率。
- 公司自动匹配率、待审核率和未匹配率。
- 公司—专利关系是否存在孤儿记录。
- 领域命中是否保存规则版本和原因。
- 相同 release 重复导入是否幂等。
- 正式记录是否全部能追溯到 source file。

建议生成 `quality_report.json`，未达到阈值时禁止发布。

## 17. 离线增量更新

不使用 API 时，更新流程为：

```text
人工检查官方门户的新批量文件
  ↓
下载并登记发布日期和 SHA-256
  ↓
只解析新增或变化文件
  ↓
生成新的 Bronze / Silver
  ↓
执行质量检查
  ↓
发布新的 dataset release
```

更新原则：

- 不物理删除旧 release。
- 名称、受让人或关系变化通过版本和有效时间表达。
- 固定评测绑定固定 release。
- 当前产品默认查询最新已发布 release。
- 数据截止时间显示在研究报告中。

## 18. Data Gate

完整 React、NestJS 和多 Agent 产品开发前，必须满足：

- USPTO、GLEIF 和 SEC 至少各完成一次批量文件登记与解析。
- 至少一个领域获得 200 件以上有效专利。
- 至少发现并人工核验 10 家公司。
- 可以按技术查询公司、按公司查询专利。
- 公司—专利关系保存角色、匹配依据和审核状态。
- 每条正式记录能够追溯到原始文件、hash 和 release。
- 同一 release 重复导入不会产生重复数据。
- Fixture 可以完全离线运行。
- 可以从本地数据生成一份关键事实带引用的最小报告。

通过 Data Gate 后，数据库不会停止建设。完整产品开发与垂直主库扩充并行推进。

## 19. Data Foundation 实施计划

### 第 1–2 天：文件和 schema

- 下载一批 USPTO、GLEIF 和 SEC 官方文件。
- 建立文件登记和 SHA-256 校验。
- 创建 Raw/Bronze/Silver 目录。
- 建立 SQL migration、staging、catalog 和 dataset release 表。

### 第 3–4 天：Bronze 构建

- 将 GLEIF 和 SEC 转换成 Parquet。
- 解析 USPTO 分析表或 XML。
- 验证年份、编码、字段和 schema 差异。
- 记录 Bronze 行数和错误统计。

### 第 5–6 天：领域过滤

- 实现领域 YAML 和规则版本。
- 使用 CPC 粗筛。
- 使用标题、摘要和排除词精筛。
- 生成专利、分类和领域匹配 Silver 表。

### 第 7 天：公司实体

- 提取申请人和受让人候选。
- 本地匹配 GLEIF 和 SEC Bronze。
- 导出 `entity_review.csv`。
- 人工确认至少 10 家公司。

### 第 8–9 天：导入与质量

- 生成完整 Silver release。
- 使用 `COPY + UPSERT` 导入 catalog。
- 验证幂等、外键、孤儿关系和来源追溯。
- 建立全文和关系查询索引。

### 第 10 天：Data Gate 验收

- 按技术查询公司。
- 按公司查询专利。
- 生成质量报告。
- 构建 Fixture。
- 生成一份最小本地研究报告。
- 决定两个领域是否保留或替换。

## 20. 规模规划

### Data Gate

- 每个领域处理 200–500 件候选专利。
- 至少一个领域保留 200 件有效专利。
- 人工核验 10–15 家公司。

### MVP 目标

- 两个领域合计 5000–20000 个相关专利族或专利记录，取决于来源字段。
- 200–500 个公司候选主体。
- 核心公司拥有已确认的别名和公司—专利关系。

规模是目标区间，不要求一次性导满。优先保证公司映射、领域规则和来源追溯正确。

当数据达到数百万专利并出现明显分析压力后，再考虑 DuckDB 常驻分析、ClickHouse 或专用搜索集群。

## 21. 实施检查清单

- [ ] 首批领域、时间和区域范围已确认。
- [ ] USPTO 批量文件已从官方门户下载。
- [ ] GLEIF Golden Copy 已下载。
- [ ] SEC Company Tickers 已下载。
- [ ] 每个原始文件已记录发布日期、大小和 SHA-256。
- [ ] Raw 文件不可变，Bronze 和 Silver 可以重建。
- [ ] USPTO XML schema 或分析表字段已经验证。
- [ ] 领域 YAML、CPC、关键词和排除词已经版本化。
- [ ] 公司候选仅使用本地文件进行匹配。
- [ ] 人工审核 CSV 和状态模型已经定义。
- [ ] staging、catalog、app schema 边界已经确定。
- [ ] SQL migration 只有一个所有者。
- [ ] Silver 使用 `COPY + UPSERT` 幂等导入。
- [ ] 数据质量不通过时禁止发布 release。
- [ ] PostgreSQL 只保存目标领域数据。
- [ ] 产品运行时不会调用第三方数据 API。
- [ ] Data Gate 未通过前不开发完整产品页面和多 Agent 主链。
