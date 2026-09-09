# Research 统一研究服务

使用 FastAPI、LangGraph、Playwright 和 PostgreSQL 处理研究规划、计划确认、网页采集、企业身份核对、分析及恢复。Web 通过 NestJS 调用统一服务，Intelligence 与 Acquisition 在同一进程内直接协作。

确认前只生成检索计划；确认后直接调用进程内 Acquisition，等待同一任务完成并固定研究快照。模型执行预算与网页等待时间分开，暂停及重试保留检查点和预算。

```powershell
uv sync --project services/research
pnpm migrate:research
pnpm login:research
pnpm dev:research
uv run --project services/research pytest services/research/tests
```

配置见 `.env.example`。本服务写入 `agent_runtime`、`ingestion` 和 `catalog_v2`，产品投影由 NestJS 写入 `app`。旧离线目录读取器已删除。详细结构见 [架构](../../docs/architecture.md)。
