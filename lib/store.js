/**
 * dsh-study-coach — 数据层。
 *
 * 一个学习目标一个档案，档案就是一个文件夹，里面全是人能直接打开手改的 JSON。
 * 不引数据库，不上锁，只保证：读坏了不炸、写下去是整份、每次改动留时间戳。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'

/** 掌握度状态档位，从低到高。顺序有意义，别重排。 */
export const STAGES = ['没接触过', '见过', '能跟做', '能独立做', '熟练稳定', '能讲明白']

/**
 * 升到这几档之前，该单元下至少要有几条「真做过」的证据。
 *
 * 档位是教练填的，但「够不够格升」不该只由教练说了算：自评说一百遍「我熟练了」
 * 也换不来一条做题记录。所以这几档设一道硬闸门，见 `lib/tools.js` 的 `study_record`。
 * 「能跟做」及以下不设门——那几档本来就只是「见过/跟着走过」，本来就该允许自评。
 */
export const STAGE_NEEDS = { 能独立做: 1, 熟练稳定: 2, 能讲明白: 3 }

/** 算「真做过」的证据类型：做题、作业照片。自评、上课、复习都不算。 */
export const WORK_KINDS = ['quiz', 'photo']

/** 材料分析里「读到什么程度」。 */
export const COVERAGE = ['整本通读', '部分通读', '只翻目录']

/** 章节难度。 */
export const DIFFICULTY = ['基础', '中等', '难']

/**
 * 页级归类里「这一页算什么」。顺序有意义：面板按这个顺序排图例、上色。
 * 目录和答案不占知识点，其余都能挂到地图的最小单元上。
 */
export const PAGE_KINDS = ['讲解', '例题', '习题', '目录', '答案', '其他']

/**
 * 材料的类别。`ai` 是「AI 出题」——教练现场生成的练习卷，落在书架里跟教辅平级，
 * 只是没有对应的本机文件（path 为空、正文走 ai/ 目录下那份 md）。
 */
export const MATERIAL_KINDS = ['book', 'video', 'notes', 'past', 'ai', 'other']

/** 面板上的中文叫法。键跟 MATERIAL_KINDS 对齐，`other` 兜底。 */
export const MATERIAL_KIND_LABELS = {
  book: '教辅',
  video: '网课',
  notes: '讲义',
  past: '真题',
  ai: 'AI 出题',
  other: '其他',
}

/**
 * 错题状态，从低到高：还没订正完 → 错因和订正都写了 → 隔几天重做同类题做对了。
 * 顺序有意义，别重排。
 */
export const MISTAKE_STATUS = ['待验证', '已订正', '已复做对']

/** 一个档案固定就这几个文件。 */
export const FILES = {
  profile: 'profile.json',
  map: 'map.json',
  mastery: 'mastery.json',
  tasks: 'tasks.json',
  guide: 'guide.json',
  inbox: 'inbox.json',
  analysis: 'analysis.json',
  toolbox: 'toolbox.json',
  memory: 'memory.json',
  student: 'student.json',
}

/**
 * 关于这个学生的判断分几类。
 *
 * 跟 mastery 是**两层东西**：mastery 里每条 evidence 是「哪一次、什么表现」，
 * 是流水（L1）；这里一条是「这个人是怎么回事」的**结论**（L2），必须挂着几条
 * 流水才成立。分开存是因为两边的寿命不一样——流水一直涨，结论要能被推翻重写。
 */
export const FACT_KINDS = ['习惯', '强项', '弱项', '偏好', '背景']


/**
 * 记忆卡的间隔阶梯，单位是分钟：10 分钟、1 小时、9 小时、1 天、2 天、6 天、31 天。
 *
 * 这就是艾宾浩斯那条曲线最常用的那组复现点。**顺序有意义**：一段一段往后走，
 * 「忘了」打回第一步，「模糊」退一级。走完最后一级就毕业，不再排期。
 */
export const CARD_STEPS = [10, 60, 540, 1440, 2880, 8640, 44640]

/** 一张卡是什么东西。分这个是为了能按类型筛（单词和公式的复习节奏不一样）。 */
export const CARD_KINDS = ['单词', '公式', '定义', '其他']

/** 自评四档。顺序有意义：越靠后记得越牢，排得越远。 */
export const CARD_GRADES = ['忘了', '模糊', '记住', '秒答']

/** 番茄钟的两个相位。顺序有意义：work 走完接 break。 */
export const FOCUS_PHASES = ['work', 'break']

/** 一次专注允许的分钟数。太短没意义，太长不是番茄钟了。 */
export const FOCUS_MIN = 1
export const FOCUS_MAX = 180

const MATERIALS_DIR = 'materials'

function nowIso() {
  return new Date().toISOString()
}

/** 空档案的默认形状。缺字段的地方一律从这里兜底。 */
export function emptyProfile() {
  return {
    version: 1,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    goal: { subject: '', outcome: '', deadline: '', minutesPerDay: 60 },
    materials: [],
    tools: [],
    /* 教练对「这人现在整体什么水平」写下的判词，面板顶上那条就显示它。 */
    ability: { text: '', level: '', updatedAt: null },
  }
}

export function emptyMap() {
  return { version: 1, revision: 0, status: 'draft', confirmedAt: null, modules: [] }
}

export function emptyMastery() {
  return { version: 1, points: {} }
}

export function emptyTasks() {
  return { version: 1, days: {} }
}

/** 教练写在面板顶上的一句话指引：现在该回对话里干什么。 */
export function emptyGuide() {
  return { version: 1, text: '', kind: '', at: null }
}

/** 学生在面板上留给教练的话，等对话那边来读。 */
export function emptyInbox() {
  return { version: 1, items: [] }
}

/** 材料通读之后的分析：整份材料怎么用、每章干什么。 */
export function emptyAnalysis() {
  return { version: 1, byMaterial: {} }
}

/**
 * 工具栏目：番茄钟和清单。
 *
 * 番茄钟的状态**以绝对时刻为准**（`endsAt`），不是「还剩几秒」——
 * 面板关掉、页面刷新、DSH 重启都不影响它，回来一看该走到哪儿就是哪儿。
 * 所以「这一轮结束了没有」是读的时候顺手结算的（`settleFocus`），
 * 不靠任何定时器。
 */
export function emptyToolbox() {
  return {
    version: 1,
    focus: {
      workMinutes: 25,
      breakMinutes: 5,
      longBreakMinutes: 15,
      roundsPerLong: 4,
      running: false,
      /* 这一轮结束的时刻，ISO；没在跑就是 null */
      endsAt: null,
      /* 这一轮什么时候开始的，用来算日志 */
      startedAt: null,
      /* 这一轮在做什么：清单条目的 id 和它的文字（文字是快照，条目删了日志还看得懂） */
      taskId: '',
      label: '',
      /* 今天背了几个番茄、累计多少分钟；日期一变就清零 */
      today: '',
      todayMinutes: 0,
      todayRounds: 0,
      /* 已经走完的轮次，最近的在后面 */
      log: [],
    },
    todos: { items: [] },
  }
}

/**
 * 记忆卡：要背的东西一张一张摊开，按艾宾浩斯那条阶梯排什么时候再看一遍。
 *
 * 跟 mastery 是两套账：mastery 记的是「这个知识点会不会做题」，memory 记的是
 * 「这条公式背没背下来」。一张卡可以挂到某个单元上（`pointId`），但挂不挂都不
 * 影响它自己那份排期——背下来和会做是两件事。
 */
export function emptyMemory() {
  return {
    version: 1,
    /* 卡片数组；每张卡的形状见 lib/memory.js 的 normalizeCard() */
    cards: [],
  }
}

/**
 * 关于这个学生的判断（L2）。
 *
 * 刻意跟 mastery 那份流水分开存：流水是「发生过什么」，这里存的是
 * 「所以我判断他是怎么回事」。每一条都挂证据，没证据的判断不许落盘——
 * 这条规矩写在 lib/student.js 里，拦得住才行，写在提示词里拦不住。
 */
export function emptyStudent() {
  return {
    version: 1,
    /* 事实数组；每条的形状见 lib/student.js 的 normalizeFact() */
    facts: [],
  }
}

/**
 * 档案仓库。root 就是档案文件夹；多目标以后要做，就是把 root 从单目录换成
 * 一个父目录下的多个子目录，接口不用动。
 */
export class Store {
  constructor(root) {
    this.root = root
  }

  /** 该建的目录建起来，缺的文件补默认值，返回是否新建了 root。 */
  ensure() {
    const fresh = !existsSync(this.root)
    if (fresh) mkdirSync(this.root, { recursive: true })
    const matDir = join(this.root, MATERIALS_DIR)
    if (!existsSync(matDir)) mkdirSync(matDir, { recursive: true })
    for (const key of Object.keys(FILES)) {
      const p = this.path(key)
      if (!existsSync(p)) this.write(key, this.default(key))
    }
    return fresh
  }

  default(key) {
    if (key === 'profile') return emptyProfile()
    if (key === 'map') return emptyMap()
    if (key === 'mastery') return emptyMastery()
    if (key === 'tasks') return emptyTasks()
    if (key === 'guide') return emptyGuide()
    if (key === 'inbox') return emptyInbox()
    if (key === 'analysis') return emptyAnalysis()
    if (key === 'toolbox') return emptyToolbox()
    if (key === 'memory') return emptyMemory()
    if (key === 'student') return emptyStudent()
    throw new Error('unknown file: ' + key)
  }

  path(key) {
    const name = FILES[key]
    if (!name) throw new Error('unknown file: ' + key)
    return join(this.root, name)
  }

  materialsDir() {
    return join(this.root, MATERIALS_DIR)
  }

  /** 读一份；坏了或者不在了就返回默认值，不抛。 */
  read(key) {
    try {
      const raw = readFileSync(this.path(key), 'utf8')
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return this.default(key)
      return parsed
    } catch {
      return this.default(key)
    }
  }

  /** 整份写下去，先落临时文件再改名，避免写一半断电留个半截 JSON。 */
  write(key, value) {
    const target = this.path(key)
    const tmp = target + '.tmp'
    writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
    renameSync(tmp, target)
    return value
  }

  /** 改一份：读出当前值，交给 fn，写回。fn 里就地改或者返回新对象都行。 */
  update(key, fn) {
    const current = this.read(key)
    const next = fn(current) ?? current
    if (next && typeof next === 'object' && !next.updatedAt && key !== 'map' && key !== 'mastery') {
      next.updatedAt = nowIso()
    }
    return this.write(key, next)
  }

  /** 面板要一眼看全，这里一次把几份都端出去。 */
  snapshot() {
    const map = this.read('map')
    const mastery = this.read('mastery')
    const profile = this.read('profile')
    const tasks = this.read('tasks')
    return {
      root: this.root,
      profile,
      map,
      mastery,
      tasks,
      guide: this.read('guide'),
      inbox: this.read('inbox'),
      analysis: this.read('analysis'),
      /* 关于这个学生的判断（L2）。落盘是原样的引用，谁用谁去 mastery 里兑证据。 */
      student: this.read('student'),
      /* 大类、模块各带一个百分比，面板上「某大类 60%」那种就靠它。 */
      progress: progressByGroup(map, mastery),
      /* 顶上那张「这人现在什么水平」的卡，数据都在这儿，话由教练写。 */
      ability: abilityReport(profile, map, mastery, tasks),
      stage: STAGES,
      at: nowIso(),
    }
  }
}

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

/* ── 材料分析（通读教辅之后写下来的东西） ────────────────────────────────── */

/** 取一份材料的分析。没分析过就返回空壳，不抛。 */
export function analysisOf(analysis, materialId) {
  const by = analysis && analysis.byMaterial ? analysis.byMaterial : {}
  const a = by[materialId]
  if (!a || typeof a !== 'object') {
    return {
      materialId: '',
      coverage: '只翻目录',
      role: '',
      pairing: '',
      notes: '',
      chapters: [],
      analyzedAt: null,
      /* 下面这几项是「拆书」那条链的产物：整本拆成页图、读出目录、每一页归到哪个单元。 */
      pageCount: 0,
      pageDir: '',
      dpi: 0,
      toc: [],
      pages: [],
    }
  }
  const pageDir = String(a.pageDir ?? '')
  return {
    materialId: a.materialId ?? materialId,
    coverage: COVERAGE.includes(a.coverage) ? a.coverage : '只翻目录',
    role: String(a.role ?? ''),
    pairing: String(a.pairing ?? ''),
    notes: String(a.notes ?? ''),
    chapters: Array.isArray(a.chapters) ? a.chapters : [],
    analyzedAt: a.analyzedAt ?? null,
    pageCount: Number(a.pageCount) > 0 ? Number(a.pageCount) : 0,
    pageDir,
    dpi: Number(a.dpi) > 0 ? Number(a.dpi) : 0,
    toc: Array.isArray(a.toc) ? a.toc : [],
    // 每行都带上「这一页的图在哪」，省得下游各自拿 pageDir 拼一遍文件路径。
    pages: (Array.isArray(a.pages) ? a.pages : []).map((row) => ({ ...row, file: pageFileOf(pageDir, row && row.page) })),
  }
}

/**
 * 知识点 / 题型 → 页码。这一条是「一键跳到那一页」的全部依据。
 * 形状 { label, page, pointId }：label 是人看的（「这一页讲什么」），
 * pointId 是机器对的（M1.4），page 是这一份 PDF 自己的页码。
 */
export function marksOf(incoming, previous) {
  const rows = Array.isArray(incoming) && incoming.length ? incoming : previous
  if (!Array.isArray(rows)) return []
  const out = []
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue
    const label = String(raw.label ?? '').trim()
    const page = String(raw.page ?? '').replace(/[^0-9]/g, '')
    if (!label && !page) continue
    if (!label || !page) continue
    out.push({
      label,
      page,
      pointId: String(raw.pointId ?? '').trim(),
    })
  }
  return out
}

/* ── 页级索引：整本书的每一页归到哪个单元 ───────────────────────────────── */

/** 页图目录里第 N 页叫什么。文件名带页码，就是 `p0007.png`。 */
export function pageFileOf(pageDir, page) {
  const n = Number(String(page ?? '').replace(/[^0-9]/g, ''))
  if (!pageDir || !Number.isFinite(n) || n < 1) return ''
  return join(String(pageDir), 'p' + String(n).padStart(4, '0') + '.png')
}

/** 书目条目规整。level 1 是章、2 是节，page 是这一份 PDF 的物理页。 */
export function tocOf(rows) {
  const out = []
  for (const raw of Array.isArray(rows) ? rows : []) {
    if (!raw || typeof raw !== 'object') continue
    const title = String(raw.title ?? '').trim()
    const page = String(raw.page ?? '').replace(/[^0-9]/g, '')
    if (!title) continue
    const level = Number(String(raw.level ?? '1').replace(/[^0-9]/g, '')) || 1
    out.push({ level, title, page, pointId: String(raw.pointId ?? '').trim() })
  }
  return out
}

/** 逐页行规整：`{page, pointId, kind, note}`，分不清的归「其他」。 */
export function pageRowsOf(rows) {
  const seen = new Map()
  for (const raw of Array.isArray(rows) ? rows : []) {
    if (!raw || typeof raw !== 'object') continue
    const n = Number(String(raw.page ?? '').replace(/[^0-9]/g, ''))
    if (!Number.isFinite(n) || n < 1) continue
    seen.set(String(n), {
      page: String(n),
      pointId: String(raw.pointId ?? '').trim(),
      kind: PAGE_KINDS.includes(raw.kind) ? raw.kind : '其他',
      note: String(raw.note ?? '').trim(),
    })
  }
  return [...seen.values()].sort((a, b) => Number(a.page) - Number(b.page))
}

/**
 * 逐页压成区间。盘上存的是「第几页 → 哪个单元」的完整表，给人看、给面板画条带的是区间——
 * 一本 300 页的书，这两样说的是同一件事，逐页表能查、区间能读。
 */
export function spansOf(rows) {
  const sorted = pageRowsOf(rows)
  const out = []
  for (const row of sorted) {
    const n = Number(row.page)
    const last = out[out.length - 1]
    if (last && last.pointId === row.pointId && last.kind === row.kind && Number(last.to) + 1 === n) {
      last.to = row.page
      last.count += 1
      if (!last.note && row.note) last.note = row.note
      continue
    }
    out.push({ from: row.page, to: row.page, pointId: row.pointId, kind: row.kind, note: row.note, count: 1 })
  }
  return out
}

/**
 * 区间摊回逐页 —— 这是「每一页都归类」和「agent 写起来不吐血」两头都要的关键：
 * 工具入参让人写 `{from:12,to:15,pointId:'M1.4',kind:'例题'}`，盘上落成第 12/13/14/15 四行。
 * 一行里给了 pages 就按 pages 逐页来（单页、跳页用这种），否则按 from/to 铺开。
 * 覆盖不到的页返回在 result.gaps 里，好让 agent 知道还剩哪儿没归。
 */
export function expandSpans(spans, { pageCount = 0 } = {}) {
  const rows = new Map()
  for (const raw of Array.isArray(spans) ? spans : []) {
    if (!raw || typeof raw !== 'object') continue
    const kind = PAGE_KINDS.includes(raw.kind) ? raw.kind : '其他'
    const pointId = String(raw.pointId ?? '').trim()
    const note = String(raw.note ?? '').trim()
    let list = Array.isArray(raw.pages) && raw.pages.length
      ? raw.pages.map((p) => Number(String(p).replace(/[^0-9]/g, '')))
      : null
    if (!list) {
      const from = Number(String(raw.from ?? raw.page ?? '').replace(/[^0-9]/g, ''))
      const to = Number(String(raw.to ?? '').replace(/[^0-9]/g, '')) || from
      if (!Number.isFinite(from) || from < 1) continue
      list = []
      for (let n = from; n <= Math.max(from, to); n += 1) list.push(n)
    }
    for (const n of list) {
      if (!Number.isFinite(n) || n < 1) continue
      rows.set(String(n), { page: String(n), pointId, kind, note })
    }
  }
  const out = [...rows.values()].sort((a, b) => Number(a.page) - Number(b.page))
  const gaps = []
  if (pageCount > 0) {
    for (let n = 1; n <= pageCount; n += 1) if (!rows.has(String(n))) gaps.push(n)
  }
  return { rows: out, gaps }
}

/** 逐页表里超出这本书页数的行，挑出来让工具报错，别悄悄留下不存在的页。 */
export function outOfRange(rows, pageCount) {
  if (!(pageCount > 0)) return []
  return pageRowsOf(rows).filter((r) => Number(r.page) > pageCount)
}

/**
 * 一个单元在各份教辅里对应哪几页。做题页的「教辅 A / 教辅 B，你想做哪本」、
 * 排任务时往 task 上挂 `{materialId, from, to}`，都从这儿取。
 */
export function pagesForPoint(analysis, materials, pointId) {
  const want = String(pointId ?? '').trim()
  if (!want) return []
  const out = []
  for (const mat of Array.isArray(materials) ? materials : []) {
    if (!mat) continue
    const a = analysisOf(analysis, String(mat.id))
    const rows = a.pages.filter((r) => r.pointId === want)
    if (!rows.length) continue
    for (const span of spansOf(rows)) {
      out.push({
        materialId: String(mat.id),
        material: String(mat.title || ''),
        kind: String(mat.kind || ''),
        path: String(mat.path || ''),
        pageDir: a.pageDir,
        from: span.from,
        to: span.to,
        count: span.count,
        pageKind: span.kind,
        note: span.note,
      })
    }
  }
  // 顺序就是材料登记的顺序、每份材料内部按页码排——面板要按「教辅 A / 教辅 B」成组显示，
  // 全局按页数重排会把同一本书的几段打散。
  return out
}

/**
 * 写一份材料的分析。整份的元信息（role / pairing / notes / coverage）覆盖，
 * 章节按 no 合并——所以可以分批喂，也可以只改其中一章。
 */
export function upsertAnalysis(analysis, materialId, patch) {
  if (!materialId) throw new Error('materialId required')
  if (!analysis.byMaterial || typeof analysis.byMaterial !== 'object') analysis.byMaterial = {}
  const prev = analysisOf(analysis, materialId)
  const num = (value, fallback) => (Number(value) > 0 ? Number(value) : fallback)
  const next = {
    materialId,
    coverage: COVERAGE.includes(patch.coverage) ? patch.coverage : prev.coverage,
    role: typeof patch.role === 'string' ? patch.role.trim() : prev.role,
    pairing: typeof patch.pairing === 'string' ? patch.pairing.trim() : prev.pairing,
    notes: typeof patch.notes === 'string' ? patch.notes.trim() : prev.notes,
    chapters: prev.chapters.slice(),
    analyzedAt: nowIso(),
    pageCount: num(patch.pageCount, prev.pageCount),
    pageDir: typeof patch.pageDir === 'string' && patch.pageDir.trim() ? patch.pageDir.trim() : prev.pageDir,
    dpi: num(patch.dpi, prev.dpi),
    // 目录是整本书自己的骨架，一次读完一次写；分批喂一半没有意义，所以给了就整份换。
    toc: Array.isArray(patch.toc) ? tocOf(patch.toc) : prev.toc.slice(),
    pages: prev.pages.slice(),
  }
  const incoming = Array.isArray(patch.chapters) ? patch.chapters : []
  for (const raw of incoming) {
    if (!raw || typeof raw !== 'object') continue
    const no = String(raw.no ?? '').trim()
    if (!no) continue
    // 字段级合并：这一批没写的字段留着上一批的。想清空某一项就别指望传空串——
    // 分批读的场合下「忘了写」比「想清空」常见得多，宁可保守。
    const idx = next.chapters.findIndex((c) => String(c?.no ?? '') === no)
    const prevChapter = idx >= 0 ? next.chapters[idx] : null
    const keep = (value, fallback) =>
      typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
    const chapter = {
      no,
      title: keep(raw.title, prevChapter?.title ?? ''),
      pages: keep(raw.pages, prevChapter?.pages ?? ''),
      topics: keep(raw.topics, prevChapter?.topics ?? ''),
      examples: keep(raw.examples, prevChapter?.examples ?? ''),
      exercises: keep(raw.exercises, prevChapter?.exercises ?? ''),
      difficulty: DIFFICULTY.includes(raw.difficulty) ? raw.difficulty : (prevChapter?.difficulty ?? '中等'),
      role: keep(raw.role, prevChapter?.role ?? ''),
      // 讲义是一章一份 PDF 的，章节条目得自己记住是哪一份，否则做题页只能开到上一级目录。
      file: keep(raw.file, prevChapter?.file ?? ''),
      // 光有整章页码给不出「这个知识点在第 6 页」，那一句得靠逐页看图才写得出来。
      marks: marksOf(raw.marks, prevChapter?.marks),
    }
    if (idx >= 0) next.chapters[idx] = chapter
    else next.chapters.push(chapter)
  }

  /*
   * 页级索引按「页」合并，新写的盖旧的——这样 agent 可以一章一章地归，
   * 也可以回头把某一页改判到别的单元。想整本重来就传 resetPages。
   */
  if (patch.resetPages === true) next.pages = []
  const incomingSpans = [
    ...(Array.isArray(patch.spans) ? patch.spans : []),
    ...(Array.isArray(patch.pages) ? patch.pages : []),
  ]
  if (incomingSpans.length) {
    const byPage = new Map(next.pages.map((r) => [String(r.page), r]))
    for (const row of expandSpans(incomingSpans, { pageCount: next.pageCount }).rows) byPage.set(row.page, row)
    next.pages = [...byPage.values()].sort((a, b) => Number(a.page) - Number(b.page))
  }

  analysis.byMaterial[materialId] = next
  return next
}

/** 材料删了，它的分析也一起走，省得以后重新登记时撞上旧结论。 */
export function dropAnalysis(analysis, materialId) {
  if (analysis && analysis.byMaterial) delete analysis.byMaterial[materialId]
  return analysis
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
