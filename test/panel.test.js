/**
 * panel.js 的渲染回归。
 *
 * 面板是纯前端模块，在 node 里跑得先把浏览器那几样东西顶上：
 * document.getElementById / addEventListener、window、fetch。
 * 只 stub 面板真正用到的那点，不去模拟 DOM 树——render() 落的是
 * `innerHTML` 字符串，所以直接对着那串 HTML 断言就够了。
 *
 * 坑一：panel.js 是顶层 await 的 ESM，import 一次就执行一次 load()。
 *        每个用例用 `?v=<n>` 换一个模块实例，免得共用一份 state。
 * 坑二：load() 是 fire-and-forget，import 返回时 fetch 未必回来，
 *        所以得轮询等 innerHTML 落下去。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const PANEL = pathToFileURL(join(HERE, '..', 'assets', 'panel.js')).href

function stubDom() {
  const boxes = new Map()
  const box = (id) => {
    if (!boxes.has(id)) boxes.set(id, { id, innerHTML: '', className: '', textContent: '', hidden: false })
    return boxes.get(id)
  }
  box('app')
  box('toast')
  const listeners = new Map()
  const document = {
    documentElement: { dataset: {} },
    getElementById: (id) => (id === 'graph-host' ? null : box(id)),
    querySelector: (sel) => (typeof window.__query === 'function' ? window.__query(sel) : null),
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, appendChild() {}, classList: { add() {}, remove() {} } }),
    addEventListener: (type, fn) => listeners.set(type, fn),
    body: { appendChild() {}, dataset: {} },
  }
  const window = {
    addEventListener() {},
    open: () => null,
    innerWidth: 1200,
    innerHeight: 800,
    localStorage: {
      store: new Map(),
      getItem(key) {
        return this.store.has(key) ? this.store.get(key) : null
      },
      setItem(key, value) {
        this.store.set(key, String(value))
      },
      removeItem(key) {
        this.store.delete(key)
      },
    },
    location: { href: 'http://127.0.0.1:19388/study', search: '', pathname: '/study', assign() {} },
    scrollTo() {},
  }
  // 真浏览器里 pushState 会顺手把 location.pathname 改掉，假的那个也得跟着改，
  // 不然「已经在那一页了就别再 push」这条判断会永远按老地址算。
  window.history = {
    pushes: [],
    pushState(_state, _title, url) {
      this.pushes.push(url)
      window.location.pathname = String(url).split('?')[0]
    },
  }
  return { document, window, boxes, listeners }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const ARCHIVE = {
  level: 'module',
  key: 'M1',
  title: '第一模块',
  progress: 20,
  total: 2,
  touched: 1,
  avgConfidence: 0.6,
  byStage: { '能跟做': 1, '没接触过': 1 },
  due: [{ pointId: 'M1.1', title: '第一个单元', stage: '能跟做', nextReview: '2026-10-03' }],
  points: [
    { pointId: 'M1.1', title: '第一个单元', stage: '能跟做', evidenceCount: 2, lastAt: '2026-10-01', lastKind: 'self', lastNote: '自己说会了', nextReview: '2026-10-03', due: true },
    { pointId: 'M1.2', title: '第二个单元', stage: '没接触过', evidenceCount: 0 },
  ],
  evidence: [
    { kind: 'self', at: '2026-10-01', pointTitle: '第一个单元', note: '自己说会了' },
    { kind: 'quiz', at: '2026-09-30', pointTitle: '第一个单元', note: '' },
  ],
}

/**
 * 面板开机先探的那五条新路由；stale 模式下把它们全按 404 回。
 * 最后一条要用**登记过的材料路径**去问——`/study/file` 只放行登记过的材料，
 * 空 path 在新旧代码里都是 404，拿它探等于永远报旧。
 */
const PROBE_PATHS = [
  '/study/api/ability',
  '/study/api/archive?level=group&key=',
  '/study/api/library',
  '/study/practice',
  '/study/api/mistakes',
  '/study/api/student',
  '/study/api/review',
  '/study/api/materials',
  '/study/api/toolbox',
  '/study/api/memory',
  '/study/file?path=F%3A%5C%E8%AF%BE%E4%BB%B6',
]

/** 一份假对话：一条学生说的、一条教练回的。形状跟 lib/chat.js 吐出来的一致。 */
const CHAT_MESSAGES = [
  { id: 'c1', seq: 9, role: 'user', text: '这一节的含参讨论没跟上', time: 1759300000000 },
  { id: 'c2', seq: 16, role: 'bot', text: '分两种情形看：A 是不是空集会改变结论。', time: 1759300060000, tools: ['read'] },
]

/**
 * 会话清单，形状照 lib/chat.js 的 summaryView：{sessionId, updatedAt, running, blank, title, cwd}。
 * 三条分别是：刚刚动过的、五天前的、刚开出来还没说话的。时间戳都相对「现在」算，
 * 否则面板给出来的「最后活动时间」会随着系统时钟漂成不同的写法。
 */
const NOW = Date.now()
const SESSIONS = [
  { sessionId: 's1', title: '学习教练', updatedAt: NOW - 60_000, running: true, blank: false, cwd: '' },
  { sessionId: 's2', title: '', updatedAt: NOW - 5 * 86400000, running: false, blank: false, cwd: 'F:\\dshworkingspace(studyplugin' },
  { sessionId: 's3', title: '', updatedAt: NOW - 3 * 3600_000, running: false, blank: true, cwd: '' },
]

/** 今日复盘图那份假数据。真 SVG 由 lib/review.js 拼，这里只要够卡片认出来就行。 */
const REVIEW = {
  data: { branches: [{ side: 'left' }, { side: 'right' }], error_count: 1 },
  svg: '<svg viewBox="0 0 2048 1180" width="2048" height="1180"><title>今日复盘</title></svg>\n',
}

/** 书架：一本已经拆完、归了 8 页的教辅，外加一份 AI 出的卷子。 */
const SHELF = {
  materials: [
    {
      materialId: 'mat-1',
      title: '必修一',
      kind: 'book',
      path: 'F:\\课件\\必修一.pdf',
      file: true,
      pageDir: 'C:/data/pages/必修一-abc',
      total: 20,
      rendered: 20,
      rendering: false,
      scanned: true,
      dpi: 110,
      toc: [],
      indexed: 8,
      chapters: 1,
      points: ['M1.1', 'M1.4'],
      kinds: ['讲解', '习题'],
      coverage: '部分通读',
    },
    {
      // AI 出的卷子：没有本机原件、没有页图，但有正文文件和单元。
      materialId: 'mat-ai',
      title: '随堂小测 · M1.4（2026-10-01）',
      kind: 'ai',
      path: 'C:\\data\\ai\\M1.4-随堂小测.md',
      file: true,
      pageDir: '',
      total: 0,
      rendered: 0,
      rendering: false,
      scanned: false,
      dpi: 0,
      toc: [],
      indexed: 8,
      chapters: 1,
      points: ['M1.4'],
      kinds: ['习题'],
      coverage: '',
    },
  ],
  pagesRoot: 'C:/data/pages',
}

/** 摊开那一本时拉的页级索引：一段区间，其中第 4 页拆出来了、第 5 页还没。 */
const SHELF_INDEX = {
  ok: true,
  toc: [{ level: 1, title: '第一章 集合', page: 1 }],
  spans: [{ from: 4, to: 6, pointId: 'M1.4', kind: '讲解', note: '', count: 3 }],
  pages: [
    { page: 4, pointId: 'M1.4', kind: '讲解', note: '', file: 'p0004.png', url: '/study/page?path=C%3A%2Fdata%2Fp0004.png' },
    { page: 5, pointId: 'M1.4', kind: '讲解', note: '', file: 'p0005.png', url: '' },
  ],
}

/** 工具栏目：一个跑着的番茄钟 + 两条清单（一条没做完、一条做完了）。 */
const TOOLBOX = {
  focus: {
    running: true,
    phase: 'work',
    phaseLabel: '专注',
    taskId: 'td-1',
    label: '背 20 个单词',
    endsAt: '2099-01-01T00:25:00.000Z',
    left: 1380,
    roundMinutes: 25,
    workMinutes: 25,
    breakMinutes: 5,
    longBreakMinutes: 15,
    roundsPerLong: 4,
    longBreakDue: false,
    today: '2026-10-01',
    todayMinutes: 50,
    todayRounds: 2,
    log: [{ at: '2026-10-01T09:00:00.000Z', kind: 'work', minutes: 25, taskId: '', label: '看例题', partial: false }],
  },
  todos: {
    total: 2,
    open: 1,
    done: 1,
    items: [
      { id: 'td-1', text: '背 20 个单词', done: false, at: '2026-10-01T08:00:00.000Z', doneAt: '', due: '2026-10-02', pointId: 'M1.4', spent: 0, updatedAt: '2026-10-01T08:00:00.000Z' },
      { id: 'td-2', text: '整理错题', done: true, at: '2026-09-30T08:00:00.000Z', doneAt: '2026-10-01T08:30:00.000Z', due: '', pointId: '', spent: 12, updatedAt: '2026-10-01T08:30:00.000Z' },
    ],
  },
}

/**
 * 记忆卡：一张该背的、一张还没到点的、一张背下来的。
 *
 * `dueItems` 就是 `listCards(status='due')` 的结果，路由里两份一起给，
 * 所以夹具也照这个形状造。
 */
const MEMORY = {
  stats: { total: 3, due: 1, graduated: 1, learning: 1, byKind: { 单词: 1, 公式: 1, 定义: 1, 其他: 0 } },
  soon: 1,
  dueTotal: 1,
  dueItems: [
    { id: 'c-1', front: 'contingency', back: '列联表', kind: '单词', pointId: 'M1.1', state: 'due', step: 2, dueAt: '2026-10-01T09:00:00.000Z', left: 0, leftText: '现在', lapses: 1 },
    { id: 'c-3', front: 'F = ma', back: '牛顿第二定律', kind: '公式', pointId: '', state: 'due', step: 0, dueAt: '2026-10-01T09:00:00.000Z', left: 0, leftText: '现在', lapses: 0 },
  ],
  total: 3,
  items: [
    { id: 'c-1', front: 'contingency', back: '列联表', kind: '单词', pointId: 'M1.1', state: 'due', step: 2, dueAt: '2026-10-01T09:00:00.000Z', left: 0, leftText: '现在', lapses: 1 },
    { id: 'c-3', front: 'F = ma', back: '牛顿第二定律', kind: '公式', pointId: '', state: 'due', step: 0, dueAt: '2026-10-01T09:00:00.000Z', left: 0, leftText: '现在', lapses: 0 },
    { id: 'c-2', front: '独立事件', back: 'P(AB) = P(A)P(B)', kind: '定义', pointId: 'M1.1', state: 'graduated', step: 6, dueAt: '', left: 0, leftText: '', lapses: 0 },
  ],
}

/** 学生画像：一条兑得上的「弱项」，一条引的证据已经没了的「习惯」。 */
const STUDENT = {
  total: 2,
  byKind: { 习惯: 1, 强项: 0, 弱项: 1, 偏好: 0, 背景: 0 },
  orphans: [{ id: 'f-2', kind: '习惯', text: '早读效率高', bad: [{ pointId: 'M1.1', key: 'e-没了', why: '这条证据找不到了' }] }],
  facts: [
    {
      id: 'f-1',
      kind: '弱项',
      text: '换元之后容易忘记回代',
      note: '出现过两次',
      at: '2026-09-28T02:00:00.000Z',
      evidence: [
        { pointId: 'M1.1', key: 'e-aaa', pointTitle: '集合的表示', ok: true, kind: 'quiz', at: '2026-09-27T02:00:00.000Z', note: '第一章第九组第 3 题做错了' },
      ],
    },
    {
      id: 'f-2',
      kind: '习惯',
      text: '早读效率高',
      note: '',
      at: '2026-09-29T02:00:00.000Z',
      evidence: [
        { pointId: 'M1.1', key: 'e-没了', pointTitle: '集合的表示', ok: false, kind: '', at: '', note: '' },
      ],
    },
  ],
}

/** 起一次面板，喂一份假档案，等它渲染完，把 HTML 和交互句柄交出来。 */
async function boot(fixture, { stale = false, agenda = null, innerWidth = 1200, search = '', path = '/study', chat = false, hidden = false, sessions = null, messages = CHAT_MESSAGES, review = REVIEW } = {}) {
  const list = !chat ? [] : sessions === null ? SESSIONS : sessions
  const { document, window, boxes, listeners } = stubDom()
  window.innerWidth = innerWidth
  window.location.search = search
  window.location.pathname = path
  // 通道通了、页面又在前台，面板就会开一个 2.5 秒的轮询定时器——node 的
  // 事件循环就永远排不空，`node --test` 会挂着不退。要测「接通」的样子就
  // 把标签页设成后台（这是真的会走到的分支，不是给测试开的后门）。
  document.visibilityState = hidden ? 'hidden' : 'visible'
  const calls = []
  const posts = []
  globalThis.document = document
  globalThis.window = window
  // 假的 EventSource：面板接通对话时会开一条广播通道（真浏览器里是 SSE）。
  // 这里只记账，要「服务端推一帧」就手动 emit 一下。
  const sources = []
  globalThis.EventSource = class {
    constructor(url) {
      this.url = url
      this.closed = false
      this.fns = new Map()
      sources.push(this)
    }
    addEventListener(name, fn) {
      const list = this.fns.get(name) || []
      list.push(fn)
      this.fns.set(name, list)
    }
    close() {
      this.closed = true
    }
    emit(name) {
      for (const fn of this.fns.get(name) || []) fn({ data: '{}' })
    }
  }
  globalThis.fetch = async (path, options) => {
    calls.push(path)
    if (options && options.body) {
      try {
        posts.push({ path, body: JSON.parse(options.body) })
      } catch {
        posts.push({ path, body: null })
      }
    }
    if (stale && PROBE_PATHS.includes(path)) {
      return { ok: false, status: 404, json: async () => ({ ok: false, error: { code: 'not-found', message: 'unknown study route' } }) }
    }
    let body = { ok: true, state: fixture }
    if (path.includes('/api/summary')) body = { ok: true, summary: { total: 2, touched: 1, avgConfidence: 0.5, byStage: {} }, stage: [] }
    if (path.includes('/api/archive')) body = { ok: true, archive: { ...ARCHIVE, key: new URL('http://x' + path).searchParams.get('key') } }
    if (path.includes('/api/task/')) body = { ok: true, day: [] }
    if (path.includes('/api/tasks?')) {
      body = agenda
        ? { ok: true, date: agenda.date, all: true, profiles: agenda.profiles }
        : { ok: true, state: fixture }
    }
    if (path.includes('/api/review')) {
      body = review
        ? { ok: true, date: '2026-10-01', data: review.data, svg: review.svg }
        : { ok: true, date: '2026-10-01', data: null, svg: '' }
    }
    // 学生画像：读回夹具那份（带已兑的证据），删一条就回空一份。
    if (path.includes('/api/student')) {
      body = { ok: true, ...STUDENT }
      if (options && options.method === 'POST') body = { ok: true, ...STUDENT, action: 'remove', total: STUDENT.total - 1 }
    }
    // 资料页那几条。顺序要紧：/api/material? 是 /api/materials 的子串，得放在后面判。
    if (path.includes('/api/materials/build')) body = { ok: true, started: true, pid: 4242, total: 20 }
    else if (path.includes('/api/materials/import')) body = { ok: true, dir: false, added: [{ title: '必修一' }] }
    else if (path.includes('/api/materials')) body = { ok: true, ...SHELF }
    else if (path.includes('/api/material?')) body = SHELF_INDEX
    else if (path.includes('/api/material/upload')) body = { ok: true, added: [{ title: '上传的.pdf' }] }
    // 工具栏目：番茄钟跟清单各两条写接口，回的同构，够面板接着往下走就行。
    if (path.includes('/api/toolbox')) body = { ok: true, ...TOOLBOX }
    else if (path.includes('/api/focus')) body = { ok: true, action: 'start', ...TOOLBOX }
    else if (path.includes('/api/todo')) body = { ok: true, action: 'add', item: TOOLBOX.todos.items[0], todos: TOOLBOX.todos }
    // 记忆卡：读的时候按 status 把 items 换成对应那一档，写的时候回一张卡。
    else if (path.includes('/api/memory')) {
      const status = new URL('http://x' + path).searchParams.get('status') || ''
      const items = status ? MEMORY.items.filter((c) => c.state === status) : MEMORY.items
      body = { ok: true, ...MEMORY, items, total: items.length }
    }
    // 对话通道默认按「没接通」回：接通了面板会开一个轮询定时器，
    // 测试进程就永远退不出去。要测接通的样子，传 { chat: true, hidden: true }。
    // filtered:true 是这台宿主的样子——桌面那份 profile 会发会话投影，服务端因此按预设筛过，
    // 面板要照它写一句「只看学习模式」。
    if (path.includes('/api/chat/sessions')) {
      body = chat
        ? { ok: true, available: true, filtered: true, sessionId: 's1', sessions: list }
        : { ok: true, available: false, sessions: [] }
    } else if (path.includes('/api/chat')) {
      // 真服务端只在带 sessions=1 时才把清单捎回来，假的也照这个来——
      // 不然「浮窗该不该自己拉清单」这件事测不出来。
      body = chat
        ? { ok: true, available: true, filtered: true, sessionId: 's1', messages, sessions: path.includes('sessions=1') ? list : [] }
        : { ok: true, available: false, messages: [], sessions: [] }
    }
    return { ok: true, status: 200, json: async () => body }
  }
  // 真页面里 assets/boot.js 在 <head> 先跑完，panel.js 只读它的结果。
  // 测试里也得照这个顺序来，否则测到的就不是线上那条路径，而且 panel.js
  // 找不到 window.StudyBoot 会直接抛。
  const bootSrc = readFileSync(join(HERE, '..', 'assets', 'boot.js'), 'utf8')
  new Function('window', 'document', 'location', 'URLSearchParams', bootSrc)(
    window,
    document,
    window.location,
    URLSearchParams,
  )
  await import(`${PANEL}?v=${Math.random().toString(36).slice(2)}`)
  for (let i = 0; i < 60 && !boxes.get('app').innerHTML; i += 1) await sleep(5)

  const html = () => boxes.get('app').innerHTML
  /** 造一个假事件源，交给面板那份 document 级委托。 */
  const clickAct = async (dataset, { insideModal = false } = {}) => {
    const el = { dataset, closest: (sel) => (sel === '.modal' ? (insideModal ? el : null) : sel === '[data-act]' ? el : null) }
    await listeners.get('click')({ target: el })
  }
/** 造一个假事件源，交给面板那份 document 级 change 委托。 */
  const changeAct = async (dataset, value) => {
    const el = { dataset, value, id: dataset.id || '', files: [] }
    await listeners.get('change')({ target: el })
  }
  const submitForm = async (dataset, fields) => {
    globalThis.FormData = class {
      constructor() {
        this.map = new Map(Object.entries(fields))
      }
      get(key) {
        return this.map.has(key) ? this.map.get(key) : null
      }
    }
    // 聊天那个表单会顺手禁掉提交按钮、发完 reset + 把焦点放回输入框，
    // 所以假表单也得带上这几样。
    const form = {
      dataset,
      querySelector: () => ({ disabled: false, focus() {} }),
      reset() {},
      preventDefault() {},
    }
    await listeners.get('submit')({ target: form, preventDefault() {} })
  }
  /** 点一个带 data-nav 的导航链接（它不该整页跳，该前端自己切页）。 */
  const clickNav = async (id) => {
    let jumped = false
    const el = {
      dataset: { nav: id },
      closest: (sel) => (sel === '[data-nav]' ? el : null),
    }
    await listeners.get('click')({
      target: el,
      button: 0,
      preventDefault() {
        jumped = true
      },
    })
    return { jumped }
  }
  return { html, calls, posts, boxes, clickAct, clickNav, changeAct, submitForm, listeners, window, sources, documentElement: document.documentElement }
}

function fixture() {  return {
    root: '/tmp/x',
    profile: {
      version: 1,
      goal: { subject: '高等数学', outcome: '能独立做中档题', deadline: '2027-09-30', minutesPerDay: 60 },
      materials: [{ id: 'mat-1', kind: 'video', title: '网课', path: 'F:\\课件', note: '' }],
      tools: [{ name: '手算', stage: '能跟做', confidence: 0.6, note: '照着例题能算' }],
    },
    map: {
      status: 'confirmed',
      modules: [
        {
          id: 'M1',
          title: '第一模块',
          group: '第一大块',
          points: [
            { id: 'M1.1', title: '第一个单元', why: '打底', source: '第一章', video: 'F:\\课件\\01.第一节', practice: 'F:\\课件\\作业.pdf' },
            { id: 'M1.2', title: '第二个单元', why: '', source: '第一章' },
          ],
        },
      ],
    },
    mastery: { points: { 'M1.1': { stage: '能跟做', confidence: 0.6, evidence: [], nextReview: '2026-10-03' } } },
    tasks: {
      days: {
        [new Date().toISOString().slice(0, 10)]: [
          { id: 'task-1', title: '看第一节', kind: 'watch', target: 'M1.1', minutes: 40, done: false, note: '边看边记' },
        ],
      },
    },
    guide: { text: '看完回来答三个问题', kind: 'ask' },
    inbox: { items: [{ id: 'msg-1', text: '这里没看懂', at: '2026-10-01', read: false }] },
    analysis: { byMaterial: {} },
    progress: {
      overall: 20,
      groups: { 第一大块: 20 },
      modules: { M1: 20 },
    },
    ability: {
      today: '2026-10-01',
      goal: { subject: '高等数学', outcome: '能独立做中档题', deadline: '2027-09-30', minutesPerDay: 60, daysLeft: 364 },
      total: 2,
      touched: 1,
      untouched: 1,
      byStage: { '能跟做': 1, '没接触过': 1 },
      avgConfidence: 0.6,
      overall: 20,
      groups: [{ name: '第一大块', progress: 20, points: 2, weak: 1, due: 1 }],
      weak: [{ pointId: 'M1.2', title: '第二个单元', group: '第一大块', moduleTitle: '第一模块', reason: '还没碰过', stage: '没接触过' }],
      weakTotal: 1,
      due: [{ pointId: 'M1.1', title: '第一个单元', stage: '能跟做', nextReview: '2026-10-03' }],
      dueTotal: 1,
      tools: [{ name: '手算', stage: '能跟做', confidence: 0.6, note: '照着例题能算' }],
      pace: { days: [{ date: '2026-10-01', total: 1, done: 0, minutesTotal: 40, minutesDone: 0 }], total: 1, done: 0, minutesTotal: 40, minutesDone: 0, completion: 0 },
      judgement: { text: '底子还行，先把没碰过的补上。', level: '起步', updatedAt: '2026-10-01' },
    },
    stage: ['没接触过', '见过', '能跟做', '能独立做', '熟练稳定', '能讲明白'],
    at: '2026-10-01',
    profiles: [
      { id: 'default', title: '高等数学', subject: '高等数学', active: true, modules: 1, points: 2, progress: 20 },
      { id: 'p2', title: '线性代数', subject: '线性代数', active: false, modules: 0, points: 0, progress: 0 },
    ],
  }
}

test('主页面：只回答「现在什么情况、下一步点哪儿」，活儿都在子页面里', async () => {
  const { html, calls } = await boot(fixture())

  // 先把两份数据拿回来（探测要用 state 里登记过的材料路径，得排在它后面）
  assert.deepEqual(calls.slice(0, 2), ['/study/api/state', '/study/api/summary'])
  // 再探一遍新路由在不在（顺序就是 PROBE_PATHS 那一串，加一条探针这里不用再改）
  assert.deepEqual(calls.slice(2, 2 + PROBE_PATHS.length), PROBE_PATHS)
  // 多门课的时候顺带把「今天每门各有什么」拉一遍
  assert.match(calls[2 + PROBE_PATHS.length] || '', /^\/study\/api\/tasks\?all=1&date=\d{4}-\d{2}-\d{2}$/)

  // 假 fetch 什么都回 200，所以不该出现「服务端是旧代码」那条横幅
  assert.doesNotMatch(html(), /服务端还是旧代码/)

  // 顶栏就是导航：六页一个不少，当前那页标出来
  for (const p of ['/study', '/study/today', '/study/map', '/study/ability', '/study/library', '/study/coach']) {
    const want = p.replace(/\//g, '\\/')
    assert.match(html(), new RegExp(`class="nav-item[^"]*" href="${want}"`), `导航里该有 ${p}`)
  }
  assert.match(html(), /class="nav-item on" href="\/study"/)

  // 主页面三件套：hero、大盘数字、入口卡
  assert.match(html(), /class="hero"/)
  assert.match(html(), /class="stats"/)
  assert.match(html(), /class="entries"/)
  assert.equal(html().split('class="entry"').length - 1, 6, '六个入口')

  // 教练的指引摆在最显眼的地方，好把人叫回对话
  assert.match(html(), /看完回来答三个问题/)
  assert.equal(html().split('看完回来答三个问题').length - 1, 1, '指引只该出现一次')

  // 主页面自己不是操作台：任务勾选、档案弹层、目标库表单都不铺在这儿
  assert.doesNotMatch(html(), /data-act="task-toggle"/)
  assert.doesNotMatch(html(), /data-act="archive-open"/)
  assert.doesNotMatch(html(), /data-act="lib-select"/)
})

test('换页走前端，不整页跳——服务端没重启时子页面也点得开', async () => {
  // 真实场景：DSH 里跑的还是启动时加载的旧路由，/study/today 会回一个 JSON 404。
  // 导航要是老老实实整页跳过去，人看到的就是一屏报错，所以这里必须拦下来自己切。
  const { html, clickNav, window } = await boot(fixture())

  assert.match(html(), /data-nav="today"/, '导航链接得标出自己切哪一页')
  const { jumped } = await clickNav('today')
  assert.equal(jumped, true, '点了就得 preventDefault，不能让它整页跳')

  // 页换过去了：今天页的东西出来了，主页那套收起来
  assert.match(html(), /data-card="today"/)
  assert.match(html(), /data-act="task-toggle"/)
  assert.doesNotMatch(html(), /class="hero"/)
  assert.match(html(), /class="nav-item on" href="\/study\/today"/)
  assert.equal(window.history.pushes.at(-1), '/study/today', '地址栏要跟着变，好让人能复制能刷新')

  // 再点回主页
  await clickNav('home')
  assert.match(html(), /class="hero"/)
  assert.equal(window.history.pushes.at(-1), '/study')
})

test('今天页：任务能跳转、能改能删；看课的任务先看再练，顺序不能反', async () => {
  const { html, clickAct } = await boot(fixture(), { path: '/study/today' })

  assert.match(html(), /data-card="today"/)
  assert.match(html(), /data-act="task-toggle"/)
  assert.match(html(), /\/study\/file\?path=F%3A%5C%E8%AF%BE%E4%BB%B6%5C01\.%E7%AC%AC%E4%B8%80%E8%8A%82/)
  assert.match(html(), /观看本节网课/)
  assert.match(html(), /本节讲义/)
  assert.match(html(), /\/study\/practice\?point=M1\.1/)
  assert.match(html(), /看完后做题/)
  assert.ok(html().indexOf('观看本节网课') < html().indexOf('看完后做题'), '看课按钮要排在练习前面')
  assert.doesNotMatch(html(), /做题 \/ 查看掌握度/, '看课任务的按钮说的是「看完后做题」')

  assert.match(html(), /data-act="task-edit"/)
  assert.match(html(), /data-act="task-remove"/)
  await clickAct({ act: 'task-remove', id: 'task-1' })
  assert.match(html(), /确认删除/)
  await clickAct({ act: 'task-cancel' })
  assert.doesNotMatch(html(), /确认删除/)
})

test('能力页：大盘、卡住的地方、每级档案按键，点开是那一级的细账', async () => {
  const { html, calls, clickAct } = await boot(fixture(), { path: '/study/ability' })

  assert.match(html(), /card ability/)
  assert.match(html(), /底子还行，先把没碰过的补上。/)
  assert.match(html(), /待复习/)
  assert.match(html(), /最近七天/)

  // 每级都有「档案」小按键：大类、单元总览里就有，模块级得在地图页展开大类才露出来
  assert.match(html(), /data-act="archive-open" data-level="group"/)
  assert.match(html(), /data-act="archive-open" data-level="point"/)
  assert.doesNotMatch(html(), /data-act="archive-open" data-level="module"/)

  // 点「档案」把弹层拉起来，里面是这一级的细账
  await clickAct({ act: 'archive-open', level: 'module', key: 'M1' })
  assert.match(html(), /模块掌握档案 · 第一模块/)
  assert.match(html(), /2 条证据/)
  assert.match(html(), /下次复习：2026-10-03/)
  assert.match(calls.at(-1), /\/study\/api\/archive\?level=module&key=M1/)

  // 点弹层里面不该关，点背板才关
  await clickAct({ act: 'archive-close' }, { insideModal: true })
  assert.match(html(), /模块掌握档案/)
  await clickAct({ act: 'archive-close' })
  assert.doesNotMatch(html(), /模块掌握档案/)
})

test('学生画像：一句话带着当年的那次证据，证据没了要当着面说', async () => {
  const { html, posts, boxes, clickAct } = await boot(fixture(), { path: '/study/ability' })

  // 卡头上写着有几条、几要修；两张判断都画出来
  assert.match(html(), /data-card="student"/)
  assert.match(html(), /2 条判断 · 1 条要修/)
  assert.match(html(), /换元之后容易忘记回代/)
  assert.match(html(), /早读效率高/)

  // 判断是结论，底下得挂着「哪一次」——兑得上就把那次的类型和原话摆出来
  assert.match(html(), /集合的表示 · quiz/)
  assert.match(html(), /第一章第九组第 3 题做错了/)

  // 兑不上的不能藏起来（地图重画换了单元号，或者证据被删了，都是真会发生的）
  assert.match(html(), /证据没了/)
  assert.match(html(), /1 条判断引的证据找不到了/)

  // 分档：默认全看，点「弱项」只剩那条
  assert.match(html(), /data-act="fact-filter" data-kind="弱项"/)
  await clickAct({ act: 'fact-filter', kind: '弱项' })
  assert.match(html(), /换元之后容易忘记回代/)
  assert.doesNotMatch(html(), /早读效率高/)

  // 觉得不对就删：打的是 POST，回来重拉一次
  await clickAct({ act: 'fact-del', id: 'f-1' })
  assert.deepEqual(posts.at(-1), { path: '/study/api/student', body: { action: 'remove', id: 'f-1' } })
  assert.match(boxes.get('toast').textContent, /这条判断删掉了/)
})

test('地图页：展开大类才看得到模块那级的档案；定稿的地图不再问「就这么定」', async () => {
  const { html, clickAct } = await boot(fixture(), { path: '/study/map' })

  assert.match(html(), /data-card="map"/)
  assert.doesNotMatch(html(), /data-act="map-confirm"/)

  // 没展开之前，模块级那颗按键不该出现
  assert.doesNotMatch(html(), /data-act="archive-open" data-level="module"/)
  await clickAct({ act: 'group-open', group: '第一大块' })
  assert.match(html(), /data-act="archive-open" data-level="module" data-key="M1"/)
})

test('档案页：目标库、学习目标、材料、基本工具各就各位，主栏边栏分得开', async () => {
  const { html } = await boot(fixture(), { path: '/study/library' })

  // 学习目标库：切换 / 改名 / 删掉 / 新建
  assert.match(html(), /data-act="lib-select"/)
  assert.match(html(), /data-act="lib-rename"/)
  assert.match(html(), /data-act="lib-remove"/)
  assert.match(html(), /新建一个学习目标/)
  assert.match(html(), /在用/)

  // 学习目标也该能改（主路径是对话，这儿只是兜底）
  assert.match(html(), /data-act="goal-edit"/)

  // 主栏放档案与材料，边栏放目标与工具
  assert.match(html(), /<div class="col main">.*data-card="library"/s)
  assert.match(html(), /<div class="col aside">.*data-card="goal"/s)
  assert.match(html(), /<div class="col aside">.*data-card="tools"/s)
})

test('表单能提交：改任务、改目标、改档案名、新建档案都走得通', async () => {
  // 改任务在「今天」页
  const today = await boot(fixture(), { path: '/study/today' })
  const taskBefore = today.calls.length
  await today.clickAct({ act: 'task-edit', id: 'task-1' })
  assert.match(today.html(), /data-form="task-edit"/)
  await today.submitForm({ form: 'task-edit', id: 'task-1' }, { title: '看第二节', kind: 'read', minutes: '25' })
  assert.ok(today.calls.length - taskBefore >= 4, `提交后应该重新 load 过，实际只多发了 ${today.calls.length - taskBefore} 条`)

  // 改目标、改档案名、新建档案都在「档案」页
  const lib = await boot(fixture(), { path: '/study/library' })
  const before = lib.calls.length

  await lib.clickAct({ act: 'goal-edit' })
  assert.match(lib.html(), /data-form="goal"/)
  await lib.submitForm({ form: 'goal' }, { subject: '高数', outcome: '会做中档题', deadline: '2027-09-30', minutesPerDay: '45' })

  await lib.clickAct({ act: 'lib-rename', id: 'p2' })
  assert.match(lib.html(), /data-form="lib-rename"/)
  await lib.submitForm({ form: 'lib-rename', id: 'p2' }, { title: '新名字' })

  await lib.clickAct({ act: 'lib-new' })
  assert.match(lib.html(), /data-form="lib-new"/)
  await lib.submitForm({ form: 'lib-new' }, { title: '第三门', subject: '', outcome: '', deadline: '', minutesPerDay: '' })

  // 每次提交后都得重新拉一遍 state + summary
  assert.ok(lib.calls.length - before >= 8, `提交后应该重新 load 过，实际只多发了 ${lib.calls.length - before} 条`)
})

test('地图还是草稿时，地图页给出定稿按钮；没数据的能力卡不渲染', async () => {
  const data = fixture()
  data.map.status = 'draft'
  data.ability = null
  data.profiles = []

  const map = await boot(data, { path: '/study/map' })
  assert.match(map.html(), /data-act="map-confirm"/)
  assert.match(map.html(), /地图尚未定稿/)

  // 能力卡没数据就不该渲染
  const ability = await boot(data, { path: '/study/ability' })
  assert.doesNotMatch(ability.html(), /card ability/)

  // 单档案的时候不出现目标库
  const lib = await boot(data, { path: '/study/library' })
  assert.doesNotMatch(lib.html(), /新建一个学习目标/)
})

test('服务端是旧代码时，面板把话说清楚，而不是让人对着没反应的按钮猜', async () => {
  const home = await boot(fixture(), { stale: true })

  // 顶上那条横幅：缺哪几样、为什么、怎么办
  assert.match(home.html(), /服务端还是旧代码/)
  assert.match(home.html(), /总体能力判断/)
  assert.match(home.html(), /每级掌握档案/)
  assert.match(home.html(), /做题页/)
  assert.match(home.html(), /打开网课 \/ 讲义/)
  assert.match(home.html(), /重启 DSH/)

  // 东西还是照常渲染，不是一屏错误
  const ability = await boot(fixture(), { stale: true, path: '/study/ability' })
  assert.match(ability.html(), /data-act="archive-open" data-level="group"/)
  const today = await boot(fixture(), { stale: true, path: '/study/today' })
  assert.match(today.html(), /data-act="task-toggle"/)
})

test('体检卡：挡路的 / 该修的 / 顺手能做的分三档，每条都说得出为什么', async () => {
  // 服务端都是新的：没有「挡路的」这一档，剩下的都是能自己修的
  const ok = await boot(fixture())
  assert.match(ok.html(), /class="card health"/)
  assert.match(ok.html(), /件该修的/)
  assert.match(ok.html(), /学习目标还缺 3 项/)
  assert.match(ok.html(), /minutesPerDay/)
  assert.match(ok.html(), /顺手能做的/)
  assert.doesNotMatch(ok.html(), /挡路的/, '服务端是新的就不该有挡路那一档')
  assert.doesNotMatch(ok.html(), /class="hd-sec bad"/)
  // 每条都配一个能点回去的地方
  assert.match(ok.html(), /data-nav="materials"/)

  // 服务端是旧的：升成「挡路的」，并且逐条写清是哪一样、坏在哪儿
  const stale = await boot(fixture(), { stale: true })
  assert.match(stale.html(), /件挡路的/)
  assert.match(stale.html(), /class="hd-sec bad"/)
  // 处数会随能力项加减，别钉死数字；要钉的是「哪一样没了」都得点出来
  assert.match(stale.html(), /服务端还是旧代码，\d+ 处点下去会 404/)
  assert.match(stale.html(), /学生画像——能力页的画像卡/)
  assert.match(stale.html(), /记忆卡——工具页的记忆卡/)
  assert.match(stale.html(), /重启 DSH/)

  // 挡路那条不给「去看」按钮：这个学生自己点不回去，只能重启
  const body = stale.html()
  const badStart = body.indexOf('hd-sec bad')
  const badEnd = body.indexOf('hd-sec warn')
  assert.ok(badStart > 0 && badEnd > badStart, '挡路的要排在前面')
  assert.doesNotMatch(body.slice(badStart, badEnd), /data-nav=/)
})

/** 「今天」那栏的多科目版本：两门课各一条，服务端把链接都算好了。 */
function agendaFixture() {
  const date = new Date().toISOString().slice(0, 10)
  return {
    date,
    profiles: [
      {
        id: 'default',
        title: '高等数学',
        subject: '高等数学',
        active: true,
        progress: 20,
        modules: 1,
        points: 2,
        day: [
          {
            id: 'task-1',
            title: '看第一节',
            kind: 'watch',
            minutes: 40,
            done: false,
            note: '边看边记',
            target: 'M1.1',
            pointTitle: '第一个单元',
            group: '第一大块',
            links: [
              { kind: 'video', label: '看这节网课', url: '/study/file?path=F%3A%5C%E8%AF%BE%E4%BB%B6%5C01.%E7%AC%AC%E4%B8%80%E8%8A%82' },
              { kind: 'point', label: '看完去做练习', url: '/study/practice?point=M1.1' },
            ],
          },
        ],
      },
      {
        id: 'p2',
        title: '线性代数',
        subject: '线性代数',
        active: false,
        progress: 0,
        modules: 0,
        points: 0,
        day: [{ id: 'task-9', title: '行列式定义', kind: 'practice', minutes: 20, done: true, note: '', links: [] }],
      },
    ],
  }
}

test('多科目：今天页按科目分组，能只看一门，也能直接给任意一门加任务', async () => {
  const { html, clickAct, submitForm, posts } = await boot(fixture(), { agenda: agendaFixture(), path: '/study/today' })

  // 两门课各占一组，任务挂在各自的 profileId 上
  assert.match(html(), /data-act="task-filter" data-profile="p2"/)
  assert.match(html(), /线性代数/)
  assert.match(html(), /data-act="task-toggle" data-id="task-1" data-profile="default"/)
  assert.match(html(), /data-act="task-toggle" data-id="task-9" data-profile="p2"/)
  assert.match(html(), /完成 1\/2 · 60 分钟/)
  // 服务端算好的跳转按钮原样用，不用前端再拼一遍
  assert.match(html(), /\/study\/practice\?point=M1\.1/)

  // 只看线性代数那一门
  await clickAct({ act: 'task-filter', profile: 'p2' })
  assert.match(html(), /data-id="task-9"/)
  assert.doesNotMatch(html(), /data-id="task-1"/)
  // 再点回来
  await clickAct({ act: 'task-filter', profile: '' })
  assert.match(html(), /data-id="task-1"/)

  // 加一条：默认排给当前在用的那门，也能指定另一门
  await clickAct({ act: 'task-new' })
  assert.match(html(), /data-form="task-add"/)
  await submitForm({ form: 'task-add' }, { title: '看第 3 讲', kind: 'watch', minutes: '30', target: 'M1.2', open: '', profileId: 'p2' })
  assert.equal(posts.at(-1).path, '/study/api/task')
  assert.equal(posts.at(-1).body.profileId, 'p2')
  assert.equal(posts.at(-1).body.title, '看第 3 讲')
  assert.equal(posts.at(-1).body.minutes, 30)
  assert.doesNotMatch(html(), /data-form="task-add"/)

  // 删一条也要带上它属于哪门课
  await clickAct({ act: 'task-remove', id: 'task-9', profile: 'p2' })
  assert.match(html(), /确认删除/)
  await clickAct({ act: 'task-del', id: 'task-9', profile: 'p2' })
  assert.equal(posts.at(-1).path, '/study/api/task/remove')
  assert.equal(posts.at(-1).body.profileId, 'p2')
})

test('两种模式：窄屏默认侧栏、卡片折起来只留名字；点一下切成浏览器模式铺开', async () => {
  const narrow = await boot(fixture(), { innerWidth: 400, path: '/study/today' })
  assert.equal(narrow.documentElement.dataset.mode, 'sidebar')
  // 侧栏模式：每张卡头顶一条折叠按钮，卡身折起来
  assert.match(narrow.html(), /class="fold"[^>]*data-act="card-toggle"/)
  assert.match(narrow.html(), /data-card="today"/)
  assert.match(narrow.html(), /今日任务/)
  // 「今日任务」默认是开着的（这张卡还多带一个 day 类：它照复盘图的版式重排过）
  assert.match(narrow.html(), /class="card day open" data-card="today"/)

  await narrow.clickAct({ act: 'card-toggle', card: 'today' })
  assert.doesNotMatch(narrow.html(), /class="card day open" data-card="today"/)
  await narrow.clickAct({ act: 'card-toggle', card: 'today' })
  assert.match(narrow.html(), /class="card day open" data-card="today"/)

  // 切成浏览器模式：折叠按钮消失
  await narrow.clickAct({ act: 'mode', mode: 'browser' })
  assert.equal(narrow.documentElement.dataset.mode, 'browser')
  assert.doesNotMatch(narrow.html(), /data-act="card-toggle"/)
  // 侧栏才用的折叠类不该漏到浏览器模式里
  assert.doesNotMatch(narrow.html(), /class="card[^"]*\bopen\b/)

  // 两栏都有东西的页（档案页）：主栏 + 边栏各摞各的
  const lib = await boot(fixture(), { path: '/study/library' })
  assert.match(lib.html(), /<div class="col main">.*data-card="library"/s)
  assert.match(lib.html(), /<div class="col aside">.*data-card="goal"/s)
  assert.doesNotMatch(lib.html(), /data-act="card-toggle"/)

  // 只有一栏的页不硬凑一个空边栏
  const map = await boot(fixture(), { path: '/study/map' })
  assert.doesNotMatch(map.html(), /<div class="col aside">/)

  // 反着来：宽屏默认浏览器模式
  const wide = await boot(fixture())
  assert.equal(wide.documentElement.dataset.mode, 'browser')
  assert.doesNotMatch(wide.html(), /data-act="card-toggle"/)

  // 地址上写死过就听地址的
  const asked = await boot(fixture(), { innerWidth: 1400, search: '?mode=sidebar' })
  assert.equal(asked.documentElement.dataset.mode, 'sidebar')
  assert.match(asked.html(), /data-act="card-toggle"/)

  // 侧栏一屏只放得下一张卡：进哪一页就把那一页的主卡摊开
  const coach = await boot(fixture(), { innerWidth: 400, path: '/study/coach' })
  assert.match(coach.html(), /class="card open" data-card="chat"/)
  const libNarrow = await boot(fixture(), { innerWidth: 400, path: '/study/library' })
  assert.match(libNarrow.html(), /class="card open" data-card="library"/)

  // 工具页那张卡多带了一个类（`<section class="card focus">`），以前 fold() 会把
  // 后面的属性也当成类名砍进去，拼出 `data-card="focus open" data-card="tool"`：
  // open 掉进 data-card 里，卡永远折着，点折叠按钮也拿错 dataset.card。钉死它。
  const tool = await boot(fixture(), { innerWidth: 400, path: '/study/toolbox' })
  assert.match(tool.html(), /class="card focus open" data-card="tool"/)
  // 侧栏模式那一页会出两处 data-card="tool"：折叠按钮一颗、卡片一节。两处都得干净。
  assert.equal((tool.html().match(/data-card="tool"/g) || []).length, 2)
  assert.doesNotMatch(tool.html(), /data-card="[^"]*\s/)
})

test('对话页就是一个完整聊天窗口；别的页挂一颗悬浮窗', async () => {
  // ① 对话页：整页给聊天，没有「给教练留言」这张卡
  const live = await boot(fixture(), { path: '/study/coach', chat: true, hidden: true })
  assert.match(live.html(), /class="cards chat-page"/)
  assert.match(live.html(), /id="chat-log"/)
  assert.match(live.html(), /data-form="chat"/)
  assert.match(live.html(), /这一节的含参讨论没跟上/, '真消息得画出来')
  assert.doesNotMatch(live.html(), /给教练留言/)
  assert.doesNotMatch(live.html(), /data-form="inbox"/)
  assert.doesNotMatch(live.html(), /data-act="float-open"/, '这一页本身就是聊天窗口，不用再挂一颗')

  // 通道没接通时也得说清楚，而不是装作坏了
  const off = await boot(fixture(), { path: '/study/coach' })
  assert.match(off.html(), /未接通对话通道/)
  assert.match(off.html(), /data-act="chat-reload"/)
  assert.doesNotMatch(off.html(), /给教练留言/)

  // ② 别的页：右下角一颗圆按钮，默认没展开
  const home = await boot(fixture(), { path: '/study', chat: true, hidden: true })
  assert.match(home.html(), /class="fab" data-act="float-open"/)
  assert.doesNotMatch(home.html(), /class="float"/)

  // ③ 点开：小窗出来，有自己的消息区和输入框，发消息走同一条通道
  await home.clickAct({ act: 'float-open' })
  assert.match(home.html(), /class="float"/)
  assert.match(home.html(), /id="float-log"/)
  assert.match(home.html(), /data-form="chat"/)
  assert.doesNotMatch(home.html(), /class="fab"/)
  await home.submitForm({ form: 'chat' }, { text: '今天只剩 30 分钟' })
  assert.equal(home.posts.at(-1).path, '/study/api/chat/send')
  assert.equal(home.posts.at(-1).body.text, '今天只剩 30 分钟')

  // ④ 收起
  await home.clickAct({ act: 'float-close' })
  assert.match(home.html(), /class="fab" data-act="float-open"/)
  assert.doesNotMatch(home.html(), /class="float"/)
})

test('顶上那一栏：教练没留话就整条不画，不再垫一句「本页仅供查看」', async () => {
  // 夹具里 guide 是有话的：那就得画出来，还带「这类话要他干嘛」那一行小字
  const said = await boot(fixture())
  assert.match(said.html(), /class="card guide on"/)
  assert.match(said.html(), /看完回来答三个问题/)
  assert.match(said.html(), /需在对话中回答/)

  // 教练没留话：整张卡都不在——以前这里垫一句「本页仅供查看…」，每页挂着
  const quiet = await boot({ ...fixture(), guide: { text: '', kind: '' } })
  assert.doesNotMatch(quiet.html(), /仅供查看/)
  assert.doesNotMatch(quiet.html(), /class="card guide/)
  assert.doesNotMatch(quiet.html(), /教练的指引/, '空卡连折叠条都不该有')
})

test('浮窗能拖着走：位置记在样式里、重画不跳回角落，双击回右下角', async () => {
  const home = await boot(fixture(), { path: '/study', chat: true, hidden: true })
  await home.clickAct({ act: 'float-open' })

  // 假的窗口元素：量出来 372×540，此刻坐在 (800, 500)
  const box = {
    style: {},
    offsetWidth: 372,
    offsetHeight: 540,
    getBoundingClientRect: () => ({ left: 800, top: 500, width: 372, height: 540 }),
  }
  const head = { closest: () => null }
  const target = {
    closest(sel) {
      if (sel === '.float') return box
      if (sel === '.float-head') return head
      return null // 标题栏上那两颗按钮：按在这儿不算拖
    },
  }
  const down = home.listeners.get('pointerdown')
  const move = home.listeners.get('pointermove')
  const up = home.listeners.get('pointerup')

  // 没按住就动：一动不动
  move({ clientX: 10, clientY: 10 })
  assert.equal(box.style.left, undefined)

  // 按住 (900, 520) —— 抓手在窗子里的 (100, 20)，拖到 (200, 300) 就是落在 (100, 280)
  down({ button: 0, clientX: 900, clientY: 520, target, preventDefault() {} })
  move({ clientX: 200, clientY: 300 })
  assert.equal(box.style.left, '100px')
  assert.equal(box.style.top, '260px', '视口高 800、窗子高 540，最多到 260 —— 拖不出视口')
  assert.equal(box.style.right, 'auto', 'right 得让开，不然两头顶着')
  assert.equal(box.style.bottom, 'auto')

  // 再往右下角甩：按回视口内（1200-372 = 828）
  down({ button: 0, clientX: 300, clientY: 400, target, preventDefault() {} })
  move({ clientX: 9999, clientY: 9999 })
  assert.equal(box.style.left, '828px')
  assert.equal(box.style.top, '260px')

  // 松手之后鼠标再动，窗子不跟着跑
  up()
  move({ clientX: 40, clientY: 40 })
  assert.equal(box.style.left, '828px')
  // 并且记下来了，刷新之后还在老地方
  assert.equal(home.window.localStorage.getItem('study-coach:float-pos'), '{"left":828,"top":260}')

  // 重画（收起再点开）位置得带着 —— 否则每 2.5 秒刷一次快照，窗子自己跳回右下角
  await home.clickAct({ act: 'float-close' })
  await home.clickAct({ act: 'float-open' })
  assert.match(home.html(), /class="float moved" style="left:828px;top:260px"/)

  // 双击标题栏：回右下角，记的位置也忘掉
  const head2 = { closest: (sel) => (sel === '.float-head' ? head2 : sel === '.float' ? box : null) }
  home.listeners.get('dblclick')({ target: head2 })
  assert.equal(box.style.left, '', '回到 CSS 那个右下角')
  assert.equal(box.style.top, '')
  assert.equal(home.window.localStorage.getItem('study-coach:float-pos'), null)
  assert.match(home.html(), /class="float" role="dialog"/)
  assert.doesNotMatch(home.html(), /class="float moved"/)
})

test('浮窗记的位置是另一块屏幕上拖的：重画时按当前视口收回来看得见', async () => {
  const home = await boot(fixture(), { path: '/study', chat: true, hidden: true })
  await home.clickAct({ act: 'float-open' })
  const box = {
    style: {},
    offsetWidth: 372,
    offsetHeight: 540,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 372, height: 540 }),
  }
  const head = { closest: () => null }
  const target = { closest: (sel) => (sel === '.float' ? box : sel === '.float-head' ? head : null) }
  // 在外接屏（1200×800）上拖到右下角
  home.listeners.get('pointerdown')({ button: 0, clientX: 900, clientY: 520, target, preventDefault() {} })
  home.listeners.get('pointermove')({ clientX: 9999, clientY: 9999 })
  home.listeners.get('pointerup')({})
  assert.equal(box.style.left, '828px')

  // 换回笔记本，视口只剩 400×700 —— 再画一次就得挪回来
  home.window.innerWidth = 400
  home.window.innerHeight = 700
  home.window.__query = (sel) => (sel === '.float' ? box : null)
  await home.clickAct({ act: 'float-close' })
  await home.clickAct({ act: 'float-open' })
  assert.equal(box.style.left, '28px', '400 - 372')
  assert.equal(box.style.top, '160px', '700 - 540')
  assert.equal(home.window.localStorage.getItem('study-coach:float-pos'), '{"left":28,"top":160}')
  assert.match(home.html(), /class="float moved" style="left:28px;top:160px"/)
})

test('会话选择：只有一个会话也写出来，多个才给下拉，浮窗里也有', async () => {
  // ① 多个会话：给下拉，选项里带最后活动时间；当前那个被选中
  const page = await boot(fixture(), { path: '/study/coach', chat: true, hidden: true })
  assert.match(page.html(), /class="chat-pick"/)
  assert.match(page.html(), /<select data-act="chat-session">/)
  assert.match(page.html(), /value="s1" selected/)
  assert.match(page.html(), /学习教练[^<]*·[^<]*进行中/, '标题 + 时间 + 进行中')
  assert.match(page.html(), /（新会话）/, '空会话要有名字，不能是一片空白')
  assert.match(page.html(), /dshworkingspace\(studyplugin/, '没标题就退回目录末段')
  assert.doesNotMatch(page.html(), /当前会话/, '有得选就不叫「当前会话」')

  // 切一个：带上 sessionId 重新拉，并且还要再要一次清单
  await page.changeAct({ act: 'chat-session' }, 's2')
  const asked = page.calls.filter((c) => c.startsWith('/study/api/chat?')).at(-1)
  assert.match(asked, /sessionId=s2/)
  assert.match(asked, /sessions=1/)

  // ② 只有一个会话：不给点不动的下拉，直接把「你在哪一个」写出来
  const one = await boot(fixture(), { path: '/study/coach', chat: true, hidden: true, sessions: [SESSIONS[0]] })
  assert.match(one.html(), /当前会话/)
  assert.match(one.html(), /class="pick-now"[^>]*>[^<]*学习教练/)
  assert.doesNotMatch(one.html(), /data-act="chat-session"/, '没得选就别放一颗控件')

  // ③ 悬浮窗里也要能切：load() 只问了快照，点开浮窗得自己去拉清单
  const home = await boot(fixture(), { path: '/study', chat: true, hidden: true })
  assert.doesNotMatch(home.html(), /data-act="chat-session"/, '浮窗没开的时候不用拉清单')
  await home.clickAct({ act: 'float-open' })
  assert.match(home.html(), /<select data-act="chat-session">/, '浮窗里得有会话选择')
  await home.changeAct({ act: 'chat-session' }, 's1')
  assert.match(home.calls.filter((c) => c.startsWith('/study/api/chat?')).at(-1), /sessionId=s1/)

  // ④ 通道没接通：一个选择器都不该冒出来
  const off = await boot(fixture(), { path: '/study' })
  assert.doesNotMatch(off.html(), /data-act="chat-session"/)
  assert.doesNotMatch(off.html(), /当前会话/)
})

test('会话选择旁边那颗「＋ 新建」：清单空着也能自己开一个学习教练会话', async () => {
  // 一个学习教练会话都没有时，那一行得给条出路——面板自己去 create，别让学生回 DSH 绕一圈。
  const page = await boot(fixture(), { path: '/study/coach', chat: true, hidden: true, sessions: [] })
  assert.match(page.html(), /data-act="chat-new"/)
  assert.match(page.html(), /＋ 新建/)
  assert.match(page.html(), /还没有「学习教练」模式的对话/)

  await page.clickAct({ act: 'chat-new' })
  assert.equal(page.posts.at(-1).path, '/study/api/chat/new', '走的是新建那条路由')
  assert.deepEqual(page.posts.at(-1).body, {}, '不用带参数：预设和落点都由服务端定')
  assert.match(
    page.calls.filter((c) => c.startsWith('/study/api/chat?')).at(-1),
    /sessionId=s1/,
    '开完就切到刚建的那个会话',
  )

  // 有会话的时候那颗按钮也还在（旁边多一句「只看学习模式」）
  const many = await boot(fixture(), { path: '/study/coach', chat: true, hidden: true })
  assert.match(many.html(), /class="dim chat-only">只看学习模式<\/span><button class="mini chat-new"/)
})

test('消息正文走 markdown + 数学；表情包画成图（图片通道）；新消息靠广播通道自己冒出来', async () => {
  const CAPTION = '得意闭眼拳头，好耶，小鲸鱼娘很满意'
  const messages = [
    ...CHAT_MESSAGES,
    { id: 'c3', seq: 20, role: 'bot', text: `[表情: ${CAPTION}] 就照这个来`, time: 1759300120000, tools: [] },
    {
      id: 'c4',
      seq: 21,
      role: 'bot',
      text: '**判据**：当 $x^2+y^2=1$ 时，最小值是 1。\n\n- 先配方\n- 再看端点',
      time: 1759300180000,
      tools: [],
    },
  ]
  const page = await boot(fixture(), { path: '/study/coach', chat: true, hidden: true, messages })

  // ① `[表情: 描述]` 换成图片通道那条路由，不再原样显示成一段文字
  assert.match(page.html(), /<img class="chat-meme" src="\/study\/api\/meme\?q=[^"]+"/)
  assert.match(page.html(), new RegExp(`alt="${CAPTION}"`), 'alt 就是那句描述，图挂了也不会留破图')
  assert.doesNotMatch(page.html(), /\[表情:/, '那条记号不是给学生看的正文')
  assert.match(page.html(), /就照这个来/, '同一句里别的字还得在')

  // ①' markdown：粗体、列表、公式都画出来了（这一份假 DOM 里没有 KaTeX，公式落回等宽源码）
  assert.match(page.html(), /<b>判据<\/b>/, '粗体不再是两个星号')
  assert.match(page.html(), /<div class="md-list"><ul><li>先配方<\/li><li>再看端点<\/li><\/ul><\/div>/)
  assert.match(page.html(), /<code class="md-math"[^>]*>x\^2\+y\^2=1<\/code>/, '数学走渲染器，不是原样的美元号')
  assert.doesNotMatch(page.html(), /\*\*判据\*\*/)

  // ② 广播通道开着——而且页面在后台也开着（推送正是给后台准备的）
  assert.equal(page.sources.length, 1)
  assert.equal(page.sources[0].url, '/study/api/events')

  // ③ 服务端推一帧，面板立刻去拉一次：不用人手动刷新
  const chatCalls = () => page.calls.filter((c) => c.startsWith('/study/api/chat?')).length
  const before = chatCalls()
  page.sources[0].emit('change')
  for (let i = 0; i < 40 && chatCalls() === before; i += 1) await sleep(5)
  assert.ok(chatCalls() > before, '推一帧就该拉一次')

  // ④ 离开这一页（浮窗也关了）就把那条长连接收掉，别留着
  await page.clickNav('home')
  assert.equal(page.sources[0].closed, true)
})

test('今日复盘图：常驻在主页与今日任务两页；今天没动过就说清怎么让它有内容', async () => {
  const today = await boot(fixture(), { path: '/study/today' })
  assert.match(today.html(), /<section class="card review" data-card="review">/)
  assert.match(today.html(), /今日复盘图/)
  assert.match(today.html(), /data-act="review-save"/)
  assert.match(today.html(), /<svg viewBox="0 0 2048 1180"/)
  // 卡片工厂吐的是 <div> 的话，fold() 会把 class 属性拼成 class="card<div class="review""
  // ——这一条就是上次那个 bug 的看门狗。
  assert.doesNotMatch(today.html(), /class="card[^"]*</, 'fold() 拿到非卡片 HTML 了')

  // 常驻：主页上也有同一张图，不用换页去找
  const home = await boot(fixture(), { path: '/study' })
  assert.match(home.html(), /<section class="card review" data-card="review">/)
  assert.match(home.html(), /<svg viewBox="0 0 2048 1180"/)

  // 今天什么都没动过（服务端回 data:null / svg:''）：卡片不消失，改成写清楚怎么让它有内容
  const blank = await boot(fixture(), { path: '/study/today', review: null })
  assert.match(blank.html(), /<section class="card review" data-card="review">/)
  assert.match(blank.html(), /今天还没记过一笔/)
  assert.doesNotMatch(blank.html(), /data-act="review-save"/)

  // 别的页不拉这张图（一张 9 KB，没必要每页都拖）。
  // 注意 `probeCapabilities()` 会拿 `/api/review` 探一下路由在不在——那是探活、不带 date，不算「拉图」。
  const ability = await boot(fixture(), { path: '/study/ability' })
  assert.doesNotMatch(ability.html(), /data-card="review"/)
  assert.ok(!ability.calls.some((c) => c.includes('/api/review?date=')), '能力页不该真去拉复盘图')
})

test('今日任务页：眉标 / 大标题 / 日期 · 周X / 状态 / 量尺，任务行带序号，只给一条青', async () => {
  const page = await boot(fixture(), { path: '/study/today' })

  // 版式照「今日复盘图」那张图来：眉标 + 大标题 + 右上状态 + 日期 · 周X + 细规下的量尺
  assert.match(page.html(), /<section class="card day" data-card="today">/)
  assert.match(page.html(), /<p class="eyebrow">TODAY · 今日任务<\/p>/)
  assert.match(page.html(), /<h2 class="day-title">今日任务<\/h2>/)
  assert.match(page.html(), /<span class="day-pill">完成 0\/1 · 40 分钟 \/ 60<\/span>/)
  assert.match(page.html(), /<p class="day-sub">\d{4}-\d{2}-\d{2} · 周[日一二三四五六]<\/p>/)
  assert.match(page.html(), /class="day-gauge" role="img" aria-label="今日完成度 0%"><i style="width:0%"><\/i>/)

  // 任务行：序号是索引字（01 起），「现在该做的那条」全页只标一条
  assert.match(page.html(), /<li class="task-item is-next">\s*<span class="task-ord" aria-hidden="true">01<\/span>/)
  assert.match(page.html(), /<span class="dim task-meta">看课 · 40 分 · 第一个单元<\/span>/)
  assert.equal((page.html().match(/is-next/g) || []).length, 1, '「现在该做的那条」只许一条')
  assert.doesNotMatch(page.html(), /今天 · \d{4}-\d{2}-\d{2}/, '旧那个「今天 · 日期」的抬头换掉了')
})

test('资料页：书架列出每本拆到哪、归到哪，点开能看见页码并能跳过去', async () => {
  const page = await boot(fixture(), { path: '/study/materials' })

  // 导航上多了一页，且这一页真的在
  assert.match(page.html(), /data-nav="materials"/)
  assert.match(page.html(), /data-card="shelf"/)
  assert.match(page.html(), /data-card="import"/)
  assert.match(page.html(), /data-card="ai"/)

  // 一本教辅：标题、进度徽标、拆图按钮
  assert.match(page.html(), /必修一/)
  assert.match(page.html(), /20 页 · 扫描件 · 2 个单元/)
  assert.match(page.html(), /拆完了 20 页/)
  assert.match(page.html(), /data-act="shelf-build" data-id="mat-1"/)
  assert.match(page.html(), /data-act="shelf-toggle" data-id="mat-1"/)

  // 没摊开之前不画页级归类，也不该白拉一趟接口
  assert.doesNotMatch(page.html(), /pg-btn/)
  assert.equal(page.calls.filter((c) => c.includes('/api/material?')).length, 0)

  // 摊开：区间、页码按钮。拆出来的那页是链接，没拆的是灰的（不给死链）
  await page.clickAct({ act: 'shelf-toggle', id: 'mat-1' })
  assert.match(page.html(), /归了 8 页，覆盖 2 个单元/)
  assert.match(page.html(), /M1\.4/)
  assert.match(page.html(), /4—6 页/)
  const linked = page.html().match(/<a class="pg-btn" href="([^"]+)"/)
  assert.ok(linked, '拆出来那页得是个能点的链接')
  assert.match(decodeURIComponent(linked[1]), /p0004\.png/)
  assert.match(page.html(), /<span class="pg-btn off"[^>]*>5<\/span>/, '第 5 页没拆出来，别给死链')
  assert.match(page.html(), /第一章 集合/, '目录也要画出来')

  // 再点一下收起，回到列表
  await page.clickAct({ act: 'shelf-toggle', id: 'mat-1' })
  assert.doesNotMatch(page.html(), /pg-btn/)

  // 拆图：点了就打那条接口，回来顺手重拉一次书架
  await page.clickAct({ act: 'shelf-build', id: 'mat-1' })
  assert.equal(page.posts.at(-1).path, '/study/api/materials/build')
  assert.deepEqual(page.posts.at(-1).body, { materialId: 'mat-1' })
  assert.ok(page.calls.filter((c) => c === '/study/api/materials').length >= 2, '拆完要重拉书架看进度')
})

test('资料页：书架按类别分组，AI 出题跟教辅平级；AI 卷不报「原件不在了」', async () => {
  const page = await boot(fixture(), { path: '/study/materials' })
  const html = page.html()

  // 两份材料分属两类，各带一个小标题
  assert.match(html, /<h3 class="sub">教辅<span class="dim">1 份<\/span><\/h3>/)
  assert.match(html, /<h3 class="sub">AI 出题<span class="dim">1 份<\/span><\/h3>/)

  // AI 卷：标签是「AI 出题」不是「其他」，没有进度条，也不该出现教辅那两颗按钮
  const ai = html.slice(html.indexOf('class="shelf-row ai"'))
  assert.match(ai, /随堂小测 · M1\.4（2026-10-01）/)
  assert.match(ai, /覆盖 M1\.4 · 1 份卷 · 8 题有索引/)
  assert.match(ai, /AI 出的卷/, '没有页图这件事要当成正常，不是「原件不在了」')
  assert.doesNotMatch(ai, /原件不在了/)
  assert.match(ai, /打开这份卷/)
  assert.match(ai, /按 M1\.4 做题/)
  assert.doesNotMatch(ai, /data-act="shelf-build"/)
  assert.doesNotMatch(ai, /<div class="bar">/)

  // 教辅那边不受影响
  assert.match(html, /data-act="shelf-build" data-id="mat-1"/)
})

test('资料页的 AI 入口：挑类型、挑单元、递一句话，投给对话而不是自己出卷', async () => {
  const page = await boot(fixture(), { path: '/study/materials' })

  // 三种卷 + 单元下拉（单元来自地图）
  assert.match(page.html(), /data-act="ai-want" data-want="quiz"/)
  assert.match(page.html(), /data-act="ai-want" data-want="recite"/)
  assert.match(page.html(), /data-act="ai-want" data-want="variant"/)
  assert.match(page.html(), /class="mini on" data-act="ai-want" data-want="quiz"/)
  assert.match(page.html(), /<option value="M1\.1" selected>M1\.1 /)

  // 换类型不发接口，只重画
  const before = page.posts.length
  await page.clickAct({ act: 'ai-want', want: 'variant' })
  assert.equal(page.posts.length, before, '换类型只改本地状态，别白打一趟接口')
  assert.match(page.html(), /class="mini on" data-act="ai-want" data-want="variant"/)

  // 递上去：这一节 + 要哪种卷 + 那句话，一次交给 practice/ask
  await page.submitForm({ form: 'ai' }, { pointId: 'M1.1', note: '只要应用题' })
  assert.equal(page.posts.at(-1).path, '/study/api/practice/ask')
  assert.deepEqual(page.posts.at(-1).body, { pointId: 'M1.1', mode: 'ai', want: 'variant', text: '只要应用题' })
})

test('工具页：二级菜单切小工具，番茄钟照服务端的绝对时刻走，清单勾得动', async () => {
  const page = await boot(fixture(), { path: '/study/toolbox' })

  // 导航上多了「工具」，二级菜单横在两栏上面，默认选中番茄钟
  assert.match(page.html(), /data-nav="toolbox"/)
  assert.match(page.html(), /class="sub-nav"/)
  assert.match(page.html(), /data-act="tool-pick" data-tool="pomodoro"/)
  assert.match(page.html(), /data-act="tool-pick" data-tool="checklist"/)
  assert.match(page.html(), /class="sub-item on" data-act="tool-pick" data-tool="pomodoro"/)
  assert.match(page.html(), /id="focus-clock"/)

  // 钟面上写的是服务端给的剩余时间，不是页面自己数出来的
  assert.match(page.html(), /id="focus-clock"[^>]*data-ends="2099-01-01T00:25:00\.000Z"/)
  assert.match(page.html(), /data-total="1500"/)
  assert.match(page.html(), /23:00/, '1380 秒要写成 23:00')
  assert.match(page.html(), /今天 2 个 · 50 分钟/)
  assert.match(page.html(), /背 20 个单词/, '这一轮挂在哪条清单上要写出来')

  // 还没切过去的时候，清单那张卡不该在（省一趟接口 + 少画一堆东西）。
  // 探针那条 alive('/study/api/toolbox') 也算命中，所以不能拿次数当判据。
  assert.doesNotMatch(page.html(), /data-form="todo"/)
  assert.equal(page.posts.filter((p) => p.path === '/study/api/todo').length, 0)

  // 切到清单
  await page.clickAct({ act: 'tool-pick', tool: 'checklist' })
  assert.match(page.html(), /class="sub-item on" data-act="tool-pick" data-tool="checklist"/)
  assert.match(page.html(), /data-form="todo"/)
  assert.doesNotMatch(page.html(), /id="focus-clock"/)
  assert.match(page.html(), /没做完 1 条 · 做完 1 条/)
  assert.match(page.html(), /data-act="todo-toggle" data-id="td-1"/)
  assert.match(page.html(), /data-act="todo-del" data-id="td-2"/)
  assert.match(page.html(), /class="tick on"[^>]*data-id="td-2"/, '做完那条要打上勾')
  assert.match(page.html(), /data-act="todo-timer" data-id="td-1"/)
  assert.match(page.html(), /2026-10-02 前/, '到期日要写出来')

  // 勾掉一条：打的是 toggle，回来重拉一次
  await page.clickAct({ act: 'todo-toggle', id: 'td-1' })
  assert.equal(page.posts.at(-1).path, '/study/api/todo')
  assert.deepEqual(page.posts.at(-1).body, { action: 'toggle', id: 'td-1' })

  // 加一条：空文本被本地拦下，不白打一趟接口
  const before = page.posts.length
  await page.submitForm({ form: 'todo' }, { text: '   ', due: '' })
  assert.equal(page.posts.length, before, '空条目不该打接口')
  await page.submitForm({ form: 'todo' }, { text: '背 20 个单词', due: '2026-10-02' })
  assert.equal(page.posts.at(-1).path, '/study/api/todo')
  assert.deepEqual(page.posts.at(-1).body, { action: 'add', text: '背 20 个单词', due: '2026-10-02' })

  // 切回番茄钟：起一轮要把时长和挂靠一起交上去
  await page.clickAct({ act: 'tool-pick', tool: 'pomodoro' })
  await page.clickAct({ act: 'focus-start' })
  assert.equal(page.posts.at(-1).path, '/study/api/focus')
  assert.equal(page.posts.at(-1).body.action, 'start')
  assert.equal(page.posts.at(-1).body.minutes, 25)
  assert.equal(page.posts.at(-1).body.breakMinutes, 5)

  // 停掉：不是「开了就算完成」，中途停要按实际分钟记半截
  await page.clickAct({ act: 'focus-stop' })
  assert.equal(page.posts.at(-1).path, '/study/api/focus')
  assert.deepEqual(page.posts.at(-1).body, { action: 'stop' })
})

test('记忆卡：正面朝上不给答案；背完自己翻下一张，排期由服务端算', async () => {
  const page = await boot(fixture(), { path: '/study/toolbox' })

  // 默认是番茄钟，看钟的时候不该白跑一趟记忆卡。
  // 探针那条 alive('/study/api/memory') 也是这个路径，所以只数带查询串的。
  assert.equal(page.calls.filter((g) => g.includes('/api/memory?')).length, 0)
  assert.doesNotMatch(page.html(), /class="mem-face"/)

  // 切到记忆卡：补拉一次，二级菜单跟着挪
  await page.clickAct({ act: 'tool-pick', tool: 'memory' })
  assert.match(page.html(), /class="sub-item on" data-act="tool-pick" data-tool="memory"/)
  assert.equal(page.calls.at(-1), '/study/api/memory?status=due&limit=200')
  assert.match(page.html(), /class="card mem" data-card="tool"/)

  // 概览
  assert.match(page.html(), /该背 1 张 · 一共 3 张 · 背下来 1 张 · 24 小时内还有 1 张/)
  // 筛子：四档都列出来，现在停在「该背了」；「还没到点」是减出来的
  assert.match(page.html(), /data-act="card-filter" data-status="due">该背了 1/)
  assert.match(page.html(), /data-act="card-filter" data-status="waiting">还没到点 1/)
  assert.match(page.html(), /data-act="card-filter" data-status="graduated">已经背下来 1/)
  assert.match(page.html(), /class="mini on" data-act="card-filter" data-status="due"/)

  // 正面朝上：只给正面，答案和四个自评都不在
  assert.match(page.html(), /<b class="mem-front">contingency<\/b>/)
  assert.match(page.html(), /data-act="card-reveal"/)
  assert.doesNotMatch(page.html(), /列联表/)
  assert.doesNotMatch(page.html(), /data-act="card-grade"/)

  // 翻过来：答案和四档自评都出来
  await page.clickAct({ act: 'card-reveal' })
  assert.match(page.html(), /class="mem-back">列联表</)
  for (const g of ['忘了', '模糊', '记住', '秒答']) {
    assert.match(page.html(), new RegExp(`data-act="card-grade" data-grade="${g}" data-id="c-1"`))
  }

  // 自评一次：打的是 review，回来重拉，并且翻回正面等下一张
  await page.clickAct({ act: 'card-grade', grade: '记住', id: 'c-1' })
  assert.equal(page.posts.at(-1).path, '/study/api/memory')
  assert.deepEqual(page.posts.at(-1).body, { action: 'review', id: 'c-1', grade: '记住' })
  assert.equal(page.calls.at(-1), '/study/api/memory?status=due&limit=200')
  assert.match(page.html(), /data-act="card-reveal"/)
  assert.doesNotMatch(page.html(), /data-act="card-grade"/)
  assert.match(page.boxes.get('toast').textContent, /记上了：记住/)

  // 切到「已经背下来」那一档：只画那一档的卡。
  // 复习盒子跟筛子无关——该背的还是照背，换筛子不该把手上这张抽走。
  await page.clickAct({ act: 'card-filter', status: 'graduated' })
  assert.equal(page.calls.at(-1), '/study/api/memory?status=graduated&limit=200')
  assert.match(page.html(), /独立事件/)
  assert.match(page.html(), /class="mem-front">contingency</)
  assert.doesNotMatch(page.html(), /data-act="card-grade"/)

  // 加一张：正面、背面都得写；写全了才打接口
  const before = page.posts.length
  await page.submitForm({ form: 'card' }, { front: '   ', back: '', kind: '', pointId: '' })
  assert.equal(page.posts.length, before, '正面背面没写全不该打接口')
  assert.match(page.boxes.get('toast').textContent, /正面、背面都得写/)
  await page.submitForm({ form: 'card' }, { front: 'P(AB)', back: '联合概率', kind: '公式', pointId: 'M1.1' })
  assert.equal(page.posts.at(-1).path, '/study/api/memory')
  assert.deepEqual(page.posts.at(-1).body, { action: 'add', front: 'P(AB)', back: '联合概率', kind: '公式', pointId: 'M1.1' })

  // 删一张
  await page.clickAct({ act: 'card-del', id: 'c-3' })
  assert.equal(page.posts.at(-1).path, '/study/api/memory')
  assert.deepEqual(page.posts.at(-1).body, { action: 'remove', id: 'c-3' })
})
