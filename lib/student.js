/**
 * 关于这个学生的判断（L2）——纯函数，不碰磁盘也不碰 HTTP，跟 lib/toolbox.js、
 * lib/memory.js 一个路数。
 *
 * ## 这一层是干什么的
 *
 * 掌握度（mastery）里一条条 evidence 是**流水**：「十月一日，M1.4，隔了三天重做
 * 同类题独立做对」。流水只会越积越多，它回答不了「这孩子到底怎么回事」——那个
 * 问题每次都要现读现总结，所以每次开场都得重来一遍。
 *
 * 这一层存的是**结论**：「他换元之后容易忘记回代」。一条结论必须挂着几条流水才
 * 成立，所以它是能查、能推翻、能改的，不是模型的一句印象。
 *
 * ## 三条规矩（写在代码里，不写在提示词里）
 *
 * 1. **没证据不许落盘**。这是这一层跟「随口评价」唯一的区别。挂的证据还得真在
 *    mastery 里存在——单元写错一个字母、或者那条证据后来没了，都当场拒掉。
 * 2. **证据指向具体哪一次**，不只是哪个单元。单元是「在哪儿」，证据 id 是「哪一次」。
 *    老数据没有 id，`evidenceKey()` 会按「单元 + 时刻」推一个稳定的出来。
 * 3. **一句判断不许写成一段分析**。超过 120 字就不是判断了，那是复盘。
 *
 * 判断不会过期，但它引的那一次可能被删、单元 id 可能随地图重画而变。
 * `auditFacts()` 专门把这种「引的证据找不到了」挑出来，让面板上能看见、能修。
 */

import { FACT_KINDS } from './store.js'

const TEXT_MAX = 120
const LIST_MAX = 200
const SIDE_MAX = 40

function nowIso() {
  return new Date().toISOString()
}

let factSeq = 0

function newFactId() {
  factSeq += 1
  return 'f-' + Date.now().toString(36) + '-' + factSeq
}

function requireText(value) {
  const text = String(value ?? '').trim()
  if (!text) throw new Error('判断要写一句话，比如「换元之后容易忘记回代」')
  if (text.length > TEXT_MAX) {
    throw new Error(`判断超过 ${TEXT_MAX} 字了——这是一句结论，不是一段分析。长的写进 note 或者复盘里`)
  }
  return text
}

function pickKind(value) {
  const kind = String(value ?? '').trim()
  if (!kind) return '习惯'
  if (!FACT_KINDS.includes(kind)) {
    throw new Error(`判断的类别只能是 ${FACT_KINDS.join(' / ')}，收到「${kind}」`)
  }
  return kind
}

/* ── 证据那头：怎么指、怎么兑 ───────────────────────────────────────────── */

/**
 * 一条证据的稳定 key。
 *
 * 新证据有自己的 `id`，直接用。老证据是匿名的，就按「单元 + 时刻」推一个；
 * 同一毫秒同一单元撞了才补个序号——补的时候也必须两边用同一套算法，
 * 不然今天写的引用明天就兑不上了。
 */
export function evidenceKey(pointId, item, index = 0) {
  if (item && item.id) return String(item.id)
  const at = String((item && item.at) || '')
  return index > 0 ? `${pointId}@${at}#${index}` : `${pointId}@${at}`
}

/** 某个单元下所有证据，每条带上能引用的 key。 */
export function evidenceList(mastery, pointId) {
  const state = mastery && mastery.points ? mastery.points[String(pointId)] : null
  const rows = state && Array.isArray(state.evidence) ? state.evidence : []
  return rows
    .map((item, index) => ({
      key: evidenceKey(String(pointId), item, index),
      kind: String((item && item.kind) || 'self'),
      at: String((item && item.at) || ''),
      note: String((item && item.note) || ''),
      mistake: (item && item.mistake) || null,
    }))
    .filter((row) => row.at || row.note)
}

/** 所有单元下的证据摊平，给「这条 id 到底存不存在」兜底用。 */
export function allEvidence(mastery) {
  const out = []
  const points = (mastery && mastery.points) || {}
  for (const pointId of Object.keys(points)) {
    for (const row of evidenceList(mastery, pointId)) out.push({ ...row, pointId })
  }
  return out
}

/** 地图里的单元 id → 标题，用来校验引用、渲染标题。 */
function pointIndex(map) {
  const titles = new Map()
  const modules = map && Array.isArray(map.modules) ? map.modules : []
  for (const m of modules) {
    for (const p of Array.isArray(m && m.points) ? m.points : []) {
      if (p && p.id) titles.set(String(p.id), String(p.title || ''))
    }
  }
  return titles
}

/**
 * 把给进来的一串引用规范化 + 验真。
 *
 * 每条可以写成 `'e-xxx'`（只给 id，全库找）或者 `{ pointId, key }`。给 id 更省事，
 * 找不到或者撞上多条就报错——宁可让他重新看一眼，也不要静默挂个空引用。
 */
function normalizeEvidence(raw, ctx) {
  const { mastery, map } = ctx
  const titles = pointIndex(map)
  const list = Array.isArray(raw) ? raw : raw ? [raw] : []
  if (!list.length) {
    throw new Error('每条判断至少要挂一条证据：哪一次、哪个单元让你这么判断的。不挂证据的就不是判断，是印象')
  }
  if (list.length > SIDE_MAX) throw new Error(`一条判断最多挂 ${SIDE_MAX} 条证据`)

  const out = []
  for (const one of list) {
    const wanted = typeof one === 'string' ? { pointId: '', key: one } : one && typeof one === 'object' ? one : {}
    const key = String(wanted.key ?? wanted.evidenceId ?? wanted.id ?? '').trim()
    let pointId = String(wanted.pointId ?? wanted.point ?? '').trim()
    if (!key) throw new Error('证据要写 id：`evidence: ["e-xxx"]`，id 从 study_archive 里拿')
    if (!pointId) {
      const hits = allEvidence(mastery).filter((row) => row.key === key)
      if (!hits.length) throw new Error(`没有任何一条证据的 id 是「${key}」。别编 id，去 study_archive 里看真有哪些`)
      if (hits.length > 1) throw new Error(`「${key}」对上了不止一条证据，把 pointId 一起写上`)
      pointId = hits[0].pointId
    }
    if (titles.size && !titles.has(pointId)) throw new Error(`地图里没有这个单元：${pointId}`)
    const hit = evidenceList(mastery, pointId).find((row) => row.key === key)
    if (!hit) {
      throw new Error(`${pointId} 上没有 id 是「${key}」的证据。先去 study_archive 看一眼那一节到底记了什么`)
    }
    if (!out.some((row) => row.pointId === pointId && row.key === key)) out.push({ pointId, key })
  }
  return out
}

/* ── 判断本体 ───────────────────────────────────────────────────────────── */

/**
 * 一条判断的规范化 + 自校验。
 *
 * `text` / `kind` / `evidence` 没传就留上一次的：改证据不该把话冲掉，改措辞
 * 也不该把挂的证据冲掉。
 */
export function normalizeFact(raw, previous = null, id = '', ctx = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('fact 要是一个对象')
  const prev = previous && typeof previous === 'object' ? previous : {}
  const prevEvidence = Array.isArray(prev.evidence)
    ? prev.evidence.map((e) => ({ pointId: String(e?.pointId || ''), key: String(e?.key || '') }))
    : []
  const next = {
    id: String(id || prev.id || newFactId()),
    kind: raw.kind === undefined || String(raw.kind).trim() === '' ? pickKind(prev.kind) : pickKind(raw.kind),
    text: raw.text === undefined ? String(prev.text || '') : requireText(raw.text),
    evidence: raw.evidence === undefined ? prevEvidence : normalizeEvidence(raw.evidence, ctx),
    note: raw.note === undefined ? String(prev.note || '') : String(raw.note ?? '').trim(),
    at: String(prev.at || nowIso()),
    updatedAt: nowIso(),
  }
  if (!next.text) throw new Error('判断要写一句话，比如「换元之后容易忘记回代」')
  if (!next.evidence.length) {
    throw new Error('每条判断至少要挂一条证据：哪一次、哪个单元让你这么判断的。不挂证据的就不是判断，是印象')
  }
  return next
}

/** 找一条判断，找不到返回 null。 */
export function findFact(student, factId) {
  const want = String(factId ?? '')
  if (!want) return null
  const facts = student && Array.isArray(student.facts) ? student.facts : []
  return facts.find((f) => f && String(f.id) === want) || null
}

/** 按类别 / 单元筛一批判断出来。 */
export function listFacts(student, { kind = '', pointId = '', limit = LIST_MAX } = {}) {
  const facts = student && Array.isArray(student.facts) ? student.facts : []
  return facts
    .filter((f) => f && typeof f === 'object')
    .filter((f) => !kind || String(f.kind) === String(kind))
    .filter((f) => !pointId || (Array.isArray(f.evidence) ? f.evidence : []).some((e) => String(e?.pointId) === String(pointId)))
    .slice(0, Math.max(1, Number(limit) || LIST_MAX))
    .map((f) => ({
      ...f,
      evidence: Array.isArray(f.evidence)
        ? f.evidence.map((e) => ({ pointId: String(e?.pointId || ''), key: String(e?.key || '') }))
        : [],
    }))
}

export function addFact(student, raw, ctx) {
  if (!Array.isArray(student.facts)) student.facts = []
  const fact = normalizeFact(raw, null, '', ctx)
  student.facts.push(fact)
  return fact
}

export function patchFact(student, factId, patch, ctx) {
  const fact = findFact(student, factId)
  if (!fact) throw new Error('没有这条判断：' + String(factId))
  Object.assign(fact, normalizeFact(patch || {}, fact, fact.id, ctx))
  return fact
}

export function removeFact(student, factId) {
  const before = Array.isArray(student.facts) ? student.facts.length : 0
  student.facts = (student.facts || []).filter((f) => !f || String(f.id) !== String(factId))
  if (student.facts.length === before) throw new Error('没有这条判断：' + String(factId))
  return true
}

/**
 * 体检：把「引的证据已经找不到了」挑出来。
 *
 * 证据本身删不掉，但单元 id 会随地图重画而变——这就是最常见的失效方式。
 * 把这种判断显式列出来，让教练决定改引用还是删掉，
 * 别让一条对不上的判断在档案里躺一年。
 */
export function auditFacts(student, mastery, map) {
  const titles = pointIndex(map)
  const known = new Set(allEvidence(mastery).map((row) => row.key))
  const orphans = []
  for (const fact of student && Array.isArray(student.facts) ? student.facts : []) {
    if (!fact || typeof fact !== 'object') continue
    const bad = []
    for (const ref of Array.isArray(fact.evidence) ? fact.evidence : []) {
      const pointId = String(ref?.pointId || '')
      const key = String(ref?.key || '')
      if (titles.size && !titles.has(pointId)) bad.push({ pointId, key, why: '地图里没这个单元了' })
      else if (!known.has(key)) bad.push({ pointId, key, why: '这条证据找不到了' })
    }
    if (bad.length) {
      orphans.push({ id: String(fact.id), text: String(fact.text || ''), kind: String(fact.kind || ''), bad })
    }
  }
  orphans.sort((a, b) => a.id.localeCompare(b.id))
  return orphans
}

/**
 * 把一条判断引的证据兑成人话，面板和工具都用这一份。
 *
 * 兑不上的那一格不隐藏，直接标 `ok: false`——面板上看见红字才知道要修。
 */
export function renderFact(fact, map, mastery) {
  const titles = pointIndex(map)
  const known = new Map()
  for (const row of allEvidence(mastery)) known.set(row.key, row)
  return {
    id: String(fact?.id || ''),
    kind: String(fact?.kind || ''),
    text: String(fact?.text || ''),
    note: String(fact?.note || ''),
    at: String(fact?.at || ''),
    updatedAt: String(fact?.updatedAt || ''),
    evidence: (Array.isArray(fact?.evidence) ? fact.evidence : []).map((ref) => {
      const pointId = String(ref?.pointId || '')
      const key = String(ref?.key || '')
      const hit = known.get(key)
      return {
        pointId,
        key,
        pointTitle: titles.get(pointId) || '',
        ok: Boolean(hit),
        kind: hit ? hit.kind : '',
        at: hit ? hit.at : '',
        note: hit ? hit.note : '',
        mistake: hit ? hit.mistake : null,
      }
    }),
  }
}

/** 面板和工具要的整份：判断（证据已兑）+ 失效清单 + 按类别计数。 */
export function studentBody(student, map, mastery, options = {}) {
  const facts = listFacts(student, options).map((f) => renderFact(f, map, mastery))
  const byKind = {}
  for (const kind of FACT_KINDS) byKind[kind] = 0
  for (const f of listFacts(student, {})) byKind[f.kind] = (byKind[f.kind] || 0) + 1
  return {
    facts,
    total: facts.length,
    byKind,
    orphans: auditFacts(student, mastery, map),
  }
}
