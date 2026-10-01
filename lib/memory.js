/**
 * 记忆卡：要背的东西一张一张摊开，按艾宾浩斯那条间隔阶梯排什么时候再看一遍。
 *
 * 这一层跟 `toolbox.js` 一样是**纯函数**，不碰磁盘也不碰 HTTP，所以能脱开插件单测。
 * 数据形状在 `schema.js` 的 `emptyMemory()` 里。
 *
 * 两条关键决定：
 *
 * 1. **`dueAt` 存绝对时刻，不存「还剩几分钟」。** 跟番茄钟一个道理：页面刷新、
 *    关掉面板、DSH 重启都不影响，回来一看该背哪张就是哪张。面板上那句「还有 8
 *    分钟」是拿 `dueAt - Date.now()` 现算的显示，不是真相。
 *
 * 2. **跟 `mastery` 是两套账。** `mastery` 记「这个知识点会不会做题」，这里记
 *    「这条公式背没背下来」。一张卡可以挂在某个单元上（`pointId`），但背下来不
 *    等于会做题——所以这里的复习**不能当掌握度证据**，反过来也一样。
 */

import { CARD_STEPS, CARD_KINDS, CARD_GRADES } from './store.js'

/** 一张卡最多留这么多条复习记录，免得文件越滚越大。 */
const REVIEW_MAX = 30

/** 一次最多列这么多张。 */
const LIST_MAX = 500

/** 正面 / 背面各截到这里为止——这是背的东西，不是笔记。 */
const SIDE_MAX = 200

/** 一分钟，用来把「马上」写成一个具体的时刻。 */
const MINUTE = 60 * 1000

let cardSeq = 0

function newCardId() {
  return 'c-' + Date.now().toString(36) + '-' + ++cardSeq
}

function nowIso(now) {
  return new Date(now).toISOString()
}

/** 严格版：给人用的入口要报错，不能悄悄夹住。 */
function requireText(value, what) {
  const text = String(value ?? '').trim()
  if (!text) throw new Error(`卡片${what}要写点东西`)
  if (text.length > SIDE_MAX) throw new Error(`卡片${what}超过 ${SIDE_MAX} 字了，这是要背的东西，不是笔记`)
  return text
}

function pickKind(value) {
  if (value === undefined || value === null || value === '') return '其他'
  const kind = String(value).trim()
  if (!CARD_KINDS.includes(kind)) {
    throw new Error(`卡片类型只能是 ${CARD_KINDS.join(' / ')}，收到「${value}」`)
  }
  return kind
}

function pickGrade(value) {
  const grade = String(value ?? '').trim()
  if (!CARD_GRADES.includes(grade)) {
    throw new Error(`自评只能是 ${CARD_GRADES.join(' / ')}，收到「${value}」`)
  }
  return grade
}

/**
 * 排期：给定「走到第几级」，算出下次什么时候再看。
 *
 * `step` 是**已经走完的级数**：新卡是 0（马上看第一遍），走完 `CARD_STEPS` 那么
 * 多级就毕业。四档自评只改这一步往哪儿走：
 *
 * - `忘了`  → 打回第 0 级，10 分钟后再来，记一次 lapse；
 * - `模糊`  → 退一级（1 天退成 9 小时），不记 lapse；
 * - `记住`  → 进一级；
 * - `秒答`  → 进两级，连着三次就毕业。
 */
export function scheduleFor(step, grade) {
  const last = CARD_STEPS.length - 1
  const at = Math.max(0, Math.min(last, Number(step) || 0))
  if (grade === '忘了') return { step: 0, minutes: CARD_STEPS[0], lapsed: true }
  if (grade === '模糊') return { step: Math.max(0, at - 1), minutes: CARD_STEPS[Math.max(0, at - 1)], lapsed: false }
  const next = grade === '秒答' ? at + 2 : at + 1
  if (next > last) return { step: next, minutes: null, lapsed: false }
  return { step: next, minutes: CARD_STEPS[next], lapsed: false }
}

/**
 * 收一份原始输入，产出落盘形状。
 *
 * `previous` 给了就是「改一张已有的卡」：没传的字段留上一次的，`id` / `at` 不动。
 */
export function normalizeCard(raw, previous = null, id = '') {
  if (!raw || typeof raw !== 'object') throw new Error('card 要是一个对象')
  const keep = (value, fallback) => (value === undefined || value === null ? fallback : value)
  const at = (previous && previous.at) || nowIso(Date.now())
  const front = requireText(keep(raw.front, previous ? previous.front : ''), '正面')
  const back = requireText(keep(raw.back, previous ? previous.back : ''), '背面')
  const kind = raw.kind === undefined || raw.kind === null || raw.kind === ''
    ? (previous ? previous.kind : '其他')
    : pickKind(raw.kind)
  const step = previous ? previous.step : 0
  return {
    id: id || (previous && previous.id) || newCardId(),
    front,
    back,
    kind,
    /* 挂到知识地图的哪个单元；挂不挂都不影响排期，只是列表里能对着看 */
    pointId: String(keep(raw.pointId, previous ? previous.pointId : '') || '').trim(),
    note: String(keep(raw.note, previous ? previous.note : '') || '').trim(),
    /* 走到第几级了 */
    step,
    /* 下次什么时候看，ISO；毕业了就是 null */
    dueAt: previous ? previous.dueAt : nowIso(Date.now()),
    graduatedAt: previous ? previous.graduatedAt : null,
    lapses: previous ? previous.lapses : 0,
    /* 连着「秒答」几次，连着三次就直接毕业 */
    streak: previous ? previous.streak : 0,
    reviews: previous ? previous.reviews : [],
    at,
    updatedAt: nowIso(Date.now()),
  }
}

/**
 * 一张卡现在的处境。
 *
 * - `due`     该看了（没毕业且到点了）
 * - `waiting` 还没到点
 * - `graduated` 毕业了，不再排期
 */
export function cardState(card, now = new Date()) {
  if (card.graduatedAt) return 'graduated'
  const due = Date.parse(card.dueAt || '')
  if (!Number.isFinite(due)) return 'due'
  return now.getTime() >= due ? 'due' : 'waiting'
}

/** 到期还剩多久（毫秒）。已经到点或没排期就是 ≤ 0。 */
export function cardLeft(card, now = new Date()) {
  const due = Date.parse(card.dueAt || '')
  if (!Number.isFinite(due)) return 0
  return Math.max(0, due - now.getTime())
}

/** 「还有 8 分钟 / 还有 3 小时 / 明天」这种人话。 */
export function leftText(ms) {
  if (ms <= 0) return '现在'
  const minutes = Math.round(ms / MINUTE)
  if (minutes < 1) return '马上'
  if (minutes < 60) return `还有 ${minutes} 分钟`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `还有 ${hours} 小时`
  const days = Math.round(hours / 24)
  if (days < 31) return `还有 ${days} 天`
  return `还有 ${Math.round(days / 30)} 个月`
}

/** 挑出要看的那些，新的在前。`status` 认 `due` / `waiting` / `graduated`，空就是全部。 */
export function listCards(memory, options = {}) {
  const { status = '', kind = '', pointId = '', limit = LIST_MAX } = options
  const now = options.now instanceof Date ? options.now : new Date()
  const all = (memory && memory.cards) || []
  const byStatus = { due: 0, waiting: 0, graduated: 0 }
  const rows = []
  for (const card of all) {
    const st = cardState(card, now)
    byStatus[st] = (byStatus[st] || 0) + 1
    if (status && st !== status) continue
    if (kind && card.kind !== kind) continue
    if (pointId && card.pointId !== pointId) continue
    rows.push({ ...card, state: st, left: cardLeft(card, now), leftText: leftText(cardLeft(card, now)) })
  }
  // 到期的先来，然后按「原定什么时候该看」排；同点的按建卡时间倒序（新的在前）。
  rows.sort((a, b) => {
    if (a.state !== b.state) {
      const rank = { due: 0, waiting: 1, graduated: 2 }
      return rank[a.state] - rank[b.state]
    }
    const da = Date.parse(a.dueAt || '') || 0
    const db = Date.parse(b.dueAt || '') || 0
    if (da !== db) return da - db
    return String(b.at).localeCompare(String(a.at))
  })
  return {
    items: rows.slice(0, Math.max(1, limit)),
    total: rows.length,
    due: byStatus.due,
    waiting: byStatus.waiting,
    graduated: byStatus.graduated,
  }
}

/** 按类型 / 挂靠单元分一分，给面板画个概览。 */
export function cardStats(memory, now = new Date()) {
  const all = (memory && memory.cards) || []
  const byKind = {}
  for (const kind of CARD_KINDS) byKind[kind] = 0
  let due = 0
  let graduated = 0
  for (const card of all) {
    const st = cardState(card, now)
    if (st === 'due') due += 1
    if (st === 'graduated') graduated += 1
    byKind[card.kind] = (byKind[card.kind] || 0) + 1
  }
  return { total: all.length, due, graduated, learning: all.length - graduated, byKind }
}

/** 加一张。新卡立刻到期——刚写下来的东西就是该马上看一遍的。 */
export function addCard(memory, raw, now = new Date()) {
  const card = normalizeCard(raw, null, '')
  card.at = nowIso(now)
  card.updatedAt = card.at
  card.dueAt = card.at
  memory.cards = memory.cards || []
  memory.cards.push(card)
  return card
}

/** 找一张卡，找不到给 null。 */
export function findCard(memory, id) {
  const want = String(id || '')
  if (!want) return null
  return ((memory && memory.cards) || []).find((card) => card.id === want) || null
}

/**
 * 复习完一张，推进它的排期。
 *
 * 连着三次「秒答」直接毕业——真背下来的人不用再被这张卡烦。
 */
export function reviewCard(memory, id, grade, now = new Date()) {
  const card = findCard(memory, id)
  if (!card) throw new Error(`没有这张卡：${id || '（空）'}`)
  const what = pickGrade(grade)
  const plan = scheduleFor(card.step, what)
  const at = nowIso(now)
  card.step = plan.step
  card.streak = what === '秒答' ? (card.streak || 0) + 1 : 0
  if (plan.lapsed) card.lapses = (card.lapses || 0) + 1
  const graduate = plan.minutes === null || card.streak >= 3
  if (graduate) {
    card.graduatedAt = at
    card.dueAt = null
  } else {
    card.graduatedAt = null
    card.dueAt = new Date(Date.parse(at) + plan.minutes * MINUTE).toISOString()
  }
  card.reviews = (card.reviews || []).concat([{
    at,
    grade: what,
    step: card.step,
    dueAt: card.dueAt,
  }]).slice(-REVIEW_MAX)
  card.updatedAt = at
  return card
}

/** 改一张卡的正面 / 背面 / 类型 / 挂靠 / 备注。排期不动。 */
export function patchCard(memory, id, patch = {}) {
  const card = findCard(memory, id)
  if (!card) throw new Error(`没有这张卡：${id || '（空）'}`)
  const next = normalizeCard(patch || {}, card, card.id)
  // normalizeCard 管的是「内容」，排期那几项是复习出来的，改内容不能把它们冲掉。
  next.step = card.step
  next.dueAt = card.dueAt
  next.graduatedAt = card.graduatedAt
  next.lapses = card.lapses
  next.streak = card.streak
  next.reviews = card.reviews
  next.at = card.at
  Object.assign(card, next)
  return card
}

/** 删一张。 */
export function removeCard(memory, id) {
  const card = findCard(memory, id)
  if (!card) throw new Error(`没有这张卡：${id || '（空）'}`)
  memory.cards = (memory.cards || []).filter((row) => row.id !== card.id)
  return card
}

/**
 * 把一批卡按「今天该背多少」摊给面板看。
 *
 * `soon` 是接下来 24 小时内的（用来告诉学生「背完这些，晚上还有 3 张」）。
 */
export function memoryBody(memory, now = new Date()) {
  const stats = cardStats(memory, now)
  const dueList = listCards(memory, { status: 'due', limit: 200, now })
  const horizon = now.getTime() + 24 * 60 * MINUTE
  const soon = ((memory && memory.cards) || []).filter((card) => {
    if (cardState(card, now) !== 'waiting') return false
    const due = Date.parse(card.dueAt || '')
    return Number.isFinite(due) && due <= horizon
  }).length
  return { stats, soon, dueItems: dueList.items, dueTotal: dueList.total }
}
