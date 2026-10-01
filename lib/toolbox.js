/**
 * 工具栏目：番茄钟 + 清单。
 *
 * 这一层是纯函数，不碰磁盘也不碰 HTTP，所以能脱开插件单测。
 * 数据形状在 schema.js 的 `emptyToolbox()` 里。
 *
 * 番茄钟的关键决定：**只存「这一轮什么时候结束」，不存「还剩多少」**。
 * 页面刷新、关掉面板、DSH 重启都不影响；读写的时候顺手结算（`settleFocus`）。
 * 好处是没有一个需要一直活着的定时器——面板上那个每秒走动的数字只是
 * 拿 `endsAt - Date.now()` 现算的显示。
 */

import { FOCUS_MIN, FOCUS_MAX } from './store.js'

const LOG_MAX = 200

/** 面板和工具都按这个时区口径算「今天」。日期只到天，跟别处一套。 */
export function dateOf(at = new Date()) {
  return new Date(at).toISOString().slice(0, 10)
}

function clampMinutes(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(FOCUS_MAX, Math.max(FOCUS_MIN, Math.round(n)))
}

/** 严格版：给人用的入口要报错，不能悄悄夹住。 */
function requireMinutes(value, what) {
  const n = Number(value)
  if (!Number.isFinite(n) || Math.round(n) !== n || n < FOCUS_MIN || n > FOCUS_MAX) {
    throw new Error(`${what}只能是 ${FOCUS_MIN}—${FOCUS_MAX} 分钟的整数，收到「${value}」`)
  }
  return n
}

/** 今天换天了就把当日计数清零。 */
function rollDay(focus, now) {
  const day = dateOf(now)
  if (focus.today !== day) {
    focus.today = day
    focus.todayMinutes = 0
    focus.todayRounds = 0
  }
  return focus
}

/**
 * 结算：该走完的轮次走完。
 *
 * 刻意**不自动接着下一轮**——学生走了半小时回来，不该看到「你已经背了 3 个番茄、
 * 正在第 4 个」。走到点就停下，剩下按不按「继续」是他自己的事。
 */
export function settleFocus(focus, now = new Date()) {
  if (!focus || typeof focus !== 'object') return focus
  rollDay(focus, now)
  if (!focus.running || !focus.endsAt) return focus
  const endsAt = Date.parse(focus.endsAt)
  if (!Number.isFinite(endsAt) || now.getTime() < endsAt) return focus

  const kind = focus.phase === 'break' ? 'break' : 'work'
  const minutes = kind === 'break' ? clampMinutes(focus.breakMinutes, 5) : clampMinutes(focus.workMinutes, 25)
  pushLog(focus, { at: focus.endsAt, kind, minutes, taskId: focus.taskId || '', label: focus.label || '' })
  if (kind === 'work') {
    focus.todayMinutes = (focus.todayMinutes || 0) + minutes
    focus.todayRounds = (focus.todayRounds || 0) + 1
  }
  focus.running = false
  focus.endsAt = null
  focus.startedAt = null
  focus.phase = kind === 'work' ? 'break' : 'work'
  // 背够一轮了就提示长休息：真长休息由学生自己按，别替他决定。
  if (kind === 'work') {
    const per = Number(focus.roundsPerLong) || 4
    focus.longBreakDue = focus.todayRounds % per === 0
  }
  return focus
}

function pushLog(focus, row) {
  if (!Array.isArray(focus.log)) focus.log = []
  focus.log.push(row)
  if (focus.log.length > LOG_MAX) focus.log = focus.log.slice(-LOG_MAX)
}

/** 面板和工具读的就是这一份。 */
export function focusStatus(focus, now = new Date()) {
  const f = focus && typeof focus === 'object' ? focus : {}
  rollDay(f, now)
  const running = Boolean(f.running && f.endsAt)
  const endsAt = running ? Date.parse(f.endsAt) : NaN
  const leftMs = running && Number.isFinite(endsAt) ? Math.max(0, endsAt - now.getTime()) : 0
  const work = clampMinutes(f.workMinutes, 25)
  const brk = clampMinutes(f.breakMinutes, 5)
  const thisRound = f.phase === 'break' ? brk : work
  return {
    running,
    /* 现在该干什么：没在跑的时候，phase 是「下一轮该干什么」 */
    phase: f.phase === 'break' ? 'break' : 'work',
    phaseLabel: f.phase === 'break' ? '休息' : '专注',
    taskId: String(f.taskId || ''),
    label: String(f.label || ''),
    endsAt: running ? f.endsAt : '',
    left: running ? Math.ceil(leftMs / 1000) : 0,
    /* 这一轮一共多少分钟，用来画进度条 */
    roundMinutes: thisRound,
    workMinutes: work,
    breakMinutes: brk,
    longBreakMinutes: clampMinutes(f.longBreakMinutes, 15),
    roundsPerLong: Number(f.roundsPerLong) || 4,
    longBreakDue: Boolean(f.longBreakDue),
    today: String(f.today || ''),
    todayMinutes: Number(f.todayMinutes) || 0,
    todayRounds: Number(f.todayRounds) || 0,
    log: Array.isArray(f.log) ? f.log.slice(-20) : [],
  }
}

/** 起一轮。已经在跑就报错——番茄钟不能同时跑两个，那是自欺欺人。 */
export function startFocus(focus, options = {}, now = new Date()) {
  settleFocus(focus, now)
  if (focus.running) {
    const left = Math.ceil((Date.parse(focus.endsAt) - now.getTime()) / 60000)
    throw new Error(`番茄钟还在跑（还剩 ${left} 分钟）。先停掉，或者等它走完`)
  }
  const kind = options.kind === 'break' ? 'break' : 'work'
  if (kind === 'work') {
    if (options.minutes !== undefined && options.minutes !== null && options.minutes !== '') {
      focus.workMinutes = requireMinutes(options.minutes, '专注时长')
    }
  } else if (options.minutes !== undefined && options.minutes !== null && options.minutes !== '') {
    focus.breakMinutes = requireMinutes(options.minutes, '休息时长')
  }
  // 休息多久跟这一轮专注多久是两码事：面板上两格一起填，所以一起存下来。
  if (options.breakMinutes !== undefined && options.breakMinutes !== null && options.breakMinutes !== '') {
    focus.breakMinutes = requireMinutes(options.breakMinutes, '休息时长')
  }
  const minutes = kind === 'break' ? clampMinutes(focus.breakMinutes, 5) : clampMinutes(focus.workMinutes, 25)
  focus.phase = kind
  focus.running = true
  focus.startedAt = now.toISOString()
  focus.endsAt = new Date(now.getTime() + minutes * 60000).toISOString()
  focus.taskId = String(options.taskId || '')
  focus.label = String(options.label || '').trim().slice(0, 80)
  focus.longBreakDue = false
  return focusStatus(focus, now)
}

/**
 * 手动停下。走完的算一轮（记满分钟数），中途停下的按实际坐了几分钟记下来，
 * **不算一个番茄**——不然「开了就算完成」就成了刷数据的口子。
 */
export function stopFocus(focus, options = {}, now = new Date()) {
  settleFocus(focus, now)
  if (!focus.running) throw new Error('番茄钟没在跑')
  const kind = focus.phase === 'break' ? 'break' : 'work'
  const startedAt = Date.parse(focus.startedAt)
  const spent = Number.isFinite(startedAt) ? Math.max(0, Math.round((now.getTime() - startedAt) / 60000)) : 0
  if (kind === 'work' && spent >= 1) {
    pushLog(focus, { at: now.toISOString(), kind, minutes: spent, taskId: focus.taskId || '', label: focus.label || '', partial: true })
    focus.todayMinutes = (focus.todayMinutes || 0) + spent
  }
  focus.running = false
  focus.endsAt = null
  focus.startedAt = null
  focus.phase = kind === 'work' ? 'break' : 'work'
  focus.longBreakDue = false
  return focusStatus(focus, now)
}

/* ── 清单 ── */

let todoSeq = 0

function newTodoId() {
  return 'td-' + Date.now().toString(36) + '-' + (++todoSeq)
}

const TODO_MAX = 120

/**
 * 一条清单。规矩写在代码里：
 * - 没文字不行（「」这种条目以后翻出来没有任何信息）
 * - 勾完成的时候顺手记 doneAt，取消勾选就抹掉
 */
export function normalizeTodo(raw, previous = null, id = '') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('清单条目要是一个对象')
  const keep = (value, fallback) => (value === undefined ? fallback : value)
  const text = String(keep(raw.text, previous ? previous.text : '') ?? '').trim()
  if (!text) throw new Error('清单条目要写一句话，比如「背 20 个单词」')
  if (text.length > TODO_MAX) throw new Error(`清单条目最多 ${TODO_MAX} 个字，收到 ${text.length} 个`)
  const done = Boolean(keep(raw.done, previous ? previous.done : false))
  const at = (previous && previous.at) || nowIso()
  const next = {
    id: id || (previous && previous.id) || newTodoId(),
    text,
    done,
    at,
    doneAt: done ? (previous && previous.doneAt) || nowIso() : null,
    due: String(keep(raw.due, previous ? previous.due : '') ?? '').trim(),
    pointId: String(keep(raw.pointId, previous ? previous.pointId : '') ?? '').trim(),
    /* 挂在这条上的番茄钟累计了多少分钟 */
    spent: Number(keep(raw.spent, previous ? previous.spent : 0)) || 0,
    updatedAt: nowIso(),
  }
  if (next.due && !/^\d{4}-\d{2}-\d{2}$/.test(next.due)) {
    throw new Error(`due 要写成 YYYY-MM-DD，收到「${next.due}」`)
  }
  return next
}

function nowIso() {
  return new Date().toISOString()
}

export function listTodos(toolbox, options = {}) {
  const items = Array.isArray(toolbox && toolbox.todos && toolbox.todos.items) ? toolbox.todos.items : []
  let rows = items.slice()
  if (options.status === 'done') rows = rows.filter((t) => t.done)
  else if (options.status === 'open') rows = rows.filter((t) => !t.done)
  else if (options.status === 'today') {
    const day = dateOf()
    rows = rows.filter((t) => !t.done && (!t.due || t.due <= day))
  }
  // 没做完的在前，然后按创建时间倒序——新加的更可能在手边
  rows.sort((a, b) => (a.done === b.done ? String(b.at || '').localeCompare(String(a.at || '')) : a.done ? 1 : -1))
  const open = items.filter((t) => !t.done).length
  return { items: rows.slice(0, Number(options.limit) || 200), total: items.length, open, done: items.length - open }
}

export function addTodo(toolbox, raw) {
  const item = normalizeTodo(raw)
  if (!toolbox.todos || typeof toolbox.todos !== 'object') toolbox.todos = { items: [] }
  if (!Array.isArray(toolbox.todos.items)) toolbox.todos.items = []
  toolbox.todos.items.push(item)
  toolbox.todos.updatedAt = nowIso()
  return item
}

export function patchTodo(toolbox, id, patch) {
  const items = (toolbox.todos && toolbox.todos.items) || []
  const hit = items.find((t) => t.id === id)
  if (!hit) throw new Error(`没有这条清单：${id}`)
  const next = normalizeTodo(patch || {}, hit, hit.id)
  Object.assign(hit, next)
  toolbox.todos.updatedAt = nowIso()
  return hit
}

export function removeTodo(toolbox, id) {
  const box = toolbox.todos || (toolbox.todos = { items: [] })
  if (!Array.isArray(box.items)) box.items = []
  const before = box.items.length
  box.items = box.items.filter((t) => t.id !== id)
  if (box.items.length === before) throw new Error(`没有这条清单：${id}`)
  box.updatedAt = nowIso()
  return true
}
