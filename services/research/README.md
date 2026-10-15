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

Neon 连接池模式下，研究服务必须单进程、单副本运行；重启时先停旧进程，避免实例重叠。会话锁已移除，事务锁仍保留。先运行 `pnpm migrate:research` 初始化角色默认 schema，再启动服务，详见 [数据库说明](../../docs/neon.md)。

`pnpm dev:research` 会先初始化当前数据库结构再启动服务；初始化可重复执行，不回填历史研究数据。直接使用 `uv run --project services/research start` 启动或部署服务时，仍需先执行 `pnpm migrate:research`。

删除研究任务会停止运行、等待研究及采集写入退出，并清除该任务的运行状态、事件、检查点和采集快照。共享公司、专利和查询缓存保留；`agent_runtime.deleted_run` 只保留已删除运行的 UUID，防止延迟到达的启动请求重建任务。

研究、模型和采集配置统一写在本目录的 `.env`；数据库 URL 只放在仓库根目录 `.env`，已有进程环境变量不会被文件覆盖。当前不配置测试数据库，数据库用例自动跳过；将来需要集成测试时仅使用独立的 `TEST_DATABASE_URL`，不会回退到业务连接。

## 模型配置

`ResearchLLM` 使用 LangChain 的 `init_chat_model` 和 `with_structured_output`，工作流不依赖具体供应商。修改 `.env` 后重启研究服务，新任务会使用新配置。模型、端点、输出方式、推理强度和预算随任务保存；恢复旧任务沿用原配置，密钥从当前环境读取，不写入任务状态。迁移前的任务仍按 DeepSeek 调用，恢复它们需要保留 `DEEPSEEK_API_KEY`。

| 配置 | OpenAI / 兼容网关 | Anthropic | DeepSeek |
| --- | --- | --- | --- |
| `LLM_PROVIDER` | `openai` | `anthropic` | `deepseek` |
| `LLM_MODEL` | `gpt-6.1-sol` | 账号可用的 Claude 型号 | `deepseek-v4-flash` |
| `LLM_BASE_URL` | `https://api.openai.com/v1` 或网关地址 | `https://api.anthropic.com` | `https://api.deepseek.com` |
| 密钥变量 | `OPENAI_API_KEY` | `ANTHROPIC_API_KEY` | `DEEPSEEK_API_KEY` |
| `LLM_STRUCTURED_METHOD` | `json_schema` | `function_calling`，支持原生结构化输出的型号也可用 `json_schema` | `json_mode` |
| `LLM_REASONING_EFFORT` | `low`，可按型号调整 | 按型号配置；设为 `null` 使用供应商默认值 | 当前关闭 thinking，忽略此项 |

`LLM_USE_RESPONSES_API=true` 仅影响 OpenAI；旧式兼容网关可设为 `false` 使用 Chat Completions，但必须确认目标模型支持。输出方式不会在请求失败时偷偷降级。GPT-6.1 Sol 默认使用 `low`，优先满足交互延迟；需要更深入分析时可改为 `medium` 或 `high`，同时评估超时和 token 预算。

模型流式输出期间只发布 `reply` 文本，不展示未完成的方向卡片。最终结果经过完整 JSON 解析、Pydantic 校验和完成状态检查后才交给工作流；工具调用形式的结构化输出也使用同一套业务校验。拒绝、截断、网络错误和取消均不会被标为成功。

密钥只填写在被 Git 忽略的 `.env` 中，示例文件不放真实凭据。兼容网关需要允许普通 API 客户端访问；只允许 Codex 官方客户端的凭据不能用于本服务。
