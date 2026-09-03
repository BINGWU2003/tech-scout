# Tech Scout

Tech Scout 是一个本地优先、证据可追溯的技术侦察项目。仓库包含 React 管理端、NestJS 产品 API、已初始化的 Python Agent 项目，以及独立的离线数据管道。

## 项目结构

```text
tech-scout/
├─ apps/
│  ├─ web/    # React 19 + Vite 8
│  └─ api/    # NestJS 12
├─ services/
│  └─ intelligence/         # Python Agent 项目，运行时尚未实现
├─ pipelines/
│  └─ data-foundation/      # Raw/Bronze/Silver/Catalog/固定报告
├─ packages/
│  └─ contracts/            # React/NestJS 共享 Zod 契约
├─ config/                  # 来源、领域和报告规则
├─ docs/                    # 产品、架构、数据和运维文档
├─ .oxfmtrc.json
├─ .oxlintrc.json
├─ package.json
├─ pnpm-workspace.yaml
└─ turbo.json
```

## 环境要求

- Node.js 24
- pnpm 10.34.4
- Python 3.13
- uv

## 开始开发

```bash
pnpm install
pnpm dev
```

`pnpm dev` 会同时启动：

- Web：<http://localhost:5173>
- API：<http://localhost:3000>

Web 已通过同源 `/api` 开发代理接入 NestJS 的登录、注册和用户管理 API。公司、专利和研究接口尚未实现。

## 常用命令

| 命令                        | 说明                                 |
| --------------------------- | ------------------------------------ |
| `pnpm dev`                  | 通过 Turborepo 并行启动 Web 和 API   |
| `pnpm build`                | 通过 Turborepo 构建并缓存所有应用    |
| `pnpm lint`                 | 使用 Oxlint 检查整个仓库             |
| `pnpm format`               | 使用 Oxfmt 格式化整个仓库            |
| `pnpm format:check`         | 检查仓库格式                         |
| `pnpm test`                 | 通过 Turborepo 运行并缓存应用测试    |
| `pnpm test:e2e`             | 通过 Turborepo 运行并缓存 API e2e    |
| `pnpm test:browser:install` | 安装 Web 测试所需的 Chromium         |
| `pnpm validate`             | 执行完整的格式、lint、测试和构建验证 |

离线 Data Foundation 使用独立的 Python CLI，不经过根 `package.json`：

```bash
uv sync --project pipelines/data-foundation
uv run --project pipelines/data-foundation data-foundation --help
uv run --project pipelines/data-foundation pytest pipelines/data-foundation/tests
```

完整命令见 [Data Foundation README](./pipelines/data-foundation/README.md)。

## 文档

- [产品需求](./docs/product-requirements.md)
- [产品与系统架构](./docs/architecture.md)
- [技术选型](./docs/technology-stack.md)
- [数据底座参考](./docs/database-and-data-status.md)
- [数据获取与发布指南](./docs/data-acquisition-guide.md)

## 环境变量

Web 本地开发不需要环境文件。API 复制 `apps/api/.env.example` 为 `apps/api/.env`，并把示例密码替换为本地数据库密码。

API 至少需要 `DATABASE_URL`。首次运行先应用 Prisma migration：

```bash
pnpm --filter @tech-scout/api prisma:migrate
```

首个管理员通过一次性 CLI 创建。先在 `apps/api/.env` 中填写 `ADMIN_BOOTSTRAP_USERNAME`、`ADMIN_BOOTSTRAP_EMAIL` 和 `ADMIN_BOOTSTRAP_PASSWORD`，其中密码至少需要 10 个字符：

```bash
pnpm --filter @tech-scout/api admin:create
```

创建成功后清除这三个一次性环境变量。公开注册只会创建普通用户，不会自动产生管理员。

API 数据库集成测试必须使用独立数据库，并通过 `TEST_DATABASE_URL` 指定；测试会清空其中的 `app.user_account` 和 `app.user_session`，不得指向日常数据库或 Catalog 数据库。

## 部署

根目录的 `netlify.toml` 仅配置 `apps/web` 的 Netlify 构建与 SPA 路由回退。API 的部署平台尚未指定。

## License

[MIT](./LICENSE)
