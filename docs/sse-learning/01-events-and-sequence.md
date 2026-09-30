# 01 · 事件、sequence 与数据库

[返回目录](README.md) · [下一篇：Python → NestJS](02-python-to-nestjs.md)

## 一条事件是什么

研究执行中产生的状态变化或进度更新，会保存为事件，例如 `planner_progress`、`search_progress`、`reasoning_progress`、`answer_progress`。一项业务步骤可以产生很多事件。

Python 保存的事件包含序号、类型、时间和当时的研究状态快照。NestJS 接收后保存到应用侧事件表，UI 查询时再提取展示需要的字段。

```text
同一个研究任务：
sequence=1   创建任务
sequence=2   开始处理
sequence=3   回答更新
sequence=4   回答再次更新
……
sequence=150 回答继续更新
```

这是示意。`sequence` 不是步骤编号、token 编号，也不是每次返回时重新计算的数组下标。

## sequence、after、Last-Event-ID

| 名称 | 谁产生 | 表示什么 |
| --- | --- | --- |
| `sequence` | Python 保存新事件时递增 | 当前任务内的事件序号，随事件持久化 |
| `after` | 调用方传入；服务端发送过程中也推进本地游标 | 本次读取从哪个序号之后开始 |
| `Last-Event-ID` | 浏览器 EventSource 自动重连时携带 | 该对象最后接收到的 SSE `id` |

本项目把 SSE `id` 设置为事件的 `sequence`，因此这些值能关联起来。相同序号可以出现在不同任务里，要结合 `runId` 识别事件。

```text
已收到 sequence=3
    → 请求 after=3
    → 查询 sequence > 3
    → 返回 4、5……，不再返回 3
```

刷新页面不会改变数据库中的序号。前端重新读出事件后，就能恢复顺序与订阅位置。

## 历史事件不是“已完成任务的事件”

查询时已经产生、已经存库的事件，都可以称为历史事件。任务仍然运行时，之前的进度也属于可回放历史。

`/events` 和 `/stream` 查同一张应用事件表，都能返回已有事件。区别是前者返回一批后结束，后者继续等待新事件。

## runEvents SQL 做了什么

源码：[research.repository.ts](../../apps/api/src/research/research.repository.ts) 中的 `runEvents()`。

核心筛选条件：

```sql
FROM app.research_event e
WHERE e.run_id = ${id}::uuid
  AND e.sequence > ${after}
ORDER BY e.sequence ASC
LIMIT 100
```

它限定任务与游标，升序返回最多 100 条。`${id}` 和 `${after}` 在 `Prisma.sql` 中作为参数绑定；`::uuid` 是 PostgreSQL 类型转换。

理解结果时，可以想成“选出需要的事件，再为每条事件生成展示字段”。实际物理执行顺序由数据库查询计划决定。

### JSON 提取

| SQL | 近似 JavaScript 含义 | 返回类型 |
| --- | --- | --- |
| `e.data->>'status'` | `data.status` | 文本 |
| `e.data->'error'` | `data.error` | JSON |
| `e.data #> '{artifacts,answer}'` | `data.artifacts?.answer` | JSON |

`'{artifacts,answer}'` 是路径数组，依次进入两层字段。SQL `NULL` 与 JavaScript `undefined` 并不相同，这里只是用访问方式作类比。

```sql
-- 两者都提取 JSON，路径缺失时返回 SQL NULL
e.data #> '{artifacts,answer}'
e.data -> 'artifacts' -> 'answer'

-- #>> 则将路径对应的值提取为文本
e.data #>> '{artifacts,answer,text}'
```

### CASE 决定每个进度列的内容

| 输出列 | 提取条件 |
| --- | --- |
| `process` | `planner_progress` 或 `search_progress` |
| `acquisition` | `acquisition_progress` |
| `reasoning` | `reasoning_progress`，或状态不再是 `queued/running` |
| `answer` | `answer_progress`，或状态不再是 `queued/running` |

每个 `CASE` 独立计算，不是互斥的 `if/else`。没有 `ELSE`，条件不满足时返回 SQL `NULL`。满足条件但 JSON 路径不存在时也可能为空。

例如运行中的 `answer_progress` 通常只提取 `answer`；当状态不再是 `queued/running` 时，会同时尝试提取 `reasoning` 和 `answer`。

其余固定字段包括 `sequence`、`kind`，以及从 JSON 顶层提取的 `status`、`node`、`error`。时间通过 `AT TIME ZONE 'UTC'` 和 `to_char` 格式化为如 `2026-09-30T08:30:12.123Z` 的字符串，别名 `"createdAt"` 保留驼峰大小写。

所有这些都在一次查询中完成，不会先查顶层字段，再另查一次 `data`。

## Python 的 Store.events 如何执行查询

与上面的 NestJS SQL 对应，Python 的 [Store.events()](../../services/research/src/tech_scout_intelligence/store.py) 查询执行侧事件表，每批最多 20 条：

```python
cursor = await conn.execute(
    select(
        ResearchEvent.sequence,
        ResearchEvent.kind,
        ResearchEvent.created_at,
        ResearchEvent.data,
    )
    .where(ResearchEvent.run_id == run_id, ResearchEvent.sequence > after)
    .order_by(ResearchEvent.sequence)
    .limit(20)
)
```

`ResearchEvent` 是 SQLAlchemy 模型类。`ResearchEvent.sequence` 表示表中的一列，不是某条记录的实际序号。列属性的 `==`、`>` 等运算符用于构造 SQL 条件，所以无需先创建模型实例。Python 创建实例也不用 new，而是 `ResearchEvent(...)`。

```text
select / where / order_by / limit
  → 构造查询表达式，尚未执行 SQL
await conn.execute(查询表达式)
  → 使用当前事务的连接执行 SQL，等待数据库结果
cursor.mappings()
  → 按字段名读取结果行
[dict(r) for r in cursor.mappings()]
  → 转成字典列表
```

这里变量名 cursor 表示查询结果对象，与 SSE 中表示已读序号的 cursor 不是同一概念。随后代码用 `json.dumps(..., default=str)` 再 `json.loads(...)`，将时间等对象转换为 JSON 可表示的数据，供接口返回。

## 序号在恢复中的用途

- 增量读取：`sequence > after`。
- 回放排序：`ORDER BY sequence ASC`。
- 保存去重：NestJS 使用 `(runId, sequence)` 做 upsert。
- 防止状态倒退：只允许更大序号的事件更新最新任务状态。

这是一套持久化、回放与去重机制，不应将其理解为在任意故障下都保证端到端“恰好一次”。

## 自检

1. 一次研究只有 5 个步骤，为什么可以有 200 条事件？因为一个步骤会多次更新进度。
2. `after=100` 是第 100 页吗？不是，它表示只读序号大于 100 的事件。
3. `LIMIT 100` 限制序号最大值吗？不限制，只限制每次返回的条数。
