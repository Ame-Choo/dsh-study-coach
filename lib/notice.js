/**
 * dsh-study-coach — 指引与留言（对话 ↔ 面板之间那根线）。
 *
 * 教练在对话里写一句话，面板顶上大字显示；学生在面板上留一句话，对话这边来读。
 * 两个方向各一小撮函数，单独成文件是因为它是界面之间的通道，
 * 不属于地图也不属于分析 —— 谁想动这条线，只看这一个文件。
 */
import { nowIso } from './store.js'

/* ── 指引与留言（对话 ↔ 面板之间那根线） ─────────────────────────────────── */

/** 教练写一句指引，面板顶上大字显示。旧的直接覆盖。 */
export function setGuide(guide, text, kind) {
  guide.text = String(text ?? '')
  guide.kind = String(kind ?? '')
  guide.at = nowIso()
  return guide
}

/** 学生在面板上留一句话。 */
export function addInboxItem(inbox, text) {
  const clean = String(text ?? '').trim()
  if (!clean) throw new Error('text required')
  if (!Array.isArray(inbox.items)) inbox.items = []
  const item = { id: 'msg-' + Date.now().toString(36), text: clean, at: nowIso(), read: false }
  inbox.items.push(item)
  return item
}

/** 还没被对话读过的留言。 */
export function unreadInbox(inbox) {
  const items = inbox && Array.isArray(inbox.items) ? inbox.items : []
  return items.filter((i) => i && !i.read)
}

/** 读过了就标掉，省得每次对话都重复念。 */
export function markInboxRead(inbox, ids) {
  const want = Array.isArray(ids) && ids.length ? ids : null
  for (const item of inbox.items ?? []) {
    if (!want || want.includes(item.id)) item.read = true
  }
  return inbox
}
