/**
 * 「这个会话是不是学习模式的」——只此一处判断。
 *
 * 面板那页「与教练对话」读的是 DSH 里真正的会话，可 DSH 里还躺着别的会话（编程的、
 * 顺手开一个问事的）。学生在这一页要看的是**学习那一条线**，所以会话清单得先按
 * 预设筛一道：只留 agentPreset === 'study-coach' 的。lib/chat.js 读对话、lib/bridge.js
 * 投话，两头都用这里，免得两边判据走偏。
 *
 * 预设不在会话头里，在**会话投影**里：
 *   SessionSummary.projections.values.agentPreset
 * DSH 自己也是这么读的（`observation.projections.values.agentPreset`），所以不必逐个
 * 会话 inspect()——那是要读日志的，费。
 *
 * 但这个字段是可选的（老宿主可能整份清单都不带 projections）。那种时候**不能**按它
 * 过滤：清单会被筛成一片空白，面板的对话页直接废掉。所以拿不到投影就退回「不过滤」，
 * 由 hasPresetChannel() 说清楚这次到底筛没筛。
 *
 * 还有一处例外：面板自己按「新建」开出来的那个会话。投影是异步落下来的，create()
 * 回来的那一瞬间它在清单里可能还没有 preset 那一行——严格筛会把它自己筛掉，学生点了
 * 新建还是一片空白。所以这些 id 先记一笔（rememberFresh），等投影补上就自然走预设那条路。
 */
import { PRESET_ID } from './preset.js'

/** 会话清单里能进面板的那些：不是子会话。 */
function visible(item) {
  return Boolean(item && item.sessionId) && !item.parentSessionId && item.origin !== 'subagent'
}

/**
 * 取一条会话摘要的预设 id。取不到回空串（没投影、没这个字段、或者宿主写了 null）。
 * @param {any} item SessionSummary
 * @returns {string}
 */
export function presetOf(item) {
  const hints = item && item.projections
  const values = hints && hints.values
  if (!values || typeof values !== 'object') return ''
  const value = values.agentPreset
  return typeof value === 'string' ? value : ''
}

/**
 * 这份清单到底发不发会话投影。发才敢按预设筛。
 * @param {any[]} items
 * @returns {boolean}
 */
export function hasPresetChannel(items) {
  return (Array.isArray(items) ? items : []).some((item) => {
    const values = item && item.projections && item.projections.values
    return Boolean(values && typeof values === 'object')
  })
}

/**
 * 面板自己刚按「新建」开出来的会话 id。
 *
 * 只活在进程里：这是一份「别急着筛我」的临时凭证，不是数据。会话投影落地之后
 * presetOf() 自己就认它了，这里留着一份也无妨（id 本来就唯一，留着只是多占几个字节）。
 */
const freshSessions = new Set()

/**
 * 记住一个面板刚建出来的学习会话。
 * @param {unknown} sessionId
 * @returns {string} 记下的 id（给不出来的话回空串，调用方当失败处理）
 */
export function rememberFresh(sessionId) {
  const id = String(sessionId ?? '')
  if (id) freshSessions.add(id)
  return id
}

/**
 * 这个会话是不是面板自己刚开的（投影还没跟上）。
 * @param {unknown} sessionId
 * @returns {boolean}
 */
export function isFresh(sessionId) {
  return freshSessions.has(String(sessionId ?? ''))
}

/**
 * 面板按「新建学习教练会话」时要跟宿主说的那句话。
 * 预设号只在这个文件里出现，别在别处再写一遍 'study-coach'。
 * @returns {{ agentPreset: string }}
 */
export function newSessionRequest() {
  return { agentPreset: PRESET_ID }
}

/**
 * 可见会话里挑出学习模式的那些。
 * @param {any[]} items
 * @returns {{ items: any[], filtered: boolean }} filtered 为 false 表示这台宿主不发投影、
 *   这次是原样放行（不是「筛完正好一个都没有」）。
 */
export function learningSessions(items) {
  const rows = (Array.isArray(items) ? items : []).filter(visible)
  if (!hasPresetChannel(rows)) return { items: rows, filtered: false }
  return { items: rows.filter((item) => presetOf(item) === PRESET_ID || isFresh(item.sessionId)), filtered: true }
}
