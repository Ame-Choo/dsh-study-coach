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

import { STAGES, STAGE_COLOR } from './stages.js'
import { inline as mdInline, renderMarkdown } from './md.js'
import { openPath } from './urls.js'

/* 与 lib/store.js 的 MISTAKE_STATUS 同序：待验证 → 已订正 → 已复做对 */
const MISTAKE_STATUS = ['待验证', '已订正', '已复做对']
/** 学生画像那五档，跟 lib/store.js 的 FACT_KINDS 同序同字。 */
const FACT_KINDS = ['习惯', '强项', '弱项', '偏好', '背景']

const KIND = { book: '教辅', video: '网课', notes: '讲义', past: '真题', ai: 'AI 出题', other: '其他' }
/** 书架上分组的顺序：教辅在前，AI 出的卷子紧随其后（跟教辅平级），剩下按重要性排。 */
const KIND_ORDER = ['book', 'ai', 'notes', 'past', 'video', 'other']
const TASK_KIND = { watch: '看课', read: '读教材', practice: '练习', review: '复习', other: '其他' }
const GUIDE_KIND = { ask: '需在对话中回答', self: '请在下方自评', plan: '查看今日任务', done: '' }

/** 右下角那个浮窗被拖到哪儿了。拖过一次才存，没拖过就是 CSS 里那个右下角。 */
const FLOAT_POS_KEY = 'study-coach:float-pos'

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
  ['ability', '总体能力判断', '知识地图页「掌握度」那张总评卡'],
  ['archive', '每级掌握档案', '点「档案」看单个单元的明细'],
  ['student', '学生画像', '知识地图页边上的画像卡'],
  ['library', '学习目标库', '档案页切目标、新建目标'],
  ['practice', '做题页', '「做题」那一整页'],
  ['mistakes', '错题本', '错题本卡和每条的「再练」'],
  ['review', '今日复盘图', '今天页那张图'],
  ['shelf', '资料书架', '资料页的书架'],
  ['toolbox', '工具栏目', '工具页'],
  ['memory', '记忆卡', '工具页的记忆卡'],
  ['file', '打开网课 / 讲义', '任务里所有「打开」按钮'],
]

let state = null
let summary = null
/* 一份「今天每门课各有什么」的汇总，服务端 taskView 过，链接现成 */
let agenda = null
/* 学习目标清单 + 回收站（回收站只有 /study/api/library 这条接口给） */
let library = null
/* 错题本（只有 /study/api/mistakes 这条接口给，state 里没有） */
let mistakes = null
/* 学生画像：历次攒下来的「关于这个人」的判断，每条挂着几条真证据。state 里没有。 */
let student = null
/* 今日复盘图：{ date, data, svg }；这一天没动过任何单元就是 null */
let review = null
/* 书架：{ materials: [...], pagesRoot }；只有「资料」页拉 */
let shelf = null
/* 资料图谱：挑中的那份材料自己的目录摊成的三层（{material, basis, groups, loose}）；只有「学习」页拉 */
let atlasTree = null
/* 书架里正摊开哪一本（materialId），空串就是都折着 */
let shelfOpen = ''
/* 摊开那一本的页级索引：{ materialId, toc, spans, pages, chapters } */
let shelfIndex = null
/* 对话那份快照：{ available, sessionId, messages, sessions, filtered, error } */
let chat = null
/* 「对话」页开着时的轮询句柄；离开这一页就停 */
let chatTimer = null
/* 广播通道（SSE）那条长连接；同样是离开对话就收 */
let chatEvents = null
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
  /* 「学习」页挑的是哪一份材料（null = 还没挑过，进来默认第一份） */
  atlasPick: null,
  /* 「学习」页折起来的大类 / 模块：键是 `g:大类序号` 与 `m:大类序号:模块序号`（null = 都摊着） */
  atlasShut: null,
  /* 「对话」页正看着哪个会话；空串 = 服务端替我挑最近那个 */
  chatSession: '',
  /* 正在发的话（发出后先乐观占位，等服务端日志追上再换成真的） */
  chatSending: false,
  /* 右下角那个悬浮小窗开着没有 */
  float: false,
  /* 浮窗被拖到哪儿了：null = 没拖过，照 CSS 待在右下角 */
  floatPos: readFloatPos(),
  /* 错题本只看哪一档，空串 = 全看 */
  mistakeStatus: '',
  factKind: '',
  factMore: false,
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
 *
 * 「怎么算出来的」不在这儿：规则在 assets/boot.js 里，HTML 的 <head> 引它，
 * 第一次绘制之前就跑完了（不然会先按一种模式画、再跳成另一种）。这里只把
 * 它算好的结果读出来，别在这儿再抄一遍阈值。
 */
const boot = window.StudyBoot
if (!boot) throw new Error('assets/boot.js 没跑到：panel.js 指望它在 <head> 里先把模式和配色定下来')

const MODE_KEY = boot.MODE_KEY
const MODES = [
  { id: 'sidebar', label: '侧栏', hint: '窄栏模式，聚焦今日任务' },
  { id: 'browser', label: '浏览器', hint: '整页模式，总览与编辑' },
]
let mode = boot.mode

/* ── 两套配色 ─────────────────────────────────────────────────────────────
 * 深色（罗德岛终端）是默认，浅色是同一套造型的纸白版，白天看。
 * 选择存在本机，换页面也还在。定在 <html data-theme> 上，颜色全在 style.css 的变量里。
 */
const THEME_KEY = boot.THEME_KEY
let theme = boot.theme

function applyTheme() {
  const root = document.documentElement
  if (root && root.dataset) root.dataset.theme = theme
}

/** 换配色：记住它再重画——颜色是 CSS 变量，本来不用重画，但按钮上的图标要跟着翻。 */
function setTheme(next) {
  theme = next === 'light' ? 'light' : 'dark'
  boot.save(THEME_KEY, theme)
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
  boot.save(MODE_KEY, next)
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

/**
 * 今天。**跟服务端一套口径**（`lib/routes.js` 的 `todayIso()` 也是 `toISOString().slice(0, 10)`）。
 *
 * 别改成本地日期：东八区一过 16:00，本地日期就跳到第二天，而任务、番茄钟、证据全是按 UTC
 * 日期存的——面板会显示「今天还没排任务」，实际上今天的活儿就在那儿（踩过）。
 */
function today() {
  return new Date().toISOString().slice(0, 10)
}

/** 周几。复盘图顶上写「2026-10-01 · 周四」，今日任务那页照同一口径，所以两边共用一个助手。 */
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
function weekdayOf(date) {
  const parts = String(date ?? '').split('-').map(Number)
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return ''
  const d = new Date(parts[0], parts[1] - 1, parts[2])
  return Number.isNaN(d.getTime()) ? '' : WEEKDAYS[d.getDay()]
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
  const [ability, archive, library, practice, mistakes, studentAlive, review, shelfAlive, toolboxAlive, memoryAlive, treeAlive] = await Promise.all([
    alive('/study/api/ability'),
    alive('/study/api/archive?level=group&key='),
    alive('/study/api/library'),
    alive('/study/practice'),
    alive('/study/api/mistakes'),
    alive('/study/api/student'),
    alive('/study/api/review'),
    alive('/study/api/materials'),
    alive('/study/api/toolbox'),
    alive('/study/api/memory'),
    // 缺参数在新代码里回 400、旧代码回 404，正好分得开
    alive('/study/api/material/tree'),
  ])
  return {
    ability,
    archive,
    library,
    practice,
    mistakes,
    student: studentAlive,
    review,
    shelf: shelfAlive,
    toolbox: toolboxAlive,
    memory: memoryAlive,
    tree: treeAlive,
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

/**
 * 体检：把「现在有什么不对」分成三档摊开，别只报一句「404」。
 *
 * 学生打开面板想知道的是「我该干什么」，不是「哪条路由没注册」。所以每条都写成
 * 「哪儿不对 + 为什么 + 怎么修」，能点的还挂一颗按钮直接过去。
 *
 * 三档的分法：
 *   挡路的（bad）——这件事不做，页面上有一整块是坏的；
 *   该修的（warn）——不挡路，但拖着迟早出事（地图没定稿、材料没通读、证据兑不上）；
 *   顺手能做的（ok）——现在不做也没什么，做了下一节会顺一点。
 */
function healthReport() {
  const blockers = []
  const warn = []
  const tips = []
  const map = (state && state.map) || {}
  const profile = (state && state.profile) || {}
  const modules = Array.isArray(map.modules) ? map.modules : []
  const points = modules.flatMap((m) => (Array.isArray(m.points) ? m.points : []))
  const materials = Array.isArray(profile.materials) ? profile.materials : []
  const byMaterial = ((state && state.analysis && state.analysis.byMaterial) || {})
  const masteryPoints = ((state && state.mastery && state.mastery.points) || {})
  const target = Number(profile.minutesPerDay) || 0

  // ── 挡路的：服务端旧代码 ───────────────────────────────────────────────
  if (capabilities) {
    const miss = STALE_NEED.filter(([key]) => !capabilities[key])
    if (miss.length) {
      blockers.push({
        title: `服务端还是旧代码，${miss.length} 处点下去会 404`,
        hint:
          miss.map(([, label, where]) => `${label}——${where}`).join('；') +
          '。页面内容是从磁盘现读的，所以看着是新版；路由在 DSH 启动时加载，换不掉。重启 DSH 就都回来了。这段时间要用，直接在对话里跟教练说。',
      })
    }
  }

  // ── 该修的 ─────────────────────────────────────────────────────────────
  if (modules.length && map.status !== 'confirmed') {
    warn.push({
      title: '知识地图还是草稿',
      hint: '没念给学生确认过。地图错了，后面排的任务和记的掌握度全落在错的地方——念一遍，他认可了再定稿。',
      nav: ['map', '去看地图'],
    })
  }

  if (Object.keys(profile).length) {
    const gaps = []
    if (!String(profile.outcome || '').trim()) gaps.push('要掌握到什么程度（outcome）')
    if (!String(profile.deadline || '').trim()) gaps.push('最晚哪天（deadline）')
    if (!target) gaps.push('每天能学多久（minutesPerDay）')
    if (gaps.length) {
      warn.push({
        title: `学习目标还缺 ${gaps.length} 项`,
        hint: `${gaps.join('、')}。${target ? '' : '没有分钟数就只能靠猜着排任务。'}在对话里跟教练说一声，让他补上。`,
      })
    }
  }

  const unread = materials.filter((m) => !byMaterial[m.id])
  if (unread.length) {
    warn.push({
      title: `${unread.length} 份材料登记了但没通读`,
      hint: `${
        unread.map((m) => m.title || m.id).slice(0, 3).join('、')
      }${unread.length > 3 ? ' 等' : ''}。没通读就排作业，页码、题号多半对不上，学生一打开就发现是错的。`,
      nav: ['materials', '去资料页'],
    })
  }

  if (student && Array.isArray(student.orphans) && student.orphans.length) {
    warn.push({
      title: `学生画像里 ${student.orphans.length} 条判断引的证据找不到了`,
      hint: '多半是地图重画换了单元号，或者那条证据被删了。不是坏事，但得核一下——在对话里让教练重新挂证据，或者删掉这条判断。',
      nav: ['map', '去地图页'],
    })
  }

  const day = todayTasks()
  const planned = day.reduce((n, t) => n + (Number(t.minutes) || 0), 0)
  if (target && planned > target) {
    warn.push({
      title: `今天的任务排了 ${planned} 分钟，比每天能学的多 ${planned - target} 分钟`,
      hint: '排多了的结果通常是一条都不做。让教练砍掉几条，或者把其中一条挪到明天。',
      nav: ['today', '去看今天'],
    })
  }

  const pending = mistakes && Number(mistakes.byStatus && mistakes.byStatus['待验证'])
  if (pending >= 3) {
    warn.push({
      title: `错题本上有 ${pending} 道还挂着「待验证」`,
      hint: '订正了不等于会了。挑一两道隔几天重做一遍，做对了再标「已复做对」——不然这个本子只会越堆越长。',
      nav: ['map', '去错题本'],
    })
  }

  // ── 顺手能做的 ─────────────────────────────────────────────────────────
  if (Object.keys(profile).length && !materials.length) {
    tips.push({
      title: '一份材料都还没登记',
      hint: '把教辅、网课目录丢进对话里。材料登记完才有地图、才有能落到页码的任务。',
      nav: ['materials', '去资料页'],
    })
  }

  const noPractice = points.filter((p) => !String(p.practice || '').trim()).length
  if (points.length && noPractice) {
    tips.push({
      title: `${noPractice} 个单元还没挂练习材料`,
      hint: '挂上之后做题页才有「按页直达」，点一下直接翻到那一页。',
      nav: ['map', '去看地图'],
    })
  }

  const touched = Object.values(masteryPoints).filter((p) => p && (p.evidence || []).length).length
  if (points.length && !touched) {
    tips.push({
      title: '一条掌握度证据都还没记',
      hint: '让他做几道题，判完记一条。没有证据，能力页和复盘图都是空的。',
    })
  }

  if (memory && Number(memory.dueTotal) > 0) {
    tips.push({
      title: `今天有 ${memory.dueTotal} 张记忆卡到点了`,
      hint: '按艾宾浩斯排的，到点过一次再往后推。翻卡片这活儿他自己做，别替他自评。',
      nav: ['toolbox', '去背'],
    })
  }

  return { blockers, warn, tips }
}

/** 体检卡。三档都空就不出这张卡。 */
function healthCard() {
  const { blockers, warn, tips } = healthReport()
  const sections = [
    ['挡路的', 'bad', blockers, '这几样不修，页面上有一整块是坏的'],
    ['该修的', 'warn', warn, '不挡路，但拖着迟早出事'],
    ['顺手能做的', 'ok', tips, '现在不做也没什么'],
  ].filter(([, , list]) => list.length)
  if (!sections.length) return ''

  const body = sections
    .map(([label, cls, list, note]) => {
      const rows = list
        .map(
          (item) => `<li class="hd-item">
        <div class="mat-main"><b>${esc(item.title)}</b><p class="dim">${esc(item.hint || '')}</p></div>
        ${item.nav ? `<button class="mini" data-nav="${esc(item.nav[0])}">${esc(item.nav[1])}</button>` : ''}
      </li>`,
        )
        .join('')
      return `<div class="hd-sec ${cls}">
      <h3>${label}<span class="dim">${list.length}</span><em>${note}</em></h3>
      <ul class="list tight hd-list">${rows}</ul>
    </div>`
    })
    .join('')

  const head = blockers.length
    ? `${blockers.length} 件挡路的`
    : warn.length
      ? `${warn.length} 件该修的`
      : '没有挡路的问题'
  return `<section class="card health">
    <div class="card-head"><h2>体检</h2><span class="dim">${head}</span></div>
    ${body}
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
    student = await loadStudent()
    // 复盘图只有「今日任务」这一页要（主页不放它——用户说主页那两张卡删掉）。其余页不拉，省一趟请求和 9 KB。
    review = page === 'today' ? await loadReview() : null
    // 书架只有「资料」这一页要。
    shelf = page === 'materials' || page === 'atlas' ? await loadShelf() : null
    // 资料图谱：拿挑中的那份材料自己的目录摊三层。只有「学习」页要。
    atlasTree = page === 'atlas' ? await loadAtlas() : null
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
 * 学生画像。跟错题本一个路数：服务端汇总成一份带「兑好的证据」的东西给面板看。
 * 服务端是旧代码（没有这条路由）就返回 null，能力页少画那一段，别让整页挂掉。
 */
async function loadStudent() {
  if (!capabilities || !capabilities.student) return null
  try {
    const out = await api('/study/api/student?limit=40')
    if (!Array.isArray(out.facts)) return null
    return {
      facts: out.facts,
      total: Number(out.total) || out.facts.length,
      byKind: out.byKind || {},
      orphans: Array.isArray(out.orphans) ? out.orphans : [],
    }
  } catch {
    return null
  }
}

/**
 * 今日复盘图。常驻在「主页」与「今日任务」两页，别的页不拉——一张图 9 KB，没必要每页都拖。
 * 服务端这条通道没接上（老版本）才返回 null；「今天什么都没动过」（data / svg 空）照样返回，
 * 由 reviewCard() 自己写空态——常驻的卡不该自己消失。
 */
async function loadReview() {
  if (!capabilities || !capabilities.review) return null
  try {
    const out = await api('/study/api/review?date=' + today())
    // data / svg 可能是空的（今天什么都没动过）——那不是「没接通」，卡片照样常驻，自己写空态。
    if (!out || typeof out.svg !== 'string') return null
    return { date: out.date || today(), data: out.data || null, svg: out.svg }
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

/**
 * 资料图谱：把**挑中的那一份**材料自己的目录（或文件夹）摊成三层。
 * 一次只摊一份——几本书的目录叠在一起只会互相打架。挑哪一份记在 `ui.atlasPick`，
 * 没挑过就默认书架上的第一份。
 * 服务端是旧代码（没有这条路由）就返回 null，卡片上说明白要重启 DSH。
 */
async function loadAtlas() {
  const mats = ((shelf && shelf.materials) || []).filter((m) => m && m.materialId)
  if (!mats.length) return null
  if (!ui.atlasPick || !mats.some((m) => m.materialId === ui.atlasPick)) ui.atlasPick = mats[0].materialId
  if (!capabilities || !capabilities.tree) return null
  try {
    const out = await api('/study/api/material/tree?materialId=' + encodeURIComponent(ui.atlasPick))
    return out && out.ok === false ? null : out
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
      // 服务端只列学习模式（study-coach）的会话时是 true；老宿主不给预设信息时是 false。
      filtered: typeof out.filtered === 'boolean' ? out.filtered : Boolean(chat && chat.filtered),
      error: out.error || '',
    }
  } catch (error) {
    chat = {
      available: false,
      sessionId: '',
      messages: [],
      sessions: (chat && chat.sessions) || [],
      filtered: Boolean(chat && chat.filtered),
      error: error.message,
    }
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
  { id: 'today', path: '/study/today', label: '今日任务', hint: '今日任务，逐条完成' },
  { id: 'map', path: '/study/map', label: '知识地图', hint: '课程全貌，可逐单元自评' },
  { id: 'atlas', path: '/study/atlas', label: '学习', hint: '挑一份材料，按它自己的目录摊成三层' },
  { id: 'library', path: '/study/library', label: '档案', hint: '学习目标、材料、基本工具、掌握度' },
  { id: 'materials', path: '/study/materials', label: '资料', hint: '登记教辅、拆成页、看每一页归到哪个单元' },
  { id: 'toolbox', path: '/study/toolbox', label: '工具', hint: '番茄钟、清单，还有以后往里加的小工具' },
  { id: 'coach', path: '/study/coach', label: '对话', hint: '直接和教练说话，这一页就是聊天窗口' },
]

let page = resolvePage()
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

/** 从地址认页；认不出来（或者测试里没有 location）就落主页。 */
function resolvePage() {
  let path = ''
  try {
    path = (window.location && window.location.pathname) || ''
  } catch {
    /* 没有 location 就当主页 */
  }
  const clean = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
  if (clean === '' || clean === '/study') return 'home'
  // 「能力」那一页并进了知识地图（掌握度那一节），老地址照旧能开——别让收藏夹里那条链接 404。
  const alias = { '/study/ability': 'map' }
  const hit = PAGES.find((p) => p.path === clean)
  return hit ? hit.id : alias[clean] || 'home'
}

/*
 * 每页各放哪几张卡。main 宽、aside 窄，各自一列往下摞——grid 两栏各摞各的，
 * 矮卡不会把高卡顶出一个洞来。
 */
const PAGE_CARDS = {
  today: { main: [['today', '今日任务', tasksCard], ['review', '今日复盘图', reviewCard]] },
  // 知识图谱这一页三节：图谱 → 掌握度（饼图 + 大类）→ 错题本；学生画像在边上。
  // 「能力」那一页已经不单独存在了——它的内容就是下面那两节。
  map: {
    main: [['map', '知识地图', mapCard], ['ability', '掌握度', abilityCard], ['mistakes', '错题本', mistakesCard]],
    aside: [['student', '学生画像', studentCard]],
  },
  // 学习这一页：选资料 → 看「资料图谱」——哪个大类、哪个模块、哪个最小单元有材料对上。
  atlas: {
    main: [['atlas', '资料图谱', atlasCard]],
    aside: [['guide', '教练的指引', guideCard]],
  },
  library: {
    // 档案这一页也挂一份掌握度（用户要的）：翻档案的时候顺眼就能看到整体饼图与各大类。
    // 它跟地图页那张是同一个 abilityCard()，两处的展开状态也共用同一个 id。
    main: [['library', '学习档案', libraryCard], ['ability', '掌握度', abilityCard], ['materials', '材料', materialsCard]],
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
    ${page === 'home'
      // 主页上「今天怎么样 + 下一步点哪儿」先说话，体检卡放它后面——
      // 一进来先看到一屏「该修的」，人还没读今天是什么情况就先挨一顿批评。
      ? `${homePage()}${healthCard()}`
      : `${healthCard()}${page === 'toolbox' ? toolMenu() : ''}${pageCards()}`}
    ${archiveModal()}
    ${floatChat()}
  `
  mountGraph()
  syncChatPolling()
  syncFocusTicker()
  clampFloatToView()
}

/* ── 对话：轮询 + 广播通道 ───────────────────────────────────────────────
 * 「对话」页要跟着 DSH 那边的进度走，所以开着的时候拉新快照。两条路一起走：
 *   ①**服务端推**（SSE `/study/api/events`）：一有新东西就送一帧。浏览器会把后台标签页里的
 *     `setInterval` 压到一分钟一次甚至冻住——「收到的消息要手动刷新才显示」主要就是这个，
 *     推送不受那条节流管。
 *   ②**2.5 秒轮询**兜底：通道没接通（老服务端 / 老浏览器）或者断线时照旧跟得上。
 * 只在指纹变了的时候重画消息列表，正在输的字和滚到一半的位置都不动。
 */
function stopChatPolling() {
  if (chatTimer) {
    clearInterval(chatTimer)
    chatTimer = null
  }
}

/**
 * 广播通道收掉。
 *
 * 只在**离开对话**的时候收：标签页切到后台**不收**——那正是最需要推送的时候
 * （学生常常在 DSH 那边说完一句、切回来才看面板，定时器在后台是慢的）。
 */
function stopChatEvents() {
  if (!chatEvents) return
  try {
    chatEvents.close()
  } catch {
    /* 关不上也无所谓，下面就重新建一个 */
  }
  chatEvents = null
}

function startChatEvents() {
  if (chatEvents) return
  const Source = typeof EventSource === 'function' ? EventSource : null
  // 老浏览器、或者单测那种假 DOM 里没有 EventSource：只跑轮询，行为跟以前一样。
  if (!Source) return
  try {
    chatEvents = new Source('/study/api/events')
  } catch {
    chatEvents = null
    return
  }
  for (const name of ['hello', 'change', 'tick']) {
    chatEvents.addEventListener(name, () => {
      void refreshChat({ pushed: true })
    })
  }
  // 断了不用管：浏览器自己会重连（重连成功会再发一帧 hello），这期间轮询接着兜。
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
  if (!chatVisible() || !chat || !chat.available) {
    stopChatPolling()
    stopChatEvents()
    return
  }
  startChatEvents()
  // 后台不挂定时器：浏览器本来就会把它压到一分钟一次甚至冻住，而推送那条一直开着。
  // 切回前台由 visibilitychange 立刻补一次并重新挂上。
  if (chatHidden()) {
    stopChatPolling()
    return
  }
  if (chatTimer) return
  chatTimer = setInterval(() => {
    void refreshChat()
  }, 2500)
}

async function refreshChat({ pushed = false } = {}) {
  if (!chatVisible()) {
    stopChatPolling()
    stopChatEvents()
    return
  }
  // 推送来的一帧照刷——后台标签页里也能把内容备好，切回来就是新的。
  if (!pushed && chatHidden()) return
  const before = chatStamp
  await loadChat()
  if (!chatStamp || chatStamp !== before) paintChat()
}

/**
 * 只换消息列表那一块，不整页重画。
 * 整页那个日志和悬浮窗那个日志都挂 `[data-chat-log]`，谁在页面上就填谁。
 *
 * 位置得自己管：换 `innerHTML` 的时候浏览器不保证替我们留住 `scrollTop`，
 * 一不留神就停回顶上——学生报的「发完消息跳到最上面，得手动拖下来」。
 * 所以换之前先记下原来贴不贴底、原来在哪，换完放回去；`bottom: true`
 * （刚发出去一条、刚切会话）一律落到底。
 */
function paintChat({ bottom = false } = {}) {
  const snapshot = chat || { messages: [] }
  chatStamp = chatFingerprint(snapshot)
  const hosts = ['chat-log', 'float-log'].map((id) => document.getElementById(id)).filter(Boolean)
  if (!hosts.length) {
    render()
    return
  }
  for (const host of hosts) {
    const stick = host.scrollHeight - host.scrollTop - host.clientHeight < 60
    const keep = host.scrollTop
    const toBottom = bottom || stick
    host.innerHTML = chatLog(snapshot)
    host.scrollTop = toBottom ? host.scrollHeight : keep
    // 图与公式是插进去之后才量出高度的，落到底得再等一帧。
    if (toBottom && typeof setTimeout === 'function') {
      setTimeout(() => {
        host.scrollTop = host.scrollHeight
      }, 0)
    }
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
    { id: 'map', title: '掌握度', hint: '整体饼图、薄弱环节、复习安排', count: total ? `碰过 ${pct}%` : '还没数据' },
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
    // 板块右上的完成度和索引板的总进度都走服务端算好的那一份（lib/map.js 的口径），
    // 面板不再自己拿档位平均一遍——两处口径不一样，学生迟早会发现数字对不上。
    progress: state.progress || null,
    // 该复习的日期得跟「今天」比。写死面板算的本地日期，别把判断丢给图谱那边。
    today: today(),
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
    openUrl(openPath(target))
    return
  }
  const name = `${point.id} ${point.title || ''}`.trim()
  api('/study/api/inbox', { text: `「${name}」这一节尚未关联网课，请帮忙配置。` })
    .then(() => toast('已发送到对话'))
    .catch((err) => toast('发送失败：' + err.message))
}

/**
 * 顶上那句：教练留了话就写出来，没留就**什么都不画**。
 *
 * 以前这里垫了一句「本页仅供查看，改动请在对话里提」，每页都挂着——一来是废话，
 * 二来也不准（面板上能动手的其实不少：自评、勾任务、管清单、切档案）。教练没说
 * 话的时候，这一栏就该是空的。
 */
function guideCard() {
  const guide = state.guide || {}
  if (!guide.text) return ''
  const sub = GUIDE_KIND[guide.kind] || ''
  return `<section class="card guide on">
    <div class="guide-text">${esc(guide.text)}</div>
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
/**
 * 四档掌握度。地图上是六档（点、色带、逐单元的标签），摊成饼太碎——饼上只看四块，
 * 颜色从亮到暗：越亮越稳。合成规则只写在这一处。
 */
const MASTERY_BANDS = [
  { key: 'solid', label: '熟练掌握', stages: ['熟练稳定', '能讲明白'], color: 'var(--stage-6)' },
  { key: 'fair', label: '大概掌握', stages: ['能独立做'], color: 'var(--stage-4)' },
  { key: 'weak', label: '薄弱', stages: ['能跟做', '见过'], color: 'var(--stage-2)' },
  { key: 'none', label: '完全不会', stages: ['没接触过'], color: 'var(--stage-1)' },
]

/** 每一档几个单元、占多少。表里没认出来的档位差额算进「完全不会」，免得饼图缺一块。 */
function masteryBands(byStage, total) {
  const bands = MASTERY_BANDS.map((b) => ({
    ...b,
    count: b.stages.reduce((n, st) => n + (Number(byStage && byStage[st]) || 0), 0),
  }))
  const known = bands.reduce((n, b) => n + b.count, 0)
  if (total > known) bands[bands.length - 1].count += total - known
  return bands.map((b) => ({ ...b, pct: total ? (b.count / total) * 100 : 0 }))
}

/**
 * 饼图。`pathLength="100"` 让每一段的 dash 长度直接就是百分比，不用自己算弧线；
 * 段尾多给 0.4 是为了盖住抗锯齿留的那条缝（相邻两块相差大时那条缝会显成一根黑线）。
 */
function masteryPie(bands, overall) {
  const r2 = (v) => Math.round(v * 100) / 100
  let acc = 0
  const slices = bands
    .map((b) => {
      const dash = b.pct > 0 ? `${r2(b.pct + 0.4)} 100` : '0 100'
      const off = -acc
      acc += b.pct
      return `<circle class="pie-slice" data-band="${b.key}" cx="100" cy="100" r="66" pathLength="100" fill="none" stroke="${b.color}" stroke-width="34" stroke-dasharray="${dash}" stroke-dashoffset="${r2(off)}"></circle>`
    })
    .join('')
  const said = bands.map((b) => `${b.label} ${Math.round(b.pct)}%`).join('、')
  return `<svg class="pie" viewBox="0 0 200 200" role="img" aria-label="整体掌握度 ${overall}%：${said}">
    <g transform="rotate(-90 100 100)">${slices}</g>
  </svg>`
}

function abilityCard() {
  const a = state.ability
  if (!a) return ''
  const pct = Math.round(Number(a.overall) || 0)
  const judge = (a.judgement && a.judgement.text) || ''

  const modules = state.map && Array.isArray(state.map.modules) ? state.map.modules : []
  const bands = masteryBands((summary && summary.byStage) || {}, (summary && summary.total) || 0)
  const pie = masteryPie(bands, pct)
  const legend = bands
    .map(
      (b) => `<li>
        <span class="lg"><i class="lg-dot" style="background:${b.color}"></i>${b.label}</span>
        <span class="pie-pct">${Math.round(b.pct)}%</span>
        <span class="dim">${b.count} 个单元</span>
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
      <h2>掌握度</h2>
      <span class="dim">${esc(a.today || '')}</span>
    </div>
    <div class="mastery">
      <div class="pie-wrap">
        ${pie}
        <div class="pie-center"><b>${pct}%</b><em>整体掌握度</em></div>
      </div>
      <div class="pie-side">
        <ul class="pie-legend">${legend}</ul>
        <div class="stats">
          <span><b>${a.touched}</b>/${a.total} 碰过</span>
          <span>平均把握 <b>${Math.round((a.avgConfidence || 0) * 100)}%</b></span>
          <span>薄弱 <b>${a.weakTotal}</b></span>
          <span>该复习 <b>${a.dueTotal}</b></span>
          ${typeof (a.goal && a.goal.daysLeft) === 'number' ? `<span>离目标 <b>${a.goal.daysLeft}</b> 天</span>` : ''}
        </div>
        <p class="dim">一共 ${a.total} 个单元：${bands.map((b) => `${b.label} ${b.count}`).join(' · ')}</p>
      </div>
    </div>
    ${
      judge
        ? `<div class="judgement"><span class="tag">总评</span><div>${esc(judge)}</div>
            ${a.judgement.level ? `<div class="dim">${esc(a.judgement.level)}</div>` : ''}</div>`
        : `<p class="dim">尚无总评。可在对话中提问「我现在什么水平」，教练会依据以上数据给出评价。</p>`
    }
    <h3 class="sub">各大类</h3>
    <div class="grouped">${
      groupedBlocks(modules) || '<p class="dim">尚未分类。在地图中为每个模块填写 group 即可。</p>'
    }</div>
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
        m.step ? `错步：${mdInlineText(m.step)}` : '',
        m.cause ? `错因：${mdInlineText(m.cause)}` : '',
        m.fix ? `订正：${mdInlineText(m.fix)}` : '',
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

/**
 * 学生画像：关于「这个人」的判断，一条一句，每条都挂着它当初是从哪几次看出来的。
 *
 * 跟错题本一样，这里**只读 + 删**——写由教练在对话里做（`study_student`），
 * 因为写一条判断必须先指着几条真证据，面板上没有「证据列表」可点。
 * 但「这条不对」这种事学生最清楚，所以删除留在这儿。
 */
function studentCard() {
  const doc = student
  if (!doc || !doc.facts.length) return ''
  const by = doc.byKind || {}
  const filter = ui.factKind
  const shown = (filter ? doc.facts.filter((f) => f.kind === filter) : doc.facts).slice(0, ui.factMore ? 200 : 8)

  const chips = ['']
    .concat(FACT_KINDS)
    .map((k) => {
      const n = k ? by[k] || 0 : doc.total
      const on = filter === k ? ' on' : ''
      return `<button class="mini${on}" data-act="fact-filter" data-kind="${esc(k)}">${k || '全部'} ${n}</button>`
    })
    .join(' ')

  const rows = shown
    .map((f) => {
      // 兑不上的证据不藏起来——恰恰是它得让学生看见，好去把话说清楚
      const ev = (f.evidence || [])
        .map((e) => {
          const label = e.ok
            ? `${esc(e.pointTitle || e.pointId)}${e.kind ? ' · ' + esc(e.kind) : ''}`
            : `${esc(e.pointTitle || e.pointId || '（单元也没了）')} <span class="bad">证据没了</span>`
          return `<li class="dim">${label}${e.note ? ` —— ${esc(e.note)}` : ''}</li>`
        })
        .join('')
      return `<li class="fact">
        <span class="tag">${esc(f.kind)}</span>
        <div class="mat-main">
          <b>${esc(f.text)}</b>
          ${f.note ? `<div class="dim">${esc(f.note)}</div>` : ''}
          <ul class="facts-ev">${ev}</ul>
        </div>
        <button class="mini" data-act="fact-del" data-id="${esc(f.id)}" title="这条判断不对，删掉">删</button>
      </li>`
    })
    .join('')

  const orphan = doc.orphans.length
    ? `<p class="dim over">有 ${doc.orphans.length} 条判断引的证据找不到了（多半是地图重画换了单元号）。在对话里说一声，让教练核一下。</p>`
    : ''

  return `<section class="card student">
    <div class="card-head">
      <h2>学生画像</h2>
      <span class="dim">${doc.total} 条判断${doc.orphans.length ? ` · ${doc.orphans.length} 条要修` : ''}</span>
    </div>
    <div class="chips">${chips}</div>
    <ul class="list tight facts">${rows}</ul>
    ${shown.length < (filter ? doc.facts.filter((f) => f.kind === filter) : doc.facts).length
      ? `<button class="mini" data-act="fact-more">还有更多，展开</button>`
      : ''}
    ${orphan}
    <p class="dim">这些是历次攒下来的结论，每条都得指着几次真表现。想加、想改，在对话里说；觉得不对，点右边的「删」。</p>
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

  /* 简报条：一行大写拉丁 + 四个数 + 一条六档色带 + 一个档位图例。
     图在下面自己会讲话，这里只负责让「一共多大、读到哪儿」一眼看得见。 */
  const overall = Math.round(Number((state.progress && state.progress.overall) || 0))
  const legend = STAGES.map((st) => `<span class="lg"><i class="lg-dot" style="background:${STAGE_COLOR[st]}"></i>${st}</span>`).join('')

  return `<section class="card">
    <div class="card-head">
      <h2>知识地图</h2>
      <span class="badge ${map.status === 'confirmed' ? 'confirmed' : ''}">${map.status === 'confirmed' ? '已定稿' : '草稿'}</span>
      ${map.status === 'confirmed' ? '' : '<button class="ghost" data-act="map-confirm">确认定稿</button>'}
    </div>
    <div class="map-brief">
      <div class="map-brief-head">
        <span class="map-kicker">KNOWLEDGE MAP</span>
        <span class="map-overall">${overall}%<em>总体进度</em></span>
      </div>
      <div class="map-stats">
        <span class="map-stat"><b>${modules.length}</b>模块</span>
        <span class="map-stat"><b>${s.total}</b>单元</span>
        <span class="map-stat"><b>${s.touched}</b>已接触</span>
        <span class="map-stat"><b>${Math.round((s.avgConfidence || 0) * 100)}%</b>平均把握</span>
      </div>
      <div class="bar">${bar}</div>
      <div class="map-legend">${legend}</div>
      <p class="dim">图谱分三层：大类、模块、最小单元，逐层展开；画布本身拖不动，要缩放按住 Ctrl 滚轮（左上角那块索引板钉着不跟走），每个单元设「看课」「做题」两个入口。下面「掌握度」那一节是整体饼图和各大类的细账。</p>
    </div>
    <div class="graph-host" id="graph-host"></div>
  </section>`
}

/**
 * 列表跟图一样折三层：大类带百分比，点开是模块（也带百分比），再点开才是最小单元。
 * 它是「掌握度」那张卡里饼图下面那一段——**别再往知识地图卡里也铺一份**（同一份进度铺两处，
 * 改一处忘一处就打架；用户就是把「能力」并进来的时候顺手把重复那份撤掉的）。
 */
function groupedBlocks(modules) {
  const progress = (state.progress && state.progress) || { groups: {}, modules: {} }
  const abilityGroups = (state.ability && state.ability.groups) || []
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
      const g = abilityGroups.find((x) => x.name === name) || {}
      return `<div class="group-head ${open ? 'open' : ''}" data-act="group-open" data-group="${esc(name)}">
          <span class="gc-caret">${open ? '▾' : '▸'}</span>
          <span class="gc-name">${esc(name)}</span>
          <span class="gc-bar"><i style="width:${pct}%"></i></span>
          <span class="gc-pct">${pct}%</span>
          <span class="dim">${mods.length} 个模块${g.weak ? ` · 薄弱 ${g.weak}` : ''}${g.due ? ` · 该复习 ${g.due}` : ''}</span>
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

/**
 * 一条任务：勾、改、删、跳转。profileId 是它属于哪门课——列在一起时不能认错门。
 * index 是它在今天这一屏里的序号（关卡面那套索引字：01 / 02 …），
 * isNext 标出「现在该做的那一条」——一屏只给一条青。
 */
function taskRow(t, profileId, showSubject, index = 0, isNext = false) {
  const links = (t.links || [])
    .filter((l) => l && l.url)
    .map((l) => `<a class="open-link ${l.kind === 'point' ? 'alt' : ''}" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`)
    .join('')
  const cls = ['task-item', t.done ? 'done' : '', isNext && !t.done ? 'is-next' : ''].filter(Boolean).join(' ')
  const ord = `<span class="task-ord" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span>`
  if (ui.editTask === t.id) {
    return `<li class="${cls} editing">${ord}<form class="inline-form" data-form="task-edit" data-id="${esc(t.id)}" data-profile="${esc(profileId)}">
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
  return `<li class="${cls}">
    ${ord}
    <label class="check"><input type="checkbox" data-act="task-toggle" data-id="${esc(t.id)}" data-profile="${esc(profileId)}" ${t.done ? 'checked' : ''}><span>${esc(t.title)}</span></label>
    <span class="dim task-meta">${showSubject ? `<span class="tag">${esc(showSubject)}</span> ` : ''}${TASK_KIND[t.kind] || esc(t.kind || '')}${t.minutes ? ' · ' + t.minutes + ' 分' : ''}${t.pointTitle ? ' · ' + esc(t.pointTitle) : ''}</span>
    ${t.note ? `<div class="dim task-note">${esc(t.note)}</div>` : ''}
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

  // 序号是「关卡面」那套索引字，跨分组一条一条数下去；「现在该做的那条」只给一条青。
  let seq = -1
  const nextId = (views.find((t) => !t.done) || {}).id || ''
  const body = shown
    .map((g) => {
      const rows = g.day
        .map((t) => {
          seq += 1
          return taskRow(t, g.id, multi && !ui.filter, seq, t.id === nextId)
        })
        .join('')
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

  // 眉标 + 大标题 + 日期 · 周X + 右上状态 + 进度量尺 —— 跟「今日复盘图」那张图同一套版式。
  const pct = views.length ? Math.round((done / views.length) * 100) : 0
  return `<section class="card day">
    <div class="day-hero">
      <p class="eyebrow">TODAY · 今日任务</p>
      <div class="day-title-row">
        <h2 class="day-title">今日任务</h2>
        <span class="day-pill${over ? ' over' : ''}">${
          views.length ? `完成 ${done}/${views.length} · ${total} 分钟${budget ? ' / ' + budget : ''}` : '今天还没排任务'
        }</span>
      </div>
      <p class="day-sub">${esc(date)} · ${esc(weekdayOf(date))}</p>
      <div class="day-gauge${over ? ' over' : ''}" role="img" aria-label="今日完成度 ${pct}%"><i style="width:${pct}%"></i></div>
    </div>
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
  if (!review) return ''
  const data = review.data || {}
  const branches = Array.isArray(data.branches) ? data.branches : []
  const wrong = Number(data.error_count) || 0
  // 常驻的卡不能自己消失：今天什么都没动过就没有图，那就把「怎么让它有内容」写出来。
  if (!review.svg) {
    return `<section class="card review">
    <div class="card-head">
      <h2>今日复盘图</h2>
    </div>
    <p class="dim">今天还没记过一笔。勾掉一条今日任务、判一道题、或在知识地图上自评一个单元，这张图立刻就有内容。</p>
  </section>`
  }
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
    links.push({ kind, label, url: openPath(value) })
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

/**
 * web 端读不动一份资料时，把它**交给教练**：这一份是哪一本、路径是什么、为什么读不动，
 * 原样投进学习教练那个会话，让 agent 用自己的工具去读（PDF 拆页看、网课目录按讲次解）。
 * 顺带把「读完按最小单元归位」也写进那句话里——这正是资料图谱要的那份标注。
 *
 * 同一份、同一个理由只投一次（`FORWARDED`），免得每次刷新往对话里灌一条一样的。
 */
const FORWARDED = new Set()
const forwardKey = (materialId, path, reason) => `${materialId || path || '?'}|${reason || ''}`

function isForwarded(materialId, path) {
  if (!materialId && !path) return false
  for (const key of FORWARDED) if (key.startsWith(`${materialId || path}|`)) return true
  return false
}

async function forwardToCoach({ materialId = '', title = '', path = '', reason = '', annotate = false } = {}) {
  const key = forwardKey(materialId, path, reason)
  if (FORWARDED.has(key)) return false
  const where = title || path || materialId || '一份资料'
  const why = annotate
    ? reason
      ? `现在的情况：${reason}`
      : '这份资料还没按最小单元标过。'
    : reason
      ? `web 端自动读取失败：${reason}`
      : 'web 端自动读取失败。'
  const ask = annotate
    ? '请你把这份资料按知识地图的最小单元标一遍：M1.1 这种 id，一处内容可以同时归好几个（同一讲既讲 M1.1 也讲 M1.2 就都写上）。教辅按页范围对、网课按讲次对，读完写进材料分析里——面板的「学习」页就能按大类、模块看它覆盖了哪些单元。'
      + '顺带用 study_analysis 的 tree 把这份材料自己的三层（大类 → 模块 → 最小单元）写一遍：教辅照它的专题与节来，网课照文件夹与文件来；每条内容对上哪个单元就把 pointId 填上、对不上就留空。'
      + '写了它，面板上那张资料图谱就照你写的画（不写的话，现在显示的是按目录自动摊的，经常把整专题的备注复制到每个模块上）。'
    : '请你直接用工具去读这份资料（PDF 可以拆页、一页一页看；网课目录按文件名把讲次解出来）。读完把内容按知识地图的最小单元归位——M1.1 这种 id，一处内容可以同时归好几个。归完写进材料分析里，面板上就能按单元翻页、做题页也就找得到页码了。'
  const text = [annotate ? `【资料没标到知识图谱，交给你】${where}` : `【资料读不动，交给你】${where}`, path ? `路径：${path}` : '', why, ask]
    .filter(Boolean)
    .join('\n')
  try {
    const out = await api('/study/api/chat/send', {
      text,
      sessionId: (chat && chat.sessionId) || ui.chatSession || '',
    })
    if (!out || !out.ok) return false
    FORWARDED.add(key)
    return true
  } catch {
    return false
  }
}

/** 交给教练那颗按钮；已经交过了就换成一句说明，别让人反复点。 */
function forwardAct(materialId, path = '', { act = 'mat-forward', label = '交给教练去读' } = {}) {
  if (isForwarded(materialId, path)) return '<span class="dim">已经交给教练了 —— 去「对话」页看看他怎么说</span>'
  return `<button class="mini" data-act="${esc(act)}" data-id="${esc(materialId)}">${esc(label)}</button>`
}

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
  if (idx.error) {
    return `<p class="dim bad">读不出来：${esc(idx.error)}</p>
      <div class="row-acts">
        ${forwardAct(s.materialId, s.path)}
      </div>`
  }

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
            ? `<a class="mini" href="${esc(openPath(s.path))}" target="_blank" rel="noopener">打开这份卷</a>`
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
        ${st.cls === 'bad' ? forwardAct(s.materialId, s.path) : ''}
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

/* ── 学习页（/study/atlas）：资料图谱 ──────────────────────────────────────
 *
 * 骨架是**这份材料自己的目录**（或者网课那个文件夹），不再是知识地图：
 *
 *   大类 → 模块 → 最小单元，每一条都带链接。
 *
 * · 教辅 / PDF：大类 = 目录一级（「专题一 …」），模块 = 二级（「1.1 集合」），
 *   最小单元 = 页级索引落在这段里的每一段（讲解 / 例题 / 习题 / 答案），带页码、
 *   「打开 PDF 第 N 页」和每一页的页图。
 * · 网课 / 讲义夹：目录名「02.模块一 基础知识 集合」切成大类 + 模块，最小单元 =
 *   里面的每个文件（一个 mp4 就是一段视频）。
 *
 * 一次只摊一份材料（`ui.atlasPick`）——几本书的目录叠在一起只会互相打架。
 * 形状由服务端摊好（`GET /study/api/material/tree`，见 lib/material-tree.js 的注释），
 * 这边只管画、折、给链接；**不在客户端重算骨架**，也不再问「各材料里在第几页」。
 *
 * 材料名一律写全名，不用 A/B/C——一串字母看不出是哪本。这份材料一条都没挂到最小
 * 单元上时，给一颗「交给教练」的按钮（这正是「agent 在最小单元上标注它的位置」
 * 那条要求的入口）。
 */
const MAT_KINDS = { book: '教辅', video: '网课', notes: '讲义', ai: 'AI 卷', past: '真题', other: '材料' }

function matKind(m) {
  return MAT_KINDS[(m && m.kind) || ''] || '材料'
}

/** 折起来的大类 / 模块：键是 `g:大类序号` 与 `m:大类序号:模块序号`。 */
function atlasShut() {
  if (!ui.atlasShut) ui.atlasShut = new Set()
  return ui.atlasShut
}

/** 一棵树摊平：所有最小单元（模块里的 + 直接挂在大类下的 + 没归到目录里的）。
 *  材料只到两层时模块自己就是最小单元（`m.leaf`），也得算进来——不然「N 条内容」会少一截。 */
function atlasUnits(tree) {
  const out = []
  for (const g of (tree && tree.groups) || []) {
    for (const u of g.units || []) out.push(u)
    for (const m of g.modules || []) {
      if (m && m.leaf) out.push(m)
      for (const u of (m && m.units) || []) out.push(u)
    }
  }
  for (const u of (tree && tree.loose) || []) out.push(u)
  return out
}

/** 取一句话的头一截（材料分析里的 note 常常是一整章的小结，行里放不下）。 */
function firstClause(text, max = 30) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim()
  if (!raw) return ''
  const cut = raw.split(/[；;。]/)[0].trim()
  const one = cut.length > 6 ? cut : raw
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`
}

/**
 * 原文件那条链接怎么写：看的是**文件本身**，不是内容类型。
 * 教辅的一个单元 kind 多半是「讲解 / 习题」，但点开的是那一页 PDF；网课的才是视频。
 */
function linkLabel(u) {
  if (u.kind === 'folder') return '打开文件夹'
  const raw = String(u.url || '').split('#')[0].toLowerCase()
  if (raw.endsWith('.pdf')) return '打开 PDF'
  if (/\.(mp4|m4v|mov|mkv|flv|avi|wmv)$/.test(raw)) return '打开视频'
  if (/\.(md|markdown|txt)$/.test(raw)) return '打开正文'
  return '打开'
}

/** 一条最小单元右边那串链接：原文件（PDF 那一页 / 那段视频）+ 每一页的页图。 */
function atlasLinks(u) {
  const out = []
  if (u.url) {
    const label = linkLabel(u)
    out.push(
      `<a class="mini" href="${esc(u.url)}" target="_blank" rel="noopener" title="${esc(label === '打开文件夹' ? '打开这个文件夹' : label === '打开 PDF' ? '打开这份材料对应的那一页' : '打开这一份')}">${label}</a>`,
    )
  }
  for (const p of (u.pages || []).filter((p) => p && p.url).slice(0, 4)) {
    out.push(
      `<a class="mini pg-btn" href="${esc(p.url)}" target="_blank" rel="noopener" title="第 ${esc(String(p.page))} 页的图">P${esc(String(p.page))}</a>`,
    )
  }
  return out.length ? `<span class="atlas-links">${out.join('')}</span>` : ''
}

/**
 * 一行最小单元：左边是它叫什么（单元名 + 一句说明），右边是挂到哪个单元 / 类型 / 页码 / 链接。
 *
 * 名字用它自己的标题（材料目录里写的人话）；挂了 pointId 的再单挂一枚 id 筹码——
 * 名字和 id 是两件事，缺一个都看不出「这段内容归到哪儿」。
 */
function atlasUnitRow(u) {
  const kind = u.kind && u.kind !== 'folder' ? u.kind : ''
  const range = u.from ? `P${u.from}${Number(u.to) > Number(u.from) ? `—${u.to}` : ''}` : ''
  const note = firstClause(u.note)
  const point = u.pointId && u.pointId !== u.title ? u.pointId : ''
  return `<li class="atlas-unit${u.pointId ? '' : ' miss'}">
    <span class="atlas-label">
      <b class="atlas-id">${esc(u.title || point || kind || '内容')}</b>
      ${note ? `<i class="atlas-name" title="${esc(u.note)}">${esc(note)}</i>` : ''}
    </span>
    <span class="atlas-meta">
      ${point ? `<span class="atlas-kind atlas-point">${esc(point)}</span>` : ''}
      ${kind ? `<span class="atlas-kind">${esc(kind)}</span>` : ''}
      ${range ? `<span class="atlas-range">${esc(range)}</span>` : ''}
      ${atlasLinks(u)}
    </span>
  </li>`
}

/**
 * 「学习」页那张卡：先挑一份材料，再把它的三层摊出来。
 * 折的只有大类 / 模块两级（`ui.atlasShut`）；最小单元不折——它就是要连着链接一起看的。
 */
function atlasCard() {
  if (!shelf || !state) {
    return `<section class="card">
      <div class="card-head"><h2>资料图谱</h2></div>
      <p class="dim">这份读不出来。刷新一下；要是刷新也不行，那多半是服务端还是旧代码，重启 DSH 再看。</p>
    </section>`
  }
  const mats = (shelf.materials || []).filter((m) => m && m.materialId)
  if (!mats.length) {
    return `<section class="card">
      <div class="card-head"><h2>资料图谱</h2></div>
      <p class="dim">还没有材料可比。先去「资料」页登记一本教辅或一门网课——登记完回这儿，就能按它自己的目录一层层看下去。</p>
    </section>`
  }

  const pick = ui.atlasPick && mats.some((m) => m.materialId === ui.atlasPick) ? ui.atlasPick : mats[0].materialId
  const shut = atlasShut()
  const picker = `<div class="chips atlas-pick">
    ${mats
      .map((m) => {
        const n = Number(m.total) || 0
        const info = `${matKind(m)}${n ? ` · ${n} 页` : m.kind === 'video' ? ' · 按文件夹' : ' · 还没拆'}`
        return `<button type="button" class="mini${m.materialId === pick ? ' on' : ''}" data-act="atlas-pick" data-id="${esc(m.materialId)}" title="${esc(m.title)} · ${esc(info)}"><span class="mini-t">${esc(m.title || '没名字的材料')}</span></button>`
      })
      .join('')}
  </div>`

  const tree = atlasTree && atlasTree.material && atlasTree.material.materialId === pick ? atlasTree : null
  const units = atlasUnits(tree)
  const mapped = units.filter((u) => u.pointId).length
  const pct = units.length ? Math.round((mapped / units.length) * 100) : 0
  const mat = (tree && tree.material) || {}
  const basisText = tree && tree.basis === 'folder'
    ? '按文件夹分'
    : tree && tree.basis === 'agent'
      ? '教练看过后写下来的'
      : tree && tree.basis === 'toc'
        ? '按它自己的目录分'
        : '按页级索引分'
  // 自动摊的那两版（目录 / 文件夹）只是兜底：教练写过的那版才准，所以留一条路让他核。
  const srcHint = tree && tree.basis === 'agent'
    ? '<span class="dim">这三层是教练读过之后写下来的</span>'
    : `<span class="dim">这三层是按它自己的目录自动摊的——教练读过一遍再写下来会更准。</span>
       ${forwardAct(pick, mat.path, { act: 'atlas-annotate', label: '让教练核一遍' })}`

  const unitList = (list) => `<ul class="list atlas-units">${list.map(atlasUnitRow).join('')}</ul>`

  /**
   * 一块模块：模块头 + 它的最小单元。
   * 材料只到两层（教辅的「1.1 集合」这种）时 `m.leaf` 为真——模块自己就是最小单元，
   * 那就把链接直接挂在模块头上，别再补一行一模一样的。
   */
  const moduleBlock = (m, gi, mi) => {
    const key = `m:${gi}:${mi}`
    const leaf = !!m.leaf
    const closed = leaf || shut.has(key)
    const page = m.page ? `P${m.page}${Number(m.to) > Number(m.page) ? `—${m.to}` : ''}` : ''
    const open = leaf
      ? ''
      : ` data-act="atlas-shut" data-key="${esc(key)}" title="点一下${closed ? '摊开' : '折起'}"`
    return `<div class="atlas-mod${leaf ? ' leaf' : ''}">
      <div class="atlas-mod-head"${open}>
        ${leaf ? '' : `<span class="atlas-caret">${closed ? '▸' : '▾'}</span>`}
        <span class="atlas-mtitle">${esc(m.title || '')}</span>
        ${m.pointId ? `<span class="atlas-mid">${esc(m.pointId)}</span>` : ''}
        <span class="dim">${leaf ? '最小单元' : `${(m.units || []).length} 条`}</span>
        ${page ? `<span class="atlas-range">${esc(page)}</span>` : ''}
        ${leaf ? atlasLinks(m) : ''}
      </div>
      ${closed ? '' : unitList(m.units || [])}
    </div>`
  }

  /** 一个大类：抬头 + 直接挂在这儿的内容 + 它下面的模块。 */
  const groupBlock = (g, gi) => {
    const key = `g:${gi}`
    const closed = shut.has(key)
    const page = g.page ? `P${g.page}${Number(g.to) > Number(g.page) ? `—${g.to}` : ''}` : ''
    const parts = []
    if ((g.units || []).length) parts.push(unitList(g.units))
    parts.push((g.modules || []).map((m, mi) => moduleBlock(m, gi, mi)).join(''))
    return `<div class="atlas-group">
      <div class="atlas-group-head" data-act="atlas-shut" data-key="${esc(key)}" title="点一下${closed ? '摊开' : '折起'}">
        <span class="atlas-caret">${closed ? '▸' : '▾'}</span>
        <span class="atlas-gname">${esc(g.title || '（没名字的一段）')}</span>
        <span class="dim">${(g.modules || []).length} 个模块 · ${g.count || 0} 条内容</span>
        ${page ? `<span class="atlas-range">${esc(page)}</span>` : ''}
      </div>
      ${closed ? '' : parts.join('')}
    </div>`
  }

  const body = (tree ? tree.groups || [] : []).map(groupBlock).join('')
  const loose = tree && (tree.loose || []).length
    ? `<div class="atlas-group">
        <div class="atlas-group-head"><span class="atlas-gname">没归到目录里的</span><span class="dim">${tree.loose.length} 条</span></div>
        ${unitList(tree.loose)}
      </div>`
    : ''
  const blank =
    !tree || mapped
      ? ''
      : `<div class="atlas-blank">
        <b>这份材料还没挂到最小单元上</b>
        <p class="hint">上面三层是按它自己的目录摊的，但一条都没对到知识地图的单元（M1.1 这种）。让教练读过一遍、把每一段挂到对应的单元上，回来刷新就能看见。</p>
        ${forwardAct(pick, mat.path, { act: 'atlas-annotate', label: '交给教练去标' })}
      </div>`

  if (!tree) {
    return `<section class="card atlas" data-card="atlas">
      <div class="day-hero">
        <p class="eyebrow">MATERIAL GRAPH · 资料图谱</p>
        <div class="day-title-row"><h2 class="day-title">资料图谱</h2></div>
      </div>
      ${picker}
      <p class="dim">这份材料的三层端不出来。服务端多半还是旧代码——重启一次 DSH 再看；要是刚登记、目录还没读过，让教练先读一遍。</p>
    </section>`
  }

  return `<section class="card atlas" data-card="atlas">
    <div class="day-hero">
      <p class="eyebrow">MATERIAL GRAPH · 资料图谱</p>
      <div class="day-title-row">
        <h2 class="day-title">资料图谱</h2>
        <span class="day-pill">${mats.length} 份材料 · 这一份 ${units.length} 条内容</span>
      </div>
      <p class="day-sub">挑一份材料，下面就是它自己的目录摊成的三层：大类 → 模块 → 最小单元，每一层右边都能直接打开对应的那一页 / 那一段（${esc(basisText)}）。</p>
      <div class="day-gauge" role="img" aria-label="已挂到单元 ${pct}%"><i style="width:${pct}%"></i></div>
    </div>
    ${picker}
    <div class="chips atlas-mode">
      <span class="atlas-mlabel">${(tree.groups || []).length} 个大类 · ${units.length} 条内容 · 已挂到单元 ${mapped} 条${tree.truncated ? ' · 太多了，先截了一段' : ''}</span>
      <span class="dim">点大类 / 模块那一行能折起来</span>
    </div>
    <div class="chips atlas-src">${srcHint}</div>
    ${body}
    ${loose}
    ${blank}
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
 *
 * 右边那颗「＋ 新建」一直都在：这台机器上可能一个学习教练会话都没有（刚装插件），
 * 让他自己回 DSH 新建对话、还得记得挑预设，太绕。这里替他开一个。
 */
function chatPicker(snapshot) {
  const list = (snapshot && snapshot.sessions) || []
  const add = '<button class="mini chat-new" data-act="chat-new" title="在 DSH 里开一个新的「学习教练」会话">＋ 新建</button>'
  if (!list.length) {
    // 一个都没有：要么真没有学习模式的对话，要么这台宿主不给会话预设信息（老 DSH）。
    const why = snapshot && snapshot.filtered === false
      ? '没读到会话清单。'
      : '还没有「学习教练」模式的对话 —— 点右边那颗 ＋ 新建 开一个，这一页就接上了。'
    return `<div class="chat-pick"><span class="dim">${why}</span>${add}</div>`
  }
  const rows = list.map((s) => {
    const name = s.title || (s.blank ? '（新会话）' : s.cwd ? String(s.cwd).split(/[\\/]/).pop() : String(s.sessionId).slice(0, 8))
    const label = [name, whenText(s.updatedAt), s.running ? '进行中' : ''].filter(Boolean).join(' · ')
    return { id: String(s.sessionId), label }
  })
  // 服务端没告诉我们在哪一个（比如清单是后拉回来的）时，就当第一个——列表是倒序的，第一个就是最近那个。
  const current = String((snapshot && snapshot.sessionId) || '') || rows[0].id
  // 只列学习模式的时候说一句，学生才知道别的会话为什么不在下拉里。
  const only = snapshot && snapshot.filtered ? '<span class="dim chat-only">只看学习模式</span>' : ''
  if (rows.length === 1) {
    return `<div class="chat-pick"><span class="dim">当前会话</span><b class="pick-now">${esc(rows[0].label)}</b>${only}${add}</div>`
  }
  const options = rows
    .map((r) => `<option value="${esc(r.id)}"${r.id === current ? ' selected' : ''}>${esc(r.label)}</option>`)
    .join('')
  return `<div class="chat-pick"><label class="dim">会话</label><select data-act="chat-session">${options}</select>${only}${add}</div>`
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
 * 消息正文：markdown（含数学）交给 `assets/md.js`，`[表情: 描述]` 这一条是本面板自己的记号，
 * 当 `extras` 递进去 —— 它同时也是全仓唯一一处把那条记号换成图的地方。
 *
 * 斗图插件在 Web 模式只回一行候选文字（`send_meme` 明说「不要加网址」），面板原来照原样画方括号，
 * 学生看见的就是「什么也加载不出来」。服务端 `/study/api/meme?q=<描述>` 会去盘上的图库找那一张
 * （见 lib/memes.js）；`alt` 就是那句描述——图挂了浏览器会把描述文字显示出来，不会留个破图，
 * 所以老机器上没装图库也能看。
 */
const CHAT_MEME_RE = /\[表情:\s*([^\]\n]{1,200})\]/g
const MEME_EXTRA = {
  re: CHAT_MEME_RE,
  html: (whole, desc) => {
    const text = String(desc || '').trim()
    const alt = esc(text)
    return `<img class="chat-meme" src="/study/api/meme?q=${encodeURIComponent(text)}" alt="${alt}" title="${alt}" loading="lazy">`
  },
}

/** 一段 AI 写的长文字 → HTML。面板里凡是要按 markdown 画的地方都走它。 */
function chatText(text) {
  return renderMarkdown(String(text ?? ''), { extras: [MEME_EXTRA] }).html
}

/** 一句话（错步 / 错因 / 订正这种）：只认行内标记，不套 `<p>`。 */
function mdInlineText(text) {
  return mdInline(String(text ?? ''), [MEME_EXTRA])
}

/**
 * 消息列表。
 *
 * 服务端（lib/chat.js）现在只发 user / assistant 两种：工具事件在那边就筛掉了。
 * 下面「工具攒成一行」这段留着是兜底，也给 scripts/preview.mjs 的假数据用——
 * 真接上 DSH 时不会再走到。
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
      out.push(`<div class="chat-msg user"><div class="chat-text">${chatText(m.text)}</div>${meta}</div>`)
      continue
    }
    const used = Array.isArray(m.tools) && m.tools.length ? `<div class="chat-used">用了 ${esc([...new Set(m.tools)].join('、'))}</div>` : ''
    out.push(
      `<div class="chat-msg bot"><div class="chat-text">${m.text ? chatText(m.text) : esc('（这一步没有正文）')}</div>${used}${meta}</div>`,
    )
  }
  flush()
  const tail = snapshot && snapshot.error ? `<div class="chat-step bad">${esc(snapshot.error)}</div>` : ''
  return out.join('') + tail
}

/**
 * 通道没接通时那段话。
 *
 * 「对话」页和浮窗各说各的措辞是有意的：浮窗只有 320px 宽，长句读不下去。
 * 但「为什么要重启」是同一个原因，所以只在这里写一次。
 */
function chatOffText(shell) {
  const why = '路由是 DSH 启动时加载的，改完代码不重启就还是旧的'
  return shell === 'float'
    ? `对话通道未接通。重启 DSH 之后点上面的 ↻ 再试（${why}）。`
    : `未接通对话通道。这一页要等 DSH 重启之后才能用 —— ${why}。`
}

/**
 * 聊天窗口的正文：会话选择 + 气泡 + 输入框。
 *
 * 「对话」页整屏那个和右下角浮窗那个是**同一个东西的两种壳**，只差三处：
 * 日志容器的类名与 id、输入框的行数与提示词、发送按钮要不要跟一行说明排在一排。
 * 以前这两处各写了一遍，谁改了一边另一边就悄悄落后 —— 收成这一份。
 */
function chatBody(snapshot, shell) {
  const wide = shell === 'card'
  const log = wide ? 'chat-log' : 'float-log'
  const placeholder = wide
    ? '跟教练说一句，例如：这节的含参讨论没跟上 / 换个教材 / 今天只剩 30 分钟'
    : '跟教练说一句…'
  const button = `<button type="submit" class="primary"${ui.chatSending ? ' disabled' : ''}>${
    ui.chatSending ? (wide ? '发送中…' : '…') : '发送'
  }</button>`
  const row = wide
    ? `<div class="row">${button}<span class="dim">Enter 发送，Shift + Enter 换行。回复会自己出现在上面。</span></div>`
    : button
  return `${chatPicker(snapshot)}
    <div class="${log}" id="${log}" data-chat-log>${chatLog(snapshot)}</div>
    <form data-form="chat" class="${wide ? 'form chat-form' : 'chat-form float-form'}">
      <textarea name="text" rows="${wide ? 2 : 1}" placeholder="${placeholder}"></textarea>
      ${row}
    </form>`
}

function chatCard() {
  const snapshot = chat
  if (!snapshot || !snapshot.available) {
    return `<section class="card">
      <div class="card-head"><h2>与教练对话</h2>${chatStatus(snapshot)}</div>
      <p class="dim">${chatOffText('card')}</p>
      ${snapshot && snapshot.error ? `<p class="dim">原因：${esc(snapshot.error)}</p>` : ''}
      <div class="row"><button class="mini" data-act="chat-reload">重新连接</button>
      <span class="dim">重启 DSH 之后点这里，不用刷新整页。</span></div>
    </section>`
  }
  // 这一页就是聊天窗口：会话选择在上，气泡占满中间，输入框钉在底下
  return `<section class="card">
    <div class="card-head"><h2>与教练对话</h2>${chatStatus(snapshot)}
      <button class="mini" data-act="chat-reload" title="重新读取">刷新</button></div>
    ${chatBody(snapshot, 'card')}
  </section>`
}

/**
 * 图标状态那颗按钮里的图案。
 *
 * 不用 emoji：面板是方角 + 细规那一套，💬 在中间既不是这套语言、各平台画的还都不一样。
 * 这里画一个自己切的方块（右上角一道斜切，跟按钮 `clip-path` 那个角同一个动机），
 * 底下一小截尾巴当对话框，里面两行短规当字。线色走 `currentColor`，跟着按钮的前景色。
 */
const FAB_ICON = `<svg class="fab-ico" viewBox="0 0 24 24" width="24" height="24" fill="none"
  stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter" aria-hidden="true" focusable="false">
  <path d="M3.4 3.6h11.4l5.8 5.8v9.2H3.4z"/>
  <path d="M5.6 18.6v2.8l3.8-2.8"/>
  <path d="M7.2 8.4h6.4M7.2 12.2h9.8"/>
</svg>`

/**
 * 右下角那个悬浮小窗。
 *
 * 面板任何一页都挂一颗切角方块，点开就是简化版的聊天窗：同一份快照、同一条投递通道，
 * 只是字号和留白收一档，宽度固定。走到哪一页都能顺手说一句，不用先绕回「对话」页。
 * 「对话」页本身已经整屏是聊天窗口了，那一页不再挂。
 *
 * **收起、展开两态都能拖**（用户要的：图标状态原来挪不动，挡着东西只能先点开）。两态共用
 * 同一份 `ui.floatPos`：在图标状态拖到哪儿，点开的小窗就在哪儿；收起来又回到同一处。
 * 位置**每帧重画都带着它**——不然每 2.5 秒刷一次快照，它就自己跳回右下角了。
 */
function floatChat() {
  if (page === 'coach') return ''
  if (!ui.float) {
    const pos = ui.floatPos
    const place = pos ? ` style="left:${pos.left}px;top:${pos.top}px"` : ''
    return `<button class="fab${pos ? ' moved' : ''}"${place} data-act="float-open" title="与教练对话（按住可以拖走，右键回到右下角）" aria-label="与教练对话">${FAB_ICON}</button>`
  }
  const snapshot = chat
  const on = Boolean(snapshot && snapshot.available)
  const pos = ui.floatPos
  const cls = `float${pos ? ' moved' : ''}`
  const place = pos ? ` style="left:${pos.left}px;top:${pos.top}px"` : ''
  const head = `<header class="float-head" title="按住这里可以拖走，双击回到右下角">
    <b>与教练对话</b>${on ? '' : '<span class="dim">未接通</span>'}
    <span class="spread"></span>
    <button class="mini" data-act="chat-reload" title="重新读取">↻</button>
    <button class="mini" data-act="float-close" title="收起" aria-label="收起">✕</button>
  </header>`
  if (!on) {
    return `<section class="${cls}"${place} role="dialog" aria-label="与教练对话">${head}
      <p class="dim float-off">${chatOffText('float')}</p>
    </section>`
  }
  return `<section class="${cls}"${place} role="dialog" aria-label="与教练对话">${head}
    ${chatBody(snapshot, 'float')}
  </section>`
}

/* ══ 浮窗拖着走 ═══════════════════════════════════════════════════════════
 * 浮窗本来是钉在右下角的，挡着东西的时候想挪开。**收起时整颗图标按钮都能拖**，
 * 展开着只有标题栏能拖（消息和输入框上按一下就跑，没法选中文字）；松开记住位置
 * （localStorage，刷新还在老地方）；双击标题栏、或者右键那颗图标，回到右下角
 * ——拖跑了找不回来最气人。
 *
 * 用指针事件，鼠标 / 触屏 / 触控笔一套写完。监听挂在 **document** 上而不是窗口
 * 自己身上：拖到窗口外面再松手也得收到 pointerup，挂元素上会漏，然后就变成
 * 「手松了它还跟着鼠标跑」。
 *
 * 图标状态多一件事：它同时也是「点开」的按钮，所以挪动超过 3px 就记一笔
 * `floatNudged`，把松手后那记 click 吃掉——否则拖一下顺手就把窗子打开了。
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 拖动中的中间状态：{ box, dx, dy, ox, oy, fromFab, moved }。null = 没在拖。 */
let floatDrag = null
/** 图标状态被真的拖动过：吃掉松手后那记 click，别让「挪开它」变成「点开它」。 */
let floatNudged = false

/** 现在该去改谁：展开着是 `.float`，收起来是那颗 `.fab`。两个都找一遍，都没有就 null。 */
function floatBox() {
  if (!document.querySelector) return null
  return document.querySelector('.float') || document.querySelector('.fab') || null
}

/** 把窗口按在视口里：整扇都看得见，拖不出去。视口比窗口还小就贴在左上角。 */
function clampPos(left, top, size, view) {
  const maxLeft = Math.max(0, Math.round(view.width - size.width))
  const maxTop = Math.max(0, Math.round(view.height - size.height))
  return {
    left: Math.min(Math.max(0, Math.round(left)), maxLeft),
    top: Math.min(Math.max(0, Math.round(top)), maxTop),
  }
}

/** 浮窗现在多宽多高；量不到就按样式里那对默认值算（372 × 540）。 */
function floatSize(box) {
  const rect = box && box.getBoundingClientRect ? box.getBoundingClientRect() : null
  return {
    width: (box && box.offsetWidth) || (rect && rect.width) || 372,
    height: (box && box.offsetHeight) || (rect && rect.height) || 540,
  }
}

/**
 * 把位置写进元素样式。拖动时直接改样式、不整页重画——重画会把输入框里的字
 * 和消息列表滚到一半的位置弄丢。
 */
function applyFloatPos(box, pos) {
  if (!box || !box.style) return
  if (!pos) {
    box.style.left = ''
    box.style.top = ''
    box.style.right = ''
    box.style.bottom = ''
    return
  }
  box.style.left = `${pos.left}px`
  box.style.top = `${pos.top}px`
  box.style.right = 'auto'
  box.style.bottom = 'auto'
}

/**
 * 存下来的位置可能是另一块屏幕上拖的（外接屏挪到左边、换回笔记本），画完照当前
 * 视口重新按一次；没挪动就不写，省得每帧都碰 localStorage。
 */
function clampFloatToView() {
  if (!ui.floatPos) return
  const box = floatBox()
  if (!box) return
  const pos = clampPos(ui.floatPos.left, ui.floatPos.top, floatSize(box), {
    width: window.innerWidth || 0,
    height: window.innerHeight || 0,
  })
  if (pos.left === ui.floatPos.left && pos.top === ui.floatPos.top) return
  ui.floatPos = pos
  applyFloatPos(box, pos)
  saveFloatPos(pos)
}

/** 记住拖到哪儿。存不下（无痕模式之类）就只是这次算数。 */
function saveFloatPos(pos) {
  try {
    const store = window.localStorage
    if (!store) return
    if (pos) store.setItem(FLOAT_POS_KEY, JSON.stringify({ left: pos.left, top: pos.top }))
    else if (store.removeItem) store.removeItem(FLOAT_POS_KEY)
  } catch (e) {
    /* 存不下就算了 */
  }
}

/** 读回上次拖到哪儿。没有、或者存坏了，都当没拖过。 */
function readFloatPos() {
  try {
    const store = window.localStorage
    const raw = store ? store.getItem(FLOAT_POS_KEY) : ''
    const pos = raw ? JSON.parse(raw) : null
    if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
      return { left: Math.round(pos.left), top: Math.round(pos.top) }
    }
  } catch (e) {
    /* 读到坏的当没拖过 */
  }
  return null
}

document.addEventListener('pointerdown', (event) => {
  if (event.button) return // 只认左键 / 单指
  const target = event.target
  if (!target || !target.closest) return
  // 收起时整颗图标按钮都是抓手；展开着只有标题栏能拖（消息、输入框上按一下不能就跑）。
  const fab = target.closest('.fab')
  const box = fab || target.closest('.float')
  if (!box) return
  if (!fab) {
    if (!target.closest('.float-head')) return
    if (target.closest('button')) return // 标题栏上那两颗按钮还是按钮
  }
  const rect = box.getBoundingClientRect ? box.getBoundingClientRect() : { left: 0, top: 0 }
  floatDrag = {
    box,
    dx: event.clientX - rect.left,
    dy: event.clientY - rect.top,
    ox: rect.left || 0,
    oy: rect.top || 0,
    fromFab: Boolean(fab),
    moved: false,
  }
  if (event.preventDefault) event.preventDefault()
})

document.addEventListener('pointermove', (event) => {
  if (!floatDrag) return
  // 每次都重新找一下：面板每 2.5 秒可能整块重画一次，手里那个引用会变成脱离文档的旧节点。
  const box = floatBox() || floatDrag.box
  floatDrag.box = box
  const left = event.clientX - floatDrag.dx
  const top = event.clientY - floatDrag.dy
  // 挪过 3px 才算拖：图标状态那颗按钮也是「点开」，手抖一下不该变成拖动。
  if (Math.abs(left - floatDrag.ox) + Math.abs(top - floatDrag.oy) > 3) floatDrag.moved = true
  const pos = clampPos(left, top, floatSize(box), {
    width: window.innerWidth || 0,
    height: window.innerHeight || 0,
  })
  ui.floatPos = pos
  applyFloatPos(box, pos)
})

document.addEventListener('pointerup', () => {
  if (!floatDrag) return
  // 只有「在图标上真的挪动过」才需要吃掉随后那记 click：拖标题栏时松手那一下
  // 落在 header 上，本来也没有 data-act，不用管。
  floatNudged = floatDrag.fromFab && floatDrag.moved
  floatDrag = null
  saveFloatPos(ui.floatPos)
})

/** 回到右下角：位置忘掉、行内样式清掉、重画一遍（两态共用这一条路）。 */
function resetFloatPos(box) {
  ui.floatPos = null
  saveFloatPos(null)
  applyFloatPos(box, null)
  render()
}

/* 双击标题栏：回到右下角，顺手忘掉记着的位置。 */
document.addEventListener('dblclick', (event) => {
  if (!event.target.closest || !event.target.closest('.float-head')) return
  resetFloatPos(event.target.closest('.float'))
})

/* 右键那颗图标：也是回右下角（图标状态没地方双击——第一下就把窗子点开了）。 */
document.addEventListener('contextmenu', (event) => {
  const el = event.target.closest && event.target.closest('.fab')
  if (!el) return
  if (event.preventDefault) event.preventDefault()
  resetFloatPos(el)
})

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
      const res = await api('/study/api/mastery', { pointId, stage: el.dataset.stage, note, kind: 'self' })
      // 升不动的时候后端会在 note 里说清差几条；别让 toast 继续说「已记录为」——
      // 档位没动，那句话就成了骗他的。
      toast(res && res.note ? res.note : `已记录为「${el.dataset.stage}」`)
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
    } else if (act === 'fact-filter') {
      ui.factKind = el.dataset.kind || ''
      render()
    } else if (act === 'fact-more') {
      ui.factMore = true
      render()
    } else if (act === 'fact-del') {
      const id = el.dataset.id || ''
      el.disabled = true
      try {
        await api('/study/api/student', { action: 'remove', id })
        toast('这条判断删掉了')
        student = await loadStudent()
        render()
      } catch (error) {
        toast(error.message)
        el.disabled = false
      }
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
    } else if (act === 'mat-forward') {
      const id = el.dataset.id || ''
      const mat = ((shelf && shelf.materials) || []).find((m) => m.materialId === id) || {}
      const sent = await forwardToCoach({
        materialId: id,
        title: mat.title || '',
        path: mat.path || '',
        reason: '面板这边读不到它的内容',
      })
      toast(sent ? '交给教练了，去「对话」页看看' : '没能交过去 —— 对话通道没通', !sent)
      render()
    } else if (act === 'atlas-pick') {
      // 换一份材料：它的三层要重新去服务端摊（形状是服务端算的，客户端不重算）。
      const id = el.dataset.id || ''
      if (!id || id === ui.atlasPick) return
      ui.atlasPick = id
      ui.atlasShut = null
      atlasTree = await loadAtlas()
      render()
    } else if (act === 'atlas-shut') {
      // 折 / 摊一个大类或模块——纯客户端，不惊动服务端。
      const key = el.dataset.key || ''
      if (!key) return
      const shut = atlasShut()
      if (shut.has(key)) shut.delete(key)
      else shut.add(key)
      render()
    } else if (act === 'atlas-annotate') {
      const id = el.dataset.id || ''
      const mat = ((shelf && shelf.materials) || []).find((m) => m.materialId === id) || {}
      const sent = await forwardToCoach({
        materialId: id,
        title: mat.title || '',
        path: mat.path || '',
        reason: '这份还没按最小单元标过',
        annotate: true,
      })
      toast(sent ? '让教练去标了，标完刷新这一页' : '没能交过去 —— 对话通道没通', !sent)
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
        // web 端自己读不动——按约定直接转给教练，让他用自己的工具去读。
        const mat = ((shelf && shelf.materials) || []).find((m) => m.materialId === id) || {}
        const sent = await forwardToCoach({
          materialId: id,
          title: mat.title || '',
          path: mat.path || '',
          reason: error.message,
        })
        toast(sent ? `web 端拆不了（${error.message}），已经交给教练去读` : '没能开始拆：' + error.message, true)
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
          // 路径读不动（不在本机、没权限、格式不认）也一样转给教练。
          const sent = await forwardToCoach({ path: path.trim(), reason: error.message })
          toast(sent ? `web 端读不了这个路径（${error.message}），已经交给教练看看` : '看不了：' + error.message, true)
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
    } else if (act === 'chat-new') {
      // 开一个新的学习教练会话，然后立刻切到它 —— 学生点完就该能直接说话。
      try {
        const made = await api('/study/api/chat/new', {})
        ui.chatSession = made.sessionId
        await loadChat({ sessionId: made.sessionId, withSessions: true })
        paintChat({ bottom: true })
        toast('开好了，直接说话就行')
      } catch (error) {
        toast('开不出来：' + error.message, true)
      }
    } else if (act === 'float-open') {
      // 刚把图标拖到别处的那一下不算「点开」——松手时手会顺带点一下，
      // 不然想挪开它反而每次都被它拦住。下一次点才是真要点开。
      if (floatNudged) {
        floatNudged = false
      } else {
        ui.float = true
        // 浮窗里也要能选会话：清单还没拉过就趁这次拉一份——load() 那次只问了快照，
        // 那时候 ui.float 还是 false，所以 sessions 是空的。
        if (!chat || !(chat.sessions || []).length) await loadChat({ withSessions: true })
        render()
      }
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
    // 换会话就当翻到最新一条：新开的那个会话本来就该从底下看起。
    paintChat({ bottom: true })
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
      // 等日志追上：立刻拉一次，过一秒再拉一次，别让人盯着空白等。
      // 刚发出去的那一条一定落到底——不然学生还得自己往下拖。
      await loadChat()
      paintChat({ bottom: true })
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
  resizeTimer = setTimeout(() => {
    mountGraph()
    // 拖过的浮窗在窗口变小之后可能有一截露在外面，重新按回视口里
    clampFloatToView()
  }, 160)
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
  // 切回前台立刻补一次，不等下一个 2.5 秒刻度——原来切回来可能还要盯着旧内容等一会儿。
  if (!chatHidden()) void refreshChat({ pushed: true })
  syncChatPolling()
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
