# Tech Scout

按技术方向寻找中国专利与企业。用户输入需求、编辑方向与关键词并确认后，系统采集 Google Patents；手动开始企业发现后，查询天眼查并生成分析报告。企业库和专利库汇总历次采集结果，空库即可开始研究。

确认前只保存计划；研究使用独立快照，支持暂停与恢复。企业查询命中作为调研线索，不代表专利权属。

## 项目结构

- `apps/web`：React、TanStack Router / Query、Tailwind、shadcn/ui。
- `apps/api`：NestJS 认证、研究接口与资料库查询，使用 Prisma 访问数据库。
- `services/research`：Python 3.13、FastAPI、LangGraph、Playwright，规划、采集与分析在同一进程运行。
- `packages/contracts`：共享 Zod 契约；`packages/shared`：公共工具。

## 本地启动

需要 Node.js 24、pnpm 10、Python 3.13、uv、Chrome 和 Neon PostgreSQL。

将以下示例复制为同目录的 `.env` 并填写配置；进程环境变量优先，实际 `.env` 不提交 Git。

- [根目录示例](.env.example)：唯一的 `DATABASE_URL`，API、Python 和迁移命令共用。
- [API 示例](apps/api/.env.example)：访问地址、会话与内部服务配置。
- [研究服务示例](services/research/.env.example)：模型密钥与浏览器配置；两端的 `INTELLIGENCE_INTERNAL_TOKEN` 必须一致且至少 32 字符。

```powershell
pnpm install
uv sync --project services/research
pnpm --filter @tech-scout/api prisma:migrate
pnpm migrate:research
```

在两个终端分别启动：

```powershell
pnpm dev
pnpm dev:research
```

前端默认端口 8848，API 3000，研究服务仅监听 `127.0.0.1:8001`。前端通过同源 `/api` 代理访问 API，访问地址需与 `WEB_ORIGIN` 一致。

## 数据库与运行约束

- Neon 运行时使用 `-pooler` 地址并保留 `sslmode=require&channel_binding=require`，迁移自动改用同项目直连地址。
- Prisma 只迁移 `app`；Python 管理 `agent_runtime`、`ingestion`、`catalog_v2`。`catalog.prisma` 仅生成查询客户端，不执行 migrate 或 db push；资料库查询使用只读事务和 10 秒语句超时。
- 研究迁移设置当前角色的默认 `search_path`，账号需有修改权限，已有连接需重新建立才能生效。研究服务只运行一个进程、一个副本，重启前先停止旧实例。

## 验证

```powershell
pnpm validate
pnpm test:research
```

数据库用例仅使用显式配置、数据库名以 `_test` 结尾的独立 `TEST_DATABASE_URL`，缺失时跳过；架构与真实网页验收脚本缺失该配置时直接退出。

## 文档

- [研究节点与返回数据流](docs/research-node-data-flow.md)
- [SSE 全链路学习指南](docs/sse-learning/README.md)
- [研究服务运行与模型配置](services/research/README.md)
- [共享契约约定](packages/contracts/README.md)
