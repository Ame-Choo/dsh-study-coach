/**
 * 学习教练面板。纯原生 JS，同源调 /study/api/*。
 *
 * 分工摆在这儿：对话那边负责问、解析材料、生成地图、写档案；这一端只负责
 * 给人看、让人自评、勾任务，再加一个留言口，把话带回对话里去。
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

const STAGE_COLOR = {
  '没接触过': 'var(--stage-1)',
  '见过': 'var(--stage-2)',
  '能跟做': 'var(--stage-3)',
  '能独立做': 'var(--stage-4)',
  '熟练稳定': 'var(--stage-5)',
  '能讲明白': 'var(--stage-6)',
}

const KIND = { book: '教辅', video: '网课', notes: '讲义', past: '真题', other: '其他' }
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
  ['file', '打开网课 / 讲义'],
]

let state = null
let summary = null
/* 一份「今天每门课各有什么」的汇总，服务端 taskView 过，链接现成 */
let agenda = null
/* 学习目标清单 + 回收站（回收站只有 /study/api/library 这条接口给） */
let library = null
/* 对话那份快照：{ available, sessionId, messages, sessions, error } */
let chat = null
/* 「对话」页开着时的轮询句柄；离开这一页就停 */
let chatTimer = null
/* 上一份快照的指纹，用来判断要不要重画消息列表 */
let chatStamp = ''
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
  const [ability, archive, library, practice] = await Promise.all([
    alive('/study/api/ability'),
    alive('/study/api/archive?level=group&key='),
    alive('/study/api/library'),
    alive('/study/practice'),
  ])
  return { ability, archive, library, practice, file: await fileAlive() }
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
    // 对话只有那一页要看，别每回开机都多打一次接口
    if (page === 'coach') await loadChat({ withSessions: true })
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
 * 读一份对话快照。
 *
 * 走插件自己的 `/study/api/chat`，那一头拿的是 DSH 的 sessionController，
 * 所以画的就是真正的对话，不是另抄一份。服务端是旧代码（没有这条路由）时
 * 回 404，这里收成 `available:false`，卡片退回「留言」那套。
 */
async function loadChat({ sessionId = ui.chatSession, withSessions = false } = {}) {
  const query = '?max=60' + (sessionId ? '&sessionId=' + encodeURIComponent(sessionId) : '') + (withSessions ? '&sessions=1' : '')
  try {
    const out = await api('/study/api/chat' + query)
    chat = {
      available: out.available !== false,
      sessionId: out.sessionId || '',
      messages: Array.isArray(out.messages) ? out.messages : [],
      sessions: Array.isArray(out.sessions) ? out.sessions : (chat && chat.sessions) || [],
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
  { id: 'coach', path: '/study/coach', label: '对话', hint: '留言给教练，由对话处理' },
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
  today: { main: [['today', '今日任务', tasksCard]] },
  map: { main: [['map', '知识地图', mapCard]] },
  ability: { main: [['ability', '总体能力', abilityCard]] },
  library: {
    main: [['library', '学习档案', libraryCard], ['materials', '材料', materialsCard]],
    aside: [['goal', '学习目标', goalCard], ['tools', '基本工具', toolsCard]],
  },
  coach: {
    main: [['chat', '与教练对话', chatCard]],
    aside: [['inbox', '留言', inboxCard], ['guide', '教练的指引', guideCard]],
  },
}

/* ── 渲染 ─────────────────────────────────────────────────────────────── */
function render() {
  const app = document.getElementById('app')
  applyMode()
  app.className = ''
  app.innerHTML = `
    ${topBar()}
    ${staleCard()}
    ${page === 'home' ? homePage() : pageCards()}
    ${archiveModal()}
  `
  mountGraph()
  syncChatPolling()
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

function syncChatPolling() {
  // 通道没接通就别空转定时器——那会让页面永远有个活动的 interval 停不下来。
  // 接通之前靠卡片上那颗「重新连接」手动再试一次。
  if (page !== 'coach' || chatHidden() || !chat || !chat.available) {
    stopChatPolling()
    return
  }
  if (chatTimer) return
  chatTimer = setInterval(() => {
    void refreshChat()
  }, 2500)
}

async function refreshChat() {
  if (page !== 'coach' || chatHidden()) {
    stopChatPolling()
    return
  }
  const before = chatStamp
  await loadChat()
  if (!chatStamp || chatStamp !== before) paintChat()
}

/** 只换消息列表那一块，不整页重画。 */
function paintChat() {
  const host = document.getElementById('chat-log')
  const snapshot = chat || { messages: [] }
  chatStamp = chatFingerprint(snapshot)
  if (!host) {
    render()
    return
  }
  const stick = host.scrollHeight - host.scrollTop - host.clientHeight < 60
  host.innerHTML = chatLog(snapshot)
  if (stick) host.scrollTop = host.scrollHeight
}

/** 当前这一页的卡片；侧栏模式一律折成一条一条。 */
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
  // 卡片工厂返回空串就是「这一页现在不需要它」——比如对话通道通了，留言卡就让位。
  const draw = (col) =>
    (spec[col] || [])
      .map(([id, label, make]) => ({ id, label, html: make() }))
      .filter((card) => card.html)
      .map((card) => fold(card.id, card.label, card.html))
      .join('')
  const aside = draw('aside')
  if (isSidebar()) return `<div class="cards">${draw('main')}${aside}</div>`
  return `<div class="cards${aside ? ' two' : ''}">
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
    { id: 'coach', title: '与教练对话', hint: '有疑问、想更换材料、时间有变，都可留言', count: '' },
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
  const own = html.slice(0, at).replace(/^<section class="card/, '').replace(/"$/, '')
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

/** 会话选择。只有多个会话时才出，免得白占一行。 */
function chatPicker(snapshot) {
  const list = (snapshot && snapshot.sessions) || []
  if (list.length < 2) return ''
  const current = (snapshot && snapshot.sessionId) || ''
  const options = list
    .map((s) => {
      const label = s.title || (s.blank ? '（新会话）' : s.cwd ? s.cwd.split(/[\\/]/).pop() : s.sessionId.slice(0, 8))
      const mark = s.running ? ' · 进行中' : ''
      return `<option value="${esc(s.sessionId)}"${s.sessionId === current ? ' selected' : ''}>${esc(label + mark)}</option>`
    })
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
      <p class="dim">未接通对话通道（服务端可能是旧版本，或会话服务不可用）。可用右下角的「留言」先写下来，教练下次开口时会读到。</p>
      ${snapshot && snapshot.error ? `<p class="dim">原因：${esc(snapshot.error)}</p>` : ''}
      <div class="row"><button class="mini" data-act="chat-reload">重新连接</button>
      <span class="dim">重启 DSH 之后点这里，不用刷新整页。</span></div>
    </section>`
  }
  return `<section class="card">
    <div class="card-head"><h2>与教练对话</h2>${chatStatus(snapshot)}</div>
    ${chatPicker(snapshot)}
    <div class="chat-log" id="chat-log">${chatLog(snapshot)}</div>
    <form data-form="chat" class="form chat-form">
      <label>说点什么<textarea name="text" rows="2" placeholder="例如：这节的含参讨论没跟上 / 换个教材 / 今天只剩 30 分钟"></textarea></label>
      <div class="row">
        <button type="submit" class="primary"${ui.chatSending ? ' disabled' : ''}>${ui.chatSending ? '发送中…' : '发送'}</button>
        <span class="dim">发送后进入对话，回复会自己出现在上面。</span>
      </div>
    </form>
  </section>`
}

/** 把话带回对话里。递到了教练立刻被叫起来；递不到就先存着，等他开口。 */
function inboxCard() {
  // 对话读得通就用不着留言了：那一页能直接说话。留言只在通道没接通时兜底。
  if (chat && chat.available) return ''
  const items = (state.inbox && state.inbox.items) || []
  const recent = items.slice(-3).reverse()
  return `<section class="card">
    <div class="card-head"><h2>给教练留言</h2></div>
    <p class="dim">此处内容会直接发送到对话。连接中断时会先保存，待下次对话处理。</p>
    <form data-form="inbox" class="form">
      <label>说点什么<textarea name="text" rows="3" placeholder="例如：这一部分没看懂 / 想更换教材 / 今天没有时间"></textarea></label>
      <div class="row"><button type="submit" class="primary">发送</button></div>
    </form>
    ${
      recent.length
        ? `<ul class="list">${recent
            .map(
              (i) => `<li class="${i.read ? 'done' : ''}"><span style="flex:1">${esc(i.text)}</span><span class="dim">${i.read ? '已读' : '未读'}</span></li>`,
            )
            .join('')}</ul>`
        : ''
    }
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
    if (kind === 'chat') {
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
          toast('已发送')
        }
      } finally {
        ui.chatSending = false
      }
      // 等日志追上：立刻拉一次，过一秒再拉一次，别让人盯着空白等
      await loadChat()
      paintChat()
      setTimeout(() => void refreshChat(), 1200)
    } else if (kind === 'inbox') {
      const text = String(data.get('text') || '').trim()
      if (!text) {
        toast('内容为空', true)
        return
      }
      const out = await api('/study/api/inbox', { text })
      toast(out.pushed ? '已发送' : '已暂存（' + (out.pushError || '通道未通') + '），请回到对话中说明')
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
  if (event.key !== 'Escape') return
  if (ui.archive) {
    ui.archive = null
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
load()
