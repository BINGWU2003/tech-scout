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

需要 Node.js 24、pnpm 10、Python 3.13、uv、PostgreSQL 和 Chrome。按各服务的 `.env.example` 配置数据库、内部服务令牌及模型服务。

环境配置按服务统一管理：`apps/api` 和 `services/research` 各只使用 `.env`（本地实际配置，不提交）与 `.env.example`（可提交的配置模板）。研究与浏览器采集共用 `services/research/.env`，进程环境变量优先于文件。可选的 `TEST_*` 变量也放在对应服务的 `.env`；数据库测试只读取测试变量，不会回退到日常使用的数据库连接。示例中的测试配置默认注释，启用时必须指向独立测试库。

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

API 的 `CATALOG_DATABASE_URL` 现在仅表示累计数据库的只读连接，需要 `ingestion`、`catalog_v2` 的 USAGE/SELECT 权限。保留变量名便于现有本机配置使用，不再支持旧 Catalog 数据源模式。

## 验证

```powershell
pnpm validate
uv run --project services/research python services/research/scripts/verify_architecture.py
```

第二条命令创建独立测试数据库，验证采集持久化、研究确认/恢复、清理保护和 API。测试数据库名称记录在被 Git 忽略的 `.local/architecture-test.json`，不会导入正式库。真实网页验收另见 [采集说明](docs/browser-acquisition.md)。
