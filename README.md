# Tech Scout

按技术方向寻找专利与企业：用户确认检索后，Python 通过 Google Patents 采集中国专利，再通过天眼查企业查询接口补充中国企业工商信息。所有业务数据来自实际采集，空库即可开始研究。

## 使用流程

1. 打开研究工作台，输入技术方向。
2. 编辑模型建议的技术方向、描述和公开年份，确认检索。
3. 查看采集进度；来源限流或要求验证时暂停，处理后继续。
4. 专利采集后手动开始企业发现；查看独立企业候选、Agent 主体解析与分级报告。
5. 在企业库、专利库查看历次采集的累计数据，可按研究来源筛选。

确认前只保存任务与计划。专利按公开号去重，企业按统一社会信用代码去重。研究快照独立保存；浏览数据不会启动采集。

## 项目结构

- `apps/web`：React 研究工作台、企业库、专利库、账号与用户管理。
- `apps/api`：NestJS 认证、研究接口、累计数据查询。
- `services/research`：研究规划、Playwright 网页采集、确认门禁、Agent 主体解析和分析；采集与研究运行在同一服务中。
- `packages/contracts`：前后端 Zod 契约；`packages/shared`：公共工具。

## 本地启动

需要 Node.js 24、pnpm 10、Python 3.13、uv 和 Chrome。数据库使用 Supabase 的 `tech-scout` 项目（PostgreSQL），按各服务的 `.env.example` 配置数据库、内部服务令牌及模型服务。数据库连接、权限与回退说明见 [Supabase 数据库](docs/supabase.md)。本地数据库集成测试仍需独立 PostgreSQL 测试库。

数据库只在仓库根目录 `.env` 配置一个 `DATABASE_URL`，参考根目录 `.env.example`；API、Python 及迁移命令共用该连接，`app`、`agent_runtime`、`ingestion`、`catalog_v2` 的选择写在代码中。API 其他配置放在 `apps/api/.env`，研究、模型和浏览器采集配置放在 `services/research/.env`。各目录均提供 `.env.example`，实际 `.env` 不提交，进程环境变量优先于文件。

```powershell
pnpm install
uv sync --project services/research
pnpm --filter @tech-scout/api prisma:migrate
pnpm migrate:research
```

上述命令保留 Prisma 迁移历史，并初始化当前研究表与检查点结构；研究初始化可重复执行，不回填旧格式数据。

分别启动：

```powershell
pnpm dev
pnpm dev:research
```

前端默认端口 8848，API 3000，统一研究服务 8001。前端使用同源 `/api` 代理；访问地址需与 API 的 `WEB_ORIGIN` 一致。

API 的资料库查询也使用共用连接，但通过独立连接池设置默认只读事务和 10 秒语句超时；Prisma 的模型映射明确指定 `ingestion`、`catalog_v2`。

## 验证

```powershell
pnpm validate
pnpm test:research
```

当前没有测试数据库，不需要配置测试连接。单元测试照常运行，依赖数据库的用例自动跳过；不会使用业务 `DATABASE_URL` 执行这些测试。将来启用数据库集成测试时，需显式提供指向独立 `_test` 数据库的 `TEST_DATABASE_URL`。架构回归及真实网页验收脚本也要求该独立连接，缺失时直接退出。真实网页验收另见 [采集说明](docs/browser-acquisition.md)。
