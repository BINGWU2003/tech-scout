# 02 · Python 事件如何进入 NestJS 数据库

[返回目录](README.md) · [上一篇](01-events-and-sequence.md) · [下一篇：NestJS → 浏览器](03-nestjs-to-browser.md)

## 从产生事件到第一次保存

### 大模型流的处理入口

[llm.py](../../services/research/src/tech_scout_intelligence/llm.py) 的 `DeepSeek.generate()` 对可展示的对话响应开启流式调用。这里的 `visible` 对应 `ConversationReply` 或 `DirectionProposal`，其他内部模型调用走普通响应。

```python
# 摘录核心结构，省略其他参数与处理
chat = cast(AsyncChat, client.chat)
stream = await chat.completions.create(
    **options,
    stream=True,
    stream_options={"include_usage": True},
)
async with stream:
    async for chunk in stream:
        # 提取增量内容、累积和发布进度
        ...
```

SDK 将模型流解析为 chunk，`async for` 类似 JS 的 `for await`。代码读取 `choice.delta`，累积正文 `content`，并用 `partial_reply(content)` 从尚未完整的 JSON 中提取可展示的 reply。开启思考时，还会累积 `reasoning_content`。

模型 chunk 不等于研究事件。回答首次出现时立即发布；之后有内容变化，且距上次发布至少 0.3 秒时，再调用 `publish_answer("streaming")`。思考首次出现或更新距上次发布至少 0.5 秒时会发布思考进度。这些是新 chunk 到达时检查的条件，不是固定计时器。

`publish_answer()` 设置回答状态，获取当前 artifacts，合并回答快照，再调用：

```python
await self.store.publish(
    run_id,
    lease=lease,
    kind="answer_progress",
    artifacts={**current.artifacts, "answer": dict(answer)},
)
```

`{**current.artifacts, ...}` 类似 JS 的对象展开。思考内容则由同文件的 `publish()` 包装为 `reasoning_progress`。这里的“发布”最终是写入事件表，不是直接向 NestJS 的连接写数据。

### sequence 在写入时生成

[Python Store](../../services/research/src/tech_scout_intelligence/store.py) 的 `publish()` 在事务中锁定任务并校验执行租约，再交给 `update()` 更新状态。

`update()` 增加 `sequence`、更新 `agent_runtime.research_run`，并向 `agent_runtime.research_event` 插入事件。这是事件第一次持久化，序号在这里确定。

```python
row.update(changes)
row["sequence"] += 1
view = self.view(row)
# 同一事务内更新任务，并插入携带此序号和快照的事件
```

任务的 sequence 默认从 0 开始。后续传输、NestJS 落库及前端显示都沿用它，不在每层重新编号。

```text
研究流程或 LLM 处理产生进度
  → Store.publish / update
    → sequence 加 1
    → 保存任务状态和事件
```

## Python 如何输出 SSE

[app.py](../../services/research/src/tech_scout_intelligence/app.py) 中的 `stream_events()` 实现内部接口：

```http
GET /runs/{run_id}/stream?after=3
Authorization: Bearer <内部服务令牌>
```

它先确认任务存在，再通过 FastAPI `StreamingResponse` 输出异步生成器的数据。下面是简化伪代码：

```text
cursor = after
while 客户端未断开:
  查询 sequence > cursor，升序，最多 20 条
  逐条输出 id、data、空行，并推进 cursor
  如果没有事件，输出心跳注释
  等待 1 秒
```

SSE 的传输格式如下，JSON 内容已省略：

```text
id: 4
data: {"sequence":4,"kind":"answer_progress","data":{...}}

```

空行标记一帧结束。没有数据时发送 `: keepalive\n\n`，它不是研究事件，不写事件表、不增加序号。

Python 这个 stream handler 没有“任务完成即退出”的条件；客户端断开、任务被删除或异常可以结束它。

### stream_events 的 Python 语法与执行顺序

| 代码 | 作用，以及前后端开发中的类比 |
| --- | --- |
| `@app.get(...)` | 注册路由，类似 NestJS `@Get(...)` |
| `run_id: UUID` | 解析并校验路径中的 UUID |
| `after: int = Query(default=0, ge=0)` | 整数查询参数，默认 0，不能小于 0 |
| `cast(Store, request.app.state.store)` | 给动态状态属性补静态类型，不创建或转换对象 |
| `await store.get(run_id)` | 在发送流响应头前确认任务存在 |
| `async def generate()` | 定义闭包，能访问外层的 store、run_id、after |
| `yield ...` | 逐段交出内容，类似 JS 异步生成器的 yield；不是 return |
| `json.dumps(event, ensure_ascii=False)` | 类似 JSON.stringify，并保留中文字符 |
| `await asyncio.sleep(1)` | 暂停当前协程，让出执行权，不阻塞整个服务 |
| `StreamingResponse(generate(), ...)` | 消费生成器，将每次 yield 的内容写入 HTTP 响应 |

因为函数包含 yield，调用 `generate()` 得到的是异步生成器对象，不是把整个循环一次执行完。响应框架逐步消费它，类似 NestJS 持续调用 `response.write()`；生成器正常结束后，响应也会结束。

循环中的 `cursor = event["sequence"]` 只推进读取位置，不是生成序号。`stream_events()` 不调用 `update()`：研究执行负责写，SSE 接口负责读，二者通过数据库衔接。

查询期间若任务被删除，代码捕获 `RUN_NOT_FOUND` 并 return，结束生成器；其他 ResearchError 继续抛出。

### request.app.state.store 对应哪个对象

应用启动的 `lifespan()` 中执行：

```python
store = Store(pool, config, database)
app.state.store = store
```

请求通过 `request.app` 找到应用，再从 `state.store` 获取同一个 Store 实例。因此 `store.events()` 对应 [store.py](../../services/research/src/tech_scout_intelligence/store.py) 中的 `Store.events()`。

`app.state` 是动态属性容器，编辑器可能无法推断 store 类型。当前代码用 `cast(Store, ...)` 明确类型，便于跳转和补全；它不执行运行时校验。LLM 客户端同样用 `cast(AsyncChat, client.chat)` 明确 chat 类型。若编辑器仍报类型错误，应确认使用项目的 `services/research/.venv/Scripts/python.exe`；项目环境的检查结果和编辑器的环境可能不同。

## NestJS 在哪里启动监听

[ResearchService](../../apps/api/src/research/research.service.ts) 的调用关系：

```text
create() 创建项目 ──────────────┐
newRun() 创建新轮次 ────────────┼→ sync() → 条件满足时 listen()
onModuleInit() → 定时 tick() ──┘
```

`sync()` 并非直接连接 SSE，它会先完成以下步骤：

1. 调用幂等的 `intelligence.start()` 同步启动状态，并保存返回状态。
2. 读取应用事件表中该任务的最大序号。
3. 调用 Python `/events?after=...`，每批最多 20 条，补齐已有事件。
4. 对每条补拉事件调用 `receive()` 落库。
5. 检查当前状态与最后事件，再决定是否调用 `listen()`。例如已经记录到当前序号的 `execution_stopped`，或任务已取消，就不会继续订阅。

`listen()` 使用 Map 防止同一服务实例为同一任务重复建立后台连接，并用 `AbortController` 管理连接结束。

## NestJS 如何接收流

[IntelligenceClient.stream()](../../apps/api/src/research/intelligence.client.ts) 使用手写 `fetch`，不是浏览器 `EventSource`：

```typescript
// 简化示意
const response = await fetch(url, {
  headers: { Authorization: `Bearer ${token}` },
  signal,
})

for await (const chunk of response.body) {
  buffer += decoder.decode(chunk, { stream: true })
  // 按空行拆完整 SSE 帧，提取 data，解析 JSON、校验 schema
  // 然后 yield event
}
```

网络 `chunk` 可能只有半条消息，也可能包含多条，所以需要缓冲区。实现只消费 `data:` 内容，心跳没有 data，会被忽略。

NestJS 从解析后的 JSON 中读取 `event.sequence`，不是靠解析 SSE 的 `id:` 行生成序号。Python 输出时 `id` 和 JSON 中的 sequence 使用同一事件序号；`receive()` 还会校验事件序号与其状态快照中的序号一致。

生成 SDK 中的 `streamEvents()` 当前只有定义和导出，没有业务调用；真正走的是 `IntelligenceClient.stream()`。

## 收到事件后在哪里存库

`listen()` 使用 `for await` 消费生成器：

```typescript
// 简化示意
for await (const event of this.intelligence.stream(runId, after, signal)) {
  // 先确认事件属于当前 runId
  await this.receive(event)
  if (event.kind === 'execution_stopped' || event.data.status === 'cancelled') {
    break
  }
}
```

`receive()` 在事务中：

1. 校验事件序号与状态快照序号一致，锁定本地任务；任务已删除则不继续写。
2. 按 `(runId, sequence)` 向 `app.research_event` upsert；已存在时不重复插入。
3. 仅在收到更大的序号时，更新 `app.research_run` 的最新状态和序号。

因此 NestJS **确实保存了事件**。保存的是解析后的业务数据，不是 SSE 原始文本。普通 `/events` 补齐和 SSE 实时接收都调用同一个 `receive()`。

## 这段连接如何恢复与结束

`fetch` 不会自动重连。监听结束时，`finally` 会 abort 并移除 Map 中的连接记录。模块初始化设置的 2 秒定时检查会尝试通过 `tick → sync → listen` 恢复。

`tick()` 有防重入机制，每批最多选取 20 个任务，不只查询 running 任务。因此“每 2 秒触发检查”不意味着每个断线都恰好 2 秒恢复。

收到 `execution_stopped` 或 cancelled 事件后，NestJS 消费端主动结束监听。`execution_stopped` 是业务事件，不是 SSE 协议自带的结束标记。服务销毁时也会 abort 所有后台连接。

## 自检

1. 打开前端 SSE 才会启动 Python 监听吗？不会，后台监听由创建和同步流程触发。
2. NestJS 收到同一序号两次会插入两条吗？不会，使用任务 ID 与序号去重。
3. Python stream handler 没有终态判断，连接怎么停？NestJS 消费端收到相应业务事件后主动中止连接。
4. 为什么 stream_events 里看不到 update？它只读已保存事件，写入由研究执行流程触发。
5. 是否等模型生成完才保存？不是，可展示的流式内容会在生成过程中发布进度。
