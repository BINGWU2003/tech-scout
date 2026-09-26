# 数据访问约定

## Python

`tech_scout_storage` 映射既有 `agent_runtime`、`ingestion`、`catalog_v2` 业务表。
研究与采集分别注入一个 `Database`，使用 SQLAlchemy 2.x 异步 Session 和 psycopg 驱动。
每个引擎最多 4 个连接，不允许 overflow，启用连接存活检查；即使两个 DSN 相同也保持两个引擎。

- 一次 Store 操作对应一个显式事务，辅助方法复用传入的 Session；不得跨并发任务共享 Session。
- 普通增删改查使用声明式模型与 SQLAlchemy 表达式，upsert 使用 PostgreSQL `on_conflict_*`。
- Store 只返回字典、标量或既有 Pydantic 模型，不向业务层暴露 ORM 实体。
- JSONB 更新显式提交完整值，不依赖对嵌套字典的隐式跟踪。JSON `null` 使用 Python `None`，SQL `NULL` 使用 `sqlalchemy.null()`；不能将两者互换。
- 保持状态与事件、采集条目与事实/来源/投影、发布快照与完成状态的事务边界。

两个 psycopg 连接池继续管理 LangGraph 和采集初始化，不与 ORM 共享连接或事务。
研究服务按单进程、单副本部署；会话锁已移除，长时间研究/浏览器执行不持有数据库锁或 ORM 事务。
LangGraph 使用迁移设置的角色级默认 `search_path`；业务写入仍保留事务级锁。
因此部署时须预留原有 psycopg 池之外新增的最多 8 个 ORM 连接。
应用关闭顺序为停止后台任务、关闭 psycopg 池、释放 ORM 引擎。

允许保留的原生 SQL 集中在数据库基础设施中：事务级锁、局部锁超时、LangGraph checkpoint 清理。
清理第三方表时表名来自固定白名单，运行 ID 始终参数化。

## Node API

- API 与 Python 共用仓库根目录 `.env` 的唯一 `DATABASE_URL`。`PrismaService` 在代码中选择 `app` schema，保留原有迁移历史；Prisma CLI 在配置代码中附加 `schema=app`，不要求在环境变量中指定 schema。
- `CatalogPrismaService` 使用同一个 URL，只读访问 Python 管理的资料库，最多 5 个连接；所有查询通过 `read()` 在同一事务中设置只读和 10 秒语句超时。
- 资料库使用独立 `catalog.prisma`、客户端输出目录及 `prisma.catalog.config.ts`。该配置仅用于生成/校验；**不得对它执行 migrate 或 db push**。共用业务账号具备跨 schema 权限，查询连接通过只读事务限制写入，不再以不同登录账号隔离服务。
- `prisma:generate`、`prisma:validate`、构建与测试覆盖两个客户端；`prisma:migrate` 仍只操作 `app`。
- 普通访问使用模型 API；JSONB 字段投影、正文裁剪、聚合、活跃运行优先排序与行锁保留参数化 `$queryRaw`。
- 研究原生查询集中在 `research.repository.ts`，资料库查询集中在 `LibraryRepository`。行锁必须传入当前事务客户端，不能改用根客户端。
- 表名/列名仅使用固定 SQL 片段，所有请求参数使用绑定变量，禁止 Unsafe 查询。
- 不得以 ORM 全量读取大型 `state`/事件 JSON 再在应用层裁剪的方式替代现有数据库投影。

## 迁移与验证

数据库托管与账号迁移说明见 [Neon 数据库](neon.md)。Python 初始化继续使用原有 DDL 与 `pnpm migrate:research`；LangGraph 自行管理 checkpoint 表。
不使用 `create_all()`，不把 Python 管理的 schema 纳入 app 迁移。
数据库切换回退需停止服务并恢复原连接配置，切换后新增的数据需单独处理。

当前没有测试数据库。数据库用例只读取可选的 `TEST_DATABASE_URL`，未配置时跳过，不回退到业务连接。启用时 URL 必须指向名称以 `_test` 结尾的独立 PostgreSQL 数据库。
资料库夹具用测试写入连接准备，运行时 Prisma 连接仍启用只读配置。
现有部分采集夹具使用固定业务键，完整回归应从新建测试库开始。

运行 `pnpm test:research`、API 单元和端到端测试、两套 Prisma 校验、API 构建，以及 Python Ruff/Pyright 检查。
回归覆盖事务失败回滚、JSON null 语义、租约与幂等、事务锁释放、删除互斥、快照不可变和只读限制。
大型 JSON 用例检查数据库返回的原始结果已裁剪，并确认资料库列表查询次数不随记录数增长。
未配置测试数据库或跨服务夹具导致的跳过必须单独报告。
