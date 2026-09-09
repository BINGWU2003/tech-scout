# Tech Scout

按技术方向寻找专利与企业：用户确认检索后，Python 采集万方专利网页，再通过风鸟补充企业工商信息。所有业务数据来自实际采集，空库即可开始研究。

## 使用流程

1. 打开研究工作台，输入技术方向。
2. 编辑模型建议的关键词、IPC 和公开年份，确认检索。
3. 查看采集进度；登录过期或来源要求验证时暂停，处理后继续。
4. 核对候选企业身份，查看有专利证据支持的研究结果。
5. 在企业库、专利库查看历次采集的累计数据，可按研究来源筛选。

确认前只保存任务与计划。专利按公开号去重，企业按统一社会信用代码去重。研究快照独立保存；浏览数据不会启动采集。

## 项目结构

- `apps/web`：React 研究工作台、企业库、专利库、账号与用户管理。
- `apps/api`：NestJS 认证、研究接口、累计数据查询。
- `services/research`：研究规划、Playwright 网页采集、确认门禁、主体核对和分析；采集与研究运行在同一服务中。
- `packages/contracts`：前后端 Zod 契约；`packages/shared`：公共工具。

## 本地启动

需要 Node.js 24、pnpm 10、Python 3.13、uv、PostgreSQL 和 Chrome。按各服务的 `.env.example` 配置数据库、内部服务令牌及模型服务。

```powershell
pnpm install
uv sync --project services/research
pnpm --filter @tech-scout/api prisma:migrate
pnpm migrate:research
pnpm login:research
```

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

旧离线数据管道已移除。一次性清理使用 `services/research/scripts/cleanup_legacy.py`，默认仅盘点；停服务后加 `--apply` 按来源清理旧研究及旧 schema，保留账号和新采集记录。更换网页来源时可运行 `services/research/scripts/reset_source_data.py`，默认只统计；加 `--apply` 会清空采集检查点、事实、缓存与快照，并将原采集任务重置为待执行，不修改用户、研究历史或浏览器登录资料。
