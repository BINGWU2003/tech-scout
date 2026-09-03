# TechScout Intelligence Service

> 状态：`Planned`，当前尚未实现运行时服务。

该目录保留给未来的 Python Intelligence Service，负责 Agent、研究工作流、模型调用和专业分析工具。

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

离线数据工程位于 [`pipelines/data-foundation`](../../pipelines/data-foundation/)。开始 Agent 开发时，再在此目录创建独立的 `pyproject.toml`、运行时代码和测试。

完整边界和演进计划见 [`docs/architecture.md`](../../docs/architecture.md)。
