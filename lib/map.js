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
import { STAGES, MISTAKE_STATUS, nowIso } from './store.js'

/* ── 掌握度 ──────────────────────────────────────────────────────────────── */

/** 没记录过的知识点，当成「见过但没底」。 */
export function pointState(mastery, pointId) {
  const p = mastery && mastery.points ? mastery.points[pointId] : null
  if (!p || typeof p !== 'object') {
    return { stage: '没接触过', confidence: 0, evidence: [], nextReview: null, updatedAt: null }
  }
  return {
    stage: STAGES.includes(p.stage) ? p.stage : '没接触过',
    confidence: typeof p.confidence === 'number' ? p.confidence : 0,
    evidence: Array.isArray(p.evidence) ? p.evidence : [],
    nextReview: p.nextReview ?? null,
    updatedAt: p.updatedAt ?? null,
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
    for (const item of Array.isArray(state?.evidence) ? state.evidence : []) {
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
 */
export function recordEvidence(mastery, { pointId, kind, note, stage, confidence, nextReview, mistake }) {
  if (!pointId) throw new Error('pointId required')
  if (!mastery.points || typeof mastery.points !== 'object') mastery.points = {}
  const prev = pointState(mastery, pointId)
  const evidence = prev.evidence.slice()
  const item = { id: newEvidenceId(), kind: kind || 'self', at: nowIso(), note: note || '' }
  if (mistake) item.mistake = normalizeMistake(mistake)
  evidence.push(item)
  const nextStage = STAGES.includes(stage) ? stage : prev.stage
  const next = {
    stage: nextStage,
    confidence: typeof confidence === 'number' ? clamp01(confidence) : prev.confidence,
    evidence,
    nextReview: nextReview ?? prev.nextReview,
    updatedAt: nowIso(),
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
    for (const ev of Array.isArray(state?.evidence) ? state.evidence : []) {
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

function daysBetween(from, to) {
  const a = Date.parse(String(from) + 'T00:00:00Z')
  const b = Date.parse(String(to) + 'T00:00:00Z')
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return Math.round((b - a) / 86400000)
}

export function todayString() {
  return new Date().toISOString().slice(0, 10)
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
      due.push({ pointId: id, title: brief.title, stage: state.stage, nextReview: String(state.nextReview) })
    }
    const last = state.evidence.length ? state.evidence[state.evidence.length - 1] : null
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
      evidenceCount: state.evidence.length,
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
  for (const id of ids) {
    const state = pointState(mastery, id)
    if (state.stage === '没接触过') continue
    const brief = briefOf(modules, id)
    if (STAGES.indexOf(state.stage) <= STAGES.indexOf('能跟做')) {
      weak.push({
        pointId: id,
        title: brief.title,
        group: brief.group,
        moduleTitle: brief.moduleTitle,
        stage: state.stage,
        confidence: state.confidence,
        reason: '停在「' + state.stage + '」',
      })
    } else if (state.confidence < 0.5) {
      weak.push({
        pointId: id,
        title: brief.title,
        group: brief.group,
        moduleTitle: brief.moduleTitle,
        stage: state.stage,
        confidence: state.confidence,
        reason: '档位到了但没底（把握 ' + Math.round(state.confidence * 100) + '%）',
      })
    }
    if (state.nextReview && String(state.nextReview) <= today) {
      due.push({ pointId: id, title: brief.title, stage: state.stage, nextReview: String(state.nextReview) })
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
 * 这条任务该往哪儿跳：网课、配套练习、做题页。路径一律转成面板能直接开的 URL，
 * 网课和讲义走 /study/file，做题走 /study/practice。
 */
export function taskLinks(map, task) {
  const out = []
  const id = String(task?.target || '')
  const brief = id ? briefOf(map && Array.isArray(map.modules) ? map.modules : [], id) : null
  const hit = brief && brief.moduleId ? brief : null
  const watching = String(task?.kind || '') === 'watch'
  const video = hit && hit.video
    ? { kind: 'video', label: '看这节网课', url: '/study/file?path=' + encodeURIComponent(hit.video) }
    : null

  // 看课的任务，主线是先看完这一讲：看课按钮排在最前，练习排在它后面，
  // 顺序反了学生一点就跳过课直接做题。
  if (watching && video) out.push(video)
  if (task?.open) out.push({ kind: 'open', label: '打开', url: String(task.open) })
  if (!hit) return out
  if (video && !out.some((l) => l.kind === 'video')) out.push(video)
  if (hit.practice) {
    out.push({ kind: 'practice', label: '这一节的讲义', url: '/study/file?path=' + encodeURIComponent(hit.practice) })
  }
  out.push({
    kind: 'point',
    label: watching ? '看完去做练习' : '做题 / 看掌握度',
    url: '/study/practice?point=' + encodeURIComponent(id),
  })
  return out
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
