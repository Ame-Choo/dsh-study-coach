/**
 * 学习教练面板。纯原生 JS，同源调 /study/api/*。
 *
 * 分工摆在这儿：对话那边负责问、解析材料、生成地图、写档案；这一端只负责
 * 给人看、让人自评、勾任务，再加一页对话和一个悬浮小窗，把话带回对话里去。
 * 所以这里没有「改目标」「加材料」的表单 —— 那些都归对话。
 */
/**
 * 图谱那份单独搁一个文件。用动态 import：万一它没在、或者写坏了，
 * 顶多少画一张图，别把整个面板连带拖下水。
 */
let renderGraph = null
try {
  ;({ renderGraph } = await import('./graph.js'))
} catch {
  renderGraph = null
}

const STAGES = ['没接触过', '见过', '能跟做', '能独立做', '熟练稳定', '能讲明白']
/* 与 lib/store.js 的 MISTAKE_STATUS 同序：待验证 → 已订正 → 已复做对 */
const MISTAKE_STATUS = ['待验证', '已订正', '已复做对']

const STAGE_COLOR = {
  '没接触过': 'var(--stage-1)',
  '见过': 'var(--stage-2)',
  '能跟做': 'var(--stage-3)',
  '能独立做': 'var(--stage-4)',
  '熟练稳定': 'var(--stage-5)',
  '能讲明白': 'var(--stage-6)',
}

const KIND = { book: '教辅', video: '网课', notes: '讲义', past: '真题', ai: 'AI 出题', other: '其他' }
/** 书架上分组的顺序：教辅在前，AI 出的卷子紧随其后（跟教辅平级），剩下按重要性排。 */
const KIND_ORDER = ['book', 'ai', 'notes', 'past', 'video', 'other']
const TASK_KIND = { watch: '看课', read: '读教材', practice: '练习', review: '复习', other: '其他' }
const GUIDE_KIND = { ask: '需在对话中回答', self: '请在下方自评', plan: '查看今日任务', done: '' }

const BACK_HINT = '本页仅供查看。修改学习目标、登记材料、重画知识地图，请在对话中提出。'

/**
 * 服务端是不是新代码。
 *
 * 页面这一半（js / css）是每次请求现读磁盘的，服务端那一半（路由）是 DSH 启动时
 * 就加载好的。改了 lib/ 却没重启 DSH，就会变成「面板长着新脸、接口全是旧的」——
 * 表现就是按钮点下去 404。所以启动时探一次，探不到就把话挑明，别让人对着
 * 一个没反应的按钮猜。
 */
let capabilities = null

const STALE_NEED = [
  ['ability', '总体能力判断'],
  ['archive', '每级掌握档案'],
  ['library', '学习目标库'],
  ['practice', '做题页'],
  ['mistakes', '错题本'],
  ['review', '今日复盘图'],
  ['shelf', '资料书架'],
  ['toolbox', '工具栏目'],
  ['memory', '记忆卡'],
  ['file', '打开网课 / 讲义'],
]

let state = null
let summary = null
/* 一份「今天每门课各有什么」的汇总，服务端 taskView 过，链接现成 */
let agenda = null
/* 学习目标清单 + 回收站（回收站只有 /study/api/library 这条接口给） */
let library = null
/* 错题本（只有 /study/api/mistakes 这条接口给，state 里没有） */
let mistakes = null
/* 今日复盘图：{ date, data, svg }；这一天没动过任何单元就是 null */
let review = null
/* 书架：{ materials: [...], pagesRoot }；只有「资料」页拉 */
let shelf = null
/* 书架里正摊开哪一本（materialId），空串就是都折着 */
let shelfOpen = ''
/* 摊开那一本的页级索引：{ materialId, toc, spans, pages, chapters } */
let shelfIndex = null
/* 对话那份快照：{ available, sessionId, messages, sessions, error } */
let chat = null
/* 「对话」页开着时的轮询句柄；离开这一页就停 */
let chatTimer = null
/* 上一份快照的指纹，用来判断要不要重画消息列表 */
let chatStamp = ''
/* 工具栏目那一份：{ focus, todos }；只有「工具」页拉 */
let toolbox = null
/* 记忆卡那一份：{ stats, soon, items, total }；只有工具页切到「记忆卡」时拉 */
let memory = null
/* 番茄钟那个每秒走动的句柄；离开这一页、或者钟停了就清掉 */
let focusTimer = null
const ui = {
  openPoint: null,
  openGroups: new Set(),
  openModules: new Set(),
  /* 掌握档案弹层：{ level, key, loading, data, error } */
  archive: null,
  /* 正在改哪条任务 / 正在等确认删哪条任务，以及它属于哪门课 */
  editTask: null,
  editProfile: '',
  pendingDel: null,
  pendingProfile: '',
  /* 正在改名 / 等确认删掉哪个学习目标 */
  renameId: null,
  pendingDropProfile: null,
  /* 学习目标详情表单开着没有 */
  editGoal: false,
  /* 新建学习目标的表单开着没有 */
  newProfile: false,
  /* 加任务的表单开着没有 */
  newTask: false,
  /* 「今天」那栏只看哪一门课，空串 = 全看 */
  filter: '',
  /* 侧栏模式下展开的卡片（侧栏里一次只铺开一两张，别让人滚半天） */
  open: new Set(['today']),
  /* 材料卡里那段长说明摊开了没有（默认压三行，不然一页全是字） */
  matMore: false,
  /* 「对话」页正看着哪个会话；空串 = 服务端替我挑最近那个 */
  chatSession: '',
  /* 正在发的话（发出后先乐观占位，等服务端日志追上再换成真的） */
  chatSending: false,
  /* 右下角那个悬浮小窗开着没有 */
  float: false,
  /* 错题本只看哪一档，空串 = 全看 */
  mistakeStatus: '',
  /* 资料页：正在上传/登记，别让人连点两下 */
  importing: false,
  /* 上传到哪儿了（一行一句，最多留五句） */
  importLog: '',
  /* 「只看文件夹里有什么」的结果 */
  importPreview: null,
  /* 让 AI 出题：要哪种卷、对着哪个单元、补一句什么要求 */
  aiWant: 'quiz',
  aiPoint: '',
  aiNote: '',
  aiBusy: false,
  /* 工具栏目：正看着哪个小工具（二级菜单选中的那个） */
  tool: 'pomodoro',
  /* 清单只看哪一类：open / today / done，空串 = 全看 */
  todoStatus: 'open',
  /* 这一轮番茄钟挂在清单哪一条上 */
  focusTask: '',
  /* 番茄钟时长输入框里那两格 */
  focusMinutes: 25,
  breakMinutes: 5,
  /* 正等哪条清单/番茄钟的响应，别让人连点 */
  toolBusy: '',
  /* 记忆卡：正面翻过来没有、正在背哪一张、只看哪一档 */
  cardReveal: false,
  cardId: '',
  cardStatus: 'due',
  /* 记忆卡表单里那几格（重画不冲掉填好的字） */
  cardDraft: { front: '', back: '', kind: '', pointId: '' },
}

/* ── 两种用法 ─────────────────────────────────────────────────────────────
 * 侧栏模式：挤在 DSH 右边那条里，窄、短、只想看「现在干什么」。卡片折叠，
 *          图谱收起来，任务优先。
 * 浏览器模式：占满一整个页签，铺开看全景，能改能管。
 * 怎么定：地址上 ?mode= 说了算（说了就记住）；没说过就看环境——嵌在框里
 * 或者屏很窄，按侧栏来。
 */
const MODE_KEY = 'study-coach:mode'
const MODES = [
  { id: 'sidebar', label: '侧栏', hint: '窄栏模式，聚焦今日任务' },
  { id: 'browser', label: '浏览器', hint: '整页模式，总览与编辑' },
]
let mode = resolveMode()

function resolveMode() {
  let asked = ''
  try {
    asked = new URLSearchParams((window.location && window.location.search) || '').get('mode') || ''
  } catch {
    /* 没有 location（测试里）就当没问 */
  }
  if (asked === 'sidebar' || asked === 'browser') {
    try {
      window.localStorage.setItem(MODE_KEY, asked)
    } catch {
      /* 存不下就算了 */
    }
    return asked
  }
  let saved = ''
  try {
    saved = window.localStorage.getItem(MODE_KEY) || ''
  } catch {
    /* 同上 */
  }
  if (saved === 'sidebar' || saved === 'browser') return saved
  let framed = false
  try {
    framed = window.self !== window.top
  } catch {
    framed = true // 跨域读 top 会抛，那就是嵌着的
  }
  const narrow = Number(window.innerWidth) > 0 && Number(window.innerWidth) < 680
  return framed || narrow ? 'sidebar' : 'browser'
}

/* ── 两套配色 ─────────────────────────────────────────────────────────────
 * 亮色（暖骨白 + 鼠尾草）是默认，暗色是同色系的暖暗版，晚上看。
 * 选择存在本机，换页面也还在。定在 <html data-theme> 上，颜色全在 style.css 的变量里。
 */
const THEME_KEY = 'study-coach:theme'
let theme = resolveTheme()

function resolveTheme() {
  let asked = ''
  try {
    asked = new URLSearchParams((window.location && window.location.search) || '').get('theme') || ''
  } catch {
    /* 测试里没有 location，就当没问 */
  }
  if (asked === 'light' || asked === 'dark') {
    saveTheme(asked)
    return asked
  }
  let saved = ''
  try {
    saved = window.localStorage.getItem(THEME_KEY) || ''
  } catch {
    /* 存不下就算了 */
  }
  return saved === 'dark' ? 'dark' : 'light'
}

function saveTheme(next) {
  try {
    window.localStorage.setItem(THEME_KEY, next)
  } catch {
    /* 记不住就这次算数 */
  }
}

function applyTheme() {
  const root = document.documentElement
  if (root && root.dataset) root.dataset.theme = theme
}

/** 换配色：记住它再重画——颜色是 CSS 变量，本来不用重画，但按钮上的图标要跟着翻。 */
function setTheme(next) {
  theme = next === 'light' ? 'light' : 'dark'
  saveTheme(theme)
  applyTheme()
  render()
}

const isSidebar = () => mode === 'sidebar'

function applyMode() {
  const root = document.documentElement
  if (root && root.dataset) root.dataset.mode = mode
  if (document.body && document.body.dataset) document.body.dataset.mode = mode
  applyTheme()
}

/** 换模式：记住它，然后整页重画。切回浏览器模式时把折叠状态清干净。 */
function setMode(next) {
  if (next !== 'sidebar' && next !== 'browser') return
  mode = next
  try {
    window.localStorage.setItem(MODE_KEY, next)
  } catch {
    /* 记不住就这次算数 */
  }
  if (!isSidebar()) ui.open.clear()
  else if (!ui.open.size) ui.open.add('today')
  render()
}

/** 侧栏里只铺开点过的几张；浏览器模式一律全开。 */
function isOpenCard(id) {
  return !isSidebar() || ui.open.has(id)
}

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

function today() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

async function api(path, body) {
  const options =
    body === undefined
      ? {}
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  const res = await fetch(path, options)
  let data = {}
  try {
    data = await res.json()
  } catch {
    /* 空响应就当空对象 */
  }
  if (!res.ok || data.ok === false) {
    throw new Error((data.error && data.error.message) || `HTTP ${res.status}`)
  }
  return data
}

/**
 * 把一个 File 原样 POST 过去。不能走 api()——那是 JSON 体，
 * 而这边要的是整块二进制；文件名靠 x-file-name 头带过去（服务端按最后一段取名字）。
 * 走 fetch 的 body 直接给 File，浏览器自己会边读边发，不会把整个文件摊进内存。
 */
async function uploadFile(file) {
  const res = await fetch('/study/api/material/upload', {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name) },
    body: file,
  })
  let data = {}
  try {
    data = await res.json()
  } catch {
    /* 空响应就当空对象 */
  }
  if (!res.ok || data.ok === false) {
    throw new Error((data.error && data.error.message) || `HTTP ${res.status}`)
  }
  return data
}

/** 往导入日志里追一句（只留最后五句，免得这一栏越滚越长）。 */
function importLog(line) {
  const lines = (ui.importLog || '').split('\n').filter(Boolean)
  lines.push(line)
  ui.importLog = lines.slice(-5).join('\n')
  const el = document.getElementById('import-log')
  if (el) el.textContent = ui.importLog
}

let toastTimer = null
function toast(message, bad = false) {
  const el = document.getElementById('toast')
  el.textContent = message
  el.className = 'toast show' + (bad ? ' bad' : '')
  el.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    el.hidden = true
    el.className = 'toast'
  }, 2600)
}

/**
 * 探一遍新路由在不在。用原生 fetch，不经过 api()——它见到 !ok 就抛，
 * 而这里 404 正是我要的答案。缺参数的探测故意不带参数：新代码回 400，
 * 旧代码回 404，正好分得开。
 */
async function probeCapabilities() {
  const alive = async (path) => {
    try {
      const res = await fetch(path)
      return res.status !== 404
    } catch {
      return false
    }
  }
  const [ability, archive, library, practice, mistakes, review, shelfAlive, toolboxAlive, memoryAlive] = await Promise.all([
    alive('/study/api/ability'),
    alive('/study/api/archive?level=group&key='),
    alive('/study/api/library'),
    alive('/study/practice'),
    alive('/study/api/mistakes'),
    alive('/study/api/review'),
    alive('/study/api/materials'),
    alive('/study/api/toolbox'),
    alive('/study/api/memory'),
  ])
  return {
    ability,
    archive,
    library,
    practice,
    mistakes,
    review,
    shelf: shelfAlive,
    toolbox: toolboxAlive,
    memory: memoryAlive,
    file: await fileAlive(),
  }
}

/**
 * 「打开网课 / 讲义」能不能用。
 * 这条不能照抄上面那招：`/study/file` 只放行**登记过的**材料，空 path 在新旧代码里
 * 一律 404，拿它探等于永远报旧。所以要用一份真登记过的路径去问；
 * 一份材料都没登记时无可开，别误报。
 */
async function fileAlive() {
  const list = (state && state.profile && state.profile.materials) || []
  const hit = list.find((m) => m && m.path)
  if (!hit) return true
  try {
    const res = await fetch('/study/file?path=' + encodeURIComponent(String(hit.path)))
    return res.status !== 404
  } catch {
    return false
  }
}

/** 缺了哪几样。全都在就是 null。 */
function staleMissing() {
  if (!capabilities) return null
  const miss = STALE_NEED.filter(([key]) => !capabilities[key]).map(([, label]) => label)
  return miss.length ? miss : null
}

/** 服务端是旧代码时的横幅：先说清为什么，再给一条能走的路。 */
function staleCard() {
  const miss = staleMissing()
  if (!miss) return ''
  return `<section class="card stale">
    <div><b>服务端还是旧代码</b>：${esc(miss.join('、'))} 这几样点下去会 404。</div>
    <div class="hint">页面内容直接从磁盘读取，因此显示为新版；路由在 DSH 启动时加载，无法热更新。
    重启 DSH 后即可全部恢复。此期间如需使用，请在对话中提出，由教练代为处理。</div>
  </section>`
}

/** 开链接。内嵌浏览器会把 window.open 拦掉，那就原地跳，别让人以为按钮坏了。 */
function openUrl(url) {
  const win = window.open(url, '_blank', 'noopener')
  if (!win) window.location.assign(url)
}

async function load() {
  const app = document.getElementById('app')
  try {
    const [s, m] = await Promise.all([api('/study/api/state'), api('/study/api/summary')])
    state = s.state
    summary = m.summary
    // 探测要用 state 里登记过的材料路径，所以放在它后面
    if (!capabilities) capabilities = await probeCapabilities()
    agenda = await loadAgenda()
    library = await loadLibrary()
    mistakes = await loadMistakes()
    // 复盘图只有「今天」这一页要。其余页不拉，省一趟请求和 9 KB。
    review = page === 'today' ? await loadReview() : null
    // 书架只有「资料」这一页要。
    shelf = page === 'materials' ? await loadShelf() : null
    // 工具栏目只有「工具」这一页要。
    toolbox = page === 'toolbox' ? await loadToolbox() : null
    // 记忆卡只有切到那个小工具时才拉——看番茄钟的时候不白跑一趟。
    memory = page === 'toolbox' && ui.tool === 'memory' ? await loadMemory() : null
    // 对话快照每页都要：右下角那颗悬浮按钮得知道通道通没通。
    // 会话清单要的是「对话页开着」或者「悬浮窗开着」——悬浮窗里也有选择器，
    // 只在对话页拉的话，浮窗切过去就是一个空下拉。
    await loadChat({ withSessions: page === 'coach' || ui.float })
    applyMode()
    app.className = ''
    render()
  } catch (error) {
    app.className = 'loading'
    app.innerHTML = `<div class="card error">读取档案失败：${esc(error.message)}</div>`
  }
}

/**
 * 今天每门课各有什么。走的是汇总接口（`/study/api/tasks?all=1`），
 * 每门课都用自己那张地图算过跳转按钮，前端不用再拼。
 * 只学一门、或者服务端还是旧代码，就返回 null，退回当前的 state.tasks。
 */
async function loadAgenda() {
  const date = today()
  const multi = Array.isArray(state && state.profiles) && state.profiles.length > 1
  if (!multi || !capabilities || !capabilities.library) return null
  try {
    const out = await api('/study/api/tasks?all=1&date=' + date)
    if (!Array.isArray(out.profiles)) return null
    return { date: out.date || date, profiles: out.profiles }
  } catch {
    return null
  }
}

/**
 * 学习目标清单与回收站。回收站只有 `/study/api/library` 这条接口给（state 里没有），
 * 服务端是旧代码、或者这个档案根不支持多档案，就返回 null，卡片只画它能画的那部分。
 */
async function loadLibrary() {
  if (!capabilities || !capabilities.library) return null
  try {
    return await api('/study/api/library')
  } catch {
    return null
  }
}

/**
 * 错题本。挂在知识点证据上的那些 mistake，服务端汇总成一张平表给面板看。
 * 服务端是旧代码（没有这条路由）就返回 null，能力页少画那一段，别让整页挂掉。
 */
async function loadMistakes() {
  if (!capabilities || !capabilities.mistakes) return null
  try {
    const out = await api('/study/api/mistakes?limit=60')
    if (!Array.isArray(out.items)) return null
    return { items: out.items, total: Number(out.total) || out.items.length, byStatus: out.byStatus || {} }
  } catch {
    return null
  }
}

/**
 * 今日复盘图。只有「今天」这一页要，所以别的页不拉——一张图 9 KB，没必要每页都拖。
 * 这一天什么都没动过（服务端回 data: null）时返回 null，卡片自己收起来。
 */
async function loadReview() {
  if (!capabilities || !capabilities.review) return null
  try {
    const out = await api('/study/api/review?date=' + today())
    if (!out || !out.data || !out.svg) return null
    return { date: out.date || today(), data: out.data, svg: String(out.svg) }
  } catch {
    return null
  }
}

/**
 * 书架：登记过的材料 + 每一本拆到哪一步、归了多少页。
 * 只有「资料」页要；服务端是旧代码（没有这条路由）就返回 null。
 */
async function loadShelf() {
  if (!capabilities || !capabilities.shelf) return null
  try {
    const out = await api('/study/api/materials')
    if (!Array.isArray(out.materials)) return null
    return { materials: out.materials, pagesRoot: out.pagesRoot || '' }
  } catch {
    return null
  }
}

/** 摊开某一本时再去拉它的页级索引（区间 + 目录 + 每一页的地址）。 */
async function loadShelfIndex(materialId) {
  shelfIndex = { materialId, loading: true, toc: [], spans: [], pages: [], error: '' }
  try {
    const out = await api('/study/api/material?materialId=' + encodeURIComponent(materialId))
    shelfIndex = {
      materialId,
      loading: false,
      toc: Array.isArray(out.toc) ? out.toc : [],
      spans: Array.isArray(out.spans) ? out.spans : [],
      pages: Array.isArray(out.pages) ? out.pages : [],
      error: '',
    }
  } catch (error) {
    shelfIndex = { materialId, loading: false, toc: [], spans: [], pages: [], error: error.message }
  }
  return shelfIndex
}

/**
 * 工具栏目那一份数据：番茄钟 + 清单。
 *
 * 番茄钟的时间以服务端的 `endsAt` 为准——不是浏览器里数出来的。
 * 所以页面刷新、换设备、DSH 重启，钟都在同一个位置上。
 */
async function loadToolbox() {
  if (!capabilities || !capabilities.toolbox) return null
  try {
    const out = await api('/study/api/toolbox')
    if (!out.focus) return null
    return { focus: out.focus, todos: out.todos || { items: [], total: 0, open: 0, done: 0 } }
  } catch {
    return null
  }
}

/** 清单和番茄钟写完之后都用这个收口：重拉一份，重画。 */
async function refreshToolbox() {
  const next = await loadToolbox()
  if (next) toolbox = next
  render()
}

/**
 * 拉一份记忆卡。
 *
 * 服务端那边 `dueAt` 存的是绝对时刻，所以「现在该背哪几张」是它现算的——
 * 这里只管把 `status` 那一档递过去，不带任何本地倒计时。
 */
async function loadMemory() {
  if (!capabilities || !capabilities.memory) return null
  try {
    const out = await api('/study/api/memory?status=' + encodeURIComponent(ui.cardStatus) + '&limit=200')
    if (!out || !out.stats) return null
    return {
      stats: out.stats,
      soon: out.soon || 0,
      dueTotal: out.dueTotal || 0,
      dueItems: Array.isArray(out.dueItems) ? out.dueItems : [],
      items: Array.isArray(out.items) ? out.items : [],
      total: out.total || 0,
    }
  } catch {
    return null
  }
}

/** 背完一张、加一张、删一张都用这个收口。 */
async function refreshMemory() {
  const next = await loadMemory()
  if (next) memory = next
  render()
}

/** 打一次写接口；失败就把服务端那句中文原样 toast 出来。 */
async function toolPost(path, body) {
  try {
    const out = await api(path, body)
    return { ok: true, out }
  } catch (error) {
    toast(error.message)
    return { ok: false, out: null }
  }
}

/**
 * 读一份对话快照。
 *
 * 走插件自己的 `/study/api/chat`，那一头拿的是 DSH 的 sessionController，
 * 所以画的就是真正的对话，不是另抄一份。服务端是旧代码（没有这条路由）时
 * 回 404，这里收成 `available:false`，对话页只说「未接通」。
 */
async function loadChat({ sessionId = ui.chatSession, withSessions = false } = {}) {
  const query = '?max=60' + (sessionId ? '&sessionId=' + encodeURIComponent(sessionId) : '') + (withSessions ? '&sessions=1' : '')
  try {
    const out = await api('/study/api/chat' + query)
    // 没带 sessions=1 的时候服务端也会给一个空的 sessions，直接收下就把上一次
    // 拉到的清单冲掉了（悬浮窗一关一开就没得选）。空数组一律当「这次没问」处理。
    const listed = Array.isArray(out.sessions) && out.sessions.length ? out.sessions : (chat && chat.sessions) || []
    chat = {
      available: out.available !== false,
      sessionId: out.sessionId || '',
      messages: Array.isArray(out.messages) ? out.messages : [],
      sessions: listed,
      error: out.error || '',
    }
  } catch (error) {
    chat = { available: false, sessionId: '', messages: [], sessions: (chat && chat.sessions) || [], error: error.message }
  }
  return chat
}

/** 消息列表的指纹。轮询时先比这个，没变就不动 DOM（免得把正在打的字、滚到一半的位置冲掉）。 */
function chatFingerprint(snapshot) {
  if (!snapshot) return ''
  const last = snapshot.messages.length ? snapshot.messages[snapshot.messages.length - 1].seq : 0
  return `${snapshot.sessionId}|${snapshot.messages.length}|${last}`
}

/* ── 页面 ─────────────────────────────────────────────────────────────────
 * 一页一件事。主页面不干活，只回答「我现在什么情况、下一步点哪儿」；改地图、勾任务、
 * 换目标这些都在各自子页面里。地址就是真地址（/study/today 这样），服务端把这几条
 * 都发同一份 panel.html，认页的事在下面 resolvePage()。
 */
const PAGES = [
  { id: 'home', path: '/study', label: '主页', hint: '当前进度与下一步' },
  { id: 'today', path: '/study/today', label: '今天', hint: '今日任务，逐条完成' },
  { id: 'map', path: '/study/map', label: '知识地图', hint: '课程全貌，可逐单元自评' },
  { id: 'ability', path: '/study/ability', label: '能力', hint: '总体进度、薄弱环节、待复习' },
  { id: 'library', path: '/study/library', label: '档案', hint: '学习目标、材料、基本工具' },
  { id: 'materials', path: '/study/materials', label: '资料', hint: '登记教辅、拆成页、看每一页归到哪个单元' },
  { id: 'toolbox', path: '/study/toolbox', label: '工具', hint: '番茄钟、清单，还有以后往里加的小工具' },
  { id: 'coach', path: '/study/coach', label: '对话', hint: '直接和教练说话，这一页就是聊天窗口' },
]

let page = resolvePage()

/** 从地址认页；认不出来（或者测试里没有 location）就落主页。 */
/**
 * 换页。
 *
 * 走 pushState 在浏览器里切，不往服务端要一次整页——因为服务端那一半是 DSH 启动时
 * 加载好的：改完 lib/ 没重启，`/study/today` 这种真地址就会回一个 JSON 404，
 * 点一下导航整页跳过去，人看到的就是一屏报错。前端自己切页，旧服务端也照样能用，
 * 地址栏还是真地址（新服务端下刷新、直连都对）。
 */
function go(id, path) {
  if (id !== page) {
    page = id
    openFirstCard(id)
    render()
    try {
      window.scrollTo(0, 0)
    } catch {
      /* 没有 window 就算了 */
    }
  }
  try {
    if (path && window.location.pathname !== path && window.history && window.history.pushState) {
      window.history.pushState(null, '', path)
    }
  } catch {
    /* 地址改不了不影响切页 */
  }
}

function resolvePage() {
  let path = ''
  try {
    path = (window.location && window.location.pathname) || ''
  } catch {
    /* 没有 location 就当主页 */
  }
  const clean = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
  if (clean === '' || clean === '/study') return 'home'
  const hit = PAGES.find((p) => p.path === clean)
  return hit ? hit.id : 'home'
}

/*
 * 每页各放哪几张卡。main 宽、aside 窄，各自一列往下摞——grid 两栏各摞各的，
 * 矮卡不会把高卡顶出一个洞来。
 */
const PAGE_CARDS = {
  today: { main: [['today', '今日任务', tasksCard], ['review', '今日复盘图', reviewCard]] },
  map: { main: [['map', '知识地图', mapCard]] },
  ability: {
    main: [
      ['ability', '总体能力', abilityCard],
      ['mistakes', '错题本', mistakesCard],
    ],
  },
  library: {
    main: [['library', '学习档案', libraryCard], ['materials', '材料', materialsCard]],
    aside: [['goal', '学习目标', goalCard], ['tools', '基本工具', toolsCard]],
  },
  // 资料这一页：主栏是书架，边栏是导入入口。
  materials: {
    main: [['shelf', '书架', shelfCard]],
    aside: [['ai', '让 AI 出题', aiCard], ['import', '导入资料', importCard], ['guide', '教练的指引', guideCard]],
  },
  // 工具这一页：主栏是「二级菜单里选中的那个小工具」，边栏放清单的搭档。
  // 菜单本身不走 PAGE_CARDS——它得横在两栏上面，所以 render() 单独插。
  toolbox: {
    main: [['tool', '小工具', currentToolCard]],
    aside: [['guide', '教练的指引', guideCard]],
  },
  // 对话页不放别的：这一页就是那个聊天窗口，整屏给它。
  coach: { main: [['chat', '与教练对话', chatCard]] },
}

/** 「工具」页主栏那张卡：跟着二级菜单走。 */
function currentToolCard() {
  const t = TOOLS.find((x) => x.id === ui.tool) || TOOLS[0]
  return t.card()
}

/* ── 渲染 ─────────────────────────────────────────────────────────────── */
function render() {
  const app = document.getElementById('app')
  applyMode()
  app.className = ''
  app.innerHTML = `
    ${topBar()}
    ${staleCard()}
    ${page === 'home' ? homePage() : `${page === 'toolbox' ? toolMenu() : ''}${pageCards()}`}
    ${archiveModal()}
    ${floatChat()}
  `
  mountGraph()
  syncChatPolling()
  syncFocusTicker()
}

/* ── 对话轮询 ─────────────────────────────────────────────────────────────
 * 「对话」页要跟着 DSH 那边的进度走，所以开着的时候定时拉一份新快照。
 * 离开这一页、或者标签页被切到后台，就把定时器停掉——不看的时候不该占着。
 * 只在指纹变了的时候重画消息列表，正在输的字和滚到一半的位置都不动。
 */
function stopChatPolling() {
  if (chatTimer) {
    clearInterval(chatTimer)
    chatTimer = null
  }
}

function chatHidden() {
  try {
    return document.visibilityState === 'hidden'
  } catch {
    return false
  }
}

function chatVisible() {
  return page === 'coach' || ui.float
}

function syncChatPolling() {
  // 通道没接通就别空转定时器——那会让页面永远有个活动的 interval 停不下来。
  // 接通之前靠卡片上那颗「重新连接」手动再试一次。
  if (!chatVisible() || chatHidden() || !chat || !chat.available) {
    stopChatPolling()
    return
  }
  if (chatTimer) return
  chatTimer = setInterval(() => {
    void refreshChat()
  }, 2500)
}

async function refreshChat() {
  if (!chatVisible() || chatHidden()) {
    stopChatPolling()
    return
  }
  const before = chatStamp
  await loadChat()
  if (!chatStamp || chatStamp !== before) paintChat()
}

/**
 * 只换消息列表那一块，不整页重画。
 * 整页那个日志和悬浮窗那个日志都挂 `[data-chat-log]`，谁在页面上就填谁。
 */
function paintChat() {
  const snapshot = chat || { messages: [] }
  chatStamp = chatFingerprint(snapshot)
  const hosts = ['chat-log', 'float-log'].map((id) => document.getElementById(id)).filter(Boolean)
  if (!hosts.length) {
    render()
    return
  }
  for (const host of hosts) {
    const stick = host.scrollHeight - host.scrollTop - host.clientHeight < 60
    host.innerHTML = chatLog(snapshot)
    if (stick) host.scrollTop = host.scrollHeight
  }
}

/**
 * 侧栏模式一屏只放得下一张卡，所以进哪一页就把那一页的主卡摊开。
 * 只在换页时做一次——放进 render 里会让折叠按钮按不动。
 */
function openFirstCard(id) {
  if (!isSidebar()) return
  const spec = PAGE_CARDS[id] || PAGE_CARDS.today
  const first = (spec.main || [])[0]
  if (first) ui.open.add(first[0])
}

function pageCards() {
  const spec = PAGE_CARDS[page] || PAGE_CARDS.today
  // 卡片工厂返回空串就是「这一页现在不需要它」（留个口子，省得以后想隐藏卡片时改渲染）。
  const draw = (col) =>
    (spec[col] || [])
      .map(([id, label, make]) => ({ id, label, html: make() }))
      .filter((card) => card.html)
      .map((card) => fold(card.id, card.label, card.html))
      .join('')
  // 对话页要占满一屏（输入框钉在底下），给它一个自己的类名，样式在 style.css 里
  const cls = page === 'coach' ? 'cards chat-page' : 'cards'
  const aside = draw('aside')
  if (isSidebar()) return `<div class="${cls}">${draw('main')}${aside}</div>`
  return `<div class="${cls}${aside ? ' two' : ''}">
    <div class="col main">${draw('main')}</div>
    ${aside ? `<div class="col aside">${aside}</div>` : ''}
  </div>`
}

/**
 * 主页面：一屏之内说清「现在什么水平、今天还剩什么、下一步点哪儿」。
 * 它自己不承担编辑功能——那些都在子页面里，这儿只放入口。
 */
function homePage() {
  const sum = summary || {}
  const day = todayTasks()
  const done = day.filter((t) => t.done).length
  const left = day.length - done
  const modules = (state && state.map && state.map.modules) || []
  const points = modules.reduce((n, m) => n + ((m.points || []).length), 0)
  const total = sum.total || points
  const touched = sum.touched || 0
  const pct = total ? Math.round((touched / total) * 100) : 0
  const goal = (state && state.profile && state.profile.goal) || {}
  const materials = (state && state.profile && state.profile.materials) || []
  const libs = (library && Array.isArray(library.profiles) ? library.profiles : []).filter((p) => !p.error)
  const built = modules.length > 0

  const hour = new Date().getHours()
  const hello = hour < 5 ? '夜深了' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好'
  const lead = !built
    ? '知识地图尚未建立。在对话中提供教辅或网课目录，我会解析并生成初稿。'
    : day.length === 0
      ? '今日暂无任务。可手动添加，或在对话中说明今天可用的时间。'
      : left > 0
        ? `今天还有 ${left} 条未完成。完成后逐条勾选，我会据此安排明天。`
        : '今日任务已全部完成。'

  const stat = (value, label, sub) => `<div class="stat">
      <b>${esc(String(value))}</b>
      <span class="stat-label">${esc(label)}</span>
      ${sub ? `<span class="stat-sub">${esc(sub)}</span>` : ''}
    </div>`

  const entries = [
    { id: 'today', title: '今日任务', hint: '逐条勾选完成情况', count: day.length ? `${done}/${day.length}` : '还没排' },
    { id: 'map', title: '知识地图', hint: '课程全貌，可逐单元自评', count: built ? `${points} 个单元` : '还没画' },
    { id: 'ability', title: '总体能力', hint: '总体数据、薄弱环节、复习安排', count: total ? `碰过 ${pct}%` : '还没数据' },
    { id: 'library', title: '学习档案', hint: '切换目标、登记材料、记录基本工具', count: materials.length ? `${materials.length} 份材料` : `${libs.length || 1} 份档案` },
    { id: 'materials', title: '资料书架', hint: '教辅拆成页图、每一页归到哪个单元', count: materials.length ? `${materials.length} 份` : '还没登记' },
    { id: 'coach', title: '与教练对话', hint: '有疑问、想换材料、时间有变，直接说', count: '' },
  ]

  return `
  <section class="hero">
    <p class="eyebrow">今天 · ${today()}</p>
    <h1>${esc(hello)}</h1>
    <p class="lede">${esc(lead)}</p>
    <div class="hero-actions">
      <a class="btn primary" href="/study/today" data-nav="today">查看今日任务</a>
      <a class="btn" href="/study/map" data-nav="map">${built ? '查看知识地图' : '建立知识地图'}</a>
    </div>
  </section>

  <section class="stats">
    ${stat(day.length ? `${done}/${day.length}` : '—', '今天的任务', day.length ? (left > 0 ? `还剩 ${left} 条` : '已全部完成') : '暂无')}
    ${stat(total || '—', '地图上的单元', modules.length ? `${modules.length} 个模块` : '尚未建立')}
    ${stat(total ? `${pct}%` : '—', '已接触比例', total ? `${touched} / ${total}` : '')}
    ${stat(goal.deadline || '—', '最晚到', goal.subject ? goal.subject : '尚未设定')}
  </section>

  <section class="entries">
    ${entries
      .map(
        (e) => `<a class="entry" href="/study/${e.id}" data-nav="${e.id}">
      <span class="entry-head"><span class="entry-title">${esc(e.title)}</span>${e.count ? `<span class="entry-count">${esc(e.count)}</span>` : ''}</span>
      <span class="entry-hint">${esc(e.hint)}</span>
    </a>`,
      )
      .join('')}
  </section>

  <div class="cards">${fold('guide', '教练的指引', guideCard())}</div>`
}

/** 顶栏：名字 + 页面导航 + 今天做完几条 + 地图状态 + 换配色 + 两种模式来回切。 */
function topBar() {
  const map = (state && state.map) || {}
  const seg = MODES.map(
    (m) => `<button class="seg ${m.id === mode ? 'on' : ''}" data-act="mode" data-mode="${m.id}" title="${esc(m.hint)}">${m.label}</button>`,
  ).join('')
  const nav = PAGES.map(
    (p) =>
      `<a class="nav-item${p.id === page ? ' on' : ''}" href="${p.path}" title="${esc(p.hint)}"${
        p.id === page ? ' aria-current="page"' : ''
      } data-nav="${p.id}">${esc(p.label)}</a>`,
  ).join('')
  const day = todayTasks()
  const done = day.filter((t) => t.done).length
  const progress = day.length ? `<span class="pill ${done === day.length ? '' : 'hot'}">今天 ${done}/${day.length}</span>` : ''
  return `<header class="top">
    <a class="brand" href="/study" data-nav="home">学习教练</a>
    <nav class="nav" aria-label="页面">${nav}</nav>
    <div class="top-right">
      ${progress}
      <span class="dim">${map.status === 'confirmed' ? '地图已定稿' : '地图尚未定稿'}</span>
      <span class="segmented" role="group" aria-label="界面模式">${seg}</span>
      <button class="seg-icon" data-act="theme" title="${theme === 'light' ? '切换为暗色' : '切换为亮色'}" aria-label="切换配色">${theme === 'light' ? '☾' : '☀'}</button>
    </div>
  </header>`
}

/** 顶栏那颗小药丸的数据：今天所有科目加起来做完了几条。 */
function todayTasks() {
  if (agenda && Array.isArray(agenda.profiles)) {
    return agenda.profiles.flatMap((p) => (Array.isArray(p.day) ? p.day : []))
  }
  const days = (state && state.tasks && state.tasks.days) || {}
  return Array.isArray(days[today()]) ? days[today()] : []
}

/**
 * 包一张卡片。
 * 浏览器模式：原样铺开，网格里按 span 排布。
 * 侧栏模式：整张折起来，只留右上角一颗小按钮写着卡名——窄条里能一眼扫完。
 * 折叠按钮放在 .card-body 外面，所以折起来之后它还看得见。
 */
function fold(id, label, html, span = '') {
  if (!html) return ''
  const open = isOpenCard(id)
  const at = html.indexOf('>')
  // 卡片自己的额外类：`<section class="card stale">` → ` stale`
  //
  // 只从 class 属性里取。以前是「砍到第一个 > 再去掉头尾引号」，那套只有
  // `<section class="card xxx">` 这种单个属性的卡才成立：卡片工厂一旦多带一个属性
  // （比如 `<section class="card focus" data-card="focus">`），砍出来的就是
  // ` focus" data-card="focus`，拼进 class 之后变成
  // `<section class="card focus" data-card="focus open" data-card="tool">`
  // ——`open` 掉进了 data-card 里，侧栏那张卡永远折着，点折叠按钮也是拿错误的
  // `dataset.card` 去 toggle。只认 class 里的那段就没这毛病。
  const own = (html.slice(0, at).match(/class="card([^"]*)"/) || ['', ''])[1]
  // open 只在侧栏模式有意义：浏览器模式一律铺开，不带这个类
  const cls = `card${own}${span ? ' ' + span : ''}${isSidebar() && open ? ' open' : ''}`
  const inner = html.slice(at + 1).replace(/<\/section>\s*$/, '')
  if (!isSidebar()) return `<section class="${cls}" data-card="${id}">${inner}</section>`
  return `<button class="fold" data-act="card-toggle" data-card="${id}" aria-expanded="${open}">
      <span class="fold-arrow">${open ? '▾' : '▸'}</span><span class="fold-label">${esc(label)}</span>
    </button>
  <section class="${cls}" data-card="${id}">
    <div class="card-body">${inner}</div>
  </section>`
}

/** 图谱是副产物，画完就完事；列表那份才是自评的操作区。 */
function mountGraph() {
  if (!state) return
  const host = document.getElementById('graph-host')
  if (!host || typeof renderGraph !== 'function') return
  const modules = (state.map && state.map.modules) || []
  if (!modules.length) return
  renderGraph(host, {
    modules,
    mastery: state.mastery || { points: {} },
    stages: STAGES,
    colorOf: (stage) => STAGE_COLOR[stage] || STAGE_COLOR[STAGES[0]],
    openPoint: ui.openPoint,
    onPick: (pointId) => {
      ui.openPoint = ui.openPoint === pointId ? null : pointId
      // 图上的圆点点开之后，下面列表得能看见它——把祖先撑开
      if (ui.openPoint) {
        for (const mod of (state.map && state.map.modules) || []) {
          if (!(mod.points || []).some((p) => p.id === pointId)) continue
          ui.openGroups.add(String(mod.group || '').trim() || '未分类')
          ui.openModules.add(String(mod.id))
        }
      }
      render()
      const head = document.querySelector(`[data-point-head="${pointId}"]`)
      if (head && head.scrollIntoView) head.scrollIntoView({ block: 'center', behavior: 'smooth' })
    },
    onOpen: openMaterial,
  })
}

/** 点「看课」直接开那一节网课；点「做题」进做题页（那儿有页码题号、能让我出题、能自评）。 */
function openMaterial(kind, point) {
  if (kind === 'practice') {
    if (capabilities && !capabilities.practice) return toast('做题页还没上线（服务端是旧代码，重启 DSH）', true)
    openUrl('/study/practice?point=' + encodeURIComponent(point.id))
    return
  }
  const target = String(point.video || '').trim()
  if (target) {
    if (capabilities && !capabilities.file) return toast('打开文件这条路还没上线（服务端是旧代码，重启 DSH）', true)
    const url = /^https?:\/\//i.test(target) ? target : '/study/file?path=' + encodeURIComponent(target)
    openUrl(url)
    return
  }
  const name = `${point.id} ${point.title || ''}`.trim()
  api('/study/api/inbox', { text: `「${name}」这一节尚未关联网课，请帮忙配置。` })
    .then(() => toast('已发送到对话'))
    .catch((err) => toast('发送失败：' + err.message))
}

/** 顶上那句：要么是教练留的，要么是「回对话里说」的兜底提示。 */
function guideCard() {
  const guide = state.guide || {}
  const text = guide.text || BACK_HINT
  const sub = guide.text ? GUIDE_KIND[guide.kind] || '' : ''
  return `<section class="card guide ${guide.text ? 'on' : ''}">
    <div class="guide-text">${esc(text)}</div>
    ${sub ? `<div class="dim">${esc(sub)}</div>` : ''}
  </section>`
}

/** 每一级（大类 / 模块 / 单元）后面都有这么一个小按键，点开是那一级的掌握档案。 */
function archiveBtn(level, key) {
  return `<button class="mini" data-act="archive-open" data-level="${esc(level)}" data-key="${esc(key)}" title="查看该级掌握档案">档案</button>`
}

const LEVEL_NAME = { group: '大类', module: '模块', point: '单元' }

async function openArchive(level, key) {
  if (capabilities && !capabilities.archive) return toast('档案接口还没上线（服务端是旧代码，重启 DSH）', true)
  ui.archive = { level, key, loading: true, data: null, error: null }
  render()
  try {
    const r = await api(`/study/api/archive?level=${encodeURIComponent(level)}&key=${encodeURIComponent(key)}`)
    // 中途用户可能又点了别的，只认最新那次
    if (!ui.archive || ui.archive.key !== key || ui.archive.level !== level) return
    ui.archive = { level, key, loading: false, data: r.archive, error: null }
  } catch (error) {
    if (!ui.archive || ui.archive.key !== key) return
    ui.archive = { level, key, loading: false, data: null, error: error.message }
  }
  render()
}

function archiveModal() {
  const a = ui.archive
  if (!a) return ''
  const head = `<div class="modal-head">
      <b>${esc(LEVEL_NAME[a.level] || '')}掌握档案 · ${esc(a.data ? a.data.title : a.key)}</b>
      <button class="mini" data-act="archive-close">关闭</button>
    </div>`
  let body = '<p class="dim">读取中…</p>'
  if (a.error) body = `<p class="dim">读取失败：${esc(a.error)}</p>`
  else if (a.data) {
    const d = a.data
    const bar = STAGES.filter((st) => (d.byStage[st] || 0) > 0)
      .map((st) => {
        const pct = d.total ? ((d.byStage[st] || 0) / d.total) * 100 : 0
        return `<span class="seg" style="width:${pct}%;background:${STAGE_COLOR[st]}" title="${st} ${d.byStage[st]} 个"></span>`
      })
      .join('')
    const rows = d.points
      .map((p) => {
        const color = STAGE_COLOR[p.stage] || STAGE_COLOR[STAGES[0]]
        return `<li class="${p.stage === '没接触过' ? 'dim' : ''}">
          <span class="dot" style="background:${color}"></span>
          <div style="flex:1">
            <b>${esc(p.title)}</b>
            <span class="dim"> ${esc(p.stage)} · ${p.evidenceCount} 条证据</span>
            ${p.lastAt ? `<div class="dim">最近记录：${esc(p.lastAt)} ${esc(p.lastKind)}${p.lastNote ? ' · ' + esc(p.lastNote) : ''}</div>` : ''}
            ${p.nextReview ? `<div class="dim">下次复习：${esc(p.nextReview)}${p.due ? '（已到期）' : ''}</div>` : ''}
          </div>
          <span class="mini-actions">${archiveBtn('point', p.pointId)}</span>
        </li>`
      })
      .join('')
    const evidence = d.evidence.length
      ? `<ul class="list">${d.evidence
          .map(
            (e) => `<li><span class="tag">${esc(e.kind)}</span><div style="flex:1"><b>${esc(e.pointTitle)}</b>
              <div class="dim">${esc(e.at)}</div>${e.note ? `<div class="dim">${esc(e.note)}</div>` : ''}</div></li>`,
          )
          .join('')}</ul>`
      : '<p class="dim">暂无证据记录。观看课程、完成练习或自评后会自动生成。</p>'
    body = `
      <div class="stats">
        <span><b>${d.progress}%</b> 掌握度</span>
        <span><b>${d.touched}</b>/${d.total} 碰过</span>
        <span>平均把握 <b>${Math.round((d.avgConfidence || 0) * 100)}%</b></span>
        <span>该复习 <b>${d.due.length}</b></span>
      </div>
      <div class="bar">${bar}</div>
      <ul class="list">${rows}</ul>
      <h3 class="sub">最近 ${d.evidence.length} 条证据（共 ${d.evidenceTotal} 条）</h3>
      ${evidence}`
  }
  return `<div class="modal-bg" data-act="archive-close">
    <div class="modal" data-act="modal-keep">
      ${head}
      <div class="modal-body">${body}</div>
    </div>
  </div>`
}

/** 总体能力：横着看所有大类、所有工具，加最近七天的节奏。 */
function abilityCard() {
  const a = state.ability
  if (!a) return ''
  const pct = Math.round(Number(a.overall) || 0)
  const judge = (a.judgement && a.judgement.text) || ''

  const groups = (a.groups || [])
    .map(
      (g) => `<li>
        <span class="gc-name">${esc(g.name)}</span>
        <span class="gc-bar"><i style="width:${Math.round(g.progress)}%"></i></span>
        <span class="gc-pct">${Math.round(g.progress)}%</span>
        <span class="dim">${g.points} 单元${g.weak ? ` · 薄弱 ${g.weak}` : ''}${g.due ? ` · 该复习 ${g.due}` : ''}</span>
        ${archiveBtn('group', g.name)}
      </li>`,
    )
    .join('')

  const weak = (a.weak || [])
    .slice(0, 8)
    .map(
      (w) => `<li>
        <span class="dot" style="background:${STAGE_COLOR[w.stage] || 'var(--stage-1)'}"></span>
        <div style="flex:1"><b>${esc(w.title)}</b> <span class="dim">${esc(w.group)} · ${esc(w.moduleTitle)}</span>
          <div class="dim">${esc(w.reason)}</div></div>
        ${archiveBtn('point', w.pointId)}
      </li>`,
    )
    .join('')

  const due = (a.due || [])
    .slice(0, 8)
    .map(
      (d) => `<li><span class="dot" style="background:${STAGE_COLOR[d.stage] || 'var(--stage-1)'}"></span>
        <div style="flex:1"><b>${esc(d.title)}</b> <span class="dim">${esc(d.stage)} · 该 ${esc(d.nextReview)}</span></div>
        ${archiveBtn('point', d.pointId)}</li>`,
    )
    .join('')

  const days = (a.pace && a.pace.days) || []
  const maxMin = Math.max(1, ...days.map((d) => d.minutesTotal || 0))
  const pace = days
    .map(
      (d) => `<div class="pace-day" title="${d.date}：${d.done}/${d.total} 条，${d.minutesDone}/${d.minutesTotal} 分钟">
        <i style="height:${Math.round(((d.minutesTotal || 0) / maxMin) * 100)}%"><b style="height:${d.minutesTotal ? Math.round(((d.minutesDone || 0) / d.minutesTotal) * 100) : 0}%"></b></i>
        <span>${esc(String(d.date).slice(5))}</span>
      </div>`,
    )
    .join('')

  return `<section class="card ability">
    <div class="card-head">
      <h2>总体能力</h2>
      <span class="dim">${esc(a.today || '')}</span>
    </div>
    <div class="stats">
      <span><b>${pct}%</b> 整体进度</span>
      <span><b>${a.touched}</b>/${a.total} 碰过</span>
      <span>平均把握 <b>${Math.round((a.avgConfidence || 0) * 100)}%</b></span>
      <span>薄弱 <b>${a.weakTotal}</b></span>
      <span>该复习 <b>${a.dueTotal}</b></span>
      ${typeof (a.goal && a.goal.daysLeft) === 'number' ? `<span>离目标 <b>${a.goal.daysLeft}</b> 天</span>` : ''}
    </div>
    <div class="bar"><span class="seg" style="width:${pct}%;background:${STAGE_COLOR['能独立做']}"></span></div>
    ${
      judge
        ? `<div class="judgement"><span class="tag">总评</span><div>${esc(judge)}</div>
            ${a.judgement.level ? `<div class="dim">${esc(a.judgement.level)}</div>` : ''}</div>`
        : `<p class="dim">尚无总评。可在对话中提问「我现在什么水平」，教练会依据以上数据给出评价。</p>`
    }
    <h3 class="sub">各大类</h3>
    <ul class="list tight">${groups || '<li class="dim">尚未分类。在地图中为每个模块填写 group 即可。</li>'}</ul>
    ${
      weak
        ? `<h3 class="sub">薄弱环节（共 ${a.weakTotal} 个）</h3><ul class="list tight">${weak}</ul>`
        : '<p class="dim">暂无明显薄弱环节。</p>'
    }
    ${due ? `<h3 class="sub">待复习（共 ${a.dueTotal} 个）</h3><ul class="list tight">${due}</ul>` : ''}
    <h3 class="sub">最近七天</h3>
    <div class="pace">${pace}</div>
    <p class="dim">完成 ${a.pace.done}/${a.pace.total} 条 · ${a.pace.minutesDone}/${a.pace.minutesTotal} 分钟（${a.pace.completion}%）</p>
  </section>`
}

/**
 * 错题本：他做错过的题、错在哪一步、错因、订正、该哪天复做。
 * 学生在这儿只能看和喊教练——记和改都是教练的活儿（study_record 的 mistake）。
 */
function mistakesCard() {
  const book = mistakes
  if (!book || !book.items.length) return ''
  const by = book.byStatus || {}
  const filter = ui.mistakeStatus
  const shown = filter ? book.items.filter((m) => m.status === filter) : book.items
  const MS_CLASS = { 待验证: 'ms-todo', 已订正: 'ms-fixed', 已复做对: 'ms-done' }

  const chips = ['']
    .concat(MISTAKE_STATUS)
    .map((s) => {
      const n = s ? by[s] || 0 : book.total
      const on = filter === s ? ' on' : ''
      return `<button class="mini${on}" data-act="mistake-filter" data-status="${esc(s)}">${s || '全部'} ${n}</button>`
    })
    .join(' ')

  const rows = shown
    .map((m) => {
      const cls = MS_CLASS[m.status] || 'ms-todo'
      const why = [
        m.step ? `错步：${esc(m.step)}` : '',
        m.cause ? `错因：${esc(m.cause)}` : '',
        m.fix ? `订正：${esc(m.fix)}` : '',
        m.redoAt ? `复做：${esc(m.redoAt)}` : '',
      ]
        .filter(Boolean)
        .map((line) => `<div class="dim">${line}</div>`)
        .join('')
      return `<li>
        <span class="stage-tag ${cls}">${esc(m.status)}</span>
        <div style="flex:1;min-width:0">
          <b>${esc(m.pointTitle || m.pointId)}</b>
          <span class="dim">${esc(m.group || '')} · ${esc(m.origin || '')}</span>
          ${why}
        </div>
        <button class="mini" data-act="mistake-ask" data-point="${esc(m.pointId)}" data-origin="${esc(m.origin || '')}" title="把这道题交给教练再看一遍">再练</button>
      </li>`
    })
    .join('')

  return `<section class="card mistakes">
    <div class="card-head">
      <h2>错题本</h2>
      <span class="dim">共 ${book.total} 条 · 待验证 ${by['待验证'] || 0}</span>
    </div>
    <div class="chips">${chips}</div>
    ${shown.length ? `<ul class="list tight">${rows}</ul>` : '<p class="dim">这一档暂时没有。</p>'}
    <p class="dim">在做题页点「这题做错了」就能记一条。错因和订正没写清之前，这条会一直挂在「待验证」。</p>
  </section>`
}

/** 我建过的学习目标：能看、能切、能改名、能删掉。 */
function libraryCard() {
  const list = state.profiles
  if (!Array.isArray(list) || list.length === 0) return ''
  const rows = list
    .map((p) => {
      const pct = Math.round(Number(p.progress) || 0)
      if (ui.renameId === p.id) {
        return `<li><form class="inline-form" data-form="lib-rename" data-id="${esc(p.id)}">
            <input name="title" value="${esc(p.title)}" placeholder="新的名称">
            <button type="submit" class="primary mini">保存</button>
            <button type="button" class="mini" data-act="lib-cancel">取消</button>
          </form></li>`
      }
      if (ui.pendingDropProfile === p.id) {
        return `<li class="confirming"><div style="flex:1">
              <b>${esc(p.title)}</b>
              <div class="dim over">连同 ${p.modules} 模块 / ${p.points} 单元一起挪进回收站，之后还能捞回来。</div>
            </div>
            <span class="mini-actions">
              <button class="mini danger" data-act="lib-drop" data-id="${esc(p.id)}">确认删除</button>
              <button class="mini" data-act="lib-cancel">取消</button>
            </span></li>`
      }
      return `<li class="${p.active ? 'active' : ''}">
        <div style="flex:1">
          <b>${esc(p.title)}</b>${p.active ? ' <span class="tag">在用</span>' : ''}
          <div class="dim">${esc(p.subject || '未填写科目')} · ${p.modules} 模块 / ${p.points} 单元 · ${pct}%</div>
        </div>
        <span class="gc-bar"><i style="width:${pct}%"></i></span>
        <span class="mini-actions">
          ${p.active ? '' : `<button class="mini" data-act="lib-select" data-id="${esc(p.id)}">切换</button>`}
          <button class="mini" data-act="lib-rename" data-id="${esc(p.id)}">改名</button>
          <button class="mini" data-act="lib-remove" data-id="${esc(p.id)}">删除</button>
        </span>
      </li>`
    })
    .join('')

  const form = ui.newProfile
    ? `<form class="form" data-form="lib-new">
        <label>名字<input name="title" placeholder="例如：高等数学（上册）" required></label>
        <div class="two">
          <label>科目<input name="subject" placeholder="课程名称"></label>
          <label>每天多久（分钟）<input name="minutesPerDay" type="number" min="0" placeholder="60"></label>
        </div>
        <label>目标程度<textarea name="outcome" rows="2" placeholder="用自己的话描述"></textarea></label>
        <label>截止日期<input name="deadline" placeholder="YYYY-MM-DD"></label>
        <div class="row">
          <button type="submit" class="primary">创建并切换</button>
          <button type="button" class="mini" data-act="lib-cancel">取消</button>
        </div>
      </form>`
    : `<button class="ghost" data-act="lib-new">新建一个学习目标</button>`

  const root = state.libraryRoot || state.root || ''
  const where = root
    ? `<p class="path">档案保存在本机 ${esc(root)}。插件本身只有代码，学习目标、知识地图、掌握度与任务均为该目录下的数据。</p>`
    : ''

  /* 回收站：删掉的学习目标在这儿躺着，能一件件捞回来。
     「新建」会顺手切到新档案，跟「删掉」挨着，误点两下就能把一整份挪走——所以这个口子必须给。 */
  const bin = (library && Array.isArray(library.trash) ? library.trash : []).filter((t) => !t.error)
  const binBlock = bin.length
    ? `<h3 class="sub">回收站（${bin.length}）</h3>
      <ul class="list tight">${bin
        .map(
          (t) => `<li>
            <div style="flex:1">
              <b>${esc(t.title || t.id)}</b>
              <div class="dim">${esc(t.subject || '未填写科目')} · ${t.modules} 模块 / ${t.points} 单元${t.at ? ' · ' + esc(String(t.at).slice(0, 10)) + ' 删除于' : ''}</div>
            </div>
            <button class="mini" data-act="trash-restore" data-entry="${esc(t.entry)}">恢复</button>
          </li>`,
        )
        .join('')}</ul>`
    : ''

  return `<section class="card">
    <div class="card-head"><h2>学习档案</h2><span class="dim">一个目标一份档案</span></div>
    <p class="dim">切换或删除学习目标均在此处。删除为移入回收站，可恢复；最后一个档案不可删除。</p>
    <ul class="list">${rows}</ul>
    ${binBlock}
    ${where}
    ${form}
  </section>`
}


/** 学习目标。主路径是对话，这儿只在你要动手改的时候兜一下。 */
function goalCard() {
  const g = (state.profile && state.profile.goal) || {}
  const empty = '<span class="dim">未设定</span>'
  const form = ui.editGoal
    ? `<form class="form" data-form="goal">
        <label>学什么<input name="subject" value="${esc(g.subject)}" placeholder="课程名称"></label>
        <label>到什么程度<textarea name="outcome" rows="2" placeholder="用自己的话描述">${esc(g.outcome)}</textarea></label>
        <div class="two">
          <label>每天多久（分钟）<input name="minutesPerDay" type="number" min="0" value="${esc(g.minutesPerDay || '')}"></label>
          <label>最晚哪天<input name="deadline" value="${esc(g.deadline)}" placeholder="YYYY-MM-DD"></label>
        </div>
        <div class="row">
          <button type="submit" class="primary">保存</button>
          <button type="button" class="mini" data-act="goal-cancel">取消</button>
        </div>
      </form>`
    : ''
  return `<section class="card">
    <div class="card-head">
      <h2>学习目标</h2>
      ${ui.editGoal ? '' : '<button class="mini" data-act="goal-edit">改</button>'}
    </div>
    <div class="goal">
      <div class="goal-line"><span class="k">科目</span><span class="v">${esc(g.subject) || empty}</span></div>
      <div class="goal-line"><span class="k">目标程度</span><span class="v">${esc(g.outcome) || empty}</span></div>
      <div class="goal-line"><span class="k">每日时长</span><span class="v">${g.minutesPerDay ? esc(g.minutesPerDay) + ' 分钟' : empty}</span></div>
      <div class="goal-line"><span class="k">截止日期</span><span class="v">${esc(g.deadline) || empty}</span></div>
    </div>
    ${g.note ? `<p class="dim">${esc(g.note)}</p>` : ''}
    ${form}
  </section>`
}

function mapCard() {
  const map = state.map || {}
  const modules = Array.isArray(map.modules) ? map.modules : []
  const s = summary || { total: 0, byStage: {}, touched: 0, avgConfidence: 0 }

  if (modules.length === 0) {
    return `<section class="card">
      <div class="card-head"><h2>知识地图</h2></div>
      <p class="dim">尚未建立知识地图。在对话中提供教辅与网课目录，解析后会生成草稿。</p>
    </section>`
  }

  const bar = STAGES.filter((st) => (s.byStage[st] || 0) > 0)
    .map((st) => {
      const pct = s.total ? ((s.byStage[st] || 0) / s.total) * 100 : 0
      return `<span class="seg" style="width:${pct}%;background:${STAGE_COLOR[st]}" title="${st} ${s.byStage[st]} 个"></span>`
    })
    .join('')

  return `<section class="card">
    <div class="card-head">
      <h2>知识地图</h2>
      <span class="badge ${map.status === 'confirmed' ? 'confirmed' : ''}">${map.status === 'confirmed' ? '已定稿' : '草稿'}</span>
      ${map.status === 'confirmed' ? '' : '<button class="ghost" data-act="map-confirm">确认定稿</button>'}
    </div>
    <div class="bar">${bar}</div>
    <p class="dim">共 ${s.total} 个知识点，已接触 ${s.touched} 个，平均把握 ${Math.round((s.avgConfidence || 0) * 100)}%。图谱分三层：大类、模块、最小单元，逐层展开；画布可拖动与缩放。每个单元设「看课」「做题」两个入口。下方列表按大类折叠，逐层展开后显示掌握度。</p>
    <div class="graph-host" id="graph-host"></div>
    ${groupedBlocks(modules)}
  </section>`
}

/** 列表跟图一样折三层：大类带百分比，点开是模块（也带百分比），再点开才是最小单元。 */
function groupedBlocks(modules) {
  const progress = (state.progress && state.progress) || { groups: {}, modules: {} }
  const buckets = new Map()
  for (const mod of modules) {
    const name = String(mod.group || '').trim() || '未分类'
    if (!buckets.has(name)) buckets.set(name, [])
    buckets.get(name).push(mod)
  }
  return [...buckets.entries()]
    .map(([name, mods]) => {
      const open = ui.openGroups.has(name)
      const pct = Math.round(Number((progress.groups && progress.groups[name]) || 0))
      return `<div class="group-head ${open ? 'open' : ''}" data-act="group-open" data-group="${esc(name)}">
          <span class="gc-caret">${open ? '▾' : '▸'}</span>
          <span class="gc-name">${esc(name)}</span>
          <span class="gc-bar"><i style="width:${pct}%"></i></span>
          <span class="gc-pct">${pct}%</span>
          <span class="dim">${mods.length} 个模块</span>
          ${archiveBtn('group', name)}
        </div>
        ${open ? mods.map(moduleBlock).join('') : ''}`
    })
    .join('')
}

function moduleBlock(mod) {
  const points = Array.isArray(mod.points) ? mod.points : []
  const id = String(mod.id)
  const open = ui.openModules.has(id)
  const pct = Math.round(Number((state.progress && state.progress.modules && state.progress.modules[id]) || 0))
  return `<div class="module ${open ? 'open' : ''}">
    <div class="module-head" data-act="module-open" data-module="${esc(id)}">
      <span class="gc-caret">${open ? '▾' : '▸'}</span>
      <b>${esc(mod.title)}</b>
      <span class="gc-bar"><i style="width:${pct}%"></i></span>
      <span class="gc-pct">${pct}%</span>
      <span class="dim">${esc(id)}</span>
      ${archiveBtn('module', id)}
    </div>
    ${mod.summary ? `<p class="dim">${esc(mod.summary)}</p>` : ''}
    ${open ? `<ul class="points">${points.map(pointRow).join('')}</ul>` : ''}
  </div>`
}

function pointRow(p) {
  const rec = (state.mastery && state.mastery.points && state.mastery.points[p.id]) || null
  const stage = rec && STAGES.includes(rec.stage) ? rec.stage : '没接触过'
  const open = ui.openPoint === p.id
  const evidence = rec && Array.isArray(rec.evidence) ? rec.evidence.length : 0

  return `<li class="point ${open ? 'open' : ''}">
    <div class="point-head" data-act="point-open" data-point="${esc(p.id)}" data-point-head="${esc(p.id)}">
      <span class="dot" style="background:${STAGE_COLOR[stage]}" title="${stage}"></span>
      <b>${esc(p.title)}</b>
      ${evidence ? `<span class="dim">${evidence} 条证据</span>` : ''}
      <span class="stage-tag" style="color:${STAGE_COLOR[stage]}">${stage}</span>
      ${archiveBtn('point', p.id)}
    </div>
    ${
      open
        ? `<div class="rate">
            <div class="stages">${STAGES.map(
              (x) =>
                `<button class="stage-btn ${x === stage ? 'on' : ''}" style="--c:${STAGE_COLOR[x]}" data-act="rate" data-point="${esc(p.id)}" data-stage="${x}">${x}</button>`,
            ).join('')}</div>
            <input class="note-input" data-note-for="${esc(p.id)}" placeholder="依据：日期、材料、具体表现（选填）">
            ${p.why ? `<p class="dim">学习目的：${esc(p.why)}</p>` : ''}
            ${p.source ? `<p class="dim">来源：${esc(p.source)}</p>` : ''}
            ${rec && rec.nextReview ? `<p class="dim">下次复习：${esc(rec.nextReview)}</p>` : ''}
          </div>`
        : ''
    }
  </li>`
}

/** 今天要干什么。每条都能直接跳过去，也能改、能删。 */
/** 当前在用哪个档案（合并视图里「全部」时用它当默认值）。 */
function activeProfileId() {
  const list = Array.isArray(state && state.profiles) ? state.profiles : []
  const hit = list.find((p) => p.active)
  return hit ? hit.id : ''
}

/**
 * 今天按科目分组。
 * 有汇总接口（多门课）就用它，每门课的跳转按钮服务端已经按自己那张地图算好了；
 * 只有一门课、或者服务端还是旧代码，就退回当前档案的 state.tasks。
 */
function taskGroups() {
  const date = today()
  if (agenda && agenda.date === date && Array.isArray(agenda.profiles)) {
    return agenda.profiles.map((p) => ({
      id: String(p.id || ''),
      title: String(p.title || ''),
      subject: String(p.subject || ''),
      active: Boolean(p.active),
      progress: Number(p.progress) || 0,
      day: Array.isArray(p.day) ? p.day : [],
    }))
  }
  const days = (state && state.tasks && state.tasks.days) || {}
  const day = Array.isArray(days[date]) ? days[date] : []
  const list = Array.isArray(state && state.profiles) ? state.profiles : []
  const me = list.find((p) => p.active) || {}
  return [
    {
      id: activeProfileId(),
      title: String(me.title || (state && state.profile && state.profile.goal && state.profile.goal.subject) || '在学的'),
      subject: String(me.subject || ''),
      active: true,
      progress: Number(me.progress) || 0,
      day: day.map((t) => taskView(t)),
    },
  ]
}

/** 一条任务：勾、改、删、跳转。profileId 是它属于哪门课——列在一起时不能认错门。 */
function taskRow(t, profileId, showSubject) {
  const links = (t.links || [])
    .filter((l) => l && l.url)
    .map((l) => `<a class="open-link ${l.kind === 'point' ? 'alt' : ''}" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`)
    .join('')
  if (ui.editTask === t.id) {
    return `<li class="editing"><form class="inline-form" data-form="task-edit" data-id="${esc(t.id)}" data-profile="${esc(profileId)}">
        <input name="title" value="${esc(t.title)}" placeholder="任务内容">
        <select name="kind">${Object.keys(TASK_KIND)
          .map((k) => `<option value="${k}" ${k === t.kind ? 'selected' : ''}>${TASK_KIND[k]}</option>`)
          .join('')}</select>
        <input name="minutes" type="number" min="0" value="${esc(t.minutes || 0)}" title="分钟">
        <button type="submit" class="primary mini">保存</button>
        <button type="button" class="mini" data-act="task-cancel">取消</button>
      </form></li>`
  }
  const confirmDel =
    ui.pendingDel === t.id
      ? `<button class="mini danger" data-act="task-del" data-id="${esc(t.id)}" data-profile="${esc(profileId)}">确认删除</button>
         <button class="mini" data-act="task-cancel">取消</button>`
      : `<button class="mini" data-act="task-edit" data-id="${esc(t.id)}" data-profile="${esc(profileId)}">改</button>
         <button class="mini" data-act="task-remove" data-id="${esc(t.id)}" data-profile="${esc(profileId)}">删除</button>`
  return `<li class="${t.done ? 'done' : ''}">
    <label class="check"><input type="checkbox" data-act="task-toggle" data-id="${esc(t.id)}" data-profile="${esc(profileId)}" ${t.done ? 'checked' : ''}><span>${esc(t.title)}</span></label>
    <span class="dim">${showSubject ? `<span class="tag">${esc(showSubject)}</span> ` : ''}${TASK_KIND[t.kind] || esc(t.kind || '')}${t.minutes ? ' · ' + t.minutes + ' 分' : ''}${t.pointTitle ? ' · ' + esc(t.pointTitle) : ''}</span>
    ${t.note ? `<div class="dim">${esc(t.note)}</div>` : ''}
    <span class="task-actions">${links}${confirmDel}</span>
  </li>`
}

/** 加任务的表单。多门课的时候能直接指定排给哪一门，不用先切过去。 */
function taskAddForm(groups) {
  if (!ui.newTask) {
    return `<button class="ghost" data-act="task-new">＋ 新建任务</button>`
  }
  const pick = groups.length > 1
    ? `<label>指派给<select name="profileId">${groups
        .map((g) => `<option value="${esc(g.id)}" ${g.id === activeProfileId() ? 'selected' : ''}>${esc(g.title)}</option>`)
        .join('')}</select></label>`
    : ''
  return `<form class="form" data-form="task-add">
    <label>任务内容<input name="title" placeholder="例如：看第 3 讲，做课后 1-5 题" required></label>
    <div class="two">
      ${pick}
      <label>类型<select name="kind">${Object.keys(TASK_KIND)
        .map((k) => `<option value="${k}" ${k === 'watch' ? 'selected' : ''}>${TASK_KIND[k]}</option>`)
        .join('')}</select></label>
    </div>
    <div class="two">
      <label>分钟<input name="minutes" type="number" min="0" step="5" placeholder="30"></label>
      <label>知识点（可不填）<input name="target" placeholder="例如 M1.4"></label>
    </div>
    <label>要打开的文件 / 链接（可不填）<input name="open" placeholder="F:\\…\\讲义.pdf"></label>
    <div class="row">
      <button type="submit" class="primary">添加</button>
      <button type="button" class="mini" data-act="task-cancel">取消</button>
    </div>
  </form>`
}

function tasksCard() {
  const date = today()
  const groups = taskGroups()
  const multi = groups.length > 1
  const shown = ui.filter ? groups.filter((g) => g.id === ui.filter) : groups
  const all = shown.flatMap((g) => g.day.map((t) => ({ t, g })))
  const views = all.map((x) => x.t)
  const total = views.reduce((n, t) => n + (t.minutes || 0), 0)
  const done = views.filter((t) => t.done).length
  const budget = Number((state.profile && state.profile.goal && state.profile.goal.minutesPerDay) || 0)
  const over = budget > 0 && total > budget

  const chips = multi
    ? `<div class="chips"><button class="chip ${ui.filter ? '' : 'on'}" data-act="task-filter" data-profile="">全部 ${groups.reduce((n, g) => n + g.day.length, 0)} 条</button>${groups
        .map(
          (g) =>
            `<button class="chip ${ui.filter === g.id ? 'on' : ''}" data-act="task-filter" data-profile="${esc(g.id)}">${esc(g.title)} ${g.day.filter((t) => !t.done).length}</button>`,
        )
        .join('')}</div>`
    : ''

  const body = shown
    .map((g) => {
      const rows = g.day.map((t) => taskRow(t, g.id, multi && !ui.filter)).join('')
      const head = multi
        ? `<div class="group-line">
             <b>${esc(g.title)}</b>${g.active ? ' <span class="tag">在用</span>' : ''}
             <span class="gc-bar sm"><i style="width:${Math.round(g.progress)}%"></i></span>
             <span class="dim">${g.day.filter((t) => t.done).length}/${g.day.length}</span>
           </div>`
        : ''
      const empty = `<p class="dim">该课程今日无任务。</p>`
      return `${head}${rows ? `<ul class="list tasks">${rows}</ul>` : empty}`
    })
    .join('')

  return `<section class="card">
    <div class="card-head"><h2>今天 · ${date}</h2>${
      views.length ? `<span class="dim ${over ? 'over' : ''}">完成 ${done}/${views.length} · ${total} 分钟${budget ? ' / ' + budget : ''}</span>` : ''
    }</div>
    ${chips}
    ${views.length || multi ? body : '<p class="dim">今日暂无任务。可手动添加，或在对话中说明。</p>'}
    ${taskAddForm(groups)}
  </section>`
}

/**
 * 今日复盘图。版式照 good-learning-skill（MIT）的 render_summary_map.py 搬过来，
 * 但那头是 Python + Pillow 画 PNG，这边是服务端现拼 SVG 字符串——一个「装完就能用」
 * 的插件不该因为想画张图就要求对方机器上有 Python。面板只负责把图摆进来、给颗下载。
 *
 * 这一天一个单元都没动过就不画：空白的一天硬凑一张图只会更难看。
 * 图里全是短句（版式没有自动换行，服务端已经按字号裁过），细节仍以下面几张卡为准。
 */
function reviewCard() {
  if (!review || !review.svg) return ''
  const data = review.data || {}
  const branches = Array.isArray(data.branches) ? data.branches : []
  const wrong = Number(data.error_count) || 0
  return `<section class="card review">
    <div class="card-head">
      <h2>今日复盘图</h2>
      <button class="mini" data-act="review-save">下载 SVG</button>
    </div>
    <p class="dim">${branches.length} 个单元${wrong ? ` · 其中 ${wrong} 个带错题` : ''} · 颜色是大类，红点是当天记的错题</p>
    <div class="review-stage">${review.svg}</div>
    <p class="dim">这张图是拿今天记下的证据和错题现算的，只放得下短句；要看细节，翻上面的今日任务，或去「能力」页看错题本。</p>
  </section>`
}

/**
 * 任务在图谱那份归档里是原始形状，这儿补上跳转按钮和知识点标题。
 * 跟服务端 taskView 算法一样，前端只为了少一趟请求。
 */
function taskView(t) {
  const modules = (state.map && state.map.modules) || []
  let point = null
  let owner = null
  for (const mod of modules) {
    const hit = (mod.points || []).find((p) => p.id === t.target)
    if (hit) {
      point = hit
      owner = mod
      break
    }
  }
  const links = []
  const addLink = (kind, label, raw) => {
    const value = String(raw || '').trim()
    if (!value) return
    links.push({ kind, label, url: /^https?:\/\//i.test(value) ? value : '/study/file?path=' + encodeURIComponent(value) })
  }
  const watching = String(t.kind || '') === 'watch'
  // 看课为主线：先看，再去做练习。顺序反了学生一点就跳过课直接做题。
  if (watching) addLink('video', '观看本节网课', point && point.video)
  if (t.open) addLink('open', '打开', t.open)
  if (point) {
    if (!watching) addLink('video', '观看本节网课', point.video)
    addLink('practice', '本节讲义', point.practice)
    links.push({
      kind: 'point',
      label: watching ? '看完后做题' : '做题 / 查看掌握度',
      url: '/study/practice?point=' + encodeURIComponent(point.id),
    })
  }
  return {
    id: String(t.id),
    title: String(t.title || ''),
    kind: String(t.kind || ''),
    minutes: Number(t.minutes) || 0,
    done: Boolean(t.done),
    note: String(t.note || ''),
    pointTitle: point ? String(point.title || '') : '',
    group: owner ? String(owner.group || '').trim() : '',
    links,
  }
}

function materialsCard() {
  const list = (state.profile && state.profile.materials) || []
  const long = list.some((m) => (m.note || '').length > 80)
  const items = list.length
    ? `<ul class="list">${list
        .map(
          (m) => `<li>
            <span class="tag">${KIND[m.kind] || '其他'}</span>
            <div class="mat-main">
              <b>${esc(m.title)}</b>
              ${m.note ? `<p class="dim mat-note ${ui.matMore ? 'open' : ''}">${esc(m.note)}</p>` : ''}
              ${m.path ? `<div class="path">${esc(m.path)}</div>` : ''}
            </div>
          </li>`,
        )
        .join('')}</ul>`
    : '<p class="dim">暂无材料。教辅、网课目录、真题可在对话中登记。</p>'

  // 说明太长就压三行，想看全文再点开——不然这一张卡能铺满整屏
  const more = long ? `<button class="mini" data-act="mat-more">${ui.matMore ? '收起说明' : '展开说明'}</button>` : ''

  return `<section class="card">
    <div class="card-head"><h2>材料</h2><span class="dim">在对话中登记</span>${more}</div>
    ${items}
  </section>`
}

/* ── 资料页（书架 + 导入） ────────────────────────────────────────────────
 * 一本教辅在这页上有两条进度：**拆到第几页**（PDF → 编号 PNG，`p0007.png` 对应物理第 7 页）
 * 和**归了多少页**（每一页归到知识地图的哪个单元）。前者是机器干的活，后者是教练读完目录、
 * 看过页面之后写进去的。两者都到位，做题页才能说「M1.4 在教辅 A 是第 12—17 页」。
 */
const PAGE_KIND_LABEL = { 讲解: '讲', 例题: '例', 习题: '练', 目录: '目', 答案: '答', 其他: '他' }

function shelfState(s) {
  // AI 出的卷子没有本机文件、也没有页图，别按「原件不在了」报错。
  if (s.kind === 'ai') return { text: 'AI 出的卷', cls: '' }
  if (!s.file) return { text: '原件不在了', cls: 'bad' }
  if (s.rendering) return { text: `正在拆 ${s.rendered}/${s.total || '?'}`, cls: 'hot' }
  if (!s.total) return { text: '还没拆', cls: '' }
  if (s.rendered < s.total) return { text: `拆了一半 ${s.rendered}/${s.total}`, cls: 'hot' }
  return { text: `拆完了 ${s.rendered} 页`, cls: 'ok' }
}

function shelfPages(s) {
  if (!s.indexed) return '<p class="dim">还没归类。让教练读完目录、看过页面之后把每一页归到单元上。</p>'
  const gaps = s.total && s.indexed < s.total ? `，还有 ${s.total - s.indexed} 页没归` : ''
  return `<p class="dim">归了 ${s.indexed} 页，覆盖 ${s.points.length} 个单元${gaps}。</p>`
}

function shelfDetail(s) {
  if (shelfIndex && shelfIndex.materialId !== s.materialId) return ''
  const idx = shelfIndex
  if (!idx || idx.loading) return '<p class="dim">读取中…</p>'
  if (idx.error) return `<p class="dim bad">读不出来：${esc(idx.error)}</p>`

  // 一段一段：左边「12—17 页 · 练 · M1.4」，右边每一页一颗能点开的按钮。
  const spans = idx.spans.length
    ? idx.spans
        .map((sp) => {
          const pages = []
          for (let p = Number(sp.from); p <= Number(sp.to); p += 1) {
            const hit = idx.pages.find((x) => Number(x.page) === p)
            const label = `${p}`
            pages.push(
              hit && hit.url
                ? `<a class="pg-btn" href="${esc(hit.url)}" target="_blank" rel="noopener">${label}</a>`
                : `<span class="pg-btn off" title="这一页还没拆出来">${label}</span>`,
            )
          }
          const range = Number(sp.from) === Number(sp.to) ? `${sp.from}` : `${sp.from}—${sp.to}`
          return `<li>
            <span class="tag">${esc(PAGE_KIND_LABEL[sp.kind] || '他')}</span>
            <div class="mat-main">
              <b>${esc(sp.pointId || '没归到单元')} <span class="dim">· ${range} 页 · ${esc(sp.kind || '其他')}</span></b>
              ${sp.note ? `<div class="path">${esc(sp.note)}</div>` : ''}
              <div class="pg-row">${pages.join('')}</div>
            </div>
          </li>`
        })
        .join('')
    : '<li><p class="dim">还没有页级索引：教练要先拆图、读目录，再把每一页归到单元上。</p></li>'

  const toc = idx.toc.length
    ? `<h3 class="sub">目录（${idx.toc.length} 条）</h3><ul class="list tight">${idx.toc
        .map(
          (t) => `<li><span class="dim">${esc(String(t.page))}</span><b style="margin-left:6px">${esc(t.title || '')}</b></li>`,
        )
        .join('')}</ul>`
    : '<p class="dim">这本书没有书签，目录得靠看图抄——教练渲染前几页读出来的那份会记在这儿。</p>'

  return `${shelfPages(s)}${spans ? `<ul class="list tight">${spans}</ul>` : ''}${toc}`
}

/** 书架上的一行。教辅是「拆页 + 归类」两份进度，AI 出的卷子没有页码，只有「打开」和「去做」。 */
function renderShelfRow(s) {
  const open = shelfOpen === s.materialId
  const st = shelfState(s)
  const pct = s.total ? Math.min(100, Math.round((s.rendered / s.total) * 100)) : 0
  const isAi = s.kind === 'ai'
  const meta = isAi
    ? [
        s.points.length ? `覆盖 ${s.points.join('、')}` : '还没归到单元',
        s.chapters ? `${s.chapters} 份卷` : '',
        s.indexed ? `${s.indexed} 题有索引` : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : [
        s.total ? `${s.total} 页` : '',
        s.scanned ? '扫描件' : '有文字层',
        s.points.length ? `${s.points.length} 个单元` : '',
        s.chapters ? `${s.chapters} 章有页码` : '',
      ]
        .filter(Boolean)
        .join(' · ')
  const acts = isAi
    ? `<div class="row-acts">
        ${
          s.file
            ? `<a class="mini" href="/study/file?path=${encodeURIComponent(s.path)}" target="_blank" rel="noopener">打开这份卷</a>`
            : '<span class="dim">正文文件不在了</span>'
        }
        ${
          s.points.length
            ? s.points
                .map((p) => `<a class="mini" href="/study/practice?point=${encodeURIComponent(p)}" data-nav="practice">按 ${esc(p)} 做题</a>`)
                .join('')
            : ''
        }
      </div>`
    : `<div class="row-acts">
        <button class="mini" data-act="shelf-toggle" data-id="${esc(s.materialId)}">${open ? '收起归类' : '看页级归类'}</button>
        ${
          s.rendering
            ? '<span class="dim">拆图中，过一会儿刷新看看</span>'
            : `<button class="mini" data-act="shelf-build" data-id="${esc(s.materialId)}">${
                !s.rendered ? '拆成页图' : s.rendered < s.total ? '继续拆' : '重新拆一遍'
              }</button>`
        }
      </div>`
  return `<li class="shelf-row${open ? ' open' : ''}${isAi ? ' ai' : ''}">
    <div class="shelf-head">
      <span class="tag">${esc(KIND[s.kind] || '其他')}</span>
      <div class="mat-main">
        <b>${esc(s.title)}</b>
        <div class="dim">${esc(meta)}</div>
        ${s.path ? `<div class="path">${esc(s.path)}</div>` : ''}
      </div>
      <span class="stage-tag ${st.cls}">${esc(st.text)}</span>
    </div>
    ${!isAi && s.total ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}
    ${acts}
    ${open && !isAi ? `<div class="shelf-body">${shelfDetail(s)}</div>` : ''}
  </li>`
}

function shelfCard() {
  if (!shelf) {
    return `<section class="card">
      <div class="card-head"><h2>书架</h2></div>
      <p class="dim">服务端还是旧代码，这条读不出来。重启 DSH 之后再看。</p>
    </section>`
  }
  const list = shelf.materials || []
  if (!list.length) {
    return `<section class="card">
      <div class="card-head"><h2>书架</h2></div>
      <p class="dim">还没有登记资料。右边可以粘贴一个本机路径，或者选个文件夹上传。</p>
    </section>`
  }

  // 按类别分组：教辅、AI 出题、讲义…… 每组一个小标题。
  // 学生嘴里说的「一本通」和「你昨天给我出的小测」在书架上是平级的，分组别把它们摞成主次。
  const groups = KIND_ORDER
    .map((kind) => [kind, list.filter((s) => (KIND[s.kind] ? s.kind : 'other') === kind)])
    .filter(([, items]) => items.length)

  const rowsByGroup = new Map(list.map((s) => [s.materialId, renderShelfRow(s)]))

  const body = groups
    .map(([kind, items]) => {
      const head = groups.length > 1 ? `<h3 class="sub">${esc(KIND[kind])}<span class="dim">${items.length} 份</span></h3>` : ''
      return `${head}<ul class="list shelf">${items.map((s) => rowsByGroup.get(s.materialId)).join('')}</ul>`
    })
    .join('')

  const root = shelf.pagesRoot ? `<p class="hint">页图存在 <span class="path">${esc(shelf.pagesRoot)}</span>，改了路径也不会动你的原文件。</p>` : ''
  return `<section class="card">
    <div class="card-head"><h2>书架</h2><span class="dim">共 ${list.length} 份</span></div>
    <p class="dim">按类别分组。教辅看两份进度：<b>拆到第几页</b>（PDF 转成带页码的图）和<b>归了多少页</b>（每一页归到哪个单元）；AI 出的卷子直接打开就能做。</p>
    ${body}
    ${root}
  </section>`
}

/* ── 工具栏目（/study/toolbox）─────────────────────────────────────────────
 *
 * 一格二级菜单 + 一个小工具。这一页跟别处不一样：**它是给学生自己动手的**
 * （按时钟、勾清单），不是「教练写、学生看」。所以它是面板里除了自评和勾任务
 * 之外，第三样他自己能改的东西——加小工具的时候记住这条。
 *
 * 加新工具就三步：往 TOOLS 里塞一条、写一个返回 <section class="card …"> 的工厂、
 * 在 click 分支里接上它的按钮。菜单位置和折页都由这里统一管。
 */
const TOOLS = [
  {
    id: 'pomodoro',
    label: '番茄钟',
    hint: '坐下去专注一段，到点休息',
    card: () => pomodoroCard(),
  },
  {
    id: 'checklist',
    label: '清单',
    hint: '今天想办的那几件，勾掉一件算一件',
    card: () => checklistCard(),
  },
  {
    id: 'memory',
    label: '记忆卡',
    hint: '要背的东西按艾宾浩斯排，到点回来过一遍',
    card: () => memoryCard(),
  },
]

function toolMenu() {
  const tabs = TOOLS.map(
    (t) => `<button class="sub-item${t.id === ui.tool ? ' on' : ''}" data-act="tool-pick" data-tool="${t.id}" title="${esc(t.hint)}">${esc(t.label)}</button>`,
  ).join('')
  const cur = TOOLS.find((t) => t.id === ui.tool) || TOOLS[0]
  return `<nav class="sub-nav" aria-label="工具">
    <span class="sub-title">工具</span>
    ${tabs}
    <span class="sub-hint">${esc(cur.hint)}</span>
  </nav>`
}

/** 把秒数写成 25:00。超过一小时写成 1:05:30，别让人数不清。 */
function clockText(seconds) {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const two = (n) => String(n).padStart(2, '0')
  return h ? `${h}:${two(m)}:${two(ss)}` : `${two(m)}:${two(ss)}`
}

function pomodoroCard() {
  const f = (toolbox && toolbox.focus) || null
  if (!f) {
    return `<section class="card focus" data-card="focus">
      <div class="card-head"><h2>番茄钟</h2></div>
      <p class="dim">读不到工具数据。这一页要等 DSH 重启之后才能用——路由是进程启动时加载的。</p>
    </section>`
  }
  const open = ((toolbox && toolbox.todos && toolbox.todos.items) || []).filter((t) => !t.done)
  const taskOptions = ['<option value="">不挂清单，就单纯坐一会儿</option>']
    .concat(open.map((t) => `<option value="${esc(t.id)}"${t.id === (ui.focusTask || f.taskId) ? ' selected' : ''}>${esc(t.text)}</option>`))
    .join('')
  const pct = f.running && f.roundMinutes ? Math.max(0, Math.min(100, 100 - (f.left / (f.roundMinutes * 60)) * 100)) : 0
  const log = (f.log || []).slice().reverse().slice(0, 6)
  return `<section class="card focus" data-card="focus">
    <div class="card-head">
      <h2>番茄钟</h2>
      <span class="dim">今天 ${f.todayRounds} 个 · ${f.todayMinutes} 分钟</span>
    </div>

    <div class="focus-face" data-phase="${esc(f.phase)}">
      <span class="focus-phase">${esc(f.phaseLabel)}</span>
      <b class="focus-clock" id="focus-clock" data-ends="${esc(f.endsAt)}" data-total="${esc(String(f.roundMinutes * 60))}">${clockText(f.running ? f.left : f.workMinutes * 60)}</b>
      <div class="bar focus-bar"><i id="focus-bar" style="width:${pct}%"></i></div>
      ${f.label ? `<p class="dim">这一轮：${esc(f.label)}</p>` : ''}
    </div>

    <div class="focus-set">
      <label class="dim">专注<input type="number" min="1" max="180" id="focus-min" value="${esc(String(ui.focusMinutes || f.workMinutes))}"> 分钟</label>
      <label class="dim">休息<input type="number" min="1" max="180" id="break-min" value="${esc(String(ui.breakMinutes || f.breakMinutes))}"> 分钟</label>
      <label class="dim grow">挂在<select id="focus-task" data-act="focus-task">${taskOptions}</select></label>
    </div>

    <div class="row-acts">
      <button class="btn primary" data-act="focus-start">${f.running ? '重新起一轮（会先停掉现在的）' : '开始专注'}</button>
      ${f.running ? `<button class="mini" data-act="focus-stop">停掉</button>` : ''}
      ${!f.running && f.phase === 'break' ? `<button class="mini" data-act="focus-break">只休息 ${esc(String(f.breakMinutes))} 分钟</button>` : ''}
    </div>

    ${f.longBreakDue ? '<p class="hint">背够一轮了，这次可以休息久一点。</p>' : ''}
    <p class="hint">时间是存在档案里的绝对时刻，不是页面上的倒计时——刷新、关页面、重启 DSH 都不影响。到点它会自己停下，不会自动接着下一轮。</p>

    ${log.length
      ? `<h3 class="sub">最近的番茄</h3><ul class="list tight focus-log">${log
          .map((r) => `<li><span class="tag">${r.kind === 'break' ? '息' : '专'}</span><div class="mat-main"><b>${esc(String(r.minutes))} 分钟${r.partial ? '（中途停的）' : ''}</b><div class="path">${esc(clockOf(r.at))}${r.label ? ' · ' + esc(r.label) : ''}</div></div></li>`)
          .join('')}</ul>`
      : ''}
  </section>`
}

const TODO_FILTERS = [
  ['open', '没做完'],
  ['today', '今天到期'],
  ['done', '做完了'],
  ['', '全部'],
]

function checklistCard() {
  const t = (toolbox && toolbox.todos) || null
  if (!t) {
    return `<section class="card todos" data-card="todos">
      <div class="card-head"><h2>清单</h2></div>
      <p class="dim">读不到工具数据。这一页要等 DSH 重启之后才能用。</p>
    </section>`
  }
  const all = t.items || []
  const done = all.filter((x) => x.done).length
  const chips = TODO_FILTERS.map(
    ([key, label]) => `<button class="mini${key === ui.todoStatus ? ' on' : ''}" data-act="todo-filter" data-status="${key}">${label}${key === 'done' ? ` ${done}` : key === 'open' ? ` ${all.length - done}` : ''}</button>`,
  ).join('')
  const rows = all
    .map((x) => `<li class="${x.done ? 'done' : ''}">
      <button class="tick${x.done ? ' on' : ''}" data-act="todo-toggle" data-id="${esc(x.id)}" aria-label="${x.done ? '取消勾选' : '勾掉'}">${x.done ? '✓' : ''}</button>
      <div class="mat-main">
        <b>${esc(x.text)}</b>
        <div class="path">${[x.due ? `${esc(x.due)} 前` : '', x.spent ? `花了 ${x.spent} 分钟` : '', x.pointId ? esc(x.pointId) : '', x.doneAt ? `勾于 ${esc(String(x.doneAt).slice(0, 10))}` : ''].filter(Boolean).join(' · ') || '&nbsp;'}</div>
      </div>
      <div class="spread" data-act="todo-timer" data-id="${esc(x.id)}" data-text="${esc(x.text)}" title="给这条起一个番茄钟" role="button" tabindex="0">🍅</div>
      <button class="mini" data-act="todo-del" data-id="${esc(x.id)}">删</button>
    </li>`)
    .join('')
  return `<section class="card todos" data-card="todos">
    <div class="card-head">
      <h2>清单</h2>
      <span class="dim">没做完 ${all.length - done} 条 · 做完 ${done} 条</span>
    </div>
    <form class="form todo-form" data-form="todo">
      <input name="text" placeholder="今天想办什么，比如「背 20 个单词」" maxlength="120">
      <input name="due" type="date" class="due-in" title="哪天之前办完，不填就没限期">
      <button class="btn" type="submit">加上</button>
    </form>
    <div class="chips">${chips}</div>
    ${rows ? `<ul class="list tight todos-list">${rows}</ul>` : '<p class="dim">这一类里没有条目。</p>'}
    <p class="hint">清单跟「今天」页的任务不是一回事：任务是我排的学习计划，清单是你自己想起来要办的事。点右边那颗番茄可以就着这一条起一轮计时。</p>
  </section>`
}

/* 自评四档：跟 lib/store.js 的 CARD_GRADES 同序同字，改一边就得改另一边。 */
const CARD_GRADES = ['忘了', '模糊', '记住', '秒答']
/* 类型也照 store 那份抄，默认那条「其他」由空串表示。 */
const CARD_KINDS = ['单词', '公式', '定义']
const CARD_FILTERS = [
  ['due', '该背了'],
  ['waiting', '还没到点'],
  ['graduated', '已经背下来'],
  ['', '全部'],
]

/**
 * 记忆卡：要背的东西一张一张摊开，按艾宾浩斯那条间隔排。
 *
 * 跟「今天」页的任务、跟掌握度都是两套账：这里只管背没背下来。
 * 页面**不是**定时器——该背哪几张是服务端拿 `dueAt` 跟当下比出来的，
 * 所以关掉页面、过一天再打开，看到的还是真数据。
 */
function memoryCard() {
  const m = memory
  if (!m) {
    return `<section class="card mem" data-card="memory">
      <div class="card-head"><h2>记忆卡</h2></div>
      <p class="dim">读不到记忆卡。这一页要等 DSH 重启之后才能用——路由是进程启动时加载的。</p>
    </section>`
  }
  const st = m.stats || {}
  const dueList = m.dueItems || []
  const cur = dueList.find((c) => c.id === ui.cardId) || dueList[0] || null
  const box = cur
    ? `<div class="mem-face">
      <span class="mem-label">${esc(cur.kind)}${cur.pointId ? ' · ' + esc(cur.pointId) : ''}${cur.step ? ` · 第 ${cur.step} 级` : ''}${cur.lapses ? ` · 忘过 ${cur.lapses} 次` : ''}</span>
      <b class="mem-front">${esc(cur.front)}</b>
      ${ui.cardReveal
        ? `<p class="mem-back">${esc(cur.back)}</p>
      <div class="row-acts mem-grades">
        ${CARD_GRADES.map((g) => `<button class="btn grade" data-act="card-grade" data-grade="${g}" data-id="${esc(cur.id)}">${g}</button>`).join('')}
      </div>`
        : `<button class="btn primary" data-act="card-reveal">看答案</button>`}
    </div>`
    : `<p class="dim">${st.total
      ? `现在没有该背的。${m.soon ? `接下来 24 小时里还有 ${m.soon} 张到点。` : '都在等着呢。'}`
      : '还没建过卡。下面加一张——正面写要背的东西，背面写答案，刚建好就会先让你看一遍。'}</p>`

  const mods = (state && state.map && state.map.modules) || []
  const pointOpts = ['<option value="">不挂单元</option>']
    .concat(mods.flatMap((mod) => (mod.points || []).map(
      (p) => `<option value="${esc(p.id)}"${p.id === ui.cardDraft.pointId ? ' selected' : ''}>${esc(p.id)} ${esc(p.title || '')}</option>`,
    )))
    .join('')
  const kindOpts = ['<option value="">其他</option>']
    .concat(CARD_KINDS.map((k) => `<option value="${esc(k)}"${k === ui.cardDraft.kind ? ' selected' : ''}>${esc(k)}</option>`))
    .join('')

  const chips = CARD_FILTERS.map(([key, label]) => {
    // cardStats 只给 total / due / graduated，「还没到点」得自己减出来
    const n = key === 'due' ? (st.due || 0)
      : key === 'graduated' ? (st.graduated || 0)
        : key === 'waiting' ? Math.max(0, (st.total || 0) - (st.due || 0) - (st.graduated || 0))
          : (st.total || 0)
    return `<button class="mini${key === ui.cardStatus ? ' on' : ''}" data-act="card-filter" data-status="${key}">${label} ${n}</button>`
  }).join('')

  // 列表里只写正面：答案留在复习盒子里，翻答案之前不该先被列表剧透。
  const rows = (m.items || []).map((c) => `<li>
    <div class="mat-main">
      <b>${esc(c.front)}</b>
      <div class="path">${[
        esc(c.kind),
        c.pointId ? esc(c.pointId) : '',
        c.state === 'due' ? '该背了' : c.state === 'graduated' ? '已经背下来' : esc(c.leftText || ''),
        c.step ? `第 ${c.step} 级` : '',
        c.lapses ? `忘过 ${c.lapses} 次` : '',
      ].filter(Boolean).join(' · ')}</div>
    </div>
    <button class="mini" data-act="card-del" data-id="${esc(c.id)}">删</button>
  </li>`).join('')

  return `<section class="card mem" data-card="memory">
    <div class="card-head">
      <h2>记忆卡</h2>
      <span class="dim">该背 ${st.due || 0} 张 · 一共 ${st.total || 0} 张 · 背下来 ${st.graduated || 0} 张${m.soon ? ` · 24 小时内还有 ${m.soon} 张` : ''}</span>
    </div>
    ${box}
    <form class="form mem-form" data-form="card">
      <input name="front" placeholder="正面：要背的东西，比如「photosynthesis」" maxlength="200" value="${esc(ui.cardDraft.front)}">
      <input name="back" placeholder="背面：答案，比如「光合作用」" maxlength="200" value="${esc(ui.cardDraft.back)}">
      <select name="kind" title="这是哪一类">${kindOpts}</select>
      <select name="pointId" title="挂到哪个单元上">${pointOpts}</select>
      <button class="btn" type="submit">加上</button>
    </form>
    <div class="chips">${chips}</div>
    ${rows ? `<ul class="list tight mem-list">${rows}</ul>` : '<p class="dim">这一档里没有卡。</p>'}
    <p class="hint">卡片按艾宾浩斯那条间隔排：忘了一次 10 分钟后就回来，模糊退一级，记住进一级，秒答进两级，连着三次秒答就不排了。「现在该背几张」是服务端拿到期时刻现算的，所以关掉页面过一天再打开还是准的。</p>
  </section>`
}

/**
 * 番茄钟那个每秒走动的数字。
 *
 * 只在「工具」页、钟在跑、页面还看得见的时候开——这三条任何一条不成立就停掉。
 * 数字是从服务端给的 `endsAt` 现算的，所以这个定时器**不是**真相来源，
 * 只是个显示刷新；关掉它一切照常。
 */
function stopFocusTicker() {
  if (focusTimer) {
    clearInterval(focusTimer)
    focusTimer = null
  }
}

function syncFocusTicker() {
  const f = toolbox && toolbox.focus
  if (page !== 'toolbox' || !f || !f.running || chatHidden()) {
    stopFocusTicker()
    return
  }
  const tick = () => {
    const clock = document.getElementById('focus-clock')
    const ds = (clock && clock.dataset) || null
    if (!ds) {
      stopFocusTicker()
      return
    }
    const ends = Date.parse(ds.ends || '')
    if (!Number.isFinite(ends)) {
      stopFocusTicker()
      return
    }
    const total = Number(ds.total) || 0
    const left = Math.max(0, Math.round((ends - Date.now()) / 1000))
    clock.textContent = clockText(left)
    const bar = document.getElementById('focus-bar')
    if (bar && bar.style && total) bar.style.width = Math.max(0, Math.min(100, 100 - (left / total) * 100)) + '%'
    if (left <= 0) {
      // 走到点了：让服务端结算这一轮（记日志、清 running），再重画。
      stopFocusTicker()
      loadToolbox().then((next) => {
        if (next) toolbox = next
        render()
      })
    }
  }
  tick()
  if (!focusTimer) focusTimer = setInterval(tick, 500)
}

function importCard() {
  const busy = ui.importing
  return `<section class="card">
    <div class="card-head"><h2>导入资料</h2></div>
    <p class="dim">两种都行：文件大就用路径（不搬原件），手机或别处拿来的就上传（复制一份到插件数据目录）。</p>

    <form data-form="import" class="form">
      <label>本机路径
        <input name="path" placeholder="例如 F:\\教辅\\必修一.pdf，也可以是整个文件夹" ${busy ? 'disabled' : ''}>
      </label>
      <div class="row-acts">
        <button class="btn" type="submit" ${busy ? 'disabled' : ''}>登记</button>
        <button class="mini" type="button" data-act="import-list" ${busy ? 'disabled' : ''}>只看文件夹里有什么</button>
      </div>
    </form>

    <hr>

    <label class="file-drop">
      <input type="file" id="import-files" multiple accept=".pdf,.docx,.md,.txt,.epub" ${busy ? 'disabled' : ''}>
      <span>${busy ? '上传中…' : '或者选文件上传'}</span>
    </label>
    <p class="hint">可以多选。上传的文件会复制到插件数据目录，原文件不动。</p>
    <div id="import-log" class="import-log">${ui.importLog || ''}</div>

    ${
      ui.importPreview
        ? `<div class="preview">
            <p class="dim">${esc(ui.importPreview.path)} 里有这些：</p>
            <ul class="list tight">${ui.importPreview.files
              .map((f) => `<li><span class="dim">${f.known ? '已登记' : ''}</span><span class="mat-main">${esc(f.name)}</span></li>`)
              .join('')}</ul>
            <button class="mini" data-act="import-all">整个文件夹登记进来</button>
          </div>`
        : ''
    }
  </section>`
}

/**
 * 「让 AI 出题」——资料页上的 AI 入口。
 *
 * 它不是让人在这儿直接看卷子：点下去只是把要求投给对话那头的教练，由教练出题、
 * 把卷子落成一份 kind=ai 的材料（跟教辅平级），再回到书架和做题页上。
 * 所以这一页只负责「说清要什么」，生成和登记都是教练的活儿。
 */
function aiCard() {
  const points = (state.map && state.map.modules ? state.map.modules : []).flatMap((m) =>
    (m.points || []).map((p) => ({ id: p.id, title: p.title || '' })),
  )
  if (!points.length) {
    return `<section class="card ai">
      <div class="card-head"><h2>让 AI 出题</h2></div>
      <p class="dim">地图上还没有单元，先让教练把知识地图画出来——出题要挂到某个单元上才归得了类。</p>
    </section>`
  }
  const cur = points.find((p) => p.id === ui.aiPoint) ? ui.aiPoint : points[0].id
  const busy = ui.aiBusy
  const kinds = [
    ['quiz', '随堂小测', '6—8 道，由易到难，附答案'],
    ['recite', '背诵清单', '要背的定义、公式、结论，附「怎么想起来」'],
    ['variant', '错题变式', '拿最近的错题改数字、改条件，出同构题'],
  ]
  return `<section class="card ai">
    <div class="card-head"><h2>让 AI 出题</h2></div>
    <p class="dim">给教练递一句话，他出好之后会把卷子登记进书架——跟教辅平级的一类，做题页上按单元也找得到。</p>

    <form data-form="ai" class="form">
      <div class="chips">
        ${kinds
          .map(
            ([id, label, hint]) =>
              `<button type="button" class="mini${id === ui.aiWant ? ' on' : ''}" data-act="ai-want" data-want="${id}" title="${esc(hint)}" ${busy ? 'disabled' : ''}>${esc(label)}</button>`,
          )
          .join('')}
      </div>
      <label>对着哪个单元
        <select name="pointId" ${busy ? 'disabled' : ''}>
          ${points
            .map((p) => `<option value="${esc(p.id)}"${p.id === cur ? ' selected' : ''}>${esc(p.id)} ${esc(p.title)}</option>`)
            .join('')}
        </select>
      </label>
      <label>补一句要求（可以不写）
        <textarea name="note" rows="2" maxlength="200" placeholder="例如：只要应用题，别出证明题" ${busy ? 'disabled' : ''}>${esc(ui.aiNote)}</textarea>
      </label>
      <div class="row-acts">
        <button class="btn" type="submit" ${busy ? 'disabled' : ''}>${busy ? '递过去了…' : '交给教练'}</button>
      </div>
    </form>
    <p class="hint">出好之后他会回话，你到书架上看。卷子正文在插件数据目录的 ai/ 里，不搬你的原件。</p>
  </section>`
}

function toolsCard() {
  const list = (state.profile && state.profile.tools) || []
  if (!list.length) return ''
  return `<section class="card">
    <div class="card-head"><h2>基本工具</h2></div>
    <p class="dim">运算、查资料、画图等能力不属于具体知识点，但影响学习效率。</p>
    <ul class="list">${list
      .map(
        (t) => `<li>
          <span class="dot" style="background:${STAGE_COLOR[t.stage] || 'var(--stage-1)'}"></span>
          <b>${esc(t.name)}</b>
          <span class="dim" style="flex:1">${esc(t.note)}</span>
          <span class="stage-tag" style="color:${STAGE_COLOR[t.stage] || 'var(--stage-1)'}">${esc(t.stage)}</span>
        </li>`,
      )
      .join('')}</ul>
  </section>`
}

/* ── 对话页 ───────────────────────────────────────────────────────────────
 * 这一页画的是 DSH 里真正的对话：读的是会话日志（lib/chat.js → sessionController），
 * 发的话直接投进那个会话。所以在这儿看到的就是对话里发生的，不存在两份记录。
 */
function chatStatus(snapshot) {
  if (!snapshot) return '<span class="dim">正在读取…</span>'
  if (!snapshot.available) return '<span class="dim">未接通</span>'
  const parts = []
  if (snapshot.error) parts.push(esc(snapshot.error))
  else parts.push('已接通')
  return `<span class="dim">${parts.join(' · ')}</span>`
}

/**
 * 「什么时候」：今天给钟点，昨天给「昨天」，今年给月-日，再往前才带年份。
 * 会话列表是按更新时间倒序的，光看标题分不清哪个是刚才那个。
 */
function whenText(at) {
  const n = Number(at)
  if (!n) return ''
  const d = new Date(n)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (sameDay(d, now)) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  if (sameDay(d, new Date(now.getTime() - 86400000))) return '昨天'
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}-${d.getDate()}`
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

/**
 * 会话选择。
 *
 * **只有一个会话时也把它写出来**——不然学生根本看不出自己在跟哪一个说话，
 * 这是他上一次提的毛病。多个会话才给下拉，选项里带上「最后活动时间」，
 * 因为 DSH 的会话标题常常是空的或者两条一样。
 */
function chatPicker(snapshot) {
  const list = (snapshot && snapshot.sessions) || []
  if (!list.length) return ''
  const rows = list.map((s) => {
    const name = s.title || (s.blank ? '（新会话）' : s.cwd ? String(s.cwd).split(/[\\/]/).pop() : String(s.sessionId).slice(0, 8))
    const label = [name, whenText(s.updatedAt), s.running ? '进行中' : ''].filter(Boolean).join(' · ')
    return { id: String(s.sessionId), label }
  })
  // 服务端没告诉我们在哪一个（比如清单是后拉回来的）时，就当第一个——列表是倒序的，第一个就是最近那个。
  const current = String((snapshot && snapshot.sessionId) || '') || rows[0].id
  if (rows.length === 1) {
    return `<div class="chat-pick"><span class="dim">当前会话</span><b class="pick-now">${esc(rows[0].label)}</b></div>`
  }
  const options = rows
    .map((r) => `<option value="${esc(r.id)}"${r.id === current ? ' selected' : ''}>${esc(r.label)}</option>`)
    .join('')
  return `<div class="chat-pick"><label class="dim">会话</label><select data-act="chat-session">${options}</select></div>`
}

function clockOf(time) {
  if (!time) return ''
  try {
    return new Date(time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

/**
 * 消息列表。工具调用和工具返回单独攒成一段——连着十几条 tool/call 铺开会把正文冲没，
 * 收成一行「调用了 read、edit（12 步）」正好。
 */
function chatLog(snapshot) {
  const messages = (snapshot && snapshot.messages) || []
  if (!messages.length) {
    return `<p class="dim chat-empty">${snapshot && snapshot.error ? '读取失败：' + esc(snapshot.error) : '这个会话还没有内容。在下面说一句，教练会在对话里收到。'}</p>`
  }
  const out = []
  let run = []
  const flush = () => {
    if (!run.length) return
    const names = [...new Set(run.filter((m) => m.role === 'tool' && m.tool && m.tool.name).map((m) => m.tool.name))]
    const failed = run.some((m) => m.role === 'result' && m.tool && m.tool.failed)
    const label = names.length ? names.join('、') : '工具'
    out.push(
      `<div class="chat-step${failed ? ' bad' : ''}">调用 ${esc(label)}（${run.length} 步）${failed ? ' · 有失败' : ''}</div>`,
    )
    run = []
  }
  for (const m of messages) {
    if (m.role === 'tool' || m.role === 'result') {
      run.push(m)
      continue
    }
    flush()
    const time = clockOf(m.time)
    const meta = time ? `<span class="chat-time">${esc(time)}</span>` : ''
    if (m.role === 'user') {
      out.push(`<div class="chat-msg user"><div class="chat-text">${esc(m.text)}</div>${meta}</div>`)
      continue
    }
    const used = Array.isArray(m.tools) && m.tools.length ? `<div class="chat-used">用了 ${esc([...new Set(m.tools)].join('、'))}</div>` : ''
    out.push(
      `<div class="chat-msg bot"><div class="chat-text">${esc(m.text || '（这一步没有正文）')}</div>${used}${meta}</div>`,
    )
  }
  flush()
  const tail = snapshot && snapshot.error ? `<div class="chat-step bad">${esc(snapshot.error)}</div>` : ''
  return out.join('') + tail
}

function chatCard() {
  const snapshot = chat
  if (!snapshot || !snapshot.available) {
    return `<section class="card">
      <div class="card-head"><h2>与教练对话</h2>${chatStatus(snapshot)}</div>
      <p class="dim">未接通对话通道。这一页要等 DSH 重启之后才能用——路由是进程启动时加载的，改完代码不重启就还是旧的。</p>
      ${snapshot && snapshot.error ? `<p class="dim">原因：${esc(snapshot.error)}</p>` : ''}
      <div class="row"><button class="mini" data-act="chat-reload">重新连接</button>
      <span class="dim">重启 DSH 之后点这里，不用刷新整页。</span></div>
    </section>`
  }
  // 这一页就是聊天窗口：会话选择在上，气泡占满中间，输入框钉在底下
  return `<section class="card">
    <div class="card-head"><h2>与教练对话</h2>${chatStatus(snapshot)}
      <button class="mini" data-act="chat-reload" title="重新读取">刷新</button></div>
    ${chatPicker(snapshot)}
    <div class="chat-log" id="chat-log" data-chat-log>${chatLog(snapshot)}</div>
    <form data-form="chat" class="form chat-form">
      <textarea name="text" rows="2" placeholder="跟教练说一句，例如：这节的含参讨论没跟上 / 换个教材 / 今天只剩 30 分钟"></textarea>
      <div class="row">
        <button type="submit" class="primary"${ui.chatSending ? ' disabled' : ''}>${ui.chatSending ? '发送中…' : '发送'}</button>
        <span class="dim">Enter 发送，Shift + Enter 换行。回复会自己出现在上面。</span>
      </div>
    </form>
  </section>`
}

/**
 * 右下角那个悬浮小窗。
 *
 * 面板任何一页都挂一颗圆按钮，点开就是简化版的聊天窗：同一份快照、同一条投递通道，
 * 只是字号和留白收一档，宽度固定。走到哪一页都能顺手说一句，不用先绕回「对话」页。
 * 「对话」页本身已经整屏是聊天窗口了，那一页不再挂。
 */
function floatChat() {
  if (page === 'coach') return ''
  if (!ui.float) {
    return `<button class="fab" data-act="float-open" title="与教练对话" aria-label="与教练对话">💬</button>`
  }
  const snapshot = chat
  const on = Boolean(snapshot && snapshot.available)
  const head = `<header class="float-head">
    <b>与教练对话</b>${on ? '' : '<span class="dim">未接通</span>'}
    <span class="spread"></span>
    <button class="mini" data-act="chat-reload" title="重新读取">↻</button>
    <button class="mini" data-act="float-close" title="收起" aria-label="收起">✕</button>
  </header>`
  if (!on) {
    return `<section class="float" role="dialog" aria-label="与教练对话">${head}
      <p class="dim float-off">对话通道未接通。等 DSH 重启之后点上面的 ↻ 再试。</p>
    </section>`
  }
  return `<section class="float" role="dialog" aria-label="与教练对话">${head}
    ${chatPicker(snapshot)}
    <div class="float-log" id="float-log" data-chat-log>${chatLog(snapshot)}</div>
    <form data-form="chat" class="chat-form float-form">
      <textarea name="text" rows="1" placeholder="跟教练说一句…"></textarea>
      <button type="submit" class="primary"${ui.chatSending ? ' disabled' : ''}>${ui.chatSending ? '…' : '发送'}</button>
    </form>
  </section>`
}


/* ── 交互 ─────────────────────────────────────────────────────────────── */

document.addEventListener('click', async (event) => {
  // 换页先看：导航条 / 入口卡 / 主页那两颗按钮都带 data-nav，自己切不整页跳
  const navEl = event.target.closest('[data-nav]')
  if (
    navEl &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    (event.button === undefined || event.button === 0)
  ) {
    if (typeof event.preventDefault === 'function') event.preventDefault()
    const target = PAGES.find((p) => p.id === navEl.dataset.nav)
    go(target ? target.id : 'home', target ? target.path : '/study')
    return
  }
  const el = event.target.closest('[data-act]')
  if (!el) return
  const act = el.dataset.act
  try {
    if (act === 'point-open') {
      const id = el.dataset.point
      ui.openPoint = ui.openPoint === id ? null : id
      render()
    } else if (act === 'group-open') {
      const name = el.dataset.group
      if (ui.openGroups.has(name)) ui.openGroups.delete(name)
      else ui.openGroups.add(name)
      render()
    } else if (act === 'module-open') {
      const id = el.dataset.module
      if (ui.openModules.has(id)) ui.openModules.delete(id)
      else ui.openModules.add(id)
      render()
    } else if (act === 'rate') {
      const pointId = el.dataset.point
      const noteEl = document.querySelector(`[data-note-for="${pointId}"]`)
      const note = noteEl ? noteEl.value.trim() : ''
      await api('/study/api/mastery', { pointId, stage: el.dataset.stage, note, kind: 'self' })
      toast(`已记录为「${el.dataset.stage}」`)
      ui.openPoint = null
      await load()
    } else if (act === 'map-confirm') {
      await api('/study/api/map/confirm', {})
      toast('地图已定稿')
      await load()
    } else if (act === 'archive-open') {
      await openArchive(el.dataset.level, el.dataset.key)
    } else if (act === 'archive-close') {
      if (event.target.closest('.modal')) return // 点弹层里面不算关
      ui.archive = null
      render()
    } else if (act === 'mode') {
      setMode(el.dataset.mode)
    } else if (act === 'theme') {
      setTheme(theme === 'light' ? 'dark' : 'light')
    } else if (act === 'mat-more') {
      ui.matMore = !ui.matMore
      render()
    } else if (act === 'mistake-filter') {
      ui.mistakeStatus = el.dataset.status || ''
      render()
    } else if (act === 'mistake-ask') {
      const pointId = el.dataset.point || ''
      const origin = el.dataset.origin || ''
      el.disabled = true
      try {
        const out = await api('/study/api/practice/ask', { pointId, mode: 'mistake', origin })
        toast(
          out.pushed
            ? '已交给教练：他会重判这道题的错因，再出一道同类题。'
            : '已记下，但这次没送进对话。等通道通了会自动带上。（' + (out.pushError || '') + '）',
          !out.pushed,
        )
      } catch (error) {
        toast('没送出去：' + error.message, true)
      } finally {
        el.disabled = false
      }
    } else if (act === 'review-save') {
      // 图已经在页面里了，直接把它当一个文件存下来——不用再往服务端要一趟。
      const blob = new Blob([review.svg], { type: 'image/svg+xml;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `今日复盘-${review.date}.svg`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
      toast('已下载今日复盘图（SVG，浏览器直接双击就能看）')
    } else if (act === 'shelf-toggle') {
      const id = el.dataset.id || ''
      if (shelfOpen === id) {
        shelfOpen = ''
      } else {
        shelfOpen = id
        await loadShelfIndex(id)
      }
      render()
    } else if (act === 'shelf-build') {
      const id = el.dataset.id || ''
      el.disabled = true
      try {
        const out = await api('/study/api/materials/build', { materialId: id })
        if (out.running) {
          toast(`这本书已经在拆了：${out.rendered}/${out.total} 页，过一会儿刷新看看`)
        } else if (out.started) {
          toast('开始拆了，几百页要几分钟。可以先干别的，回来点「看页级归类」。')
        } else {
          toast(out.summary || '拆图已经排上')
        }
        shelf = await loadShelf()
      } catch (error) {
        toast('没能开始拆：' + error.message, true)
      } finally {
        el.disabled = false
        render()
      }
    } else if (act === 'ai-want') {
      ui.aiWant = el.dataset.want || 'quiz'
      render()
    } else if (act === 'import-list') {
      const path = (document.querySelector('[data-form="import"] [name="path"]') || {}).value || ''
      if (!path.trim()) {
        toast('先把路径填上', true)
      } else {
        ui.importing = true
        render()
        try {
          const out = await api('/study/api/materials/import', { path: path.trim() })
          if (out.dir) {
            ui.importPreview = { path: out.path, files: out.files || [], dirs: out.dirs || [] }
            toast(`这个文件夹里有 ${(out.files || []).length} 份能登记的`)
          } else {
            ui.importPreview = null
            shelf = await loadShelf()
            toast(`登记了「${(out.added[0] || {}).title || path.trim()}」`)
          }
        } catch (error) {
          ui.importPreview = null
          toast('看不了：' + error.message, true)
        } finally {
          ui.importing = false
          render()
        }
      }
    } else if (act === 'import-all') {
      const path = (ui.importPreview && ui.importPreview.path) || ''
      ui.importing = true
      render()
      try {
        const out = await api('/study/api/materials/import', { path, all: true })
        ui.importPreview = null
        shelf = await loadShelf()
        toast(`登记了 ${out.added.length} 份${out.skipped ? `，跳过 ${out.skipped} 份已经在书架上的` : ''}`)
      } catch (error) {
        toast('没登记成：' + error.message, true)
      } finally {
        ui.importing = false
        render()
      }
    } else if (act === 'tool-pick') {
      ui.tool = el.dataset.tool || TOOLS[0].id
      // 记忆卡这一档要数据才有东西画；切过去那一下补拉，别的工具不吃这趟请求。
      if (ui.tool === 'memory' && !memory) memory = await loadMemory()
      // 换工具等于换一张卡：正面翻回去，别把上一张的答案带过来。
      ui.cardReveal = false
      render()
    } else if (act === 'card-reveal') {
      ui.cardReveal = true
      render()
    } else if (act === 'card-grade') {
      const id = el.dataset.id || ''
      const grade = el.dataset.grade || ''
      if (!id || !grade) return
      el.disabled = true
      const res = await toolPost('/study/api/memory', { action: 'review', id, grade })
      if (res.ok) {
        // 背完这一张就翻下一张：正面朝上重新开始，别停在刚背完的那张答案上。
        ui.cardReveal = false
        ui.cardId = ''
        toast(`记上了：${grade}`)
      }
      await refreshMemory()
    } else if (act === 'card-filter') {
      ui.cardStatus = el.dataset.status || ''
      ui.cardId = ''
      ui.cardReveal = false
      memory = await loadMemory()
      render()
    } else if (act === 'card-del') {
      const id = el.dataset.id || ''
      if (!id) return
      el.disabled = true
      const res = await toolPost('/study/api/memory', { action: 'remove', id })
      if (res.ok) toast('删掉了')
      await refreshMemory()
    } else if (act === 'focus-start') {
      const minutes = Number((document.getElementById('focus-min') || {}).value) || ui.focusMinutes
      const breakMin = Number((document.getElementById('break-min') || {}).value) || ui.breakMinutes
      const taskId = (document.getElementById('focus-task') || {}).value || ''
      const hit = ((toolbox && toolbox.todos && toolbox.todos.items) || []).find((t) => t.id === taskId)
      ui.focusMinutes = minutes
      ui.breakMinutes = breakMin
      ui.focusTask = taskId
      el.disabled = true
      const res = await toolPost('/study/api/focus', {
        action: 'start',
        minutes,
        breakMinutes: breakMin,
        taskId,
        label: hit ? hit.text : '',
      })
      el.disabled = false
      if (res.ok) toast(`专注开始了，${minutes} 分钟后响。`)
      await refreshToolbox()
    } else if (act === 'focus-break') {
      el.disabled = true
      const res = await toolPost('/study/api/focus', { action: 'start', kind: 'break' })
      el.disabled = false
      if (res.ok) toast('那这次只短歇一下。')
      await refreshToolbox()
    } else if (act === 'focus-stop') {
      el.disabled = true
      const res = await toolPost('/study/api/focus', { action: 'stop' })
      el.disabled = false
      if (res.ok) {
        const log = (res.out && res.out.focus && res.out.focus.log) || []
        const last = log[log.length - 1]
        toast(last && last.partial ? `停了，记下 ${last.minutes} 分钟（不到一轮的算半截）。` : '停了。')
      }
      await refreshToolbox()
    } else if (act === 'todo-filter') {
      ui.todoStatus = el.dataset.status || ''
      render()
    } else if (act === 'todo-toggle') {
      const id = el.dataset.id || ''
      el.disabled = true
      const res = await toolPost('/study/api/todo', { action: 'toggle', id })
      el.disabled = false
      if (res.ok && res.out && res.out.item && res.out.item.done) toast('勾掉一件。')
      await refreshToolbox()
    } else if (act === 'todo-del') {
      const id = el.dataset.id || ''
      el.disabled = true
      const res = await toolPost('/study/api/todo', { action: 'remove', id })
      el.disabled = false
      if (res.ok) toast('删了。')
      await refreshToolbox()
    } else if (act === 'todo-timer') {
      // 点清单右边那颗番茄：把这一条挂上去，直接起一轮。
      ui.tool = 'pomodoro'
      ui.focusTask = el.dataset.id || ''
      const res = await toolPost('/study/api/focus', {
        action: 'start',
        minutes: ui.focusMinutes,
        breakMinutes: ui.breakMinutes,
        taskId: ui.focusTask,
        label: el.dataset.text || '',
      })
      if (res.ok) toast('就着这一条起了一轮。')
      await refreshToolbox()
    } else if (act === 'card-toggle') {
      const cardId = el.dataset.card
      if (ui.open.has(cardId)) ui.open.delete(cardId)
      else ui.open.add(cardId)
      render()
    } else if (act === 'task-new') {
      ui.newTask = true
      render()
    } else if (act === 'task-filter') {
      ui.filter = el.dataset.profile || ''
      render()
    } else if (act === 'task-edit') {
      ui.editTask = el.dataset.id
      ui.editProfile = el.dataset.profile || ''
      ui.pendingDel = null
      render()
    } else if (act === 'task-remove') {
      ui.pendingDel = el.dataset.id
      ui.pendingProfile = el.dataset.profile || ''
      ui.editTask = null
      render()
    } else if (act === 'task-del') {
      await api('/study/api/task/remove', { date: today(), id: el.dataset.id, profileId: el.dataset.profile || '' })
      toast('已删除')
      ui.pendingDel = null
      ui.pendingProfile = ''
      await load()
    } else if (act === 'task-cancel') {
      ui.editTask = null
      ui.pendingDel = null
      ui.newTask = false
      render()
    } else if (act === 'goal-edit') {
      ui.editGoal = true
      render()
    } else if (act === 'goal-cancel') {
      ui.editGoal = false
      render()
    } else if (act === 'lib-select') {
      await api('/study/api/library', { action: 'select', id: el.dataset.id })
      ui.archive = null
      ui.openPoint = null
      ui.openGroups.clear()
      ui.openModules.clear()
      toast('已切换')
      await load()
    } else if (act === 'chat-reload') {
      await loadChat({ withSessions: true })
      paintChat()
      toast('已刷新')
    } else if (act === 'float-open') {
      ui.float = true
      // 浮窗里也要能选会话：清单还没拉过就趁这次拉一份——load() 那次只问了快照，
      // 那时候 ui.float 还是 false，所以 sessions 是空的。
      if (!chat || !(chat.sessions || []).length) await loadChat({ withSessions: true })
      render()
    } else if (act === 'float-close') {
      ui.float = false
      render()
    } else if (act === 'lib-rename') {
      ui.renameId = el.dataset.id
      ui.pendingDropProfile = null
      render()
    } else if (act === 'lib-remove') {
      ui.pendingDropProfile = el.dataset.id
      ui.renameId = null
      render()
    } else if (act === 'lib-drop') {
      const r = await api('/study/api/library', { action: 'remove', id: el.dataset.id })
      toast(`已删除，当前使用「${(r.profiles.find((p) => p.active) || {}).title || ''}」`)
      ui.pendingDropProfile = null
      await load()
    } else if (act === 'lib-new') {
      ui.newProfile = true
      render()
    } else if (act === 'lib-cancel') {
      ui.renameId = null
      ui.pendingDropProfile = null
      ui.newProfile = false
      render()
    } else if (act === 'trash-restore') {
      const entry = el.dataset.entry
      await api('/study/api/library/restore', { entry })
      toast('已恢复')
      await load()
    }
  } catch (error) {
    toast(error.message, true)
  }
})

document.addEventListener('change', async (event) => {
  const el = event.target
  if (!el.dataset) return
  // 番茄钟那两格时长：改动先记在 ui 上，这样中途重画不会把填好的数冲掉。
  if (el.id === 'focus-min' || el.id === 'break-min') {
    const n = Number(el.value)
    if (Number.isFinite(n) && n >= 1 && n <= 180) {
      if (el.id === 'focus-min') ui.focusMinutes = Math.round(n)
      else ui.breakMinutes = Math.round(n)
    }
    return
  }
  // 记忆卡那几格：改动先记在 ui 上，这样中途重画（翻答案、换筛选）不会把打好的半句冲掉。
  // 认表单归属，别按 name 认：出题卡上也有个 pointId，否则会把它的选择写进记忆卡草稿。
  if (el.form && el.form.dataset && el.form.dataset.form === 'card' && ['front', 'back', 'kind', 'pointId'].includes(el.name)) {
    ui.cardDraft = { ...ui.cardDraft, [el.name]: String(el.value || '') }
    return
  }
  // 出题卡：换类型按钮会重画一次，这里把单元和那句话先存住，重画时原样铺回去。
  if (el.form && el.form.dataset && el.form.dataset.form === 'ai') {
    if (el.name === 'pointId') ui.aiPoint = String(el.value || '')
    else if (el.name === 'note') ui.aiNote = String(el.value || '')
    return
  }
  // 选文件上传：一次把选中的都传上去，一个个来（并发太高容易把内存堆满）。
  if (el.id === 'import-files') {
    const files = Array.from(el.files || [])
    if (!files.length) return
    ui.importing = true
    ui.importLog = ''
    render()
    let done = 0
    for (const file of files) {
      try {
        await uploadFile(file)
        done += 1
        importLog(`✓ ${file.name}（${Math.round(file.size / 1024)} KB）`)
      } catch (error) {
        importLog(`✗ ${file.name}：${error.message}`)
      }
    }
    ui.importing = false
    shelf = await loadShelf()
    render()
    toast(done ? `登记了 ${done} 份` : '一份都没登记上，看下面那几行', !done)
    return
  }
  if (el.dataset.act === 'chat-session') {
    ui.chatSession = el.value
    await loadChat({ sessionId: el.value, withSessions: true })
    paintChat()
    return
  }
  if (el.dataset.act !== 'task-toggle') return
  try {
    await api('/study/api/task/toggle', {
      date: today(),
      id: el.dataset.id,
      profileId: el.dataset.profile || '',
      done: el.checked,
    })
    await load()
  } catch (error) {
    toast(error.message, true)
  }
})

document.addEventListener('submit', async (event) => {
  const form = event.target
  const kind = form.dataset && form.dataset.form
  if (!kind) return
  event.preventDefault()
  const data = new FormData(form)
  try {
    if (kind === 'ai') {
      const pointId = String(data.get('pointId') || ui.aiPoint || '').trim()
      if (!pointId) {
        toast('先挑一个单元', true)
        return
      }
      ui.aiBusy = true
      render()
      try {
        const out = await api('/study/api/practice/ask', {
          pointId,
          mode: 'ai',
          want: ui.aiWant,
          text: String(data.get('note') || '').trim(),
        })
        ui.aiNote = ''
        toast(
          out.pushed
            ? '已交给教练：他会出题，然后把卷子登记进书架。'
            : `已经记下了，但没送进对话：${out.pushError || '通道没接通'}`,
        )
      } catch (error) {
        toast('没交出去：' + error.message, true)
      } finally {
        ui.aiBusy = false
        render()
      }
    } else if (kind === 'import') {
      const path = String(data.get('path') || '').trim()
      if (!path) {
        toast('先把路径填上', true)
        return
      }
      ui.importing = true
      render()
      try {
        const out = await api('/study/api/materials/import', { path })
        if (out.dir) {
          // 目录不直接登记：先把里头有什么摆出来，让他点一下再收
          ui.importPreview = { path: out.path, files: out.files || [], dirs: out.dirs || [] }
          toast(`这是个文件夹，里面有 ${(out.files || []).length} 份能登记的`)
        } else {
          shelf = await loadShelf()
          toast(`登记了「${(out.added[0] || {}).title || path}」`)
        }
      } catch (error) {
        toast('没登记成：' + error.message, true)
      } finally {
        ui.importing = false
        render()
      }
    } else if (kind === 'todo') {
      const text = String(data.get('text') || '').trim()
      if (!text) {
        toast('写一句话，比如「背 20 个单词」', true)
        return
      }
      const res = await toolPost('/study/api/todo', {
        action: 'add',
        text,
        due: String(data.get('due') || ''),
      })
      if (res.ok) {
        form.reset()
        const box = form.querySelector('input[name="text"]')
        if (box && box.focus) box.focus()
        toast('加上了。')
      }
      await refreshToolbox()
    } else if (kind === 'card') {
      const front = String(data.get('front') || '').trim()
      const back = String(data.get('back') || '').trim()
      const kindOf = String(data.get('kind') || '').trim()
      const pointId = String(data.get('pointId') || '').trim()
      // 先把输入框里的字收下来：没填全得重画一次，别把已经打好的半句冲掉。
      ui.cardDraft = { front, back, kind: kindOf, pointId }
      if (!front || !back) {
        toast('正面、背面都得写', true)
        render()
        return
      }
      const res = await toolPost('/study/api/memory', { action: 'add', front, back, kind: kindOf, pointId })
      if (res.ok) {
        ui.cardDraft = { front: '', back: '', kind: '', pointId: '' }
        form.reset()
        const box = form.querySelector('input[name="front"]')
        if (box && box.focus) box.focus()
        toast('记下了，先看一遍。')
      }
      await refreshMemory()
    } else if (kind === 'chat') {
      const text = String(data.get('text') || '').trim()
      if (!text) {
        toast('内容为空', true)
        return
      }
      ui.chatSending = true
      form.querySelector('button[type="submit"]').disabled = true
      try {
        const out = await api('/study/api/chat/send', {
          text,
          sessionId: (chat && chat.sessionId) || ui.chatSession || '',
        })
        if (!out.ok) {
          toast('没递进去：' + (out.pushError || '通道未通'), true)
        } else {
          form.reset()
          // 悬浮窗里发完接着打字，别让人再点一次输入框
          const box = form.querySelector('textarea')
          if (box && box.focus) box.focus()
          toast('已发送')
        }
      } finally {
        ui.chatSending = false
      }
      // 等日志追上：立刻拉一次，过一秒再拉一次，别让人盯着空白等
      await loadChat()
      paintChat()
      setTimeout(() => void refreshChat(), 1200)
    } else if (kind === 'task-edit') {
      const id = form.dataset.id
      await api('/study/api/task/update', {
        date: today(),
        id,
        profileId: form.dataset.profile || '',
        title: String(data.get('title') || '').trim(),
        kind: String(data.get('kind') || 'practice'),
        minutes: Number(data.get('minutes') || 0),
      })
      ui.editTask = null
      ui.editProfile = ''
      toast('已保存')
    } else if (kind === 'task-add') {
      const title = String(data.get('title') || '').trim()
      if (!title) {
        toast('请填写任务内容', true)
        return
      }
      const minutes = Number(data.get('minutes') || 0)
      await api('/study/api/task', {
        date: today(),
        profileId: String(data.get('profileId') || ''),
        title,
        kind: String(data.get('kind') || 'practice'),
        target: String(data.get('target') || '').trim(),
        open: String(data.get('open') || '').trim(),
        ...(Number.isFinite(minutes) && minutes > 0 ? { minutes } : {}),
      })
      ui.newTask = false
      toast('已添加')
    } else if (kind === 'goal') {
      const minutes = Number(data.get('minutesPerDay') || 0)
      await api('/study/api/goal', {
        subject: String(data.get('subject') || '').trim(),
        outcome: String(data.get('outcome') || '').trim(),
        deadline: String(data.get('deadline') || '').trim(),
        ...(Number.isFinite(minutes) && minutes > 0 ? { minutesPerDay: minutes } : {}),
      })
      ui.editGoal = false
      toast('已保存')
    } else if (kind === 'lib-new') {
      const minutes = Number(data.get('minutesPerDay') || 0)
      await api('/study/api/library', {
        action: 'create',
        title: String(data.get('title') || '').trim(),
        subject: String(data.get('subject') || '').trim(),
        outcome: String(data.get('outcome') || '').trim(),
        deadline: String(data.get('deadline') || '').trim(),
        ...(Number.isFinite(minutes) && minutes > 0 ? { minutesPerDay: minutes } : {}),
      })
      ui.newProfile = false
      ui.openPoint = null
      ui.openGroups.clear()
      ui.openModules.clear()
      toast('已创建并切换')
    } else if (kind === 'lib-rename') {
      await api('/study/api/library', {
        action: 'rename',
        id: form.dataset.id,
        title: String(data.get('title') || '').trim(),
      })
      ui.renameId = null
      toast('名称已更新')
    } else {
      return
    }
    await load()
  } catch (error) {
    toast(error.message, true)
  }
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    // Enter 发送、Shift + Enter 换行——聊天窗口该有的手感。
    const box = event.target
    if (!box || box.tagName !== 'TEXTAREA') return
    const form = box.closest && box.closest('form')
    if (!form || !form.dataset || form.dataset.form !== 'chat') return
    event.preventDefault()
    if (typeof form.requestSubmit === 'function') form.requestSubmit()
    else if (typeof form.dispatchEvent === 'function') form.dispatchEvent(new Event('submit', { cancelable: true }))
    return
  }
  if (event.key !== 'Escape') return
  if (ui.archive) {
    ui.archive = null
    render()
    return
  }
  if (ui.float) {
    ui.float = false
    render()
  }
})

/* 窗口变宽变窄，图谱得重排一次——它自己不会跟着动。 */
let resizeTimer = null
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => mountGraph(), 160)
})

/* 浏览器的前进后退：地址变了就照地址认一次页。 */
window.addEventListener('popstate', () => {
  const next = resolvePage()
  if (next === page) return
  page = next
  openFirstCard(next)
  render()
})

/* 切回这个标签页时补一次快照：后台期间轮询是停的。 */
document.addEventListener('visibilitychange', () => {
  if (chatHidden()) stopChatPolling()
  else syncChatPolling()
})

openFirstCard(page)
applyToolParam()
load()

/**
 * 地址上带 `?tool=memory` 就默认开那个小工具。
 *
 * 放在这里而不是 ui 初始化那儿：`TOOLS` 是后面才定义的 const，在 ui 那儿引用它
 * 会踩 TDZ。顺带也让「哪个工具」能收藏、能直连——不然只能靠手点二级菜单。
 */
function applyToolParam() {
  let asked = ''
  try {
    asked = new URLSearchParams((window.location && window.location.search) || '').get('tool') || ''
  } catch {
    /* 没有 location（测试里）就当没问 */
  }
  if (asked && TOOLS.some((t) => t.id === asked)) ui.tool = asked
}
