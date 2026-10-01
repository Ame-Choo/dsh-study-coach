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
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, appendChild() {}, classList: { add() {}, remove() {} } }),
    addEventListener: (type, fn) => listeners.set(type, fn),
    body: { appendChild() {}, dataset: {} },
  }
  const window = {
    addEventListener() {},
    open: () => null,
    innerWidth: 1200,
    localStorage: {
      store: new Map(),
      getItem(key) {
        return this.store.has(key) ? this.store.get(key) : null
      },
      setItem(key, value) {
        this.store.set(key, String(value))
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
  '/study/api/review',
  '/study/api/materials',
  '/study/file?path=F%3A%5C%E8%AF%BE%E4%BB%B6',
]

/** 一份假对话：一条学生说的、一条教练回的。形状跟 lib/chat.js 吐出来的一致。 */
const CHAT_MESSAGES = [
  { id: 'c1', seq: 9, role: 'user', text: '这一节的含参讨论没跟上', time: 1759300000000 },
  { id: 'c2', seq: 16, role: 'bot', text: '分两种情形看：A 是不是空集会改变结论。', time: 1759300060000, tools: ['read'] },
]

/** 今日复盘图那份假数据。真 SVG 由 lib/review.js 拼，这里只要够卡片认出来就行。 */
const REVIEW = {
  data: { branches: [{ side: 'left' }, { side: 'right' }], error_count: 1 },
  svg: '<svg viewBox="0 0 2048 1180" width="2048" height="1180"><title>今日复盘</title></svg>\n',
}

/** 书架：一本已经拆完、归了 8 页的教辅。 */
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

/** 起一次面板，喂一份假档案，等它渲染完，把 HTML 和交互句柄交出来。 */
async function boot(fixture, { stale = false, agenda = null, innerWidth = 1200, search = '', path = '/study', chat = false, hidden = false } = {}) {
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
    if (path.includes('/api/review')) body = { ok: true, date: '2026-10-01', data: REVIEW.data, svg: REVIEW.svg }
    // 资料页那几条。顺序要紧：/api/material? 是 /api/materials 的子串，得放在后面判。
    if (path.includes('/api/materials/build')) body = { ok: true, started: true, pid: 4242, total: 20 }
    else if (path.includes('/api/materials/import')) body = { ok: true, dir: false, added: [{ title: '必修一' }] }
    else if (path.includes('/api/materials')) body = { ok: true, ...SHELF }
    else if (path.includes('/api/material?')) body = SHELF_INDEX
    else if (path.includes('/api/material/upload')) body = { ok: true, added: [{ title: '上传的.pdf' }] }
    // 对话通道默认按「没接通」回：接通了面板会开一个轮询定时器，
    // 测试进程就永远退不出去。要测接通的样子，传 { chat: true, hidden: true }。
    if (path.includes('/api/chat/sessions')) {
      body = chat
        ? { ok: true, available: true, sessionId: 's1', sessions: [{ sessionId: 's1', title: '学习教练' }] }
        : { ok: true, available: false, sessions: [] }
    } else if (path.includes('/api/chat')) {
      body = chat
        ? { ok: true, available: true, sessionId: 's1', messages: CHAT_MESSAGES, sessions: [] }
        : { ok: true, available: false, messages: [], sessions: [] }
    }
    return { ok: true, status: 200, json: async () => body }
  }
  await import(`${PANEL}?v=${Math.random().toString(36).slice(2)}`)
  for (let i = 0; i < 60 && !boxes.get('app').innerHTML; i += 1) await sleep(5)

  const html = () => boxes.get('app').innerHTML
  /** 造一个假事件源，交给面板那份 document 级委托。 */
  const clickAct = async (dataset, { insideModal = false } = {}) => {
    const el = { dataset, closest: (sel) => (sel === '.modal' ? (insideModal ? el : null) : sel === '[data-act]' ? el : null) }
    await listeners.get('click')({ target: el })
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
  return { html, calls, posts, clickAct, clickNav, submitForm, listeners, window, documentElement: document.documentElement }
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
  // 「今天」默认是开着的
  assert.match(narrow.html(), /class="card open" data-card="today"/)

  await narrow.clickAct({ act: 'card-toggle', card: 'today' })
  assert.doesNotMatch(narrow.html(), /class="card open" data-card="today"/)
  await narrow.clickAct({ act: 'card-toggle', card: 'today' })
  assert.match(narrow.html(), /class="card open" data-card="today"/)

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

test('今日复盘图：卡片工厂必须吐 <section class="card">，fold() 靠它拼 class', async () => {
  const today = await boot(fixture(), { path: '/study/today' })
  assert.match(today.html(), /<section class="card review" data-card="review">/)
  assert.match(today.html(), /今日复盘图/)
  assert.match(today.html(), /data-act="review-save"/)
  assert.match(today.html(), /<svg viewBox="0 0 2048 1180"/)
  // 卡片工厂吐的是 <div> 的话，fold() 会把 class 属性拼成 class="card<div class="review""
  // ——这一条就是上次那个 bug 的看门狗。
  assert.doesNotMatch(today.html(), /class="card[^"]*</, 'fold() 拿到非卡片 HTML 了')
})

test('资料页：书架列出每本拆到哪、归到哪，点开能看见页码并能跳过去', async () => {
  const page = await boot(fixture(), { path: '/study/materials' })

  // 导航上多了一页，且这一页真的在
  assert.match(page.html(), /data-nav="materials"/)
  assert.match(page.html(), /data-card="shelf"/)
  assert.match(page.html(), /data-card="import"/)

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
