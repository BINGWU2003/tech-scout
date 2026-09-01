# TechScout 垂直领域公司—专利数据库建设与数据导入说明

> 文档状态：方案基线 v1.1  
> 适用阶段：Data Spike 与 MVP  
> 更新日期：2026-09-01  
> 关联文档：[TechScout 产品需求文档](./product-requirements.md)

## 1. 文档目的

本文档补充说明 TechScout 在没有商业全量公司库和专利库的情况下，如何合法、可重复地获得足以跑通产品流程的数据。

重点回答以下问题：

- 公司和专利数据从哪里来。
- 是否需要提前将数据放入自己的数据库。
- 数据库中的初始数据如何生成，而不是手写 SQL。
- 如何从专利权人反向发现和核验公司。
- 如何先构建最小可用的垂直领域公司—专利数据库。
- 数据底座达到什么条件后才能进入完整产品开发。
- 第一阶段应该采集多少数据，以及如何判断数据链路可行。

## 2. 核心结论

TechScout 采用“垂直领域公司—专利主库 + 研究工作集 + Fixture/Replay”的分层策略：

1. 完整产品开发前，先建立最小可查询的公司—专利数据库，并通过 Data Gate。
2. 垂直领域主库是产品核心数据资产，持续积累公司、专利、主体关系和来源历史。
3. 第一版主库由小规模种子数据集初始化；Data Gate 通过后再逐步扩充，不等待数据库达到最终规模。
4. 用户发起真实研究时优先查询主库，再通过公开数据源增量补充研究工作集和主库。
5. 不镜像全球公司、专利、论文或新闻数据库。
6. 数据集的权威来源是 JSONL/Parquet、manifest 和构建记录，而不是 SQL 插入语句或数据库 dump。
7. PostgreSQL 是运行载体；MinIO 保存原始快照；Git 只保存构建代码、查询配置、人工审核映射和少量 Fixture。

### 2.1 正确开发顺序

```text
数据库 migration 与数据构建脚本
  ↓
采集 200–500 件专利并核验至少 10 家公司
  ↓
建立公司—专利关系和来源追溯
  ↓
通过 Data Gate
  ↓
开发完整 React / NestJS / Agent 产品
  ↓
产品开发与垂直领域主库扩充并行
```

“先构建数据库”指先完成最小可用数据底座，不是先下载全球全部数据。数据库不存在一次性“全部建完”的时刻。

## 3. 总体数据链路

```text
用户输入技术问题
  ↓
Planner 生成关键词、CPC、排除条件和时间范围
  ↓
EPO OPS / USPTO ODP 检索专利
  ↓
提取申请人、受让人和专利族
  ↓
公司名称归一化并生成实体候选
  ↓
GLEIF / SEC / Companies House 核验法律主体
  ↓
OpenAlex / ROR 补充科研活动
GDELT / RSS / 官网补充新闻和产品证据
  ↓
高置信度自动确认，中低置信度人工审核
  ↓
原始快照写入 MinIO
规范化实体和事实写入 PostgreSQL
数据包输出为 JSONL/Parquet
  ↓
Agent 检索、排序、引用和生成报告
```

该链路以专利作为企业发现主线，但不会把“拥有专利”当作企业存在或商业能力的唯一证明。

## 4. 数据获取原则

### 4.1 先检索，后获取详情

外部数据访问分两步：

1. `search`：仅获取候选 ID、标题、名称、日期等轻量结果。
2. `fetch`：只对进入研究工作集的候选获取完整详情。

这样可以减少 API 调用、存储量和无效数据清洗工作。

### 4.2 保存垂直领域主库和研究工作集

MVP 保存三类数据：

- 垂直领域主库：属于 AI 芯片和工业视觉范围的公司、专利族、权利主体及其关系。
- 研究工作集：用户某次研究实际命中的数据和最终报告引用。
- 测试数据：为实体消歧、评测、Fixture 和 Replay 所需的小样本。

不保存与当前领域无关的全量返回结果。主库数据必须满足领域范围、来源许可和最低质量要求。

### 4.3 原始数据与推断分离

必须区分：

- 来源原始记录。
- 经过规则清洗的规范化数据。
- 模型抽取的事实。
- 模型归纳或推断的结论。
- 用户人工确认的数据。

模型推断不能覆盖来源原文，也不能直接成为权威工商事实。

## 5. 专利数据获取

### 5.1 EPO Open Patent Services

官方入口：[EPO OPS](https://developers.epo.org/)

MVP 用途：

- 按关键词、CPC、申请人和时间检索全球专利。
- 获取书目信息、优先权、申请人、发明人和专利族。
- 获取可用的法律状态、摘要、全文或图像信息。

接入要求：

- 注册开发者账号。
- 创建应用并获得 OAuth 凭证。
- 遵守 OPS 使用条款、fair-use 和账户配额。
- 实施前以账号控制台确认当前速率和周期配额。

限制：

- 不适合系统性镜像全球专利库。
- 不同国家、年份和文献的字段完整度不同。
- “数据来自全球数据库”不代表每件专利都有同等完整的全文、图像和法律状态。
- 连接器必须允许字段为空，并记录数据覆盖情况。

### 5.2 USPTO Open Data Portal / PatentsView

官方入口：[USPTO Open Data Portal](https://data.uspto.gov/)

MVP 用途：

- 补充美国专利和申请数据。
- 获取适合分析的专利字段。
- 利用 PatentsView 相关数据改善美国发明人和受让人消歧。

接入要求：

- 按新 ODP 合约申请 API key。
- 开发前验证当前 endpoint、schema、分页和限额。
- 将 ODP 实现封装为可替换连接器。

注意事项：

- 旧 `api.patentsview.org` 已迁移，不能作为新项目依赖。
- 不能假定旧接口字段与新接口完全一致。
- 迁移期必须保留契约样本和连接器测试。

### 5.3 人工核验入口

- Espacenet：核验 EPO 相关专利和专利族。
- Google Patents：提供用户人工查看和搜索链接。
- CNIPA：核验中国专利权威页面。

Google Patents 没有适合作为系统稳定依赖的官方公共开发者 API，MVP 不批量爬取其网页。

### 5.4 专利标准化字段

进入 PostgreSQL 的专利记录至少包含：

- 来源及来源外部 ID。
- 出版号、申请号和规范化号码。
- 标题和摘要。
- 优先权日、申请日和公开日。
- 申请人、受让人和发明人。
- CPC/IPC 分类。
- 专利族 ID。
- 可用法律状态及其来源时间。
- 来源 URL、采集时间和内容 hash。
- 原始响应的 MinIO URI。
- 与技术方向的相关性及计算依据。

## 6. 公司数据获取

公司数据不是先购买一个全量库，而是从专利、论文、新闻和用户清单产生候选，再逐个核验。

### 6.1 GLEIF

官方入口：[GLEIF API](https://www.gleif.org/en/lei-data/gleif-api/)

用途：

- 查询拥有 LEI 的全球法律实体。
- 获取规范名称、地址、注册机关信息和部分母子关系。
- 根据名称和地址帮助实体消歧。

特点：

- API 和数据可免费访问。
- GLEIF 数据采用 CC0。
- LEI 不覆盖所有公司，未命中不能推导公司不存在。

### 6.2 SEC EDGAR

官方入口：[SEC EDGAR API](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)

用途：

- 核验美国 SEC 申报主体。
- 获取 CIK、名称、曾用名、ticker、交易所和申报历史。
- 补充公开申报和 XBRL 财务事实。

接入要求：

- 无需 API key。
- 请求必须声明合规的 User-Agent 和联系方式。
- 总请求速率不超过 SEC 当前官方限制；实现时默认控制在 10 请求/秒以内，并预留更保守配置。

### 6.3 Companies House

官方入口：[Companies House API](https://developer.company-information.service.gov.uk/)

用途：

- 核验英国公司。
- 获取公司状态、地址、高管和申报历史等字段。

接入要求：

- 注册应用并获得 API key。
- 遵守当前速率限制，默认按官方 5 分钟 600 次请求配置限流。
- 每次构建数据集前重新核查许可和速率说明。

### 6.4 OpenAlex 与 ROR

用途：

- 查询企业或研究机构参与的论文。
- 补充科研主题、作者机构和论文证据。
- 使用 ROR、Wikidata 等 ID 辅助机构对齐。

限制：

- 它们是科研知识来源，不是工商权威数据库。
- OpenAlex 中的 `company` 机构也不代表覆盖全部商业公司。

### 6.5 OpenCorporates

MVP 暂不作为默认依赖。

原因：

- 需要申请 API key。
- 免费使用通常带有开放、署名和 share-alike 等条件。
- 私有作品演示或未来商业使用需要确认适用许可或购买方案。

只有许可明确后才能新增对应连接器。

## 7. 中国公司和专利数据边界

个人 MVP 暂不承诺完整的中国工商或专利数据。

可实施方案：

- 通过 EPO OPS 获取其覆盖范围内的中国专利元数据。
- 通过 CNIPA 人工核验重点专利。
- 通过国家企业信用信息公示系统人工核验重点公司。
- 接受用户上传 CSV，补充统一社会信用代码、官网和公司别名。
- 在报告中显示“中国工商字段可能不完整”。

禁止事项：

- 绕过验证码或登录限制。
- 批量抓取国家企业信用信息公示系统、CNIPA、企查查或天眼查网页。
- 未经合同授权调用商业数据接口或保存其数据。

企查查、天眼查等未来只能作为取得正式授权后的 `CompanySourceAdapter` 接入。

## 8. 首批 AI 领域

### 8.1 AI 芯片 / 边缘推理加速

建议范围：

- NPU、神经网络加速器和张量处理器。
- 边缘 AI SoC 和低功耗推理。
- 硬件量化、稀疏计算和模型压缩。
- 存内计算、类脑或神经形态计算。

初始检索骨架：

- CPC 起点：`G06N 3/063`。
- 关键词：`neural processing unit`、`neural accelerator`、`tensor processor`、`edge inference`、`in-memory computing`。
- 再与处理器、存储、集成电路和边缘设备分类交叉。

排除：

- 没有 AI 特定权利要求的通用 CPU/GPU。
- 纯晶圆制造、封装和散热。
- 纯云调度、模型 API 和普通软件优化。

### 8.2 工业视觉 / AI 质检

建议范围：

- AOI 自动光学检测。
- 表面缺陷、晶圆、焊点和零部件检测。
- 产线 2D/3D 视觉、视觉测量和异常检测。
- 工业相机和边缘视觉控制器。

初始检索骨架：

- CPC 起点：`G06V`、`G06T`。
- 与 `B07C` 分选、`G01N` 材料检测和具体制造工艺交叉。
- 关键词：`automated optical inspection`、`surface defect detection`、`machine vision inspection`。

排除：

- 医学影像。
- 人脸识别和公共安防。
- 自动驾驶感知。
- 普通消费相机算法。

### 8.3 查询策略要求

- 不只使用关键词，否则会产生大量语义误报。
- 不只使用 CPC，否则容易漏掉新术语和跨分类专利。
- 使用“CPC 交集 + 标题/摘要/权利要求关键词 + 排除词”的混合策略。
- Data Spike 期间保留所有查询版本和过滤统计。

## 9. 垂直领域主库与种子数据集

垂直领域主库是长期运行的 PostgreSQL/MinIO 数据资产；种子数据集是它的首个可重建版本。种子数据集由四部分组成：

1. 原始来源快照。
2. 规范化 JSONL/Parquet 数据包。
3. 人工审核的实体映射。
4. 描述来源和构建过程的 manifest。

它不是：

- 手工维护的 SQL `INSERT` 文件。
- 一份无法追溯来源的数据库 dump。
- 每次启动都重新调用外部 API 的临时数据。
- 全球数据源的本地完整镜像。

## 10. 数据库首批数据如何产生

### 10.1 构建配置

每个领域维护一份查询配置。以下仅为格式示意，实际字段需根据连接器实现确定：

```yaml
dataset: ai-edge-accelerator
version: 2026-09-v1
sources:
  - provider: epo-ops
    queries:
      - cpc: G06N/3/063
        keywords:
          - neural accelerator
          - edge inference
        exclude:
          - thermal package
  - provider: openalex
    queries:
      - edge AI accelerator
  - provider: gdelt
    queries:
      - edge AI chip
limits:
  patents: 500
  companies: 30
  news: 200
```

### 10.2 构建步骤

1. Builder 读取领域查询配置。
2. 连接器调用公开 API，并把原始响应写入 MinIO。
3. Parser 将不同来源转换为内部标准结构。
4. Patent Normalizer 规范化号码、日期、分类、申请人和专利族。
5. Candidate Extractor 从申请人、论文机构和新闻实体产生公司候选。
6. Entity Matcher 使用名称、外部 ID、官网、地址和司法辖区匹配公司。
7. 高置信度候选自动确认，中低置信度候选输出审核 CSV。
8. 用户人工确认关键别名、母子公司和 IP 控股主体。
9. Builder 生成规范化 JSONL/Parquet 和 manifest。
10. Loader 根据业务唯一键幂等写入 PostgreSQL。
11. 从完整数据集中裁剪少量 Fixture。
12. 生成连接器和 Agent 的 Replay 记录。

### 10.3 建议命令

以下是计划中的命令边界，不代表当前仓库已经实现：

```text
python -m intelligence.datasets build ai-edge-accelerator --version 2026-09-v1
python -m intelligence.datasets review ai-edge-accelerator-2026-09-v1
python -m intelligence.datasets load ai-edge-accelerator-2026-09-v1
python -m intelligence.datasets verify ai-edge-accelerator-2026-09-v1
```

### 10.4 人工审核 CSV

审核文件建议包含：

| 字段 | 说明 |
| --- | --- |
| candidate_name | 专利或新闻中的原始名称 |
| normalized_name | 规则归一化后的名称 |
| candidate_company_id | 建议匹配的规范公司 |
| external_ids | LEI、CIK、注册号等 |
| website | 建议官网 |
| jurisdiction | 司法辖区 |
| confidence | 自动匹配置信度 |
| match_features | 命中的匹配特征 |
| decision | `accept`、`reject` 或 `new_entity` |
| reviewer_note | 人工说明 |

人工确认结果应当被版本控制，但不能包含许可受限或敏感数据。

## 11. 数据库建设规模

### 11.1 Data Gate 最小规模

- 每个领域检索 200–500 件专利。
- 每个领域提取 20–50 个唯一受让人候选。
- 每个领域人工确认至少 10–15 家公司。
- 每家公司补充少量论文、官网和新闻证据。

这些数据需要真正导入 PostgreSQL，并能够按技术查询公司、按公司查询专利。它们不是只放在文件中的演示样本。

### 11.2 Data Gate 通过后的 MVP 目标

- 两个领域合计形成 200–500 个候选公司主体。
- 逐步积累 5000–20000 个去重后的相关专利族。
- 建立规范公司、别名、专利权人、母子公司和 IP 控股主体关系。
- 为重点公司补充论文、官网、新闻和公开活动证据。

该目标与产品开发并行完成，不作为启动 React/NestJS 开发的前置硬门槛。来源配额或许可不支持目标规模时，应降低规模或改用正式批量数据方案，不能违规扩大 API 抓取。

### 11.3 规模扩展原则

- 优先增加相关专利族，不按同族多国文献虚增数量。
- 优先保证公司—专利关系和来源正确，再增加记录数。
- 先增加能稳定映射到法律主体的公司，再处理低置信度长尾主体。
- 当主库达到数百万专利并出现明显分析压力后，再评估 DuckDB、ClickHouse 或搜索集群。

## 12. 数据集文件结构

建议本地目录：

```text
data/
  datasets/
    ai-edge-accelerator/
      2026-09-v1/
        manifest.json
        companies.jsonl
        company-aliases.jsonl
        patents.parquet
        patent-parties.parquet
        publications.parquet
        news-events.jsonl
        entity-review.csv
  raw/
    epo-ops/
    uspto-odp/
    gleif/
    openalex/
    gdelt/
  replay/
  fixtures/
```

完整 `data/` 默认加入 `.gitignore`。仓库只保留少量许可明确的 Fixture、查询配置和审核映射。

### 12.1 manifest 示例字段

```json
{
  "dataset": "ai-edge-accelerator",
  "version": "2026-09-v1",
  "createdAt": "2026-09-01T00:00:00Z",
  "schemaVersion": "1",
  "sources": [
    {
      "provider": "epo-ops",
      "queryConfigHash": "...",
      "retrievedAt": "...",
      "licensePolicy": "local-research",
      "recordCount": 500
    }
  ],
  "files": [
    {
      "path": "patents.parquet",
      "sha256": "...",
      "recordCount": 500
    }
  ]
}
```

## 13. 数据库存储

### 13.1 PostgreSQL

建议至少建立以下表：

- `company_entity`
- `company_alias`
- `company_relation`
- `external_identifier`
- `entity_match`
- `patent`
- `patent_family`
- `patent_party`
- `company_patent_relation`
- `publication`
- `news_event`
- `source_record`
- `fact_claim`
- `dataset_version`
- `dataset_record`

数据库 migration 只负责表、索引和约束，不负责生成业务数据。

Loader 从 JSONL/Parquet 读取数据，并根据以下业务键执行 upsert：

- 公司：内部规范 ID；强标识使用 LEI、CIK 或注册号唯一约束。
- 专利：来源 + 规范化出版号或申请号。
- 专利族：来源 + 专利族 ID。
- 来源记录：来源 + 外部 ID + 内容 hash。
- 数据集记录：数据集版本 + 实体类型 + 实体 ID。

### 13.2 MinIO

保存：

- API 原始 JSON/XML。
- 允许保存的 HTML 和 PDF。
- 用户上传文件。
- 大型正文、图片和专利文档。

PostgreSQL 只保存对象 URI、hash、MIME、来源、许可和保留期限。

### 13.3 pgvector

只向量化：

- 最终报告可能使用的专利摘要或权利要求片段。
- 选中网页的必要证据片段。
- 用户上传文档的有效分块。

不对全部原始数据无差别生成向量。

## 14. 公司实体消歧

### 14.1 归一化规则

名称预处理可以：

- 统一大小写、Unicode 和空白。
- 移除仅用于比较的常见公司后缀，如 `Inc.`、`Ltd.`、`LLC`。
- 保留原始名称，不能只保存清洗结果。
- 保存中文名、英文名和历史名称之间的别名关系。

### 14.2 匹配优先级

1. LEI、CIK、注册号等强标识完全一致。
2. 官方域名和司法辖区一致。
3. 地址和规范名称高度一致。
4. 名称相似且专利、论文或新闻上下文一致。
5. 仅名称相似但缺少辅助证据。

第 1–2 类可以在无冲突时自动确认；第 3–5 类应进入人工审核。

### 14.3 不能自动合并的情况

- 集团公司和其运营子公司。
- 品牌名和法律主体。
- IP 控股公司和实际产品公司。
- 并购前后主体。
- 相同名称但不同司法辖区的公司。
- 大学实验室、研究机构和其孵化企业。

这些关系应建模为显式关系，而不是简单覆盖成同一公司。

## 15. Live、Fixture 与 Replay

### 15.1 Live

- 调用真实公开数据源。
- 先复用未过期缓存，再增量获取。
- 保存本次研究使用的数据和来源快照。
- 受速率、配额和来源可用性影响。

### 15.2 Fixture

- 仓库内保存几十条许可明确的小样本。
- 不访问网络。
- 用于单元、集成和端到端测试。
- 内容覆盖正常、缺失、冲突和实体歧义场景。

### 15.3 Replay

- 重放历史工具响应、状态事件和模型结构化输出。
- 用于稳定产品演示和 UI 调试。
- 每条 Replay 绑定连接器、提示词、工作流和数据集版本。

## 16. 数据更新策略

- 每个来源独立配置 TTL。
- 专利书目和专利族可使用较长 TTL。
- 法律状态、公司状态和新闻使用更短 TTL。
- 活跃领域主库最多每周执行一次计划增量刷新；用户研究仍可按需补充单条或小批量数据。
- 固定评测始终绑定特定数据集版本，不随 Live 数据变化。
- 新数据先进入暂存区，完成去重和实体审核后再发布新版本。
- 报告显示数据截止时间和每个来源的采集时间。

## 17. 合规和许可检查

每个连接器实现前必须记录：

- 官方入口和开发者文档。
- 是否需要注册、API key 或 OAuth。
- 当前速率和配额。
- 是否允许缓存、长期保存和再分发。
- 原始正文与派生元数据的权利差异。
- User-Agent、署名或引用要求。
- 数据删除或更正机制。

新闻特别规则：

- GDELT 的新闻索引和派生数据不等于拥有新闻正文版权。
- 默认保存标题、URL、时间、来源和必要引用片段。
- 只有来源条款允许时才保存完整正文快照。

## 18. 最小数据库与 Data Gate 执行计划

### 第 1–2 天：账户与连接器验证

- 注册 EPO OPS。
- 申请 USPTO ODP API key。
- 验证 GLEIF、OpenAlex 和 GDELT 请求。
- 记录认证、字段、分页、限流和错误样本。
- 确定原始响应的 MinIO 命名规则。

### 第 3–4 天：专利最小链路

- 实现 EPO `search` 和 `fetch`。
- 为两个领域各抽取 200 件专利。
- 规范化专利号、日期、CPC 和申请人。
- 完成初步专利族归并。

### 第 5 天：企业候选与核验

- 提取唯一受让人。
- 清洗名称并查询 GLEIF。
- 输出 `entity-review.csv`。
- 人工确认至少 10 家公司。

### 第 6–7 天：补充证据与入库

- 接入 OpenAlex 和 GDELT 最小查询。
- 补充论文、新闻和官网证据。
- 输出第一版 JSONL/Parquet 和 manifest。
- Loader 幂等导入 PostgreSQL。
- 原始快照写入 MinIO。

### 第 8–10 天：Data Gate 评估与最小报告

- 比较两个领域的唯一受让人数量。
- 统计实体映射率、误报率和头部集中度。
- 建立 Fixture 和 Replay。
- 生成一份带引用的最小公司研究报告。
- 决定是否保留两个领域，或用自动驾驶感知替换表现较差的领域。

## 19. Data Gate 验收标准

满足以下条件才进入完整 React、NestJS 和 Agent 产品开发：

- 至少一个领域获取 200 件以上相关专利。
- 至少发现并核验 10 家公司。
- 每家核心公司能够关联至少一种二次证据。
- 每条规范化专利能够追溯到原始来源。
- 公司匹配结果能够区分自动确认和人工确认。
- 同一数据集可以重复导入且不产生重复记录。
- Fixture 模式可以完全离线运行。
- Replay 模式可以稳定重放一次完整研究。
- 最小报告的关键事实具有引用。
- 已记录 API 配额、许可和字段覆盖风险。

通过 Data Gate 后，数据库不停止建设。完整产品开发与以下工作并行推进：

- 将有效专利族逐步扩充到目标范围。
- 增加 USPTO、SEC、Companies House 等连接器。
- 持续审核公司别名、母子关系和权利转让。
- 生成新的主库增量版本并执行质量回归。

## 20. 暂不实施事项

- 全球专利全量同步。
- OpenAlex 全量快照下载。
- Common Crawl 全量下载。
- 新闻正文批量归档。
- 中国工商网站或商业数据网站爬虫。
- 为全部原始文本生成向量。
- 复杂知识图谱、ClickHouse 或大规模搜索集群。
- 自动判断所有母子公司和并购关系。

当垂直领域主库达到数百万专利并需要大规模离线统计时，再考虑 Parquet、DuckDB 或 ClickHouse；MVP 不让 PostgreSQL 承担全球分析仓库职责。

## 21. 实施前检查清单

- [ ] EPO OPS 账号、OAuth 和配额已验证。
- [ ] USPTO ODP key 和新接口 schema 已验证。
- [ ] GLEIF 查询和匹配样本已验证。
- [ ] 两个 AI 领域查询配置已人工检查。
- [ ] 原始、规范化、推断和人工确认数据已分层。
- [ ] MinIO、PostgreSQL 和本地数据包分工已确定。
- [ ] 数据集 manifest schema 已定义。
- [ ] 实体审核 CSV 字段已定义。
- [ ] Git 忽略规则覆盖原始数据、数据卷和密钥。
- [ ] 每个连接器的许可和限流说明已记录。
- [ ] Fixture 和 Replay 不包含不可再分发内容。
- [ ] Data Gate 验收指标已自动化统计。
- [ ] Data Gate 未通过前不启动完整产品页面和多 Agent 主链开发。
