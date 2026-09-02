# TechScout 数据收集状态

> 文档状态：第一轮数据收集的历史阶段记录
> 检查日期：2026-09-02  
> 数据目录：`D:\files\project-data`  
> 当前统一入口：[数据库与数据资产状态](./database-and-data-status.md)
> 关联文档：[产品需求](./product-requirements.md) · [数据获取指南](./data-acquisition-guide.md)

本文档保留第一轮下载、核验和构建过程，不再作为“当前状态”的唯一入口。最新数据库表结构、已导入数据和后续路线以[数据库与数据资产状态](./database-and-data-status.md)为准。

> 后续状态：带引用的最小报告已经生成并通过独立验证，Data Gate 已通过；接口、Agent 和前端开发尚未开始，当前暂缓。

## 1. 当前结论

USPTO 授权专利数据以及 GLEIF、SEC 公司参考数据已经完成第一轮下载、来源登记、Bronze 构建和首版 AI 领域 Silver 构建。2019–2025 年 AI 芯片/边缘推理与工业视觉/AI 质检筛选已经完成，公司候选也已使用本地 GLEIF、SEC 数据完成保守匹配。

Silver 发布门槛已经通过：用户确认了 10 家公司，新的 `2026-09-v2` 已完成重建和独立复核，当前为 `status=passed`、`publishable=true`。仍有 495 个候选处于待审核或未匹配状态，但不会阻塞首版发布；未命中不能解释为主体不存在。

`2026-09-v2` 已通过 `COPY + UPSERT` 发布到本地 PostgreSQL `tech-scout` 数据库，并完成相同 release 重跑、逐表行数和孤儿关系复核。当前 `catalog` 有 19 张表，`staging` 有 14 张导入后清空的暂存表；自动清理回收 Staging 临时页后，数据库复核时约占 199 MiB。物理大小会随自动清理和索引维护波动。带引用的最小报告已经生成并验证，整体 Data Gate 已通过。

首个正式分析 release 建议使用 **2019–2025 年美国授权专利**。2015–2018 年数据保留为历史储备，但不作为首轮领域筛选的硬依赖。

## 2. 已收集的 USPTO 数据

数据来源：USPTO Open Data Portal 的 PatentsView 数据产品。

### 2.1 PatentsView Annualized Patent Data

产品标识：`PVANNUAL`

已下载并解压 `2015.csv` 至 `2025.csv`。年度文件提供专利号、申请号、授权年份、申请年份、受让人、发明人、国家/地区、WIPO 技术领域和 CPC section 等年度宽表字段。

| 授权年份 |      数据行数 |    不同专利数 | 结构检查 |
| -------: | ------------: | ------------: | -------- |
|     2015 |       311,100 |       299,382 | 通过     |
|     2016 |       316,308 |       304,126 | 通过     |
|     2017 |       333,454 |       320,003 | 通过     |
|     2018 |       322,110 |       308,853 | 通过     |
|     2019 |       371,865 |       355,923 | 通过     |
|     2020 |       370,064 |       353,701 | 通过     |
|     2021 |       344,183 |       329,097 | 通过     |
|     2022 |       340,792 |       324,698 | 通过     |
|     2023 |       328,075 |       313,707 | 通过     |
|     2024 |       341,592 |       325,602 | 通过     |
|     2025 |       343,743 |       325,822 | 通过     |
| **合计** | **3,723,286** | **3,560,914** | —        |

验证结果：

- 11 个年度文件均为 62 列，表头一致。
- 每行列数正确，没有发现坏行或文件尾部截断。
- 每个文件只包含对应授权年份。
- 一件专利可能因多个受让人出现多行，不能直接用数据行数表示专利数量。
- 年度宽表中的 `cpc_sections` 只有 CPC 大类，不能代替完整 CPC 编码。

### 2.2 PatentsView Granted Patent Disambiguated Data

产品标识：`PVGPATDIS`

已获得以下两张必要基础表：

| 文件                 |   当前大小 |   数据行数 | 用途                                     | 检查结果 |
| -------------------- | ---------: | ---------: | ---------------------------------------- | -------- |
| `g_patent.tsv`       | 约 1.12 GB |  9,454,161 | 专利标题、授权日期、类型、权利要求数量等 | 通过     |
| `g_cpc_at_issue.tsv` | 约 2.07 GB | 25,022,251 | 专利授权时的完整 CPC 编码                | 通过     |

验证结果：

- `g_patent.tsv` 固定为 8 列，没有空专利 ID 或异常列数。
- `g_cpc_at_issue.tsv` 固定为 9 列，没有空专利 ID 或异常列数。
- `g_cpc_at_issue.tsv` 有 535 行缺少 `cpc_group`，但专利 ID 完整；这是来源缺失，Bronze 原样保留并纳入质量基线。
- 两张表均以换行正常结束，没有发现明显截断。
- 年度专利号与 `g_patent.tsv` 的分年抽样关联率为 100%。
- 2016–2025 年专利号与 `g_cpc_at_issue.tsv` 的分年抽样关联率为 100%。
- 2015 年最早一批专利的 CPC at-issue 覆盖不完整：首批 1,000 件样本命中 870 件。这属于来源覆盖差异，不是下载文件损坏。

### 2.3 字段文档

已经获得：

- `PV_grant_data_dictionary.pdf`：有效 PDF，用于解释 `PVGPATDIS` 字段。

尚未获得：

- `data_dictionary_PVANNUAL.xlsx`：USPTO 详情页当前发生接口故障，待网站恢复后补充。

年度 CSV 已经过实际字段检查，因此缺少该字典暂不阻塞 Bronze 构建。

### 2.4 不需要的数据

目录中的 `year_missing.csv` 是 `PVANNUAL` 的缺失年份记录，不属于 TechScout 的业务数据，可以在处理流程中忽略。

第一轮暂不需要下载：

- `g_patent_abstract.tsv.zip`。
- `g_cpc_current.tsv.zip`。
- `g_persistent_assignee.tsv.zip`。
- 专利引用、律师、PDF、图片和 Long Text 数据。
- Patent File Wrapper 全量数据。
- Pre-Grant Publication 数据。

## 3. 已收集的公司数据

公司数据目录：`D:\files\project-data\company`

### 3.1 GLEIF Level 1 实体数据

已下载并解压：

```text
20260902-0000-gleif-goldencopy-lei2-golden-copy.csv
```

| 项目     |       结果 |
| -------- | ---------: |
| 数据快照 | 2026-09-02 |
| 文件大小 | 约 4.96 GB |
| 数据行数 |  3,418,434 |
| 字段数   |        338 |
| 唯一 LEI |  3,418,434 |

验证结果：

- 行数与 GLEIF 当日官方元数据一致。
- 所有记录均为 338 列，没有发现坏行或文件尾部截断。
- 没有重复 LEI，也没有格式错误的 LEI。
- 法律实体名称、法律地址国家、实体状态和注册状态均无缺失。
- 只有 4 条记录缺少法律司法辖区，可作为来源缺失保留。
- `Entity.EntityStatus` 中有 9,036 条字符串值 `NULL`，导入时应规范为未知状态，不能推导实体不存在。
- 数据同时包含 `ACTIVE`、`INACTIVE`、`LAPSED`、`RETIRED` 等状态。Bronze 应保留原始状态，不能只导入当前有效 LEI。

Level 1 可用于获取规范名称、其他名称、LEI、国家、注册地址、注册机构、注册号和实体状态。

### 3.2 GLEIF Level 2 关系数据

已下载并解压：

```text
20260902-0000-gleif-goldencopy-rr-golden-copy.csv
```

| 项目       |       结果 |
| ---------- | ---------: |
| 数据快照   | 2026-09-02 |
| 文件大小   |  约 242 MB |
| 数据行数   |    486,499 |
| 字段数     |         54 |
| 唯一关系键 |    486,499 |

验证结果：

- 行数与 GLEIF 当日官方元数据一致。
- 所有记录均为 54 列，没有发现坏行或文件尾部截断。
- 没有重复关系，所有关系起点和终点均为合法的 20 位 LEI。
- 所有起点 LEI 都能关联同日 Level 1。
- 有 6 条关系的终点未出现在同日 Level 1，对应 5 个不同 LEI；这是极小的快照差异，应保留关系并将终点标记为未解析。
- 486,114 条关系状态为 `ACTIVE`；其余状态也应在 Bronze 中保留。

Level 2 包含直接合并母公司、最终合并母公司、基金管理、子基金和国际分支等关系。公司匹配时不能把所有关系都等同为普通母子公司关系。

### 3.3 SEC Company Tickers

已下载：

```text
company_tickers_exchange.json
```

验证结果：

- JSON 格式正确，包含 `cik`、`name`、`ticker` 和 `exchange` 四个字段。
- 共 10,391 行，每行字段数一致。
- 公司名称和 ticker 均无缺失，ticker 没有重复。
- 有 201 行缺少交易所，可按来源空值保留。
- 有 2,390 个重复 CIK 行。这是同一 SEC 申报主体对应多个 ticker 或证券类别造成的正常一对多关系，不是重复公司。

导入时应将 CIK 作为公司外部标识，将 ticker 和 exchange 建成独立的证券标识关系，不能要求原始 JSON 中的 CIK 每行唯一。

### 3.4 当前不需要的公司数据

Companies House Free Company Data 暂不下载。只有在首轮专利受让人中出现较多无法通过 GLEIF 核验的英国主体时再加入。

没有匹配到 GLEIF 或 SEC 的受让人不能被判定为公司不存在，应标记为未核验主体。

## 4. 原始文件、Bronze 与可追溯性

原始压缩包已经统一保留在：

```text
D:\files\project-data\raw
```

当前共保留 15 个 ZIP：2015–2025 年的 11 个 `PVANNUAL` 年度包、2 个 `PVGPATDIS` 数据包，以及 GLEIF Level 1、Level 2 各 1 个数据包。SEC `company_tickers_exchange.json` 是官方直接提供的未压缩 JSON，当前保留在 `company` 目录，可直接作为 Raw 输入。

完整性验证结果：

- 15 个 ZIP 均通过完整 CRC 校验，没有发现压缩包损坏。
- 每个压缩包内的预期成员均已解压到 `patents` 或 `company` 目录。
- 所有压缩包成员的未压缩大小均与对应解压文件完全一致。
- `g_patent.tsv.zip` 同时包含 `g_patent.tsv` 和 `PV_grant_data_dictionary.pdf`，两者均已正确解压并通过大小比对。

因此，不再需要重新下载 USPTO 或 GLEIF 压缩包。来源登记 release 已生成：

```text
D:\files\project-data\releases\source-2026-09-02\
  manifest.json
  SHA256SUMS.txt
```

登记和复核结果：

- 共登记 33 个文件，其中 16 个 Raw 文件、17 个解压文件，总大小 10,930,328,320 字节。
- 所有文件均已计算 SHA-256，并通过第二次全量读取复核。
- manifest 记录了来源机构、数据集、官方页面、文件角色、格式、大小、SHA-256、数据覆盖范围，以及 ZIP 与解压成员的对应关系。
- 两份 `PV_grant_data_dictionary.pdf` 的 SHA-256 相同，确认内容一致。
- 实际下载时间无法从现有文件可靠还原，因此 `downloadedAt` 明确记录为 `null`，文件系统修改时间另存为 `observedMtimeUtc`。
- USPTO 和 SEC 的许可字段暂记为 `not_recorded`，不据此推断再分发权利；GLEIF 记录为 CC0-1.0。

后续可在不移动现有文件的前提下，逐步整理为以下目录边界：

```text
D:\files\project-data\
  inbound\                   尚未登记的下载文件
  raw\2026-09\uspto\        已登记、不可修改的官方 ZIP
  raw\2026-09\gleif\
  raw\2026-09\sec\         SEC 官方 JSON
  bronze\                    从 Raw 生成的 Parquet
  silver\                    领域筛选和实体匹配结果
  releases\                  manifest、质量报告和发布记录
```

当前 `raw` 目录仍是按文件类型集中存放的扁平结构，尚未按来源和快照日期分层。这不影响数据处理；manifest 已明确记录每个原始文件、解压文件及其对应关系。

Bronze release 已生成并完成独立全量复核：

```text
D:\files\project-data\bronze\source-2026-09-02-v1\
  manifest.json
  quality_report.json
  uspto\pvannual.parquet
  uspto\patent.parquet
  uspto\cpc_at_issue.parquet
  gleif\entities.parquet
  gleif\relationships.parquet
  sec\companies.parquet
```

| Bronze 表           |       数据行数 | 字段数 |               文件大小 |
| ------------------- | -------------: | -----: | ---------------------: |
| USPTO PVANNUAL      |      3,723,286 |     66 |       267,310,789 字节 |
| USPTO Patent        |      9,454,161 |     12 |       194,576,524 字节 |
| USPTO CPC at issue  |     25,022,251 |     13 |       321,103,516 字节 |
| GLEIF Entities      |      3,418,434 |    342 |       412,712,970 字节 |
| GLEIF Relationships |        486,499 |     58 |        19,001,471 字节 |
| SEC Companies       |         10,391 |      8 |           188,970 字节 |
| **合计**            | **42,115,022** |      — | **1,214,894,240 字节** |

Bronze 使用 DuckDB 1.5.5 和 ZSTD 压缩构建。来源字段全部保留，并为每行增加 `_source_release`、`_source_path`、`_source_sha256` 和 `_source_row_number` 四个追溯字段。质量报告包含 40 项检查，全部通过；独立 `verify` 再次确认了 6 个 Parquet 的 SHA-256、文件大小、行数和列数。

Silver release 已生成并完成独立全量复核：

```text
D:\files\project-data\silver\ai-domains\2026-09-v2\
  manifest.json
  quality_report.json
  domains.jsonl
  patent_domain_evaluations.parquet
  patents.parquet
  patent_classifications.parquet
  patent_parties.parquet
  patent_domain_matches.parquet
  company_candidates.parquet
  entity_matches.parquet
  companies.parquet
  company_aliases.parquet
  external_identifiers.parquet
  company_relations.parquet
  company_patent_relations.parquet
  entity_review.csv
```

| Silver 产物                   |    数据行数 | 说明                                        |
| ----------------------------- | ----------: | ------------------------------------------- |
| 领域筛选审计                  |     263,421 | 所有 CPC 候选及命中词、分数和排除原因       |
| 去重专利                      |       2,863 | AI 1,882 件，工业视觉 981 件，无跨域重叠    |
| 完整 CPC 分类                 |      18,175 | 只保留入选专利，但保留其全部 CPC            |
| 专利受让人                    |       2,934 | 对应 731 个名称和国家组合                   |
| 公司实体建议                  |         760 | 每个模糊候选最多 5 个建议                   |
| 已纳入公司                    |         274 | 含自动/人工接受主体及可解析关系终点         |
| 公司—专利关系                 |       1,719 | 其中 142 条来自 10 家人工确认公司           |
| 待审核/未匹配公司候选         |         495 | 已全量导出到 `entity_review.csv`            |
| **manifest 登记的 14 个文件** | **296,729** | **14,410,482 字节，不含 manifest/报告本身** |

Silver 使用规则 `config/domains/ai-domains-v1.yaml` 构建，记录 Bronze manifest hash、规则 hash、审核文件 hash、每个输出的 SHA-256、行列数和 schema。用户确认记录保存在 `reviews\ai-domains\2026-09-v1-user-confirmed-10.json`，SHA-256 为 `0c3ddda13609d0d25bf31f8654a1b1e349040ae6e99c9f78230d76353fd10580`。质量报告的 29 项结构及基线检查全部通过；独立 `verify` 又验证了 Bronze 输入、审核输入、14 个 Silver 文件和 release 文件集合。当前自动接受 226 个候选、人工接受 10 个候选，状态为 `passed`，且已发布到本地 PostgreSQL Catalog。

PostgreSQL 导入结果：

| Catalog 数据                      |    行数 |
| --------------------------------- | ------: |
| Silver 业务及审核记录             | 296,729 |
| `dataset_record` release 逐行登记 | 296,729 |
| `source_file` 文件登记            |      14 |
| `dataset_release` 已发布 release  |       1 |
| `import_job` 成功导入任务         |       1 |
| 导入完成后的全部 staging 表       |       0 |

`dataset_record` 是版本—记录映射，不是第二份业务数据。它用于证明某条记录属于哪个 Silver release，因此数据库行数和占用空间会高于 Parquet 文件本体。

## 5. 当前可支持的处理流程

现有专利和公司数据可以执行：

```text
2019–2025 年度 CSV
  + g_patent.tsv（标题）
  + g_cpc_at_issue.tsv（完整 CPC）
  ↓ 按 patent_number / patent_id 关联
CPC 粗筛
  ↓
标题关键词和排除词精筛
  ↓
目标领域专利集合
  ↓
提取申请人和受让人
  ↓
生成待匹配的公司候选
  + GLEIF Level 1（名称、国家、地址、LEI）
  + SEC Company Tickers（名称、CIK、ticker）
  ↓ 本地实体匹配
规范公司候选与待人工审核项
  + GLEIF Level 2（公司和基金关系）
```

GLEIF 和 SEC 不覆盖全球所有公司。未命中的受让人仍应保留原始名称、国家和来源专利，并标记为未核验主体。

由于第一轮未下载摘要，领域精筛先采用“完整 CPC + 标题关键词 + 排除词”。如果误报率或漏检率不可接受，再评估补充摘要数据，不提前下载 1.7 GB 的全量摘要表。

## 6. Data Gate 完成度

| 验收项                           | 当前状态 | 说明                                                   |
| -------------------------------- | -------- | ------------------------------------------------------ |
| USPTO 批量文件完成一次登记与解析 | 已满足   | 来源文件已登记，三张 Bronze Parquet 已构建并复核       |
| GLEIF 批量文件完成登记与解析     | 已满足   | Level 1、Level 2 Bronze 已构建并复核                   |
| SEC 公司文件完成登记与解析       | 已满足   | SEC Companies Bronze 已构建并复核                      |
| 至少一个领域获得 200 件有效专利  | 已满足   | 两个领域分别获得 1,882 和 981 件专利                   |
| 发现并人工核验至少 10 家公司     | 已满足   | 自动接受 226 个，用户人工确认 10 个                    |
| 按技术查询公司、按公司查询专利   | 已满足   | PostgreSQL Catalog 已发布，可使用关系表执行双向查询    |
| 正式记录可追溯到原始文件和 hash  | 已满足   | 33 个文件已登记 SHA-256，manifest 已建立并通过全量复核 |
| 同一 release 重复导入保持幂等    | 已满足   | 重跑只复核 manifest 和数据库行数，不重复写入           |
| Fixture 完全离线运行             | 已满足   | Silver fixture 覆盖筛选、排除、匹配、审核和不可变校验  |
| 生成带引用的最小报告             | 已满足   | AI 芯片报告已生成并验证，关键事实引用覆盖率为 100%     |

## 7. 后续行动（当前暂缓）

本阶段已经收尾。以下内容留作恢复开发后的建议顺序，当前不执行：

1. 为 NestJS 增加只读 Catalog 查询接口。
2. 在只读查询层稳定后再接入 Agent 工具和前端页面。
3. 495 个剩余候选可按专利数继续分批审核；每批审核必须作为新输入并生成新 Silver 版本，不能改写 v2。
4. 后续 Silver release 继续使用同一幂等导入命令增量发布。
5. 本地运行稳定后，再根据部署需求决定是否同步到 Supabase。

## 8. 当前数据边界

当前专利数据截止到 2025-12-31。报告和产品界面必须显示该截止时间，不能声称覆盖 2026 年专利。

第一轮只覆盖美国授权专利，不覆盖：

- 尚未授权的公开申请。
- 全球其他专利局的完整专利集合。
- 专利法律状态的完整历史。
- 专利全文、图片和全部权利要求。
- 新闻、论文和网页证据。

这些限制应作为数据范围说明展示，而不是由模型补写缺失事实。
