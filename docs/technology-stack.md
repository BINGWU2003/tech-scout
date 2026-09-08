# 技术选型

- 前端：React、TypeScript、TanStack Router / Query、Tailwind 和 shadcn/ui。
- 产品 API：NestJS；Prisma 管理账号与研究项目；pg 只读查询累计事实库；Zod 统一契约。
- 研究服务：Python 3.13、FastAPI、LangGraph、PostgreSQL checkpoint、DeepSeek。
- 采集服务：Python、Playwright / Chrome、BeautifulSoup、psycopg；独立浏览器配置复用风鸟登录状态。
- 存储：PostgreSQL 按 app / agent_runtime / ingestion / catalog_v2 分工，事实去重、研究来源和不可变快照分开保存。
- 工具：pnpm workspace、Turbo、uv、Vitest 浏览器测试、pytest、Ruff、Oxfmt/Oxlint。

结构与启动见 [架构](architecture.md) 及 [项目说明](../README.md)。
