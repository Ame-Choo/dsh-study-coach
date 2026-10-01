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
    location: { href: 'http://127.0.0.1:19388/study', search: '', assign() {} },
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
  '/study/file?path=F%3A%5C%E8%AF%BE%E4%BB%B6',
]

/** 起一次面板，喂一份假档案，等它渲染完，把 HTML 和交互句柄交出来。 */
async function boot(fixture, { stale = false, agenda = null, innerWidth = 1200, search = '' } = {}) {
  const { document, window, boxes, listeners } = stubDom()
  window.innerWidth = innerWidth
  window.location.search = search
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
    await listeners.get('submit')({ target: { dataset }, preventDefault() {} })
  }
  return { html, calls, posts, clickAct, submitForm, listeners, documentElement: document.documentElement }
}

function fixture() {
  return {
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

test('面板渲染：总体能力、每级档案、任务跳转与管理、学习目标库都出得来', async () => {
  const { html, calls, clickAct } = await boot(fixture())

  // 先把两份数据拿回来（探测要用 state 里登记过的材料路径，得排在它后面）
  assert.deepEqual(calls.slice(0, 2), ['/study/api/state', '/study/api/summary'])
  // 再探一遍新路由在不在
  assert.deepEqual(calls.slice(2, 7), [
    '/study/api/ability',
    '/study/api/archive?level=group&key=',
    '/study/api/library',
    '/study/practice',
    '/study/file?path=F%3A%5C%E8%AF%BE%E4%BB%B6',
  ])
  // 多门课的时候顺带把「今天每门各有什么」拉一遍
  assert.match(calls[7] || '', /^\/study\/api\/tasks\?all=1&date=\d{4}-\d{2}-\d{2}$/)

  // 假 fetch 什么都回 200，所以不该出现「服务端是旧代码」那条横幅
  assert.doesNotMatch(html(), /服务端还是旧代码/)

  // 顶上那句指引：面板要把人叫回对话
  assert.match(html(), /看完回来答三个问题/)

  // ① 总体能力那张卡
  assert.match(html(), /card ability/)
  assert.match(html(), /底子还行，先把没碰过的补上。/)
  assert.match(html(), /该复习了/)
  assert.match(html(), /最近七天/)

  // ② 每级都有「档案」小按键：大类、单元总览里就有，模块得展开大类才看得到
  assert.match(html(), /data-act="archive-open" data-level="group"/)
  assert.match(html(), /data-act="archive-open" data-level="point"/)
  assert.doesNotMatch(html(), /data-act="archive-open" data-level="module"/)
  await clickAct({ act: 'group-open', group: '第一大块' })
  assert.match(html(), /data-act="archive-open" data-level="module" data-key="M1"/)

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

  // ③ 任务能一键跳过去。看课的任务以看课为主线：先看，再去做练习，顺序不能反
  assert.match(html(), /\/study\/file\?path=F%3A%5C%E8%AF%BE%E4%BB%B6%5C01\.%E7%AC%AC%E4%B8%80%E8%8A%82/)
  assert.match(html(), /看这节网课/)
  assert.match(html(), /这一节的讲义/)
  assert.match(html(), /\/study\/practice\?point=M1\.1/)
  assert.match(html(), /看完去做练习/)
  assert.ok(html().indexOf('看这节网课') < html().indexOf('看完去做练习'), '看课按钮要排在练习前面')
  assert.doesNotMatch(html(), /做题 \/ 看掌握度/, '看课任务的按钮说的是「看完去做练习」')

  // ④ 任务能改能删
  assert.match(html(), /data-act="task-edit"/)
  assert.match(html(), /data-act="task-remove"/)
  await clickAct({ act: 'task-remove', id: 'task-1' })
  assert.match(html(), /确定删掉/)
  await clickAct({ act: 'task-cancel' })
  assert.doesNotMatch(html(), /确定删掉/)

  // ⑤ 学习目标库：切换 / 改名 / 删掉 / 新建
  assert.match(html(), /data-act="lib-select"/)
  assert.match(html(), /data-act="lib-rename"/)
  assert.match(html(), /data-act="lib-remove"/)
  assert.match(html(), /新建一个学习目标/)
  assert.match(html(), /在用/)

  // 学习目标也该能改（主路径是对话，这儿只是兜底）
  assert.match(html(), /data-act="goal-edit"/)

  // 定稿的地图不再问「就这么定」
  assert.doesNotMatch(html(), /data-act="map-confirm"/)
})

test('表单能提交：改任务、改目标、改档案名、新建档案都走得通', async () => {
  const { html, calls, clickAct, submitForm } = await boot(fixture())
  const before = calls.length

  await clickAct({ act: 'task-edit', id: 'task-1' })
  assert.match(html(), /data-form="task-edit"/)
  await submitForm({ form: 'task-edit', id: 'task-1' }, { title: '看第二节', kind: 'read', minutes: '25' })

  await clickAct({ act: 'goal-edit' })
  assert.match(html(), /data-form="goal"/)
  await submitForm({ form: 'goal' }, { subject: '高数', outcome: '会做中档题', deadline: '2027-09-30', minutesPerDay: '45' })

  await clickAct({ act: 'lib-rename', id: 'p2' })
  assert.match(html(), /data-form="lib-rename"/)
  await submitForm({ form: 'lib-rename', id: 'p2' }, { title: '新名字' })

  await clickAct({ act: 'lib-new' })
  assert.match(html(), /data-form="lib-new"/)
  await submitForm({ form: 'lib-new' }, { title: '第三门', subject: '', outcome: '', deadline: '', minutesPerDay: '' })

  // 每次提交后都得重新拉一遍 state + summary
  assert.ok(calls.length - before >= 8, `提交后应该重新 load 过，实际只多发了 ${calls.length - before} 条`)
})

test('地图还是草稿时，面板给出定稿按钮；没有图谱宿主也不炸', async () => {
  const data = fixture()
  data.map.status = 'draft'
  data.ability = null
  data.profiles = []
  const { html } = await boot(data)
  assert.match(html(), /data-act="map-confirm"/)
  assert.match(html(), /地图还是草稿/)
  // 能力卡没数据就不该渲染
  assert.doesNotMatch(html(), /card ability/)
  // 单档案的时候不出现目标库
  assert.doesNotMatch(html(), /新建一个学习目标/)
})

test('服务端是旧代码时，面板把话说清楚，而不是让人对着没反应的按钮猜', async () => {
  const { html } = await boot(fixture(), { stale: true })

  // 顶上那条横幅：缺哪几样、为什么、怎么办
  assert.match(html(), /服务端还是旧代码/)
  assert.match(html(), /总体能力判断/)
  assert.match(html(), /每级掌握档案/)
  assert.match(html(), /做题页/)
  assert.match(html(), /打开网课 \/ 讲义/)
  assert.match(html(), /重启一次 DSH/)

  // 东西还是照常渲染，不是一屏错误
  assert.match(html(), /data-act="archive-open" data-level="group"/)
  assert.match(html(), /data-act="task-toggle"/)
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

test('多科目：今天那栏按科目分组，能只看一门，也能直接给任意一门加任务', async () => {
  const { html, clickAct, submitForm, posts } = await boot(fixture(), { agenda: agendaFixture() })

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
  assert.match(html(), /确定删掉/)
  await clickAct({ act: 'task-del', id: 'task-9', profile: 'p2' })
  assert.equal(posts.at(-1).path, '/study/api/task/remove')
  assert.equal(posts.at(-1).body.profileId, 'p2')
})

test('两种模式：窄屏默认侧栏、卡片折起来只留名字；点一下切成浏览器模式铺开', async () => {
  const narrow = await boot(fixture(), { innerWidth: 400 })
  assert.equal(narrow.documentElement.dataset.mode, 'sidebar')
  // 侧栏模式：每张卡头顶一条折叠按钮，卡身折起来
  assert.match(narrow.html(), /class="fold"[^>]*data-act="card-toggle"/)
  assert.match(narrow.html(), /data-card="today"/)
  assert.match(narrow.html(), /今天要做的/)
  // 「今天」默认是开着的，其余折着
  assert.match(narrow.html(), /class="card open" data-card="today"/)
  assert.doesNotMatch(narrow.html(), /class="card guide on open" data-card="guide"/)
  // 折起来的卡片，内容只该出现一次（不能一边留着原样一边又包一层）
  assert.equal(narrow.html().split('看完回来答三个问题').length - 1, 1)

  await narrow.clickAct({ act: 'card-toggle', card: 'today' })
  assert.doesNotMatch(narrow.html(), /class="card open" data-card="today"/)
  await narrow.clickAct({ act: 'card-toggle', card: 'today' })
  assert.match(narrow.html(), /class="card open" data-card="today"/)

  // 切成浏览器模式：折叠按钮消失，卡片分主栏 / 边栏两列摞
  await narrow.clickAct({ act: 'mode', mode: 'browser' })
  assert.equal(narrow.documentElement.dataset.mode, 'browser')
  assert.doesNotMatch(narrow.html(), /data-act="card-toggle"/)
  assert.match(narrow.html(), /<div class="col main">.*data-card="today"/s)
  assert.match(narrow.html(), /<div class="col aside">.*data-card="ability"/s)
  assert.match(narrow.html(), /<div class="col aside">.*data-card="library"/s)
  // 侧栏才用的折叠类不该漏到浏览器模式里
  assert.doesNotMatch(narrow.html(), /class="card[^"]*\bopen\b/)

  // 反着来：宽屏默认浏览器模式
  const wide = await boot(fixture())
  assert.equal(wide.documentElement.dataset.mode, 'browser')
  assert.doesNotMatch(wide.html(), /data-act="card-toggle"/)

  // 地址上写死过就听地址的
  const asked = await boot(fixture(), { innerWidth: 1400, search: '?mode=sidebar' })
  assert.equal(asked.documentElement.dataset.mode, 'sidebar')
  assert.match(asked.html(), /data-act="card-toggle"/)
})
