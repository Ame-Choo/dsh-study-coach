/**
 * dsh-study-coach — 地图、掌握度、错题、每级掌握档案、总体能力、任务视图。
 *
 * 这些是一路的：知识点挂在地图的三层结构上，每次做题往 mastery 里记一条证据，
 * 证据上再挂错题；面板上的百分比、掌握档案、能力卡、任务上的跳转按钮，
 * 全都是把这几份数据重新算一遍。放在一个文件里是因为它们共用同一套
 * 「点 → 模块 → 大类」的认人方式（pointState / briefOf / idsOf），拆开就得来回传。
 *
 * 纯函数，不碰磁盘也不碰 HTTP；页级索引那一截在 analysis.js 里。
 */
import { STAGES, STAGE_NEEDS, WORK_KINDS, MISTAKE_STATUS, nowIso } from './schema.js'
import { openPath } from './urls.js'
import { beijingDate } from './clock.js'

/* ── 升档那道门 ──────────────────────────────────────────────────────────── */

/**
 * 算一次「这次能不能升到 wanted」。**这道门只有这一份实现**：
 * 教练调 `study_record` 和学生自己在面板上点那颗档位按钮，走的是同一条规则。
 *
 * 学生那条路以前是直通的——他点一下「能讲明白」，档位就真成了能讲明白，
 * 门只管得住教练。档位是同一份账，门就得分不出两条路。
 *
 * 两条规矩：①一次只前进一档（填跳了压回上一档）；②推到 `STAGE_NEEDS` 里那几档
 * 之前，这个单元下得有真做过的证据（`WORK_KINDS`），自评、上课、复习都不算。
 *
 * 回 `{ stage, before, clamped, blocked, need, made }`：`stage` 是允许落到的档，
 * `blocked` 为真时调用方**别写 stage**——落一条证据、档位不动，把 `need`/`made` 告诉他。
 */
export function gateStage(mastery, pointId, wanted, kind = '') {
  const before = pointState(mastery, pointId).stage
  let stage = before
  let clamped = false
  if (STAGES.includes(wanted)) {
    const ceiling = Math.min(STAGES.indexOf(before) + 1, STAGES.length - 1)
    if (STAGES.indexOf(wanted) > ceiling) {
      stage = STAGES[ceiling]
      clamped = true
    } else {
      stage = wanted
    }
  }
  const need = STAGE_NEEDS[stage] || 0
  let made = 0
  if (need) {
    // 作废的证据不算数：盖了章的那条不该还撑着档位。
    made = workCountOf(pointState(mastery, pointId)) + (WORK_KINDS.includes(kind) ? 1 : 0)
  }
  return { stage, before, clamped, blocked: need > 0 && made < need, need, made }
}

/* ── 证据流水：作废、来源、可重算 ────────────────────────────────────────── */

/**
 * 一条证据是不是被作废了。
 *
 * 流水不可变：记错了一条（记错了单元、把别的科目的作业记上来了、同一次记了两遍），
 * **不许删行**——删了就没人知道这里曾经有过一条。改成在它身上盖个章，重算的时候
 * 跳过它，档案里照样看得见「这条作废了，因为……」。
 *
 * 这一段是照着 DeepTutor 那套「证据不可变 + 结论可重算」来的（它的
 * `learning/models.py` 里 `LearningEvidence` 只增不改，档位一律由引擎重算）。
 */
export function isVoided(item) {
  return Boolean(item && item.voidedAt)
}

/** 这笔账里真算数的证据（作废的不算）。错题、弱项、重算全走它。 */
export function liveEvidence(state) {
  const list = Array.isArray(state && state.evidence) ? state.evidence : []
  return list.filter((item) => !isVoided(item))
}

/** 「真做过」的证据有几条（做题 / 作业照片）。自评、上课、复习不算。 */
export function workCountOf(state) {
  return liveEvidence(state).filter((e) => WORK_KINDS.includes(e.kind)).length
}

/**
 * 照着流水重算档位。
 *
 * 为什么要有它：档位是**写下来的**（`state.stage`），所以它只反映记的那一刻。
 * 一条证据后来作废了、或者旧版本绕过门直接写了档位，账面上都看不出破绽。重算就是
 * 把同一道门照着流水再走一遍，得到「凭这些证据最多能到哪一档」；跟账上写的对不上
 * 就叫漂移（`driftOf` 会挑出来）。
 *
 * 两条规矩跟 `gateStage` 完全一致，别在这儿另立一套：
 *   ①每条证据自己记着「我之后档位在哪」（`item.stage`），一次只前进一步；
 *   ②`STAGE_NEEDS` 里那几档要凑够「真做过」的证据，不够就停在原地。
 * 没有 `item.stage` 的老证据（加这个字段之前记的）只算进 `workCount`：它证得了
 * 「他做过」，证不了「当时判成了哪一档」，所以不让它推动档位。
 *
 * 返回 `{ stage, source, work }`：`source` 是最后一次推动档位的那条证据 id。
 */
export function derivedStage(state) {
  const list = liveEvidence(state)
  let stage = '没接触过'
  let work = 0
  let source = null
  for (const item of list) {
    if (WORK_KINDS.includes(item.kind)) work += 1
    const want = STAGES.includes(item && item.stage) ? item.stage : null
    if (!want) continue
    const ceiling = Math.min(STAGES.indexOf(stage) + 1, STAGES.length - 1)
    const next = STAGES.indexOf(want) > ceiling ? STAGES[ceiling] : want
    if (next === stage) continue
    if ((STAGE_NEEDS[next] || 0) > work) continue
    stage = next
    source = item.id ? String(item.id) : null
  }
  return { stage, source, work }
}

/** 证据类型说成人话。复习理由里要用，别在别处再写一份。 */
const EVIDENCE_WORDS = { lesson: '上过课', quiz: '做过题', photo: '交过作业', review: '复习过', self: '自评过' }

/**
 * 为什么这一条现在该复习——说人话。
 *
 * 到期日是个日期，学生看到「2026-10-07」并不知道今天该不该动它；DeepTutor 的排期器
 * （`learning/scheduler.py:362`）每条都带一句人话理由，这里照办：几时记的证据、现在哪一档、
 * 到期日过没过、底下还挂着几道没复做对的错题。**只讲事实，不替教练拿主意**——要不要现在
 * 复习、复习哪一段，仍由教练用 `study_plan` 决定。
 */
export function dueReason(state, today = todayString()) {
  const live = liveEvidence(state)
  const last = live.length ? live[live.length - 1] : null
  const bits = []
  const days = last && last.at ? daysBetween(last.at, today) : null
  if (days === null) {
    bits.push('这一条还没记过证据')
  } else {
    bits.push(`${days <= 0 ? '今天' : `${days} 天前`}${EVIDENCE_WORDS[last.kind] || '记过一笔'}`)
  }
  bits.push(`现在是「${state.stage}」`)
  if (state.nextReview) {
    const late = daysBetween(state.nextReview, today)
    bits.push(late > 0 ? `排在 ${state.nextReview}，逾期 ${late} 天` : `排在 ${state.nextReview}`)
  } else {
    bits.push('还没排下次复习')
  }
  const open = live.filter((e) => e && e.mistake && e.mistake.status !== '已复做对').length
  if (open) bits.push(`底下有 ${open} 道错题没复做对`)
  return bits.join('；')
}

/**
 * 账上写的档位比证据撑得起的还高——哪些单元是这样。
 * 空数组就是账对得上。体检卡报的就是它。
 */
export function driftOf(mastery, map = null) {
  const out = []
  const modules = map && Array.isArray(map.modules) ? map.modules : null
  for (const [pointId, state] of Object.entries((mastery && mastery.points) || {})) {
    const recorded = pointState(mastery, pointId).stage
    const d = derivedStage(state)
    if (STAGES.indexOf(recorded) > STAGES.indexOf(d.stage)) {
      const brief = modules ? briefOf(modules, pointId) : null
      out.push({
        pointId,
        title: brief ? brief.title : pointId,
        stage: recorded,
        derived: d.stage,
        work: d.work,
      })
    }
  }
  return out
}

/**
 * 按 id 找一条证据，连它挂在哪个知识点上一起返回。找不到返回 null。
 * 作废之前先拿它核对单元——先动手再发现找错了单元，那条已经被盖上章了。
 */
export function findEvidence(mastery, evidenceId) {
  const want = String(evidenceId ?? '').trim()
  if (!want) return null
  for (const [pointId, state] of Object.entries((mastery && mastery.points) || {})) {
    const list = Array.isArray(state && state.evidence) ? state.evidence : []
    const item = list.find((e) => e && String(e.id) === want)
    if (item) return { pointId, item }
  }
  return null
}

/**
 * 作废一条证据，并照着重算档位。
 *
 * 这是「修账」的唯一入口：证据是在 `study_record` 记的，只有它知道 id。作废之后
 * 如果档位是靠那条证据撑着的，就降下来（`derivedStage` 说了算）——不然一条作废的
 * 证据还能把档位钉在上面，等于没修。
 *
 * 找不到那条证据直接抛：静默成功会让教练以为修好了。
 * 返回 `{ pointId, evidenceId, before, after, already }`。
 */
export function voidEvidence(mastery, evidenceId, reason = '') {
  const want = String(evidenceId ?? '').trim()
  if (!want) throw new Error('evidenceId required')
  for (const [pointId, state] of Object.entries((mastery && mastery.points) || {})) {
    const list = Array.isArray(state && state.evidence) ? state.evidence : []
    const hit = list.find((e) => e && String(e.id) === want)
    if (!hit) continue
    if (hit.voidedAt) return { pointId, evidenceId: want, before: state.stage, after: state.stage, already: true }
    const before = pointState(mastery, pointId).stage
    hit.voidedAt = nowIso()
    hit.voidReason = String(reason || '').trim()
    const d = derivedStage(state)
    if (STAGES.indexOf(d.stage) < STAGES.indexOf(before)) state.stage = d.stage
    state.source = d.source
    state.updatedAt = nowIso()
    return { pointId, evidenceId: want, before, after: state.stage, already: false }
  }
  throw new Error('没有这条证据：' + want + '（id 从 study_archive 的证据列表里拿，老证据没有 id，作废不了）')
}

/* ── 掌握度 ──────────────────────────────────────────────────────────────── */

/** 没记录过的知识点，当成「见过但没底」。 */
export function pointState(mastery, pointId) {
  const p = mastery && mastery.points ? mastery.points[pointId] : null
  if (!p || typeof p !== 'object') {
    return { stage: '没接触过', confidence: 0, evidence: [], nextReview: null, updatedAt: null, source: '', voidedCount: 0 }
  }
  const evidence = Array.isArray(p.evidence) ? p.evidence : []
  return {
    stage: STAGES.includes(p.stage) ? p.stage : '没接触过',
    confidence: typeof p.confidence === 'number' ? p.confidence : 0,
    evidence,
    nextReview: p.nextReview ?? null,
    updatedAt: p.updatedAt ?? null,
    /* 现在这个档位是被哪条证据推上来的（`recordEvidence` 每次动档都改写）。
       档案里显示成「为什么是这个档」，对不上账时也是查账的线头。 */
    source: String(p.source ?? ''),
    voidedCount: evidence.filter((e) => isVoided(e)).length,
  }
}

let mistakeSeq = 0

function newMistakeId() {
  mistakeSeq += 1
  return 'w-' + Date.now().toString(36) + '-' + mistakeSeq
}

let evidenceSeq = 0

/**
 * 证据的 id。
 *
 * 以前证据是匿名的一行 `{ kind, at, note }`——够用，因为没人需要单独指它。
 * 但「关于这个学生的判断」要一条条挂回具体是哪次，没有 id 就只能挂到整个单元，
 * 「这条判断来自哪一次」就说不清了。老数据没有 id，`evidenceKey()` 会现推一个。
 */
export function newEvidenceId() {
  evidenceSeq += 1
  return 'e-' + Date.now().toString(36) + '-' + evidenceSeq
}

/**
 * 错题的规范化 + 自校验。错题不另开一张表，就挂在某条证据上——它本来就是
 * 「这次做题他错了」这件事的细节，分开存迟早会对不上。
 *
 * 规矩写在代码里，不写在提示词里：**没有错因、没有订正，就不许标成「已订正」**。
 * 不拦这一条，「错题本」很快会退化成一张只有题号的清单，学生照着复习不到东西。
 */
export function normalizeMistake(raw, previous = null, id = '') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('mistake 要是一个对象')
  // 状态写错了别静默吞成「待验证」——教练以为自己标成「已订正」了，回头查起来对不上。
  if (raw.status !== undefined && String(raw.status ?? '').trim() !== '' && !MISTAKE_STATUS.includes(raw.status)) {
    throw new Error(`mistake.status 只能是 ${MISTAKE_STATUS.join(' / ')}，收到「${raw.status}」`)
  }
  const prev = previous && typeof previous === 'object' ? previous : {}
  // 没传的字段留着上一次的：只改状态的时候不该把错因冲掉。
  const keep = (value, fallback) => (value === undefined ? String(fallback ?? '') : String(value ?? '').trim())
  const next = {
    id: String(id || prev.id || newMistakeId()),
    origin: keep(raw.origin, prev.origin),
    step: keep(raw.step, prev.step),
    cause: keep(raw.cause, prev.cause),
    fix: keep(raw.fix, prev.fix),
    redoAt: keep(raw.redoAt, prev.redoAt),
    status: MISTAKE_STATUS.includes(raw.status) ? raw.status : prev.status || '待验证',
    at: String(prev.at || nowIso()),
    updatedAt: nowIso(),
  }
  if (!next.origin) throw new Error('错题要写 origin：哪份材料的哪一题。不写出处，以后找不回来')
  if (next.redoAt && !/^\d{4}-\d{2}-\d{2}$/.test(next.redoAt)) {
    throw new Error(`redoAt 要写成 YYYY-MM-DD，收到「${next.redoAt}」`)
  }
  if (next.status !== '待验证' && (!next.cause || !next.fix)) {
    throw new Error(`标成「${next.status}」就得先写清 cause（错因）和 fix（订正），不能只有一句「已订正」`)
  }
  return next
}

/** 按 id 找一条错题，连它挂在哪个知识点上一起返回。找不到返回 null。 */
export function findMistake(mastery, mistakeId) {
  const want = String(mistakeId ?? '')
  if (!want) return null
  for (const [pointId, state] of Object.entries((mastery && mastery.points) || {})) {
    for (const item of liveEvidence(state)) {
      if (item && item.mistake && String(item.mistake.id) === want) return { pointId, item }
    }
  }
  return null
}

/** 改一条已有的错题：订正完了、复做过了。不新增证据，也不动档位。 */
export function patchMistake(mastery, mistakeId, patch) {
  const hit = findMistake(mastery, mistakeId)
  if (!hit) throw new Error('没有这条错题：' + String(mistakeId))
  hit.item.mistake = normalizeMistake(patch || {}, hit.item.mistake, hit.item.mistake.id)
  return { pointId: hit.pointId, mistake: hit.item.mistake }
}

/**
 * 记一次证据并推进掌握度。kind 是 self/quiz/photo/coach 之类，note 是人话。
 * 状态只升不降，除非 explicitly 传 stage 往下压。
 * 带 mistake 就是「这次错了，顺带把错题记下来」——两件事一次做完，别分两次调用。
 *
 * 每条证据都记下**它之后档位在哪**（`item.stage`）：档位就成了流水的函数，
 * `derivedStage` 能照着同一个门重算一遍（对账用），不是只靠一个写死的字段。
 */
export function recordEvidence(mastery, { pointId, kind, note, stage, confidence, nextReview, mistake }) {
  if (!pointId) throw new Error('pointId required')
  if (!mastery.points || typeof mastery.points !== 'object') mastery.points = {}
  const prev = pointState(mastery, pointId)
  const evidence = prev.evidence.slice()
  const item = { id: newEvidenceId(), kind: kind || 'self', at: nowIso(), note: note || '' }
  if (mistake) item.mistake = normalizeMistake(mistake)
  const nextStage = STAGES.includes(stage) ? stage : prev.stage
  item.stage = nextStage
  evidence.push(item)
  const moved = STAGES.indexOf(nextStage) !== STAGES.indexOf(prev.stage)
  const source = moved || !prev.source ? String(item.id) : prev.source
  const next = {
    stage: nextStage,
    confidence: typeof confidence === 'number' ? clamp01(confidence) : prev.confidence,
    evidence,
    nextReview: nextReview ?? prev.nextReview,
    updatedAt: nowIso(),
    source,
  }
  mastery.points[pointId] = next
  return next
}

function clamp01(n) {
  if (typeof n !== 'number' || Number.isNaN(n)) return 0
  return Math.min(1, Math.max(0, n))
}

/** 地图里所有知识点的 id，按模块顺序摊平。 */
export function listPointIds(map) {
  const ids = []
  const modules = map && Array.isArray(map.modules) ? map.modules : []
  for (const m of modules) {
    const points = Array.isArray(m.points) ? m.points : []
    for (const p of points) if (p && p.id) ids.push(p.id)
  }
  return ids
}

/** 掌握度总览：每个档位几个点，外加平均置信度。给面板画进度用。 */
export function masterySummary(map, mastery) {
  const ids = listPointIds(map)
  const byStage = {}
  for (const s of STAGES) byStage[s] = 0
  let sum = 0
  for (const id of ids) {
    const st = pointState(mastery, id)
    byStage[st.stage] = (byStage[st.stage] || 0) + 1
    sum += st.confidence
  }
  return {
    total: ids.length,
    byStage,
    avgConfidence: ids.length ? sum / ids.length : 0,
    touched: ids.filter((id) => pointState(mastery, id).stage !== '没接触过').length,
  }
}

/** 六档折算成分数：没接触过 0 分，能讲明白满分。给「这一块掌握了百分之多少」用。 */
export const STAGE_SCORE = {
  没接触过: 0,
  见过: 0.2,
  能跟做: 0.4,
  能独立做: 0.6,
  熟练稳定: 0.8,
  能讲明白: 1,
}

/** 一组知识点掌握了百分之多少，0 到 100 的整数。空组算 0，不抛。 */
export function progressOf(map, mastery, pointIds) {
  const ids = Array.isArray(pointIds) ? pointIds : []
  if (!ids.length) return 0
  let sum = 0
  for (const id of ids) {
    const st = pointState(mastery, id)
    sum += STAGE_SCORE[st.stage] ?? 0
  }
  return Math.round((sum / ids.length) * 100)
}

/** 大类、模块、整张图各算一份进度。面板每一级挂一个百分比用这个。 */
export function progressByGroup(map, mastery) {
  const groups = {}
  const modules = {}
  const all = []
  for (const mod of map && Array.isArray(map.modules) ? map.modules : []) {
    if (!mod || !mod.id) continue
    const ids = (Array.isArray(mod.points) ? mod.points : [])
      .filter((p) => p && p.id)
      .map((p) => String(p.id))
    modules[String(mod.id)] = progressOf(map, mastery, ids)
    const name = String(mod.group || '').trim() || '未分类'
    if (!groups[name]) groups[name] = []
    groups[name].push(...ids)
    all.push(...ids)
  }
  return {
    overall: progressOf(map, mastery, all),
    groups: Object.fromEntries(
      Object.entries(groups).map(([name, ids]) => [name, progressOf(map, mastery, ids)]),
    ),
    modules,
  }
}

/* ── 错题清单 ───────────────────────────────────────────────────────────── */

/**
 * 把整个档案里的错题摊成一张清单，新的在前。面板那一栏和 study_mistakes 读同一份。
 * options: { status, pointId, limit }
 */
export function mistakesOf(map, mastery, options = {}) {
  const wantStatus = String(options.status ?? '').trim()
  const wantPoint = String(options.pointId ?? '').trim()
  const rawLimit = Number(options.limit)
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 200
  const modules = map && Array.isArray(map.modules) ? map.modules : []
  const items = []
  for (const [pointId, state] of Object.entries((mastery && mastery.points) || {})) {
    if (wantPoint && pointId !== wantPoint) continue
    for (const ev of liveEvidence(state)) {
      const m = ev && ev.mistake
      if (!m || typeof m !== 'object') continue
      if (wantStatus && m.status !== wantStatus) continue
      const brief = briefOf(modules, pointId)
      items.push({
        id: String(m.id || ''),
        pointId,
        pointTitle: brief.title,
        moduleId: brief.moduleId,
        moduleTitle: brief.moduleTitle,
        group: brief.group,
        origin: String(m.origin || ''),
        step: String(m.step || ''),
        cause: String(m.cause || ''),
        fix: String(m.fix || ''),
        redoAt: String(m.redoAt || ''),
        status: MISTAKE_STATUS.includes(m.status) ? m.status : '待验证',
        at: String(m.at || ev.at || ''),
        updatedAt: String(m.updatedAt || ''),
        kind: String(ev.kind || ''),
      })
    }
  }
  // 按「什么时候错的」倒序，不按「最后一次改动」——改一下状态就把老错题顶到最上面，
  // 学生看到的第一条会跳来跳去。排序键必须是 at。
  const stamp = (row) => String(row.at || row.updatedAt || '')
  items.sort((a, b) => stamp(b).localeCompare(stamp(a)))
  const byStatus = {}
  for (const s of MISTAKE_STATUS) byStatus[s] = 0
  for (const row of items) byStatus[row.status] += 1
  return { items: items.slice(0, limit), total: items.length, byStatus }
}

/* ── 地图 ────────────────────────────────────────────────────────────────── */

/** 合并同 id 的知识点（重新生成地图时保留用户已经改过的标题）。 */
export function upsertModule(map, module) {
  if (!module || !module.id) throw new Error('module.id required')
  if (!Array.isArray(map.modules)) map.modules = []
  const idx = map.modules.findIndex((m) => m && m.id === module.id)
  if (idx >= 0) map.modules[idx] = { ...map.modules[idx], ...module }
  else map.modules.push(module)
  map.revision = (map.revision || 0) + 1
  return map
}

/** 定稿之后就不该再乱动了；面板上「重新生成」要走 draft。 */
export function confirmMap(map) {
  map.status = 'confirmed'
  map.confirmedAt = nowIso()
  map.revision = (map.revision || 0) + 1
  return map
}

/* ── 每级掌握档案（面板上那个小按键点开看的就是它） ──────────────────────── */

/** 模块属于哪个大类。没写就是「未分类」，跟 progressByGroup 保持一套口径。 */
export function groupOf(mod) {
  return String(mod?.group || '').trim() || '未分类'
}

function idsOf(mod) {
  return (Array.isArray(mod?.points) ? mod.points : [])
    .filter((p) => p && p.id)
    .map((p) => String(p.id))
}

/** 知识点 id → 标题 / 模块 / 大类。复盘图、任务跳转都要靠它认人。 */
export function briefOf(modules, pointId) {
  for (const mod of modules) {
    const hit = (Array.isArray(mod?.points) ? mod.points : []).find((p) => p && String(p.id) === pointId)
    if (!hit) continue
    return {
      title: String(hit.title || hit.id),
      moduleId: String(mod.id || ''),
      moduleTitle: String(mod.title || mod.id || ''),
      group: groupOf(mod),
      groupTitle: groupOf(mod),
      source: String(hit.source || ''),
      video: String(hit.video || ''),
      practice: String(hit.practice || ''),
    }
  }
  return { title: pointId, moduleId: '', moduleTitle: '', group: '', groupTitle: '', source: '', video: '', practice: '' }
}

/**
 * 两个日期差几天。**先切掉时间那一段**——证据上的 `at` 是完整 ISO 串（`2026-10-03T12:34:56Z`），
 * 直接往后拼 `T00:00:00Z` 会解析不出来。算不出来回 `null`，别回 0（0 是「就是今天」）。
 * 按 UTC 零点算，不跟机器时区走——跟 `lib/clock.js` 一个道理。
 */
function daysBetween(from, to) {
  const a = Date.parse(String(from || '').slice(0, 10) + 'T00:00:00Z')
  const b = Date.parse(String(to || '').slice(0, 10) + 'T00:00:00Z')
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return Math.round((b - a) / 86400000)
}

/** 今天（北京时间）。口径在 lib/clock.js，别在这儿另写一遍。 */
export function todayString(at = new Date()) {
  return beijingDate(at)
}

/**
 * 某一级的掌握档案。level 是 group / module / point，key 是大类名 / 模块 id / 知识点 id。
 * 里头有：进度、六档分布、每个单元一条摘要、最近的证据、该复习的、挂在哪份材料上。
 * 找不到返回 null，调用方自己回 404。
 */
export function archiveFor(map, mastery, level, key, options = {}) {
  const today = options.today || todayString()
  const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Number(options.limit)) : 12
  const modules = map && Array.isArray(map.modules) ? map.modules : []
  const wanted = String(key ?? '')

  let title = ''
  let moduleId = ''
  let moduleTitle = ''
  let group = ''
  let pointIds = []

  if (level === 'group') {
    group = wanted.trim() || '未分类'
    title = group
    for (const mod of modules) {
      if (groupOf(mod) !== group) continue
      pointIds.push(...idsOf(mod))
    }
    if (!pointIds.length) return null
  } else if (level === 'module') {
    const mod = modules.find((m) => m && String(m.id) === wanted)
    if (!mod) return null
    moduleId = String(mod.id)
    moduleTitle = String(mod.title || mod.id)
    title = moduleTitle
    group = groupOf(mod)
    pointIds = idsOf(mod)
  } else if (level === 'point') {
    for (const mod of modules) {
      const hit = (Array.isArray(mod?.points) ? mod.points : []).find((p) => p && String(p.id) === wanted)
      if (!hit) continue
      moduleId = String(mod.id || '')
      moduleTitle = String(mod.title || mod.id || '')
      group = groupOf(mod)
      title = String(hit.title || hit.id)
      pointIds = [String(hit.id)]
      break
    }
    if (!pointIds.length) return null
  } else {
    throw new Error('level 只能是 group / module / point')
  }

  const byStage = {}
  for (const stage of STAGES) byStage[stage] = 0
  const points = []
  const evidence = []
  const due = []
  let sumConfidence = 0

  for (const id of pointIds) {
    const state = pointState(mastery, id)
    const brief = briefOf(modules, id)
    byStage[state.stage] = (byStage[state.stage] || 0) + 1
    sumConfidence += state.confidence
    const overdue = Boolean(state.nextReview) && String(state.nextReview) <= today
    if (overdue) {
      due.push({
        pointId: id,
        title: brief.title,
        stage: state.stage,
        nextReview: String(state.nextReview),
        why: dueReason(state, today),
      })
    }
    const live = liveEvidence(state)
    const last = live.length ? live[live.length - 1] : null
    /* 这个档位是哪条证据推上来的、凭这些证据重算能到哪一档。面板上「为什么是这个档」
       就靠它；`drift` 为真说明账上比证据高（体检卡报的就是这条）。 */
    const sourceItem = state.source
      ? state.evidence.find((e) => e && String(e.id) === state.source)
      : null
    const derived = derivedStage(state)
    points.push({
      pointId: id,
      title: brief.title,
      moduleId: brief.moduleId,
      moduleTitle: brief.moduleTitle,
      group: brief.group,
      source: brief.source,
      video: brief.video,
      practice: brief.practice,
      stage: state.stage,
      confidence: state.confidence,
      evidenceCount: live.length,
      voidedCount: state.voidedCount,
      stageSource: String(state.source || ''),
      stageSourceKind: String(sourceItem?.kind || ''),
      stageSourceAt: String(sourceItem?.at || ''),
      stageSourceNote: String(sourceItem?.note || ''),
      workCount: derived.work,
      derivedStage: derived.stage,
      drift: STAGES.indexOf(state.stage) > STAGES.indexOf(derived.stage),
      lastKind: String(last?.kind || ''),
      lastNote: String(last?.note || ''),
      lastAt: String(last?.at ?? ''),
      nextReview: String(state.nextReview ?? ''),
      updatedAt: String(state.updatedAt ?? ''),
      due: overdue,
    })
    for (const [i, item] of state.evidence.entries()) {
      /* 错题就挂在这条证据上，档案里跟着一起端出来，别让它只活在另一个界面里。
         没有错题就**不写这个字段**——输出 schema 里它是可选的对象，塞个 null 会被宿主校验拒。 */
      const row = {
        /* 学生画像那条判断就挂在这个值上（study_student 的 evidence）。
           老证据（加 id 之前记的）没有 id，就按「单元 + 时刻」推一个——**必须跟
           lib/student.js 的 evidenceKey() 用同一套算法**，不然今天写下的引用明天就兑不上了：
           那边是 `item.id || 单元@时刻`，同一毫秒同一单元撞了才补 `#序号`。 */
        id: item?.id ? String(item.id) : `${id}@${item?.at ?? ''}${i > 0 ? '#' + i : ''}`,
        pointId: id,
        pointTitle: brief.title,
        kind: String(item?.kind || ''),
        note: String(item?.note || ''),
        at: item?.at ?? null,
        /* 作废的那条照样列出来（流水不许删），只是带上章，读的人知道它不算数。 */
        voided: isVoided(item),
        voidReason: String(item?.voidReason || ''),
      }
      if (item && item.mistake) row.mistake = item.mistake
      evidence.push(row)
    }
  }
  evidence.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
  due.sort((a, b) => String(a.nextReview || '').localeCompare(String(b.nextReview || '')))

  const untouched = byStage['没接触过'] || 0
  return {
    level,
    key: wanted,
    title,
    group,
    moduleId,
    moduleTitle,
    today,
    total: pointIds.length,
    touched: pointIds.length - untouched,
    untouched,
    progress: progressOf(map, mastery, pointIds),
    avgConfidence: pointIds.length ? sumConfidence / pointIds.length : 0,
    byStage,
    points,
    evidence: evidence.slice(0, limit),
    evidenceTotal: evidence.length,
    due,
  }
}

/* ── 总体能力判断 ───────────────────────────────────────────────────────── */

/**
 * 「这个人现在什么水平」的全部数据。数字算好，话留给教练写（写回 profile.ability）。
 * 面板顶上那张卡和 study_ability 工具读的是同一份。
 */
export function abilityReport(profile, map, mastery, tasks, options = {}) {
  const today = options.today || todayString()
  const modules = map && Array.isArray(map.modules) ? map.modules : []
  const ids = listPointIds(map)
  const summary = masterySummary(map, mastery)
  const progress = progressByGroup(map, mastery)

  const groups = []
  for (const mod of modules) {
    if (!mod || !mod.id) continue
    const name = groupOf(mod)
    let entry = groups.find((g) => g.name === name)
    if (!entry) {
      entry = { name, progress: progress.groups[name] ?? 0, modules: 0, points: 0, touched: 0, due: 0, weak: 0 }
      groups.push(entry)
    }
    const list = idsOf(mod)
    entry.modules += 1
    entry.points += list.length
    entry.touched += list.filter((id) => pointState(mastery, id).stage !== '没接触过').length
  }
  groups.sort((a, b) => b.progress - a.progress)

  const weak = []
  const due = []
  const drift = []
  for (const id of ids) {
    const state = pointState(mastery, id)
    if (state.stage === '没接触过') continue
    const brief = briefOf(modules, id)
    // 做题/作业照片的条数。自评、上课、复习不算——那一档上去了也还是没底。
    // 拿它跟档位对一遍：账上写着的档位高、底下真做过的少，就是「撑不起来」。
    const work = workCountOf(state)
    const live = liveEvidence(state)
    const derived = derivedStage(state)
    if (STAGES.indexOf(state.stage) > STAGES.indexOf(derived.stage)) {
      drift.push({
        pointId: id,
        title: brief.title,
        group: brief.group,
        stage: state.stage,
        derivedStage: derived.stage,
        work,
      })
    }
    const row = {
      pointId: id,
      title: brief.title,
      group: brief.group,
      moduleTitle: brief.moduleTitle,
      stage: state.stage,
      confidence: state.confidence,
      work,
    }
    if (work === 0 && live.length > 0) {
      weak.push({ ...row, reason: '有 ' + live.length + ' 条证据但没有一条做题/作业照片——撑不起「' + state.stage + '」' })
    } else if (STAGES.indexOf(state.stage) <= STAGES.indexOf('能跟做')) {
      weak.push({ ...row, reason: '停在「' + state.stage + '」' })
    } else if (state.confidence < 0.5) {
      weak.push({ ...row, reason: '档位到了但没底（把握 ' + Math.round(state.confidence * 100) + '%）' })
    } else if (STAGES.indexOf(state.stage) >= STAGES.indexOf('能独立做') && work < 2) {
      weak.push({ ...row, reason: '「' + state.stage + '」只有 ' + work + ' 条做题证据——当天冲上去的，隔天重做一遍再认' })
    }
    if (state.nextReview && String(state.nextReview) <= today) {
      due.push({
        pointId: id,
        title: brief.title,
        stage: state.stage,
        nextReview: String(state.nextReview),
        why: dueReason(state, today),
      })
    }
  }
  const groupNames = new Set(groups.map((g) => g.name))
  for (const item of weak) {
    const entry = groups.find((g) => g.name === item.group)
    if (entry && groupNames.has(entry.name)) entry.weak += 1
  }
  for (const item of due) {
    const brief = briefOf(modules, item.pointId)
    const entry = groups.find((g) => g.name === brief.group)
    if (entry) entry.due += 1
  }
  weak.sort((a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage))
  due.sort((a, b) => a.nextReview.localeCompare(b.nextReview))

  const days = tasks && tasks.days && typeof tasks.days === 'object' ? tasks.days : {}
  const pace = { window: 7, days: [], total: 0, done: 0, minutesTotal: 0, minutesDone: 0 }
  const base = Date.parse(today + 'T00:00:00Z')
  for (let back = 6; back >= 0; back -= 1) {
    const date = new Date(base - back * 86400000).toISOString().slice(0, 10)
    const list = Array.isArray(days[date]) ? days[date] : []
    const doneList = list.filter((t) => t && t.done)
    const minutesTotal = list.reduce((n, t) => n + (Number(t?.minutes) || 0), 0)
    const minutesDone = doneList.reduce((n, t) => n + (Number(t?.minutes) || 0), 0)
    pace.days.push({ date, total: list.length, done: doneList.length, minutesTotal, minutesDone })
    pace.total += list.length
    pace.done += doneList.length
    pace.minutesTotal += minutesTotal
    pace.minutesDone += minutesDone
  }
  pace.completion = pace.total ? Math.round((pace.done / pace.total) * 100) : 0
  pace.plannedDays = pace.days.filter((d) => d.total > 0).length
  pace.finishedDays = pace.days.filter((d) => d.total > 0 && d.done >= d.total).length

  const goal = profile?.goal ?? {}
  const deadline = String(goal.deadline || '')
  const minutesPerDay = Number(goal.minutesPerDay) || 0
  const ability = profile?.ability ?? {}

  return {
    today,
    goal: {
      subject: String(goal.subject || ''),
      outcome: String(goal.outcome || ''),
      deadline,
      minutesPerDay,
      daysLeft: /^\d{4}-\d{2}-\d{2}$/.test(deadline) ? daysBetween(today, deadline) : null,
    },
    overall: progress.overall,
    total: summary.total,
    touched: summary.touched,
    untouched: summary.total - summary.touched,
    byStage: summary.byStage,
    avgConfidence: summary.avgConfidence,
    groups,
    weak: weak.slice(0, 12),
    weakTotal: weak.length,
    due: due.slice(0, 12),
    dueTotal: due.length,
    /* 账对不上：写下来的档位比证据撑得起的高。作废一条证据、或老版本绕过门写档位，
       都会留下这种痕迹——体检卡报它，修法是把那条证据作废（study_record 传 voidEvidenceId）。 */
    drift: drift.slice(0, 12),
    driftTotal: drift.length,
    tools: Array.isArray(profile?.tools) ? profile.tools : [],
    pace,
    /* 教练自己写的那句判词，跟上面算出来的数分开。 */
    judgement: {
      text: String(ability.text || ''),
      level: String(ability.level || ''),
      updatedAt: String(ability.updatedAt ?? ''),
      /* L3 → L2 的边：这句话综合了学生画像里哪几条判断。 */
      from: Array.isArray(ability.from) ? ability.from.map(String) : [],
    },
  }
}

/** 教练写的判词落回档案。传空串就是清掉那句。 */
export function setAbility(profile, { text, level, from } = {}) {
  const prev = profile.ability && typeof profile.ability === 'object' ? profile.ability : {}
  const prevFrom = Array.isArray(prev.from) ? prev.from.map(String) : []
  const next = {
    text: text === undefined ? String(prev.text || '') : String(text),
    level: level === undefined ? String(prev.level || '') : String(level),
    updatedAt: nowIso(),
    /* 不给就留着上一次的：只改判词措辞时不该把「它综合了哪几条」冲掉。 */
    from: from === undefined ? prevFrom : (Array.isArray(from) ? from.map((f) => String(f ?? '').trim()).filter(Boolean) : []),
  }
  profile.ability = next
  return next
}

/* ── 任务的跳转按钮（面板和工具都吃这一份） ─────────────────────────────── */

/**
 * 这条任务该往哪儿跳：**只给一颗「打开」**（用户要求：今日任务那一行只留「打开 / 改 / 删除」）。
 *
 * 挑法：教练写在任务上的 `open` 优先——那是他指的「就做这一份这一段」；没有就退到单元的网课，
 * 再没有退到配套讲义；都没有就不给按钮。路径一律转成面板能直接开的 URL，
 * 规则只有一处（lib/urls.js）：markdown / 纯文本进读卷页，PDF、视频走 /study/file。
 */
export function taskLinks(map, task) {
  if (task?.open) return [{ kind: 'open', label: '打开', url: openPath(String(task.open)) }]
  const id = String(task?.target || '')
  const brief = id ? briefOf(map && Array.isArray(map.modules) ? map.modules : [], id) : null
  const hit = brief && brief.moduleId ? brief : null
  if (!hit) return []
  const target = hit.video || hit.practice
  if (!target) return []
  return [{ kind: 'open', label: '打开', url: openPath(target) }]
}

/** 任务本体 + 它挂在哪个知识点上 + 跳转按钮。工具和接口都返回这个形状。 */
export function taskView(map, task) {
  const target = String(task?.target || '')
  const brief = target ? briefOf(map && Array.isArray(map.modules) ? map.modules : [], target) : null
  const hit = brief && brief.moduleId ? brief : null
  return {
    id: String(task?.id || ''),
    title: String(task?.title || ''),
    kind: String(task?.kind || ''),
    target,
    minutes: Number(task?.minutes) || 0,
    done: Boolean(task?.done),
    note: String(task?.note || ''),
    pointId: hit ? target : '',
    pointTitle: hit ? hit.title : '',
    moduleId: hit ? hit.moduleId : '',
    group: hit ? hit.group : '',
    links: taskLinks(map, task),
  }
}
