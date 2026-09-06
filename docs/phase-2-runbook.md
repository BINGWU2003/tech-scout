# 阶段 2：研究主链使用与验收

> 2026-09-06：阶段 2 后端主链已实现，并完成一次真实 DeepSeek 后端验收。技术链路通过，企业类型与研究相关性质量仍需修正，详见[真实验收记录](./phase-2-acceptance-2026-09-06.md)。自动化测试的模型桩结果与真实验收分别记录。

## 1. 本阶段交付

通过 NestJS API 创建研究项目，Python 执行 `context → planner → plan_gate → snapshot → patent → company → entity → evidence → finish`。最终结果为最多 10 家候选企业及其专利依据、模型归纳、身份来源和缺失项。阶段 3 的页面、报告生成、上传和追问尚未实现。

- Python 使用 LangGraph、FastAPI、独立 PostgreSQL checkpoint 和持久化事件；NestJS 独占 app 业务写入，接收结构化结果和 SSE，再持久化并向用户提供查询。
- Planner 和 Evidence 调用 DeepSeek；查询、规范实体复用、去重、统计和排序由程序完成。初次正常运行通常为 2 次模型请求；空结果不调用 Evidence 模型。
- 当前默认 `deepseek-v4-flash`、关闭 thinking，通过 OpenAI SDK 的 Chat Completions 接口请求 JSON，再执行本地 Pydantic 和引用 ID 校验。不启用 Beta strict tools 或自主工具循环。
- 创建运行时固定模型、公开端点、输出上限、超时、费率和工作流/提示词版本，保存在 `execution_config`；恢复不会改用新环境中的模型或费率。密钥不进入工作集，模型别名对应的实际响应模型另行记录。
- 默认累计实际执行时间 300 秒、模型请求最多 6 次、估算预算 ¥1，均由服务端环境变量配置。人工等待不计时；主动重试沿用原运行预算，不重置计数。
- 费用按配置的未缓存高峰单价预留，输入用 UTF-8 字节数加协议余量作保守估算，输出按 token 上限预留。预留不退回，未知结果也保留预留；实际返回 usage 单独记录估算费用，最终账单以提供方为准。
- 模型错误、空内容、截断、结构或引用不合法均返回失败，不自动重试、不进入后续节点、不生成降级名单。SDK 的默认自动重试已关闭。

## 2. 本地配置与启动

分别参考 [Intelligence 环境模板](../services/intelligence/.env.example)和 [API 环境模板](../apps/api/.env.example)，把本地配置保存在各自忽略 Git 的 `.env`。不要把密钥填入模板或提交源码。

| 配置                                  | 用途                                                               |
| ------------------------------------- | ------------------------------------------------------------------ |
| `INTELLIGENCE_DATABASE_URL`           | Python 运行库连接，写入 `agent_runtime`；迁移账号需能创建此 schema |
| `INTELLIGENCE_CATALOG_DATABASE_URL`   | Python Catalog 只读连接，建议使用只具备 catalog SELECT 权限的角色  |
| `INTELLIGENCE_INTERNAL_TOKEN`         | Node/Python 共用的随机内部令牌，Python 要求至少 32 字符            |
| `INTELLIGENCE_URL`                    | NestJS 连接 Python 的地址，默认使用 `http://127.0.0.1:8001`        |
| `DEEPSEEK_API_KEY`                    | 仅存于 Python 服务本地配置                                         |
| `DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL` | 默认 `https://api.deepseek.com` 和 `deepseek-v4-flash`             |

Catalog 和 App 可与 runtime 位于同一个 PostgreSQL 数据库，但 schema 权限和写入所有者不同。迁移由开发者显式执行，Python 服务启动不会自动发布 Catalog 或迁移 App。

环境变量中的数据库 URL 不需要附加 `schema` 参数。NestJS 的 Prisma adapter 和模型指定 `app`；`prisma.config.ts` 为 CLI 连接统一补入 `schema=app`，确保复用 `app._prisma_migrations` 中的迁移历史。Python 通过连接的 `search_path` 和完整表名指定 `agent_runtime`，Catalog 查询指定 `catalog`。

在仓库根目录执行：

```powershell
pnpm --filter @tech-scout/api prisma:migrate
uv sync --project services/intelligence
uv run --project services/intelligence python -m tech_scout_intelligence.migrate
uv run --project services/intelligence python -m tech_scout_intelligence
```

再在另一个终端启动 NestJS：

```powershell
pnpm --filter @tech-scout/api dev
```

Python 入口固定监听本机 `8001`，并显式选择 SelectorEventLoop，解决 Windows 下 psycopg 不支持默认 ProactorEventLoop 的问题。若需要自定义端口，可以使用 `uvicorn tech_scout_intelligence.app:app --host 127.0.0.1 --port 8001 --loop asyncio:SelectorEventLoop`。

NestJS 的研究集成是可选配置：未配置内部连接不会阻断原有账户或 Catalog API；创建研究会返回 `503 INTELLIGENCE_UNAVAILABLE`。请求已经保存，恢复连接后按同一运行 ID 补发，不重复创建项目。Python 缺少模型密钥时，运行在 Planner 返回 `MODEL_NOT_CONFIGURED`，可配置后主动重试。

## 3. 产品 API

以下路径包含统一前缀 `/api/v1/research`。所有接口需要登录 Cookie；所有 POST 还需要已有 `x-csrf-token` 和正确 Origin。内部 `/runs` API 只供 NestJS 调用，浏览器不能直连 Python。

| 方法与路径后缀                    | 用途                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------- |
| `POST /projects`                  | 创建项目和首次运行，输入 `requestKey`（UUID）与 `question`                      |
| `GET /projects`                   | 返回当前用户最近最多 100 个项目                                                 |
| `GET /projects/:projectId`        | 项目详情及历史运行列表                                                          |
| `POST /projects/:projectId/runs`  | 在同一项目启动新问题或新计划轮次，输入新 `requestKey` 和 `question`；旧运行保留 |
| `GET /runs/:runId`                | 已持久化的状态、预算、错误和工作集；不会等待模型执行完                          |
| `POST /runs/:runId/actions`       | 确认计划、处理身份、主动重试或取消；每个动作使用稳定的 `action_id`              |
| `GET /runs/:runId/events?after=0` | 按序号补取已保存事件，每页最多 100 条                                           |
| `GET /runs/:runId/stream?after=0` | SSE 推送；支持 `Last-Event-ID` 恢复                                             |

项目请求键在用户内唯一，新运行请求键在项目内唯一。重发同一键及同一内容返回已有资源；同键不同内容冲突。动作 ID 对应一个运行和固定内容，重发不再次执行。用户不能读取或操作其他用户的项目、运行或事件，调用方不能伪造确认者 ID。

### 3.1 创建与确认计划

创建请求：

```json
{
  "requestKey": "c3a432c5-99c6-4e89-81b9-c48043d4250e",
  "question": "寻找工业视觉质检相关的边缘推理公司"
}
```

从响应 `runs[0].id` 获取运行 ID，轮询直到 `awaiting_plan`。读取 `state.artifacts.plan`，编辑后提交下列动作。下例仅说明字段形状，正式执行应以接口实际返回的领域及年份为准：

```json
{
  "action_id": "d86e2038-f2ca-4571-af61-52f05a6b4d80",
  "kind": "confirm_plan",
  "plan": {
    "directions": [
      {
        "domain_id": "ai_chips_edge_inference",
        "name": "边缘推理",
        "keywords": ["inference", "neural"],
        "excluded_keywords": [],
        "cpc_prefixes": [],
        "explanation": "先按领域与标题检索，再检查工业视觉相关性"
      }
    ],
    "from_year": 2019,
    "to_year": 2025,
    "risks": ["仅能分析当前本地数据范围"]
  }
}
```

关键词组内 OR，CPC 前缀组内 OR，关键词与 CPC 条件之间 AND，多个方向之间 OR；排除词匹配标题即排除。空包含词或空 CPC 列表表示不额外限制该项。年份按授权年份筛选，不能超出 release 的覆盖范围；未发布领域不会被接受。

运行先保存规划时的发布版本。计划确认后使用 REPEATABLE READ READ ONLY 事务读取事实、关系和审核依据，保存快照。若此时已发布新版本，则返回 `RELEASE_CHANGED`，需要新运行；不会只靠旧 `dataset_record` 成员映射冒充历史事实。后续节点及主动重试只使用已保存快照。

### 3.2 身份确认

已有自动接受和人工审核结论直接复用；离线的非公司、拒绝和证据不足终态不重新变成待办。新的未知主体或关系与审核结论冲突会进入待确认项，同时保留其他公司的确定性处理结果。

在 `awaiting_entities` 状态，从 `state.artifacts.unverified` 中选择 `requires_confirmation=true` 的条目，为每项提交一个 `confirm`、`reject` 或 `skip` 决定。不确定时可批量跳过；不要求强行匹配才能结束运行。

```json
{
  "action_id": "7404f874-7074-491b-8c81-06fcbe1a5bcd",
  "kind": "resolve_entities",
  "decisions": [
    {
      "candidate_id": "替换为接口返回的候选ID",
      "action": "skip",
      "note": "当前依据不足"
    }
  ]
}
```

`confirm` 还需要快照中已有的 `company_id` 和 `evidence_ids`。引用须属于该候选，并支持所选公司的外部标识，或法律名称与国家；不允许凭任意证据选任意公司。离线明确拒绝或非公司决定不能被本次确认覆盖。决定保存确认者、时间和原依据，只影响当前研究，不修改 Catalog。

### 3.3 结果、错误与恢复

| 状态                 | 用户下一步                                                          |
| -------------------- | ------------------------------------------------------------------- |
| `queued` / `running` | 查询运行或订阅事件；可取消                                          |
| `awaiting_plan`      | 编辑并确认计划                                                      |
| `awaiting_entities`  | 确认、拒绝或跳过待确认主体                                          |
| `completed`          | 查看 `state.artifacts.result` 中的名单、推断与依据                  |
| `empty`              | 查看空结果和未核验主体，创建新运行调整计划；系统不自动放宽条件      |
| `failed`             | 查看 `state.error.code/message/node`，修复原因后主动 `retry` 或取消 |
| `recoverable`        | 进程中断或租约失效后，用 `retry` 恢复                               |
| `cancelled`          | 本运行不再执行；需要继续时创建新运行                                |

主动重试或取消只需提供新的 `action_id` 和 `kind: "retry"` / `"cancel"`。失败 Planner 也允许手动提交 `confirm_plan`；后续节点失败不能借此覆盖已确认计划。已用完原运行预算的重试仍会失败，不会偷偷扩充额度。

返回名单按最高领域规则相关分、去重相关专利数、最近授权年份降序排列，同值按公司 ID 保持稳定。只统计本次工作集，保留公司—专利正式关系或本次人工确认依据；规则分不代表投资价值。模型只能为指定公司引用已提供的专利，不得新增公司或引用其他公司的材料。解释明确标记在 `inference`，不冒充来源原文。

结果中的 `evidence_quality` 按证据 ID 去重，保留身份依据的发布者、观察时间、存档和来源定位可用性；`conflicts` 列出同一候选的标识差异与关系审核冲突，供复核。标识差异可能来自时间变化，不自动判定哪条来源错误。这些证据只支持身份，不证明产品能力，也不意味着已取得来源正文。

Python 通过心跳和租约防止同一运行被重复执行；正常关闭标记可恢复，异常退出后约 20 秒检测到租约过期。LangGraph 保存成功节点检查点；模型调用前独立持久化预算预留，重启不能抹去已发出的调用。模型请求已发出但响应未能保存时不能保证外部调用恰好一次，主动重试可能再次收费，预留与请求数仍累计。

NestJS 持久化命令后发送，内部传输失败可补发同一个动作 ID，这不等同于自动重试模型节点。Python 事件有单调序号；NestJS 先保存事件和状态再向客户端提供 SSE，重连从已保存游标补取，旧事件不会把新状态回退。

## 4. 开发与验证

内部协议由 Pydantic → FastAPI OpenAPI → 自动生成 TypeScript 客户端维护：

```powershell
uv run --project services/intelligence python -m tech_scout_intelligence.export_openapi
pnpm --filter @tech-scout/api intelligence:client
uv run --project services/intelligence python -m tech_scout_intelligence.export_openapi --check
pnpm --filter @tech-scout/api intelligence:client:check
```

不要手工编辑生成目录。前端未来使用的产品输入、状态和响应 Zod 契约位于 `packages/contracts/src/research.ts`。

基础检查：

```powershell
uv run --project services/intelligence ruff check services/intelligence
uv run --project services/intelligence pytest services/intelligence/tests
pnpm --filter @tech-scout/contracts test
pnpm --filter @tech-scout/api test
pnpm --filter @tech-scout/api build
```

真实数据库测试必须指向专用测试库。`TEST_DATABASE_URL` 用于 App，`TEST_CATALOG_DATABASE_URL` 用于 Catalog fixture，`TEST_INTELLIGENCE_DATABASE_URL` 用于 runtime checkpoint。Catalog fixture 会重建 Catalog/staging，原有认证 E2E 会清理账户，禁止配置成日常库；fixture 数据库名称必须以 `_test` 结尾。

完整链路测试还需要 `TEST_INTELLIGENCE_URL` 与 `TEST_INTELLIGENCE_INTERNAL_TOKEN`，以及使用同一隔离库的 Python 服务。测试提供方可单独启动：

```powershell
uv run --project services/intelligence uvicorn mock_deepseek:app --app-dir services/intelligence/tests --host 127.0.0.1 --port 18002 --loop asyncio:SelectorEventLoop
```

此时只给测试 Python 进程设置 `DEEPSEEK_BASE_URL=http://127.0.0.1:18002` 和任意测试 key，不修改正式服务配置。随后运行 `pnpm --filter @tech-scout/api test:e2e`。未设置环境变量的集成测试会明确跳过，不能把跳过当作通过。

自动化覆盖正常与零结果主链、身份跳过和证据校验、模型失败不续跑、版本变化、快照恢复、预算、租约、幂等、CSRF、跨用户隔离和事件恢复。真实 DeepSeek 已完成一次现有领域问题从确认到名单的验收，引用检查通过但内容质量存在待修项，见本文开头的验收记录；本地模型桩只证明系统协议和状态链路。

来源：[DeepSeek 接口](https://api-docs.deepseek.com/)、[JSON 输出](https://api-docs.deepseek.com/guides/json_mode)、[价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)。模型别名及价格会变化，运行记录保存配置模型、响应模型和 usage，调价后应同步环境费率。
