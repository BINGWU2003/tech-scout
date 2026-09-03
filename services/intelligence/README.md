# TechScout Intelligence Service

> 状态：项目和依赖已初始化，运行时服务仍为 `Planned`。

该目录是独立的 Python Intelligence Service 项目，负责 Agent、研究工作流、模型调用和专业分析工具。当前已有 `pyproject.toml`、`uv.lock`、包边界和基础测试，尚无 FastAPI 应用或 Agent 工作流。

## 环境和测试

```powershell
uv sync --project services/intelligence
uv run --project services/intelligence pytest services/intelligence/tests
uv run --project services/intelligence ruff check services/intelligence
```

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
