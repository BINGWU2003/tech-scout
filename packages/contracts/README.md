# TechScout Contracts

React 和 NestJS 共享的运行时 Zod 契约。该包只能包含协议 schema、派生类型和 OpenAPI 元数据，不能依赖 React、NestJS、Prisma、Kysely 或业务服务实现。

Prisma 生成类型属于 `app` 持久化实现，不能从本包导出。Python Intelligence 的内部 API 由 Pydantic/OpenAPI 描述，并为 NestJS 生成 TypeScript 类型。
