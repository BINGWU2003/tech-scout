# TechScout Intelligence Service

> 状态：阶段 2 后端主链已实现，已接入 FastAPI、LangGraph、PostgreSQL checkpoint 和 DeepSeek 适配器；真实模型验收需本地配置密钥。

该目录是独立的 Python Intelligence Service 项目，负责研究计划、只读 Catalog 工具、身份确认、候选长名单、模型调用、预算和恢复。浏览器通过 NestJS 产品 API 操作，不直连 Python。完整启动步骤、API 示例和验收边界见[阶段 2 使用指南](../../docs/phase-2-runbook.md)。

## 环境和测试

```powershell
uv sync --project services/intelligence
uv run --project services/intelligence python -m tech_scout_intelligence.migrate
uv run --project services/intelligence python -m tech_scout_intelligence
uv run --project services/intelligence pytest services/intelligence/tests
uv run --project services/intelligence ruff check services/intelligence
```

先按 `.env.example` 配置服务本地 `.env`。迁移只创建 `agent_runtime` 及 LangGraph checkpoint 表，不修改 Catalog 或 App。数据库集成测试使用独立 `TEST_INTELLIGENCE_DATABASE_URL`，未配置时明确跳过。Windows 入口显式使用 SelectorEventLoop。

## 职责

- 接收 NestJS 发起的内部研究任务。
- 执行 Agent 工作流、工具调用和检查点恢复。
- 只读查询 PostgreSQL `catalog` schema。
- 将结构化执行结果返回 NestJS，由 NestJS 负责产品状态和 `app` schema 写入。

## 禁止边界

- 浏览器不能直接调用本服务。
- 本服务不能直接写入 `app` schema。
- 本服务不能发布或修改 `catalog`。
- 本服务不能 import `pipelines/data-foundation` 的内部 Python 模块。
- Raw、Bronze、Silver、实体审核和 Catalog 导入不属于本服务。

离线数据工程位于 [`pipelines/data-foundation`](../../pipelines/data-foundation/)，不能与本项目共享虚拟环境或内部源码。

完整边界和演进计划见 [`docs/architecture.md`](../../docs/architecture.md)，具体依赖选择见 [`docs/technology-stack.md`](../../docs/technology-stack.md)。
