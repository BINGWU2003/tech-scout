# Supabase 数据库（历史记录）

> 2026-09-26 已迁移至 Neon；下文是旧部署记录，不再代表当前配置。当前连接与运行限制见 [Neon 数据库](neon.md)。

业务数据库使用 Supabase 的 `tech-scout` 项目（`kuztkaiftsgkzhweamdn`，东京区域）。NestJS 继续负责登录和权限，Python 继续执行研究与采集，前端通过现有后端接口访问数据。

## 一个连接配置

整个仓库只在根目录 `.env` 配置一个 `DATABASE_URL`，参照根目录 `.env.example`。API、Python 和数据库迁移命令读取同一个连接，不在各服务 `.env` 中重复配置。进程环境变量优先，加载配置不依赖启动时的工作目录。

API 其他配置保留在 `apps/api/.env`；研究、模型和浏览器配置保留在 `services/research/.env`。实际 `.env` 均不提交 Git。Prisma CLI 在代码中为迁移连接附加 `schema=app`，保持迁移历史位于 `app`。

| 使用方                    | 代码中的 schema                            | 访问方式                                   |
| ------------------------- | ------------------------------------------ | ------------------------------------------ |
| API 主 Prisma 客户端      | `app`                                      | 账号、会话、研究页面与 Prisma 迁移         |
| API Catalog Prisma 客户端 | `ingestion`、`catalog_v2`                  | 独立只读连接池，最多 5 连接，10 秒语句超时 |
| Python SQLAlchemy         | `agent_runtime`、`ingestion`、`catalog_v2` | 模型中明确指定 schema                      |
| Python LangGraph          | `agent_runtime`                            | 连接代码设置 `search_path`                 |

运行账号为专用的 `tech_scout_app`，通过继承现有 `tech_scout_api` 和 `tech_scout_research` schema owner 角色获得权限，没有超级用户、创建数据库或管理角色的能力。两个服务共用凭据；Catalog 的只读限制由该客户端的数据库会话参数保证，共用账号本身具有业务写入权限。原 owner 角色保留，表所有权与 RLS 规则无需迁移。

四个业务 schema 不向 Supabase Data API 开放。表已启用 RLS，服务端角色策略匹配上述访问模型。以后添加表时继续维护相应 RLS 与角色权限。

## 连接与证书

使用直连地址 `db.kuztkaiftsgkzhweamdn.supabase.co:5432`。连接包含 `sslmode=verify-full` 和 `sslrootcert`，加密并验证证书与主机名。`sslrootcert` 指向 `config/supabase-ca.crt` 的绝对路径，例如 `D:/files/tech-scout/config/supabase-ca.crt`，URL 中的特殊字符需编码。

仓库包含的 [Supabase 官方根证书](https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt) 不含私钥，有效期至 2031-04-26。更换部署目录后更新证书路径，不要关闭证书校验。

如果部署网络无法直连，从 Supabase 控制台 Connect 获取 Session pooler 地址和证书设置，用户名使用 `tech_scout_app.kuztkaiftsgkzhweamdn`。研究服务使用会话锁、`search_path` 和预编译语句，必须使用直连或 Session pooler，不能使用 Transaction pooler。统一 URL 不合并连接池，各池仍保持自己的会话和并发边界。

## 初始化与验证

现有项目已完成角色和 schema 配置。

```powershell
pnpm --filter @tech-scout/api prisma:migrate
pnpm migrate:research
```

Prisma 仅管理 `app`，Python 管理其余三个 schema，LangGraph 管理自己的检查点迁移。不要对 `catalog.prisma` 执行 migrate 或 db push。

当前没有测试数据库，不需要配置测试 URL。单元测试和构建照常执行，数据库用例未配置独立 `TEST_DATABASE_URL` 时跳过。验收脚本缺少该变量时直接退出，不会读取业务连接创建测试库。

## 迁移记录与回退

2026-09-24 迁移了 4 个用户账号的全部字段，包括 ID、原密码哈希、角色、状态和时间戳。旧会话未迁移，用户需重新登录；研究、企业、专利、缓存和检查点从空库开始。源数据库及历史数据保留。

迁移验证覆盖账号逐字段一致性、24 张表、权限、会话锁、LangGraph 检查点、注册登录、管理员权限、空资料库接口和服务健康。临时验证账号及会话已删除，没有调用模型或真实采集。原迁移配置和用户备份位于 `.local/supabase-migration-20260924/`；统一 URL 前的配置备份位于 `.local/single-db-url-20260924/`。这些本机目录含敏感数据，不提交或共享。

如需恢复源数据库，先停止 API 和研究服务，在根目录 `.env` 中把 `DATABASE_URL` 换成对源库四个 schema 有相应权限的连接，再启动服务。不要把旧的多 URL 配置文件直接覆盖到重构后的服务目录。切换后 Supabase 新增的数据不会自动回到源库，回退前必须单独保留并决定如何处理。
