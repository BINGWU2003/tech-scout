# Intelligence 研究服务

使用 FastAPI、LangGraph 和 PostgreSQL 检查点处理研究规划、计划确认、采集等待、企业身份核对、分析及恢复。Web 通过 NestJS 调用内部服务。

确认前只生成检索计划；确认后调用 Acquisition，等待同一任务完成并固定研究快照。模型执行预算与网页等待时间分开，暂停及重试保留检查点和预算。

```powershell
uv sync --project services/intelligence
pnpm migrate:intelligence
pnpm dev:intelligence
uv run --project services/intelligence pytest services/intelligence/tests
```

配置见 `.env.example`。本服务只写 `agent_runtime`，产品投影由 NestJS 写入 `app`，采集事实由 Acquisition 写入。旧离线目录读取器已删除。详细结构见 [架构](../../docs/architecture.md)。
