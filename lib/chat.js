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
 * 只有这两种进面板（见 CHAT_EVENT_TYPES）。同一个日志里还有 tool/call、tool/result、
 * system/message、request/*、step/*、session-log-*、agent/… —— 那些是教练自己的手脚
 * 和宿主的记账，不是对话，一律不往下走。
 *
 * 会话清单只列**学习模式**（agentPreset === 'study-coach'）的那些：DSH 里还躺着编程的、
 * 顺手开的会话，这一页是给学生看学习那条线的。判据在 lib/session-preset.js，跟投话那条线
 * （lib/bridge.js）共用一份。
 *
 * 一台机器上可能一个学习会话都还没有（学生刚装插件）。所以这一页自己也能开一个：
 * create() 走 sessionController.create({ agentPreset: 'study-coach' })，开出来的 id
 * 立刻记一笔（session-preset.js 的 rememberFresh），免得投影还没落地就被自己的筛子筛掉。
 */

import { isFresh, learningSessions, newSessionRequest, rememberFresh } from './session-preset.js'

/** 一次给面板多少条消息。多了页面卡，少了看不全上下文。 */
export const CHAT_MAX_MESSAGES = 60

/** 单条消息最长留多少字。工具返回动辄几万字，全塞进 JSON 面板要跪。 */
export const CHAT_MAX_CHARS = 4000

/**
 * 面板只认这两种会话事件，别的一律不进。
 *
 * 为什么**不**放 tool/call 和 tool/result：这一页是给学生看的对话窗，不是 agent 的
 * 监控台。实测一个正常会话里工具事件是正文的十几倍，一屏下来全是「调用 pwsh（3 步）」，
 * 真正说过的话被冲没。这一轮回复动了哪些工具，assistant/message 自带的 tools 已经
 * 折成一行「用了 read、edit」，够用了。
 *
 * 要往回加，把类型写进这张表、再在 toMessages 里补一段映射即可。
 */
export const CHAT_EVENT_TYPES = Object.freeze(['user/message', 'assistant/message'])

/**
 * 日志里的 `user/message` 有两种：学生真敲的字，和宿主塞进去的注入块。
 * 实测见过整条消息就是一段 `<system-reminder>`（AGENTS.md 全文），面板会把它当成
 * 学生说的话整段画出来 —— 这种不画。
 */
const INJECTED_USER_RE = /^\s*<(?:system[-_](?:reminder|instruction|prompt)s?|system)\b/i

/** @param {string} text */
function isInjectedUserText(text) {
  return INJECTED_USER_RE.test(text)
}

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
    // 先按类型筛一道：不在这张表里的事件根本不往下走。
    if (!CHAT_EVENT_TYPES.includes(event.type)) continue
    const seq = num(event.seq)
    if (seq === null) continue
    const time = num(event.time) || 0
    const data = event.data && typeof event.data === 'object' ? event.data : {}

    if (event.type === 'user/message') {
      const { text } = splitContent(data.content)
      if (!text || isInjectedUserText(text)) continue
      out.push({ seq, time, role: 'user', text: clip(text), tools: [] })
      continue
    }

    // 走到这儿只剩 assistant/message。一轮里带工具调用的「空正文」步很常见，
    // 画出来就是一排「（这一步没有正文）」，一点信息都没有 —— 只留有正文的。
    const message = data.message && typeof data.message === 'object' ? data.message : {}
    const { text, tools } = splitContent(message.content)
    if (!text) continue
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
   * 最近一次清单判定的底账：哪些会话是学习模式的、这次筛没筛。
   * history() 靠它决定「学生点进来这个会话能不能读」，省掉每次轮询都重拉一遍清单。
   * @type {{ ids: Set<string>, filtered: boolean } | null}
   */
  let lastList = null

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

    /**
     * 开一个新的「学习教练」会话（面板上那颗「＋ 新建」）。
     *
     * DSH 的 create() 是按 (workspace, sessionId, preset) **幂等收养**的：不给 sessionId
     * 就是新建，不给 cwd 就落在宿主自己当前那个工作区 —— 面板不猜路径，交给宿主定。
     *
     * 建完先把 id 记进 freshSessions：会话投影是异步写下来的，紧接着 re-list 时它可能
     * 还没带上 agentPreset，严格按预设筛会把学生刚开的这个会话自己筛掉。记一笔就绕开了。
     */
    async create() {
      const service = controller()
      if (!service) return { ok: false, available: false, error: '这台机器上没有会话服务', sessionId: '' }
      if (typeof service.create !== 'function') {
        return { ok: false, available: true, error: '会话服务不支持 create', sessionId: '' }
      }
      try {
        const value = await service.create(newSessionRequest())
        const id = rememberFresh(value && value.sessionId)
        if (!id) return { ok: false, available: true, error: '宿主没有回会话 id', sessionId: '' }
        // 新会话还没进过任何一份清单底账，下次 sessions() 重新拉。
        lastList = null
        return {
          ok: true,
          available: true,
          error: '',
          sessionId: id,
          agentPreset: typeof (value && value.agentPreset) === 'string' ? value.agentPreset : '',
        }
      } catch (error) {
        return { ok: false, available: true, error: String((error && error.message) ?? error), sessionId: '' }
      }
    },

    /**
     * 可见会话清单。子会话（子 agent）不进面板——那是教练自己的手脚，不是对话。
     * 宿主发会话投影时只留学习模式（`study-coach`）的；filtered 说明这次筛没筛。
     */
    async sessions() {
      const service = controller()
      if (!service) return { ok: false, available: false, filtered: false, error: '这台机器上没有会话服务', sessions: [] }
      if (typeof service.list !== 'function') {
        return { ok: false, available: false, filtered: false, error: '会话服务不支持 list', sessions: [] }
      }
      try {
        const value = await service.list({}, deadline())
        const items = Array.isArray(value && value.items) ? value.items : []
        const { items: kept, filtered } = learningSessions(items)
        const rows = kept.map(summaryView).sort((a, b) => b.updatedAt - a.updatedAt)
        lastList = { ids: new Set(rows.map((s) => s.sessionId)), filtered }
        return { ok: true, available: true, filtered, error: '', sessions: rows }
      } catch (error) {
        return { ok: false, available: true, filtered: false, error: String((error && error.message) ?? error), sessions: [] }
      }
    },

    /**
     * 某个会话最近的一屏对话。sessionId 留空就挑最近那个非空的学习会话。
     *
     * 显式给了 sessionId 也要核一下：面板只该读学习模式的会话，别让人拿一个别的会话
     * 的 id 把编程那条日志画到这一页上。
     */
    async history({ sessionId = '', maxMessages = CHAT_MAX_MESSAGES } = {}) {
      const service = controller()
      if (!service) return { ok: false, available: false, filtered: false, error: '这台机器上没有会话服务', messages: [] }
      if (typeof service.follow !== 'function') {
        return { ok: false, available: false, filtered: false, error: '会话服务不支持 follow', messages: [] }
      }

      const size = Math.max(1, Math.min(200, Math.round(num(maxMessages) ?? CHAT_MAX_MESSAGES)))
      let id = String(sessionId || '')

      if (id) {
        // 手上没有清单底账（面板直接带 id 进来）就先拉一次，有了就不再问。
        if (!lastList) await this.sessions()
        // 「面板自己刚开出来的那个」是例外：它不是预设不对，是投影还没落地。
        if (lastList && lastList.filtered && !lastList.ids.has(id) && !isFresh(id)) {
          return {
            ok: false,
            available: true,
            filtered: true,
            error: '这个会话不是「学习教练」模式的，面板不读它的对话',
            sessionId: id,
            messages: [],
          }
        }
      } else {
        const listed = await this.sessions()
        if (!listed.ok) {
          return { ok: false, available: listed.available, filtered: false, error: listed.error, messages: [] }
        }
        // blank 的会话是刚开出来还没说话的，读它只能读到空日志；优先挑有内容的。
        const picked = listed.sessions.find((s) => !s.blank) || listed.sessions[0]
        if (!picked) {
          return {
            ok: true,
            available: true,
            filtered: listed.filtered,
            error: '',
            sessionId: '',
            messages: [],
            sessions: listed.sessions,
          }
        }
        id = picked.sessionId
      }

      const shot = await snapshot(service, id, size)
      return {
        ok: !shot.error,
        available: true,
        filtered: Boolean(lastList && lastList.filtered),
        error: shot.error,
        sessionId: id,
        cursor: shot.cursor,
        title: shot.header && typeof shot.header.title === 'string' ? shot.header.title : '',
        messages: toMessages(shot.records),
      }
    },
  }
}
