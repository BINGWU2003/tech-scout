# TechScout 数据获取与发布指南

> 文档定位：常青的数据运维手册
> 适用范围：Raw → Source Manifest → Bronze → Silver → PostgreSQL Catalog → 报告
> 当前数据和表结构见[数据底座参考](./database-and-data-status.md)
> 产品范围见[产品需求](./product-requirements.md)

## 1. 基本原则

TechScout 运行时只查询本地 PostgreSQL 和本地产物，不依赖第三方数据 API。数据更新通过“下载官方批量文件并发布新 release”完成。

必须遵守：

- Raw 原始文件登记后不可原地修改。
- 每层都保存 manifest、SHA-256、schema、行数和上游版本。
- 相同 release 不覆盖；输入、规则或审核发生变化时创建新版本。
- 大文件采用流式或分批处理，不能整体载入内存。
- 公司匹配宁可保守未接受，也不能根据品牌、母公司或相似名称强行合并。
- 来源没有的字段保持 unavailable，不使用 LLM 或空字段伪造。
- Git 只保存代码、规则、migration、测试和文档；大型数据保存在 `D:\files\project-data`。
- 数据库密码只保存在已忽略的 `db.txt`，不得写入日志、文档或 manifest。

## 2. 官方数据源

| Provider | 数据集              | 官方入口                                                                                            | 用途                             |
| -------- | ------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------- |
| USPTO    | PVANNUAL            | [USPTO Open Data Portal](https://data.uspto.gov/)                                                   | 专利和受让人年度数据             |
| USPTO    | PVGPATDIS           | [USPTO Bulk Data](https://data.uspto.gov/bulkdata/datasets)                                         | 专利标题和授权时 CPC             |
| GLEIF    | Level 1 Golden Copy | [GLEIF Golden Copy](https://www.gleif.org/en/lei-data/gleif-golden-copy/download-the-golden-copy#/) | 法律实体、名称、国家、地址和 LEI |
| GLEIF    | Level 2 Golden Copy | [GLEIF Golden Copy](https://www.gleif.org/en/lei-data/gleif-golden-copy/download-the-golden-copy#/) | 官方实体关系                     |
| SEC      | Company Tickers     | [SEC Company Tickers](https://www.sec.gov/files/company_tickers_exchange.json)                      | CIK、ticker、交易所和名称        |

扩展数据只在功能需要时增加：

- 专利摘要、权利要求、引用和法律状态。
- EPO PATSTAT 或其他专利局数据。
- SEC submissions 和 company facts。
- Companies House、ROR、OpenAlex、新闻或市场数据。

不要批量爬取 Google Patents、Espacenet、CNIPA 或其他不允许自动抓取的网页，也不要绕过登录、验证码和反爬。

## 3. 目录与权威文件

当前数据根目录：

```text
D:\files\project-data\
  patents\                 USPTO 文件
  company\                 GLEIF、SEC 文件
  releases\                Source manifest
  bronze\                  源结构 Parquet
  silver\                  领域 Silver release
  reviews\                 公司审核批次和证据
  reports\                 可复核研究报告
  backups\                 可选数据库备份
```

推荐的长期目录边界是 `inbound`、`raw/<snapshot>/<provider>`、`bronze`、`silver` 和 `releases`。当前 Raw 目录较扁平，但已有 manifest 完整登记；整理物理目录前必须设计新的路径版本，不能直接移动已登记文件。

权威文件：

| 内容                             | 权威来源                                      |
| -------------------------------- | --------------------------------------------- |
| Raw 来源、许可、大小和 hash      | Source `manifest.json`、`SHA256SUMS.txt`      |
| Bronze/Silver 文件 schema 和行数 | 对应 release `manifest.json`                  |
| 数据质量                         | 对应 `quality_report.json`                    |
| 领域定义                         | `config/domains/ai-domains-v1.yaml`           |
| 审核终态和证据                   | `reviews/ai-domains/<batch>` 与累计审核 JSON  |
| PostgreSQL 结构                  | `pipelines/data-foundation/migrations/*.sql`  |
| 当前版本和表用途                 | [数据底座参考](./database-and-data-status.md) |

## 4. 环境准备

项目命令使用 pnpm 和 uv：

```powershell
pnpm install
uv sync --project pipelines/data-foundation
```

PostgreSQL 连接配置保存在：

```text
D:\files\tech-scout\db.txt
```

配置文件不得进入 Git。执行命令时通过 `--db-config` 传入路径，不要在命令行直接写密码。

## 5. 下载与 Raw 验收

每次下载后先检查：

1. 文件来自官方页面，记录来源 URL。
2. 文件大小大于 0，压缩包可以正常读取。
3. ZIP 的 CRC、成员名称和解压后大小一致。
4. 数据范围和文件名符合预期。
5. 许可字段只记录能够确认的内容；无法确认时使用 `not_recorded`。
6. `downloadedAt` 无法可靠还原时使用 `null`；`observedMtimeUtc` 只表示文件系统时间。

原始 ZIP 和解压文件都保留。ZIP 是官方原始证据，解压文件是处理输入，两者通过 manifest 关联。

## 6. Source Manifest

来源登记配置位于 Git，生成产物位于数据目录。当前快照命令：

```powershell
uv run --project pipelines/data-foundation data-foundation source generate `
  --data-root "D:\files\project-data" `
  --snapshot 2026-09-02

uv run --project pipelines/data-foundation data-foundation source verify `
  --manifest "D:\files\project-data\releases\source-2026-09-02\manifest.json"
```

`generate` 会流式计算全部文件 SHA-256。正式 release 已存在时不得删除重建；日后新增或替换来源文件，应使用新的 snapshot。

验收要求：

- 登记文件全部存在且大于 0。
- 没有未声明文件。
- SHA-256 是 64 位十六进制值。
- ZIP 与解压成员映射完整。
- 重复验证结果一致。

## 7. Bronze 构建

Bronze 尽量保留来源字段，并为每行增加：

```text
_source_release
_source_path
_source_sha256
_source_row_number
```

当前 release 的构建和验证：

```powershell
uv run --project pipelines/data-foundation data-foundation bronze build `
  --data-root "D:\files\project-data" `
  --source-manifest "D:\files\project-data\releases\source-2026-09-02\manifest.json" `
  --version v1

uv run --project pipelines/data-foundation data-foundation bronze verify `
  --manifest "D:\files\project-data\bronze\source-2026-09-02-v1\manifest.json"
```

相同版本存在时只验证、不覆盖。Bronze 是离线分析层，不整体导入 PostgreSQL。

## 8. Silver 构建

Silver 只保存目标领域的规范数据。领域判断使用确定性 CPC、标题词、排除词和固定评分，规则发生变化时必须生成新 release。

当前 v6 的完整输入示例：

```powershell
uv run --project pipelines/data-foundation data-foundation silver build `
  --bronze-manifest "D:\files\project-data\bronze\source-2026-09-02-v1\manifest.json" `
  --rules "config\domains\ai-domains-v1.yaml" `
  --version 2026-09-v6 `
  --review-file "D:\files\project-data\reviews\ai-domains\2026-09-v6-cumulative.json" `
  --review-evidence-manifest "D:\files\project-data\reviews\ai-domains\2026-09-b1\manifest.json" `
  --review-evidence-manifest "D:\files\project-data\reviews\ai-domains\2026-09-b2\manifest.json" `
  --review-evidence-manifest "D:\files\project-data\reviews\ai-domains\2026-09-b3\manifest.json" `
  --review-evidence-manifest "D:\files\project-data\reviews\ai-domains\2026-09-b4\manifest.json"

uv run --project pipelines/data-foundation data-foundation silver verify `
  --manifest "D:\files\project-data\silver\ai-domains\2026-09-v6\manifest.json"
```

构建器会验证 Bronze、规则、累计审核文件、全部证据 manifest、证据 ID 唯一性、外键关系和输出 hash。

发布条件：

- `status=passed`。
- `publishable=true`。
- 两个目标领域均达到质量基线。
- 正式关系不存在孤儿。
- 每个审核决定引用的证据都可解析。
- 活动队列符合该 release 的预期。

## 9. 公司审核

公司候选来自目标专利的原始受让人名称和国家。调查优先级：

1. GLEIF 法律名称、别名、LEI 和注册状态。
2. SEC CIK、当前名称和历史名称。
3. ROR 的高校、研究机构、政府和医疗机构。
4. 对应国家注册机构、监管披露和公司官网。

允许的终态：

| 终态                    | 含义                                               | 生成公司—专利关系 |
| ----------------------- | -------------------------------------------------- | ----------------- |
| `accepted`              | 官方稳定标识，或两项独立官方证据确认法律实体       | 是                |
| `rejected`              | 当前匹配建议被确认错误                             | 否                |
| `non_company`           | 官方证据确认是高校、研究机构、政府、医疗机构或个人 | 否                |
| `verified_unmatched`    | 主体有效，但不能安全映射为规范公司                 | 否                |
| `insufficient_evidence` | 完成一轮官方调查后证据仍不足                       | 否                |

审核规则：

- 名称关键词只能用于调查分流，不能直接决定主体类型。
- 专利只关联实际法律受让人，不直接归并母公司。
- 接受本地实体时优先使用注册机构和注册号生成稳定 ID。
- 每项必须记录方法、实际调查时间、证据及附件 SHA-256。
- 自动证据判断使用 `Codex evidence rule`，不得标记为用户确认。
- 正式审核批次不可覆盖；追加决定后生成新的累计审核文件和 Silver release。

审核批次命令接口：

```powershell
uv run --project pipelines/data-foundation data-foundation review prepare --help
uv run --project pipelines/data-foundation data-foundation review verify --manifest "<review-release>\manifest.json"
```

批次参数必须根据上一个 Silver 的活动队列确定，不要复用本指南中的历史候选数量。

## 10. PostgreSQL 发布

Catalog 只接受已通过验证且 `publishable=true` 的 Silver release。

```powershell
uv run --project pipelines/data-foundation data-foundation catalog migrate `
  --db-config "D:\files\tech-scout\db.txt"

uv run --project pipelines/data-foundation data-foundation catalog import `
  --db-config "D:\files\tech-scout\db.txt" `
  --manifest "D:\files\project-data\silver\ai-domains\2026-09-v6\manifest.json"

uv run --project pipelines/data-foundation data-foundation catalog verify `
  --db-config "D:\files\tech-scout\db.txt" `
  --release 2026-09-v6 `
  --manifest "D:\files\project-data\silver\ai-domains\2026-09-v6\manifest.json"
```

导入流程：

```text
验证 Silver 和全部上游 hash
  → COPY 到 UNLOGGED staging
  → 行数、重复和关系检查
  → 事务内 UPSERT 到 catalog
  → 登记 release 和记录映射
  → 清空本次 staging
```

同一 release 和 manifest 重复执行 `import` 时只验证、不重写。相同 release 对应不同 manifest 时必须失败。

产品查询只使用 `catalog`。完整 21 张 Catalog 表和 16 张 Staging 表的用途见[数据底座参考](./database-and-data-status.md)。

## 11. 最小研究报告

当前报告构建和验证：

```powershell
uv run --project pipelines/data-foundation data-foundation report minimal build `
  --db-config "D:\files\tech-scout\db.txt" `
  --release 2026-09-v6 `
  --domain ai_chips_edge_inference `
  --version 2026-09-v5

uv run --project pipelines/data-foundation data-foundation report minimal verify `
  --manifest "D:\files\project-data\reports\ai-chips-edge-inference\2026-09-v5\manifest.json" `
  --db-config "D:\files\tech-scout\db.txt"
```

报告生成器只读已发布 Catalog，不调用第三方 API，不用 LLM 补全事实。关键事实引用覆盖率必须为 100%。

## 12. 新数据发布流程

每次更新按以下顺序执行：

1. 将新下载文件放入隔离的 inbound 目录。
2. 检查来源、许可、覆盖范围、压缩完整性和文件大小。
3. 更新受版本控制的来源登记配置。
4. 生成并验证新的 Source snapshot。
5. 构建并验证新的 Bronze release。
6. 使用版本化领域规则构建 Silver。
7. 如有活动候选，生成审核批次、保存证据并构建新的累计审核文件。
8. 验证 Silver 的 hash、行数、schema、质量检查和可发布状态。
9. 执行 migration，幂等导入 Catalog 并独立验证。
10. 重建引用报告。
11. 更新[数据底座参考](./database-and-data-status.md)中的当前版本、行数和边界。
12. 生成数据库备份，并运行项目测试和格式检查。

不要修改旧 Source、Bronze、Silver、Review 或 Report release。

## 13. 备份与恢复

Catalog 可以从 Silver 重建，但完成新 release、migration 或人工审核后仍建议生成 PostgreSQL custom-format dump。密码使用 `.pgpass`、`PGPASSFILE` 或交互方式提供。

推荐恢复顺序：

1. 验证 Source、Bronze 和 Silver manifest。
2. 执行 `data-foundation catalog migrate`。
3. 执行 `data-foundation catalog import`。
4. 执行 `data-foundation catalog verify`。
5. 只有存在不可重建的 App 数据时，才从 dump 恢复 App schema。

不要因为已经有数据库备份而删除 Raw、manifest、Bronze、Silver 或审核证据。

## 14. 发布前检查

```powershell
uv run --project pipelines/data-foundation pytest pipelines/data-foundation/tests
uv run --project pipelines/data-foundation ruff check pipelines/data-foundation
pnpm test
pnpm format:check
git diff --check
```

此外必须独立运行当前 Source、Bronze、Silver、Review、Catalog 和报告的 `verify` 命令。任何 hash、行数、schema、来源路径或关系不一致都应阻止发布。
