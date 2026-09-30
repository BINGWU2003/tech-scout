# 04 · 断线、刷新与结束

[返回目录](README.md) · [上一篇](03-nestjs-to-browser.md)

## 先区分三个“结束”

| 概念 | 含义 |
| --- | --- |
| 研究执行停止 | 业务不再继续本轮执行，已有事件仍然保留 |
| 一次 SSE HTTP 响应结束 | 当前网络连接关闭，不表示数据库中的历史消失 |
| 浏览器 `EventSource.close()` | 主动关闭对象，停止它的自动重连 |

SSE 协议本身没有“研究完成”的内置语义。业务完成事件与连接何时关闭，需要应用代码配合。

## 场景一：浏览器网络短暂断开

Wi-Fi 切换、VPN 重连、休眠、服务重启或代理超时，都可能中断连接。

```text
浏览器收到 id: 3
  → 网络断开
  → 后端感知旧连接关闭，退出旧请求（感知可能延迟）
  → EventSource 对象仍在，没有调用 close()
  → 浏览器自动尝试新的 HTTP 请求
      Last-Event-ID: 3
  → 后端重新进入 Controller，查询 sequence > 3
  → 补发已保存的 4、5，继续等待后续事件
```

每次重连都是新请求、新响应流，不是恢复旧的 Controller 循环。

[前端 Hook](../../apps/web/src/features/research/use-research-run.ts) 中：

```typescript
stream.onopen = () => setDisconnected(false)
stream.onerror = () => setDisconnected(true)
```

这两个回调只设置连接状态。可重试断线后的重连由浏览器 `EventSource` 实现，不是 `onerror` 手动发请求；并非所有 HTTP 错误都保证无限重试。

UI Controller 使用：

```typescript
after: request.header('Last-Event-ID') ?? q.after
```

所以即使最初 URL 为 `after=1`，后来收到 `id: 3`，自动重连仍可以从 3 之后读取。

## 场景二：刷新页面

刷新会销毁旧页面及 EventSource，新对象不会自动继承旧对象的 Last-Event-ID。

```text
刷新 → 旧连接关闭
  → 新页面请求摘要和历史事件
  → 历史按 sequence 排序，取最大序号
  → 若 queued/running，建立 stream?after=最大序号
  → 若已停止执行，显示已保存内容，不建立 SSE
```

序号由后端持久化，所以刷新不会重排或重新编号。前端恢复的是已保存内容和读取位置。

## 场景三：断线期间任务已经完成

```text
收到 3 → 断线
后台保存 4、5，其中 5 表示完成
浏览器恢复连接 → 查询 sequence > 3 → 仍可得到 4、5
```

任务完成不会删除历史事件，UI 查询也没有“必须 running 才能读取”的限制。只要任务仍存在且有权限，就可以读到已保存的数据。

也可能普通轮询先发现完成，前端就关闭 SSE，再通过 `/events` 补齐最终事件，而不再等待 SSE 重连。

## 当前项目是谁关闭 UI SSE

[UI Controller](../../apps/api/src/research/research-view.controller.ts) 的核心结构是：

```typescript
response.on('close', () => { closed = true })
try {
  while (!closed) {
    // 发送事件或心跳，等待，再查询
  }
} finally {
  response.end()
}
```

这里没有根据业务终态退出的判断。正常页面流程是：

```text
收到完成相关事件，或轮询发现状态变化
  → 摘要刷新，不再 queued/running
  → effect 清理执行 stream.close()
  → 后端感知连接关闭，退出循环
```

组件卸载、相关依赖变化也会触发清理。任务删除导致后续查询 NotFound 时，Controller 也会结束响应；异常同样可能结束连接。

如果单独用客户端连接这个接口，任务完成后不主动断开，可能继续收到心跳。浏览器 Network 中长连接显示 Pending 本身不是错误。

后端当然可以用 `response.end()` 主动结束响应，但 EventSource 通常会对此尝试重连。如果将来设计“后端通知完成后停止订阅”，需要业务结束信号与前端 `close()` 配合；这不是当前 UI stream 已实现的专用 done 协议。

## Python → NestJS 的断线恢复不同

| 对比项 | 浏览器 → NestJS | NestJS → Python |
| --- | --- | --- |
| 客户端 | 原生 EventSource | fetch + 手动解析 |
| 自动恢复来源 | 浏览器重连机制 | 后台 tick → sync → listen |
| 续传位置 | Last-Event-ID，或新建时 query.after | 应用数据库中已保存的最大序号，先补齐再订阅 |
| 主动关闭 | EventSource.close() | AbortController.abort() |

NestJS 内部监听收到 `execution_stopped` 或 cancelled 会停止；这不影响浏览器之后从应用数据库读取历史。

## 当前实现的边界

- 两段流都通过轮询事件表输出数据，更新存在查询与传输延迟。
- 心跳帮助保持连接，但不能保证所有代理、网络故障下连接永不中断。
- 事件回放依赖任务和事件仍然存在、鉴权成功、后端服务可用。
- 前端执行期间会周期性从 0 加载历史；历史增大时读取成本也会增加。
- 事件序号、持久化和去重支持恢复，但不能据此宣称任意情况下绝不丢失或端到端恰好一次。

## 自检

1. 没有调用前端 close，后端旧连接就永远不结束吗？不是，感知网络断开后也会结束。
2. 重连是否复用旧请求？不复用，会重新执行 Controller。
3. SSE 结束是否意味着历史读不到？不是，网络生命周期与存储生命周期不同。
4. 为什么任务结束仍能补发事件？事件已经保存，读取不要求任务仍在执行。
