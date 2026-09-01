# Tech Scout

Tech Scout 是一个基于 pnpm workspace 和 Turborepo 的全栈 monorepo，包含 React 管理端和 NestJS API。

## 项目结构

```text
tech-scout/
├─ apps/
│  ├─ web/    # React 19 + Vite 8
│  └─ api/    # NestJS 12
├─ .oxfmtrc.json
├─ .oxlintrc.json
├─ package.json
├─ pnpm-workspace.yaml
└─ turbo.json
```

## 环境要求

- Node.js 24
- pnpm 10.34.4

## 开始开发

```bash
pnpm install
pnpm dev
```

`pnpm dev` 会同时启动：

- Web：<http://localhost:5173>
- API：<http://localhost:3000>

两个应用当前保持独立运行，尚未配置开发代理、CORS 或业务 API 联调。

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

## 环境变量

- Web：复制 `apps/web/.env.example` 为 `apps/web/.env`
- API：复制 `apps/api/.env.example` 为 `apps/api/.env`

## 部署

根目录的 `netlify.toml` 仅配置 `apps/web` 的 Netlify 构建与 SPA 路由回退。API 的部署平台尚未指定。

## License

[MIT](./LICENSE)
