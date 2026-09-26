# Neon 数据库

业务数据库使用 Neon PostgreSQL。NestJS 负责登录和权限，Python 负责研究与采集；前端继续通过后端接口访问数据。

## 连接与初始化

仓库根目录 `.env` 只配置一个 `DATABASE_URL`，运行时使用 Neon 的 `-pooler` 地址，并保留 `sslmode=require&channel_binding=require`。服务自己的 `.env` 保存其他配置；进程环境变量优先。连接密码不提交 Git。

```powershell
pnpm --filter @tech-scout/api prisma:migrate
pnpm migrate:research
```

迁移代码会将 Neon `-pooler` 主机转换为同一项目的直连主机，避免 Prisma 迁移锁和初始化语句受事务池影响。应用运行时仍使用配置中的连接池地址。

| 使用方               | schema                                     | 连接池兼容方式                                   |
| -------------------- | ------------------------------------------ | ------------------------------------------------ |
| API 主 Prisma 客户端 | `app`                                      | 显式指定 schema                                  |
| API 资料库客户端     | `ingestion`、`catalog_v2`                  | 每次查询使用只读事务，事务内设置 10 秒语句超时   |
| Python SQLAlchemy    | `agent_runtime`、`ingestion`、`catalog_v2` | 模型显式指定 schema，保留事务级锁                |
| Python LangGraph     | `agent_runtime`                            | 迁移为当前角色在当前数据库设置默认 `search_path` |

Python 迁移执行 `ALTER ROLE … IN DATABASE … SET search_path TO agent_runtime, public`，因此迁移账号须能修改自身默认配置。运行时不使用会话级 `SET search_path` 或连接启动 `options`。角色默认设置只对新后台连接生效；已有连接池需要轮转后台连接或重启计算节点，并重新验证 `SHOW search_path`。新库应先迁移、再启动应用。

Prisma 只管理 `app`，Python 管理其他三个 schema；不要对 `catalog.prisma` 执行 migrate 或 db push。

## 单实例运行约束

研究服务只运行一个进程、一个副本。停止旧进程后再启动新进程，避免滚动部署时新旧实例重叠。单进程内部仍可按 `RESEARCH_MAX_PARALLEL` 执行不同研究任务，浏览器采集串行运行。

会话级 advisory lock 已移除。事务级锁、数据库约束、任务领取及心跳机制保留，但不再保证跨进程的浏览器独占和检查点写入互斥。以后启用多实例前，需要恢复兼容的互斥机制。

## 迁移与回退

2026-09-26 从原 Supabase 库迁入 4 个账号，逐字段核对 ID、账号信息、原密码哈希、权限、状态及时间戳。旧登录会话和扫描、资料、缓存、检查点数据不迁移，用户需要重新登录。

迁移专项验证通过：API 登录与资料库 9 项、研究事务回滚 2 项、检查点及事务锁验证、研究服务启动健康检查和编译后 API 数据库查询。临时 `_test` 数据库已删除。完整 API 研究页面回归出现远程数据库 30 秒超时，完整 Python 数据库回归超过工具等待窗口，因此不声明全量回归通过。验证日志和结果保存在下述本地备份目录。

原数据库保留。原连接配置和账号备份位于本机 `.local/neon-migration-20260926/`，该目录被 Git 忽略，包含敏感数据，不要提交或共享。

回退时先停止服务、保留 Neon 上新增的数据，再恢复根 `.env` 的源库连接。当前运行代码依赖角色默认 `search_path`；旧库须完成同样的配置并验证后再启动，不能只改 URL 就假定回退完成。

集成测试只使用显式提供、名称以 `_test` 结尾的独立 `TEST_DATABASE_URL`，不在业务库运行测试。后端部署平台上的连接变量需同步切换并重启进程；修改本地 `.env` 不会自动更新线上环境。

参考：[Neon 连接池限制](https://neon.com/docs/connect/connection-pooling)。
