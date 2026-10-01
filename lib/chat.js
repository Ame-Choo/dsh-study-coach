/**
 * 把 DSH 的对话读进面板。
 *
 * 通道是 host 的 `sessionController`（`ctx.get('sessionController')`），和 lib/bridge.js
 * 写对话用的是同一个服务，只是这里读：
 *
 *   list{}                → 可见会话清单（不激活 Agent）
 *   follow{address}       → 打开一个会话日志，第一帧是完整 snapshot，往后是增量事件
 *
 * 只用 follow 的 snapshot：面板要的是「最近 N 条」，不是全量。所以拿到第一帧就
 * break（`for await` 的 break 会自动调 `return()`，把订阅退掉），不常驻连接。
 * 不做 SSE：面板轮询一次拿一份完整快照，逻辑简单，也不会留下断不掉的连接。
 *
 * 事件形状按 DSH `session.v4` 日志实测（拿磁盘上的 .zstd 日志解出来核过）：
 *   {"type":"user/message","seq":9,"time":…,"data":{"content":[{"type":"text","text":"…"}]}}
 *   {"type":"assistant/message","seq":16,…,"data":{"turn":1,"step":1,
 *      "message":{"role":"assistant","content":[{"type":"reasoning",…},
 *                 {"type":"text","text":"…"},{"type":"tool-call","id":…,"name":…}],…},
 *      "usage":{…},"stream":[…]}}
 *   {"type":"tool/call","seq":17,…,"data":{"turn":1,"step":1,"callId":…,"name":"read","arguments":"{…}"}}
 *   {"type":"tool/result","seq":18,…,"data":{"turn":1,"step":1,
 *      "message":{"role":"tool","toolCallId":…,"content":[{"type":"text","text":"…"}]}}}
 * 其余（system/message、request/*、step/*、session-log-*、agent/…）一律不进面板。
 */

/** 一次给面板多少条消息。多了页面卡，少了看不全上下文。 */
export const CHAT_MAX_MESSAGES = 60

/** 单条消息最长留多少字。工具返回动辄几万字，全塞进 JSON 面板要跪。 */
export const CHAT_MAX_CHARS = 4000

const DEFAULT_TIMEOUT = 6000

/** @param {unknown} value */
function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** 剪一段文本，超了留个头 + 省略号。 */
function clip(text) {
  const s = String(text ?? '')
  return s.length > CHAT_MAX_CHARS ? s.slice(0, CHAT_MAX_CHARS) + '\n…（已截断）' : s
}

/**
 * 把一条消息的 content 拆成「能画出来的正文」和「这次动了哪些工具」。
 * reasoning 不画——面板是给学生看的，推理过程反而碍事。
 * @param {unknown} content
 */
function splitContent(content) {
  const text = []
  const tools = []
  if (!Array.isArray(content)) return { text: '', tools }
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) text.push(block.text)
    else if (block.type === 'tool-call' && block.name) tools.push(String(block.name))
  }
  return { text: text.join('\n').trim(), tools }
}

/** tool/call 的 arguments 是 JSON 字符串，抽里面最好认的一个值当摘要。 */
function summarizeArgs(raw) {
  if (typeof raw !== 'string' || !raw) return ''
  let parsed = null
  try {
    parsed = JSON.parse(raw)
  } catch {
    return raw.slice(0, 80)
  }
  if (!parsed || typeof parsed !== 'object') return ''
  for (const key of ['title', 'pointId', 'sessionId', 'file_path', 'path', 'query', 'pattern', 'filePath', 'command']) {
    const value = parsed[key]
    if (typeof value === 'string' && value) return value.length > 60 ? value.slice(0, 60) + '…' : value
  }
  return ''
}

/**
 * 日志记录 → 面板消息。
 *
 * `records` 里每项可能是 `{type:'event', event}`（page/follow 的包装）或者直接就是
 * 事件本身；两种都认。
 */
export function toMessages(records) {
  const list = Array.isArray(records) ? records : []
  const out = []
  for (const record of list) {
    const event = record && record.type === 'event' && record.event ? record.event : record
    if (!event || typeof event !== 'object') continue
    const seq = num(event.seq)
    if (seq === null) continue
    const time = num(event.time) || 0
    const data = event.data && typeof event.data === 'object' ? event.data : {}

    if (event.type === 'user/message') {
      const { text } = splitContent(data.content)
      if (text) out.push({ seq, time, role: 'user', text: clip(text), tools: [] })
      continue
    }

    if (event.type === 'assistant/message') {
      const message = data.message && typeof data.message === 'object' ? data.message : {}
      const { text, tools } = splitContent(message.content)
      if (!text && !tools.length) continue
      const usage = data.usage && typeof data.usage === 'object' ? data.usage : null
      out.push({
        seq,
        time,
        role: 'assistant',
        text: clip(text),
        tools,
        interrupted: Boolean(data.interrupted),
        tokens: usage ? num(usage.totalTokens) : null,
      })
      continue
    }

    if (event.type === 'tool/call') {
      out.push({
        seq,
        time,
        role: 'tool',
        text: '',
        tools: [],
        tool: { name: String(data.name || ''), callId: String(data.callId || ''), hint: summarizeArgs(data.arguments) },
      })
      continue
    }

    if (event.type === 'tool/result') {
      const message = data.message && typeof data.message === 'object' ? data.message : {}
      out.push({
        seq,
        time,
        role: 'result',
        text: '',
        tools: [],
        tool: { callId: String(data.toolCallId || message.toolCallId || ''), failed: Boolean(data.error) },
      })
    }
  }
  out.sort((a, b) => a.seq - b.seq)
  return out
}

/** 面板要用的一条会话摘要。 */
function summaryView(item) {
  return {
    sessionId: String(item.sessionId || ''),
    updatedAt: num(item.updatedAt) || 0,
    running: Boolean(item.running),
    blank: Boolean(item.blank),
    title: typeof item.title === 'string' ? item.title : '',
    cwd: typeof item.cwd === 'string' ? item.cwd : '',
  }
}

/**
 * @param {{ resolve: () => any, timeoutMs?: number }} deps
 *   resolve() 每次现取 sessionController —— 服务可能晚于插件挂载，也可能根本没有。
 */
export function createChat(deps = {}) {
  const resolve = typeof deps.resolve === 'function' ? deps.resolve : () => null
  const timeoutMs = num(deps.timeoutMs) ?? DEFAULT_TIMEOUT

  const controller = () => {
    try {
      const found = resolve()
      return found && typeof found === 'object' ? found : null
    } catch {
      return null
    }
  }

  const deadline = () => AbortSignal.timeout(timeoutMs)

  /**
   * 打开会话日志，只取开头那一帧 snapshot，然后立刻退订。
   * 拿不到 snapshot（服务不认、超时、会话是空的）就回空。
   */
  async function snapshot(service, sessionId, maxMessages) {
    const request = { address: { kind: 'session', sessionId }, maxMessages }
    /** @type {AsyncIterable<any> | null} */
    let stream = null
    try {
      stream = service.follow(request, deadline())
      if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') {
        return { records: [], cursor: null, header: null, error: 'follow 没有返回异步迭代器' }
      }
      for await (const frame of stream) {
        if (frame && frame.type === 'snapshot') {
          return {
            records: Array.isArray(frame.records) ? frame.records : [],
            cursor: num(frame.cursor),
            header: frame.header && typeof frame.header === 'object' ? frame.header : null,
            error: '',
          }
        }
      }
      return { records: [], cursor: null, header: null, error: '没有收到 snapshot 帧' }
    } catch (error) {
      return { records: [], cursor: null, header: null, error: String((error && error.message) ?? error) }
    } finally {
      // break 出 for await 已经会退订；这里是兜底，防止半路抛异常留下订阅。
      if (stream && typeof stream.return === 'function') {
        try {
          await stream.return()
        } catch {
          /* 退订失败不该盖掉真正的结果 */
        }
      }
    }
  }

  return {
    /** 这台机器上到底读不读得到对话。读不到面板就退回「留言」那套。 */
    get available() {
      return Boolean(controller())
    },

    /** 可见会话清单。子会话（子 agent）不进面板——那是教练自己的手脚，不是对话。 */
    async sessions() {
      const service = controller()
      if (!service) return { ok: false, available: false, error: '这台机器上没有会话服务', sessions: [] }
      if (typeof service.list !== 'function') return { ok: false, available: false, error: '会话服务不支持 list', sessions: [] }
      try {
        const value = await service.list({}, deadline())
        const items = Array.isArray(value && value.items) ? value.items : []
        const rows = items
          .filter((item) => item && item.sessionId && !item.parentSessionId && item.origin !== 'subagent')
          .map(summaryView)
          .sort((a, b) => b.updatedAt - a.updatedAt)
        return { ok: true, available: true, error: '', sessions: rows }
      } catch (error) {
        return { ok: false, available: true, error: String((error && error.message) ?? error), sessions: [] }
      }
    },

    /**
     * 某个会话最近的一屏对话。sessionId 留空就挑最近那个非空会话。
     */
    async history({ sessionId = '', maxMessages = CHAT_MAX_MESSAGES } = {}) {
      const service = controller()
      if (!service) return { ok: false, available: false, error: '这台机器上没有会话服务', messages: [] }
      if (typeof service.follow !== 'function') return { ok: false, available: false, error: '会话服务不支持 follow', messages: [] }

      const size = Math.max(1, Math.min(200, Math.round(num(maxMessages) ?? CHAT_MAX_MESSAGES)))
      let id = String(sessionId || '')

      if (!id) {
        const listed = await this.sessions()
        if (!listed.ok) return { ok: false, available: listed.available, error: listed.error, messages: [] }
        // blank 的会话是刚开出来还没说话的，读它只能读到空日志；优先挑有内容的。
        const picked = listed.sessions.find((s) => !s.blank) || listed.sessions[0]
        if (!picked) return { ok: true, available: true, error: '', sessionId: '', messages: [], sessions: listed.sessions }
        id = picked.sessionId
      }

      const shot = await snapshot(service, id, size)
      return {
        ok: !shot.error,
        available: true,
        error: shot.error,
        sessionId: id,
        cursor: shot.cursor,
        title: shot.header && typeof shot.header.title === 'string' ? shot.header.title : '',
        messages: toMessages(shot.records),
      }
    },
  }
}
