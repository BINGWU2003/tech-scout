# TechScout Data Foundation

离线数据工程项目，负责将官方批量数据构建并发布为可验证的 PostgreSQL Catalog。它不是在线服务，也不参与浏览器请求。

## 包含内容

- `src/data_foundation/datasets`：Bronze、Silver、实体审核和 Catalog 发布。
- `src/data_foundation/reports`：固定模板、可复现的 Data Gate 报告。
- `src/data_foundation/shared`：仓库路径和数据库连接等内部基础设施。
- `migrations`：`staging` 与 `catalog` schema 的已发布 migration。
- `tests`：完全离线 fixture 和构建/验证测试。

## 环境和测试

```powershell
uv sync --project pipelines/data-foundation
uv run --project pipelines/data-foundation pytest pipelines/data-foundation/tests
uv run --project pipelines/data-foundation ruff check pipelines/data-foundation
```

构建、审核、发布和报告统一使用本项目注册的 Python CLI：

```powershell
uv run --project pipelines/data-foundation data-foundation --help
uv run --project pipelines/data-foundation data-foundation bronze --help
uv run --project pipelines/data-foundation data-foundation silver --help
uv run --project pipelines/data-foundation data-foundation review --help
uv run --project pipelines/data-foundation data-foundation catalog --help
uv run --project pipelines/data-foundation data-foundation report minimal --help
```

根 `package.json` 只管理 Node/Turborepo 应用；Data Foundation 的依赖、命令和测试均由本目录的 `pyproject.toml` 与 `uv.lock` 管理。
Source Manifest 仍由现有 Node 流式哈希工具生成，因此暂时保留 `pnpm data:manifest` 和 `pnpm test:data-manifest`。

## 边界

- 可以读取 Raw/Bronze/Silver 和审核 release。
- 可以使用 staging 并发布 Catalog。
- 不能写入未来的产品 `app` 表。
- 不能被 `services/intelligence` 在线服务直接 import。
- 不保存数据库密码或大型数据文件。

完整发布流程见 [`docs/data-acquisition-guide.md`](../../docs/data-acquisition-guide.md)，系统边界见 [`docs/architecture.md`](../../docs/architecture.md)。
