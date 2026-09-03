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

Web 已通过同源 `/api` 开发代理接入 NestJS 的账户 API 和只读 Catalog API。登录后可从“技术目录”浏览当前已发布 release 的领域、公司、专利、实体匹配证据和安全来源信息；研究任务接口尚未实现。

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

API 需要两个独立连接：`DATABASE_URL` 读写 `app` schema，`CATALOG_DATABASE_URL` 只读 `catalog` schema。首次运行先应用 Prisma migration：

```bash
pnpm --filter @tech-scout/api prisma:migrate
```

首个管理员通过一次性 CLI 创建。先在 `apps/api/.env` 中填写 `ADMIN_BOOTSTRAP_USERNAME`、`ADMIN_BOOTSTRAP_EMAIL` 和 `ADMIN_BOOTSTRAP_PASSWORD`，其中密码至少需要 10 个字符：

```bash
pnpm --filter @tech-scout/api admin:create
```

创建成功后清除这三个一次性环境变量。公开注册只会创建普通用户，不会自动产生管理员。

Catalog 连接会额外设置 `search_path=catalog`、只读事务和 5 秒 statement timeout。生产或演示环境应使用最小权限角色，例如由数据库管理员执行（密码请通过安全渠道设置）：

```sql
CREATE ROLE tech_scout_catalog_reader LOGIN PASSWORD 'replace-me';
GRANT CONNECT ON DATABASE "tech-scout" TO tech_scout_catalog_reader;
GRANT USAGE ON SCHEMA catalog TO tech_scout_catalog_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA catalog TO tech_scout_catalog_reader;
ALTER ROLE tech_scout_catalog_reader SET default_transaction_read_only = on;
ALTER ROLE tech_scout_catalog_reader SET statement_timeout = '5s';
```

Catalog 发布账号创建新表时，还应由该表实际所有者配置 `ALTER DEFAULT PRIVILEGES ... GRANT SELECT ON TABLES TO tech_scout_catalog_reader`。该角色不得获得 `staging`、`app` 或 Catalog 写权限。

Catalog schema 变化后重新生成并核对 Kysely 类型：

```bash
pnpm --filter @tech-scout/api catalog:types
pnpm --filter @tech-scout/api catalog:types:check
```

API e2e 必须设置 `TEST_DATABASE_URL` 和 `TEST_CATALOG_DATABASE_URL`。两者可指向同一个专用、可丢弃的测试库（分别使用 `app` 与 `catalog` schema）；测试会清空账户表并重建 Catalog fixture，绝不能指向日常或生产数据库。

## 部署

根目录的 `netlify.toml` 仅配置 `apps/web` 的 Netlify 构建与 SPA 路由回退。API 的部署平台尚未指定。

## License

[MIT](./LICENSE)
