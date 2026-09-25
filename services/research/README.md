# Research 统一研究服务

使用 FastAPI、LangGraph、Playwright 和 PostgreSQL 处理研究规划、计划确认、网页采集、企业身份核对、分析及恢复。Web 通过 NestJS 调用统一服务，Intelligence 与 Acquisition 在同一进程内直接协作。

确认前只生成检索计划；确认后直接调用进程内 Acquisition，等待同一任务完成并固定研究快照。模型执行预算与网页等待时间分开，暂停及重试保留检查点和预算。

```powershell
uv sync --project services/research
pnpm migrate:research
pnpm dev:research
uv run --project services/research pytest services/research/tests
```

数据库连接使用仓库根目录 `.env` 中唯一的 `DATABASE_URL`，其余配置见本目录 `.env.example`。本服务在代码中明确写入 `agent_runtime`、`ingestion` 和 `catalog_v2`，产品投影由 NestJS 写入 `app`。详细结构见 [架构](../../docs/architecture.md)。

`pnpm dev:research` 会先初始化当前数据库结构再启动服务；初始化可重复执行，不回填历史研究数据。直接使用 `uv run --project services/research start` 启动或部署服务时，仍需先执行 `pnpm migrate:research`。

删除研究任务会停止运行、等待研究及采集写入退出，并清除该任务的运行状态、事件、检查点和采集快照。共享公司、专利和查询缓存保留；`agent_runtime.deleted_run` 只保留已删除运行的 UUID，防止延迟到达的启动请求重建任务。

研究、模型和采集配置统一写在本目录的 `.env`；数据库 URL 只放在仓库根目录 `.env`，已有进程环境变量不会被文件覆盖。当前不配置测试数据库，数据库用例自动跳过；将来需要集成测试时仅使用独立的 `TEST_DATABASE_URL`，不会回退到业务连接。
