# TechScout 技术选型

> 文档职责：记录 React、NestJS 与 Python Intelligence 的具体技术选择、适用边界和采用状态  
> 更新日期：2026-09-03  
> 组件关系和所有权见[产品与系统架构](./architecture.md)  
> 数据现状和表结构见[数据底座参考](./database-and-data-status.md)

## 1. 状态定义

| 状态          | 含义                                     |
| ------------- | ---------------------------------------- |
| `Implemented` | 已有实际代码并通过测试                   |
| `Installed`   | 依赖和锁文件已经就绪，但尚未完成业务接线 |
| `Adopt`       | 已确定采用，将在对应阶段实现             |
| `Deferred`    | 当前不引入，出现明确需求后再评估         |
| `Rejected`    | 已评估但不符合当前边界，不作为默认技术   |

版本以 `pnpm-lock.yaml` 和各 Python 项目的 `uv.lock` 为准。本文记录当前主要版本，不承诺未来小版本永远不升级。

## 2. 总体选型

| 层           | 主要技术                                                                  | 状态                            |
| ------------ | ------------------------------------------------------------------------- | ------------------------------- |
| React Web    | React 19、Vite 8、TypeScript 6、TanStack、Zod、ky、Tailwind CSS、Radix UI | 账户与 Catalog 界面已接真实 API |
| NestJS API   | NestJS 12、Express、Zod、Kysely、Prisma、PostgreSQL、Pino                 | 账户与只读 Catalog API 已实现   |
| Python Agent | Python 3.13、FastAPI、Pydantic、LangGraph、OpenAI SDK、HTTPX、structlog   | 项目已初始化，服务待实现        |
| 共享契约     | 独立 `@tech-scout/contracts`、Zod 4、OpenAPI                              | 基础包已实现                    |
| 数据底座     | Python、DuckDB、Parquet、psycopg、PostgreSQL                              | 已实现并通过 Data Gate          |
| 数据库       | 本地 PostgreSQL `tech-scout`                                              | Catalog 已发布                  |

浏览器只调用 NestJS。NestJS 和 Python Intelligence 都不能修改 Catalog；Data Foundation 是 Catalog 的唯一发布者。

## 3. React Web

### 3.1 核心框架

| 技术                        | 当前版本 | 用途                              | 状态          |
| --------------------------- | -------- | --------------------------------- | ------------- |
| React                       | 19.2     | 产品界面和组件                    | `Implemented` |
| Vite                        | 8.0      | 开发服务器和生产构建              | `Implemented` |
| TypeScript                  | 6.0      | 静态类型                          | `Implemented` |
| TanStack Router             | 1.x      | 类型化客户端路由                  | `Implemented` |
| TanStack Query              | 5.x      | 服务端状态、缓存和请求生命周期    | `Implemented` |
| TanStack Table              | 8.x      | 公司、专利和审核数据表格          | `Implemented` |
| Tailwind CSS + Radix UI     | 4.x/1.x  | 样式和无障碍基础组件              | `Implemented` |
| React Hook Form + Zod       | 7.x/4.x  | 表单状态和运行时校验              | `Implemented` |
| Zustand                     | 5.x      | 少量跨页面客户端状态              | `Implemented` |
| ky                          | 2.1      | 基于标准 Fetch 的统一 HTTP 客户端 | `Implemented` |
| MSW                         | 2.15     | Fetch 接口 Mock 和前端集成测试    | `Installed`   |
| Vitest Browser + Playwright | 4.x/1.x  | 真实 Chromium 中的组件和交互测试  | `Implemented` |

继续使用客户端渲染，不迁移 Next.js。当前产品是本地优先的研究工作台，没有 SSR、服务端组件或公开 SEO 的必要需求。

### 3.2 请求边界

目标调用链：

```text
React feature
  → TanStack Query
  → 单一 api-client
  → ky / Fetch
  → NestJS
```

- React 组件不能散落直接调用 `fetch` 或 `ky`。
- TanStack Query 负责缓存、失效、重试和加载状态；ky 只负责 HTTP、超时、Cookie 和错误规范化。
- 请求参数和响应必须经过 `@tech-scout/contracts` 的 Zod schema。
- Session 使用浏览器 Cookie，前端不在 localStorage 保存访问令牌。
- Axios 与 Clerk 模板依赖、演示路由均已移除。

## 4. NestJS Product API

### 4.1 服务框架

| 技术               | 当前版本 | 用途                    | 状态          |
| ------------------ | -------- | ----------------------- | ------------- |
| NestJS             | 12.0     | 唯一对外产品 API        | `Implemented` |
| Express Adapter    | 5.x      | NestJS HTTP 运行时      | `Implemented` |
| Zod                | 4.3      | 请求、响应和配置校验    | `Installed`   |
| Pino/nestjs-pino   | 10.x/5.x | 结构化 JSON 日志        | `Installed`   |
| cookie-parser      | 1.4      | HttpOnly Session Cookie | `Installed`   |
| Argon2             | 0.45     | Argon2id 密码哈希       | `Installed`   |
| Vitest + Supertest | 4.x/7.x  | 单元和 HTTP 集成测试    | `Implemented` |

保留当前 Express Adapter。没有证据表明 Fastify 能为 MVP 带来足以抵消迁移成本的收益。

### 4.2 Catalog：Kysely + pg

Catalog 使用 `pg 8.23 + Kysely 0.29`，仅执行只读、显式、类型安全的 SQL。NestJS 读取 Catalog 是为了向页面提供确定性接口：

- 领域列表和统计。
- 公司排名、公司详情和关联专利。
- 专利列表、CPC、受让人和领域匹配依据。
- 实体审核证据、来源文件和 release 追溯。
- App 收藏或报告引用 Catalog ID 时的存在性检查。

普通分页和详情请求不能绕道 Python Agent。Python 只处理需要规划、工具调用和推理的长任务。

### 4.3 App：Prisma

`app` schema 使用 Prisma 7.10 和 PostgreSQL Driver Adapter。适用范围包括：

- 用户、凭据和 Session。
- 研究项目、运行和事件。
- 收藏、用户设置和保存的报告。
- 后续普通产品 CRUD。

强制约束：

- Prisma schema 只声明 `app` 表，Prisma Migrate 只管理 `app`。
- `catalog` 表不映射为 Prisma model，也不由 Prisma introspection/migration 接管。
- App 记录通过普通 `companyId`、`patentId` 和 `release` 引用 Catalog，由 CatalogRepository 校验。
- Prisma 生成类型是持久化实现，不允许作为前端 API 类型导出。
- 同一表不能同时由 Prisma 和 Kysely 随意读写。

这种双数据访问层是有意设计：Kysely 服务于复杂只读分析，Prisma 服务于标准产品 CRUD。

### 4.4 自建鉴权

第一版采用已经落地的简化自建账户系统：

- 使用必填用户名、邮箱和密码公开注册，注册后自动登录。
- 用户名统一为小写，可使用用户名或邮箱登录；邮箱保留原始值并以规范化值保证唯一。
- 用户名注册后不可修改，不设置独立展示名。
- 邮箱不验证，数据模型中不存在邮箱验证状态。
- 不接入邮件服务、验证码或邮件找回密码。
- 邮箱只是未经验证的登录标识，不能视为可信身份。
- 忘记密码由管理员重置。
- 所有普通用户拥有相同产品功能，但只能访问自己的项目、任务和报告。
- 管理员只增加查看账号、调整 `user/admin` 角色、禁用、恢复、重置密码和撤销 Session 的能力，不建设通用 RBAC。
- 禁用账号必须撤销全部 Session，不能物理删除其数据。
- 管理员通过一次性 CLI 创建，不把第一个公开注册用户自动提升为管理员。

最低安全集：Argon2id、数据库 Session、HttpOnly/SameSite Cookie、生产环境 Secure Cookie、同源 `/api`、写请求 Origin 检查和 CSRF Token。不引入 CAPTCHA、账号锁定、短信、邮件验证、复杂审计或 Redis 限流。

Session 闲置 7 天失效，最长 30 天强制重新登录；密码变更保留当前 Session 并撤销其他 Session，账号禁用和管理员撤销会话会删除目标用户的全部 Session。

这是一套本地和作品演示优先的鉴权方案，不应被描述为面向公网的大规模生产身份平台。

## 5. 共享 TypeScript 契约

`packages/contracts` 是 React 与 NestJS 的契约源：

```text
packages/contracts
  → Zod request/response schemas
  → z.infer TypeScript types
  → OpenAPI metadata
```

- 只依赖 Zod 和 Zod-to-OpenAPI。
- 不能依赖 React、NestJS、Prisma、Kysely或业务 service。
- NestJS 使用自有薄 Validation Pipe/Interceptor，不采用当前尚未声明支持 NestJS 12 的 `nestjs-zod`。
- 不采用当前仍绑定 NestJS 11/Zod 3 的 `ts-rest`。
- 前端直接消费相同 Zod schema，并对关键响应做运行时校验。

## 6. Python Intelligence

### 6.1 服务与 Agent

| 技术                          | 当前版本   | 用途                             | 状态        |
| ----------------------------- | ---------- | -------------------------------- | ----------- |
| Python                        | 3.13       | 在线 Agent 服务运行时            | `Installed` |
| uv                            | 当前环境   | 依赖、虚拟环境和锁文件           | `Installed` |
| FastAPI + Uvicorn             | 0.141/0.52 | 内部 HTTP/SSE 服务               | `Installed` |
| Pydantic + pydantic-settings  | 2.13/2.15  | API、配置、工具和结构化输出校验  | `Installed` |
| LangGraph                     | 1.2        | 显式状态图、暂停、恢复和人工确认 | `Installed` |
| langgraph-checkpoint-postgres | 3.1        | PostgreSQL 工作流检查点          | `Installed` |
| OpenAI Python SDK             | 2.54       | 首个模型提供商适配器             | `Installed` |
| HTTPX                         | 0.28       | 内部及外部异步 HTTP              | `Installed` |
| psycopg                       | 3.3        | Catalog 只读查询和 checkpoint    | `Installed` |
| structlog                     | 25.5       | 结构化 JSON 日志                 | `Installed` |
| pytest/pytest-asyncio/RESPX   | 9.x/1.x    | 工作流、异步代码和 HTTP 测试     | `Installed` |

当前只完成项目、依赖和锁文件初始化，尚无 FastAPI 应用、Agent 节点、模型调用或数据库写入代码。

### 6.2 为什么以 LangGraph 为核心

LangGraph 管理研究状态、检查点、预算暂停、失败恢复和人工确认。领域节点保持普通 Python 函数，以便独立测试。

LangChain 不作为主工作流框架，也不声明完整 `langchain` 为直接依赖。LangGraph 会传递安装 `langchain-core`；以后只有在具体 Loader、Retriever 或集成组件确有价值时才按需增加直接依赖，不能用高层通用 Agent 循环隐藏产品状态。

### 6.3 执行与通信

- NestJS 通过内部 REST 启动、恢复、取消和查询运行。
- Python 通过内部 SSE 输出结构化事件；NestJS 保存必要产品事件后再向浏览器提供 SSE。
- MVP 使用单进程受控 `asyncio` 后台任务、PostgreSQL checkpoint、运行租约和心跳。
- 进程重启后将未完成任务标记为可恢复，不在第一版引入 Redis 或 Celery。
- Python 只读 `catalog`，只写自身 `agent_runtime` schema，不能写 `app`。

### 6.4 跨语言契约

React 与 NestJS 直接共享 Zod；Python 不能导入 TypeScript 包，因此内部 Agent API 使用另一条生成链：

```text
Python Pydantic models
  → FastAPI OpenAPI
  → @hey-api/openapi-ts
  → NestJS TypeScript client/types
```

选择 `@hey-api/openapi-ts` 是因为当前版本支持项目正在使用的 TypeScript 6。生成代码不能手工修改。

## 7. PostgreSQL 所有权

| Schema          | 写入者              | NestJS            | Python Intelligence |
| --------------- | ------------------- | ----------------- | ------------------- |
| `staging`       | Data Foundation     | 禁止              | 禁止                |
| `catalog`       | Data Foundation     | Kysely 只读       | psycopg 只读        |
| `app`           | NestJS/Prisma       | 完整 CRUD         | 禁止                |
| `agent_runtime` | Python Intelligence | 通过内部 API 查询 | checkpoint 读写     |

部署时使用独立 PostgreSQL 登录角色落实权限：

- `tech_scout_foundation`：管理 `staging/catalog`。
- `tech_scout_api`：读写 `app`。
- `tech_scout_catalog_reader`：仅连接并读取 `catalog`，供 NestJS 的独立 Catalog 连接使用。
- `tech_scout_agent`：读取 `catalog`，读写 `agent_runtime`。

## 8. 测试策略

| 范围               | 工具                            | 要求                                  |
| ------------------ | ------------------------------- | ------------------------------------- |
| React 组件         | Vitest Browser + Playwright     | 在真实 Chromium 中验证交互            |
| React API 状态     | MSW + TanStack Query            | 不依赖真实后端复现加载、错误和分页    |
| 共享契约           | Vitest                          | 请求、响应、默认值和非法输入          |
| NestJS HTTP        | Vitest + Supertest              | Validation、Cookie、错误和状态码      |
| Catalog Repository | Vitest + 真实 PostgreSQL        | 分页、排序、release 和只读权限        |
| App Repository     | Vitest + Prisma 测试数据库      | migration、事务、唯一约束和所有者隔离 |
| Python Agent       | pytest + pytest-asyncio + RESPX | 节点、状态转移、暂停恢复和 HTTP 失败  |
| 浏览器完整流程     | Playwright E2E                  | 注册、登录、Catalog 查询和研究运行    |

## 9. 日志与可观测性

MVP 使用 Pino 和 structlog 输出结构化 JSON，统一携带：

- `requestId`、`userId`、`runId`。
- Catalog/Silver release。
- 节点、工具、模型和提示词版本。
- 延迟、重试、错误类别、token 和费用。

OpenTelemetry、Prometheus、集中日志和 Sentry 均为 `Deferred`。出现真实跨服务排障或远程部署需求后再接入。

## 10. 明确延后或不采用

| 技术                     | 状态       | 原因                                         |
| ------------------------ | ---------- | -------------------------------------------- |
| Next.js                  | `Rejected` | 当前不需要 SSR/RSC/公开 SEO                  |
| Axios                    | `Rejected` | 统一使用 Fetch/ky，且旧依赖没有实际引用      |
| TypeORM                  | `Rejected` | 不适合当前显式分析 SQL 与 Prisma App 分工    |
| Prisma 管理 Catalog      | `Rejected` | Catalog 由 Data Foundation 发布且运行时只读  |
| `nestjs-zod` / `ts-rest` | `Deferred` | 当前未声明兼容 NestJS 12 与现有 Zod 4 组合   |
| 通用 LangChain Agent     | `Rejected` | 状态、恢复和人工确认必须由显式状态图控制     |
| LangChain 组件           | `Deferred` | 出现具体 Loader/Retriever 需求后按需安装     |
| Redis/Celery             | `Deferred` | 单进程和 PostgreSQL checkpoint 足够验证 MVP  |
| pgvector                 | `Deferred` | 当前没有摘要、权利要求或文档分块语义检索数据 |
| MinIO                    | `Deferred` | 当前没有大量运行时上传和证据对象             |
| Docker Compose           | `Deferred` | 先保持 pnpm、uv 和本地 PostgreSQL 开发流程   |
| Clerk                    | `Rejected` | 使用 NestJS 自建鉴权，不接入第三方认证服务   |
| 邮件/短信验证            | `Rejected` | 当前明确采用简化的未验证邮箱账户             |

## 11. 实施顺序

1. ~~初始化 Prisma `app` schema，实现公开注册、Session 和账号管理。~~ 已完成。
2. ~~用数据库 Session Cookie 替换前端 Mock Token 模板。~~ 已完成。
3. ~~建立 NestJS Catalog Kysely 只读连接、类型和 repository。~~ 已完成。
4. ~~用共享 Zod 定义第一批领域、公司、专利和来源响应。~~ 已完成。
5. ~~实现 React → NestJS → Catalog 的分页查询闭环。~~ 已完成。
6. 实现 Python FastAPI 健康检查和 NestJS 内部客户端。
7. 增加 LangGraph 最小研究工作流、`agent_runtime` checkpoint 和 SSE。
8. 在出现真实瓶颈后再评估队列、向量检索、对象存储和容器化。

依赖已安装不代表对应阶段已经完成。每一步仍需 migration、权限、契约、测试和文档共同验收。
