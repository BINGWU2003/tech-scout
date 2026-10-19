# Research 统一研究服务

FastAPI 服务在同一进程内运行 LangGraph 研究流程和 Playwright 采集，通过内部 Bearer 令牌供 NestJS 调用。项目安装、环境变量和数据库约束见[根目录说明](../../README.md)。

## 运行

在仓库根目录执行：

```powershell
pnpm dev:research
pnpm test:research
```

`pnpm dev:research` 自动执行迁移；部署时使用 `uv run --project services/research start` 则需先执行 `pnpm migrate:research`。升级含旧 `budget` 列的数据库时，迁移会重置研究轮次、对话、检查点及项目工作台，保留账号、项目与采集事实；升级前停止 API 和研究服务。

采集串行使用专用 Chrome 配置，默认位于用户目录 `.tech-scout/browser-profile`；其中会话文件含来源站 Cookie，仅保存在本机。每个采集阶段独立限时六小时，暂停和重试复用任务与检查点。

## 模型配置

参照[配置示例](.env.example)填写本目录 `.env`，设置 `LLM_PROVIDER`、`LLM_MODEL`、`LLM_BASE_URL` 及对应密钥。修改后重启服务，新任务使用新配置；恢复旧任务沿用保存的模型参数，密钥从当前环境读取。

| `LLM_PROVIDER` | 密钥变量            | `LLM_STRUCTURED_METHOD`                                        |
| -------------- | ------------------- | -------------------------------------------------------------- |
| `openai`       | `OPENAI_API_KEY`    | `json_schema`                                                  |
| `anthropic`    | `ANTHROPIC_API_KEY` | `function_calling`；支持原生结构化输出的型号可用 `json_schema` |
| `deepseek`     | `DEEPSEEK_API_KEY`  | `json_mode`                                                    |

默认使用 OpenAI `gpt-6.1-sol`、Responses API 和 `low` 推理强度。兼容网关可设置 `LLM_USE_RESPONSES_API=false` 使用 Chat Completions；端点与结构化输出方式需匹配模型能力。`LLM_REASONING_EFFORT=null` 使用供应商默认值，DeepSeek 当前关闭 thinking。

`RESEARCH_MODEL_TIMEOUT_SECONDS` 控制单次模型超时，`RESEARCH_OUTPUT_TOKENS` 控制输出上限，`RESEARCH_MAX_PARALLEL` 控制研究并发，不设置累计研究预算。旧 DeepSeek 任务恢复仍需 `DEEPSEEK_API_KEY`。

节点状态与计划组装见[研究节点与返回数据流](../../docs/research-node-data-flow.md)，流式输出与事件回放见 [SSE 学习指南](../../docs/sse-learning/README.md)。
