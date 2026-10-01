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
 * 可见会话里挑出学习模式的那些。
 * @param {any[]} items
 * @returns {{ items: any[], filtered: boolean }} filtered 为 false 表示这台宿主不发投影、
 *   这次是原样放行（不是「筛完正好一个都没有」）。
 */
export function learningSessions(items) {
  const rows = (Array.isArray(items) ? items : []).filter(visible)
  if (!hasPresetChannel(rows)) return { items: rows, filtered: false }
  return { items: rows.filter((item) => presetOf(item) === PRESET_ID), filtered: true }
}
