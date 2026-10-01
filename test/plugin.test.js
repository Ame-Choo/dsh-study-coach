/**
 * 端到端装配测试：假装自己是 DSH，把 apply() 真的跑一遍，
 * 再把 /study 那个 handler 挂到真 HTTP 服务器上打请求。
 * 这一步能在重启 DSH 之前就发现装配层面的错。
 */
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'study-coach-'))
process.env.DSH_STUDY_ROOT = root

const routes = []
const tools = []
const disposers = []
const presets = []
const ctx = {
  effect(fn) {
    const d = fn()
    if (typeof d === 'function') disposers.push(d)
    return () => {}
  },
  webServer: {
    register(route) {
      routes.push(route)
      return () => {}
    },
  },
  tools: {
    register(tool) {
      tools.push(tool)
      return () => {}
    },
  },
  agentPresets: {
    async register(definition) {
      presets.push(definition)
      return () => {}
    },
  },
}

const mod = await import('../index.js')
mod.apply(ctx)

test('注册了 /study 前缀路由，并且真的落在 profiles/default 里', () => {
  assert.equal(routes.length, 1)
  assert.equal(routes[0].kind, 'prefix')
  assert.equal(routes[0].path, '/study')
  assert.equal(mod.DATA_ROOT, root)
  /* 档案挪进了库：root 下是 registry.json + profiles/<id>/，老的单档案布局搬进 default。 */
  assert.ok(existsSync(join(root, 'registry.json')))
  const home = join(root, 'profiles', 'default')
  assert.ok(existsSync(join(home, 'profile.json')))
  assert.ok(existsSync(join(home, 'map.json')))
  assert.ok(existsSync(join(home, 'mastery.json')))
  assert.ok(existsSync(join(home, 'tasks.json')))
  assert.ok(existsSync(join(home, 'guide.json')))
  assert.ok(existsSync(join(home, 'inbox.json')))
  assert.ok(existsSync(join(home, 'analysis.json')))
})

test('注册了 15 个工具', () => {
  assert.equal(tools.length, 15)
  const names = tools.map((t) => t.name ?? (t.spec && t.spec.name) ?? '').filter(Boolean)
  assert.equal(names.length, 15, `拿不到工具名，实际 keys: ${JSON.stringify(tools[0] && Object.keys(tools[0]))}`)
  for (const expected of [
    'study_report',
    'study_goal',
    'study_map',
    'study_record',
    'study_plan',
    'study_material',
    'study_analysis',
    'study_archive',
    'study_ability',
    'study_library',
    'study_files',
    'study_pages',
    'study_tool_level',
    'study_guide',
    'study_inbox',
  ]) {
    assert.ok(names.includes(expected), `${expected} 没注册`)
  }
})

test('「学习教练」预设登记进了 agentPresets', async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(presets.length, 1, '预设没登记上')
  const def = presets[0]
  assert.equal(def.id, 'study-coach')
  assert.equal(def.name, '学习教练')
  assert.ok(Array.isArray(def.plugins) && def.plugins.length > 0)
  const persona = def.plugins.find((p) => p.id === 'persona')
  assert.match(persona.config.prefix, /学习教练/)
})

const server = createServer((req, res) => routes[0].handler(req, res))
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

const get = (path) => fetch(base + path)
const post = (path, body) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })

test('面板页能打开', async () => {
  const res = await get('/study')
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type'), /text\/html/)
  const html = await res.text()
  assert.match(html, /学习教练/)
  assert.match(html, /\/study\/assets\/panel\.js/)
})

test('做题页能打开', async () => {
  const res = await get('/study/practice?point=g1.p1')
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type'), /text\/html/)
  const html = await res.text()
  assert.match(html, /\/study\/assets\/practice\.js/)
  assert.match(html, /\/study\/assets\/practice\.css/)
})

test('静态资源能取到，穿越路径取不到', async () => {
  const js = await get('/study/assets/panel.js')
  assert.equal(js.status, 200)
  assert.match(js.headers.get('content-type'), /javascript/)
  assert.match(await js.text(), /study\/api\/state/)

  const css = await get('/study/assets/style.css')
  assert.equal(css.status, 200)
  assert.match(css.headers.get('content-type'), /css/)

  const graph = await get('/study/assets/graph.js')
  assert.equal(graph.status, 200, '图谱模块要能取到，面板是动态 import 它的')
  assert.match(await graph.text(), /export function renderGraph/)

  const graphCss = await get('/study/assets/graph.css')
  assert.equal(graphCss.status, 200)
  assert.match(graphCss.headers.get('content-type'), /css/)

  assert.match(await (await get('/study')).text(), /\/study\/assets\/graph\.css/, '面板要引图谱的样式')

  const prac = await get('/study/assets/practice.js')
  assert.equal(prac.status, 200)
  assert.match(await prac.text(), /study\/api\/practice/)

  const pracCss = await get('/study/assets/practice.css')
  assert.equal(pracCss.status, 200)
  assert.match(pracCss.headers.get('content-type'), /css/)

  const stages = await get('/study/assets/stages.js')
  assert.equal(stages.status, 200, '做题页 import 它，取不到就白屏')
  assert.match(await stages.text(), /export const STAGES/)

  const escape = await get('/study/assets/%2e%2e/index.js')
  assert.equal(escape.status, 404)

  const missing = await get('/study/assets/nope.js')
  assert.equal(missing.status, 404)
})

test('state 一开始是空档案', async () => {
  const res = await get('/study/api/state')
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(data.ok, true)
  assert.equal(data.state.map.status, 'draft')
  assert.deepEqual(data.state.profile.materials, [])
})

test('目标能存能读，非法日期被挡', async () => {
  const bad = await post('/study/api/goal', { subject: '线性代数', deadline: '2027/01/01' })
  assert.equal(bad.status, 400)

  const ok = await post('/study/api/goal', {
    subject: '线性代数',
    outcome: '考研数一能独立做中档题',
    deadline: '2027-01-01',
    minutesPerDay: 90,
  })
  assert.equal(ok.status, 200)

  const state = await (await get('/study/api/state')).json()
  assert.equal(state.state.profile.goal.subject, '线性代数')
  assert.equal(state.state.profile.goal.minutesPerDay, 90)
})

test('地图能写入、能自评、能定稿', async () => {
  const replaced = await post('/study/api/map/replace', {
    modules: [
      {
        id: 'm1',
        title: '行列式',
        points: [
          { id: 'm1.p1', title: '定义与几何意义', why: '后面全要用' },
          { id: 'm1.p2', title: '按行展开', why: '计算基本功' },
        ],
      },
    ],
  })
  assert.equal(replaced.status, 200)
  assert.equal((await replaced.json()).count, 1)

  const unknown = await post('/study/api/mastery', { pointId: 'm9.p9', stage: '见过' })
  assert.equal(unknown.status, 404)

  const badStage = await post('/study/api/mastery', { pointId: 'm1.p1', stage: '还行' })
  assert.equal(badStage.status, 400)

  const rated = await post('/study/api/mastery', {
    pointId: 'm1.p1',
    stage: '能跟做',
    confidence: 0.6,
    note: '看了第 1 讲',
    kind: 'self',
  })
  assert.equal(rated.status, 200)

  const summary = await (await get('/study/api/summary')).json()
  assert.equal(summary.summary.total, 2)
  assert.equal(summary.summary.touched, 1)
  assert.equal(summary.summary.byStage['能跟做'], 1)

  const confirmed = await post('/study/api/map/confirm', {})
  assert.equal(confirmed.status, 200)
  const state = await (await get('/study/api/state')).json()
  assert.equal(state.state.map.status, 'confirmed')
})

test('每日任务能排能勾', async () => {
  const added = await post('/study/api/task', {
    date: '2027-01-01',
    title: '看第 3 讲',
    kind: 'watch',
    minutes: 40,
    target: 'm1.p2',
  })
  assert.equal(added.status, 200)
  const taskId = (await added.json()).task.id

  const badDate = await post('/study/api/task', { date: '明天', title: 'x' })
  assert.equal(badDate.status, 400)

  const toggled = await post('/study/api/task/toggle', { date: '2027-01-01', id: taskId, done: true })
  assert.equal(toggled.status, 200)
  assert.equal((await toggled.json()).task.done, true)

  const state = await (await get('/study/api/state')).json()
  assert.equal(state.state.tasks.days['2027-01-01'][0].done, true)
})

test('材料能加能删', async () => {
  const added = await post('/study/api/materials', {
    kind: 'video',
    title: '线代强化',
    path: 'D:\\网课\\线代强化',
    note: '24 讲',
  })
  assert.equal(added.status, 200)
  const id = (await added.json()).material.id

  const removed = await post('/study/api/materials/remove', { id })
  assert.equal(removed.status, 200)
  assert.deepEqual((await removed.json()).materials, [])
})

test('未知接口 404，脏 body 不炸服务器', async () => {
  const nope = await get('/study/api/nope')
  assert.equal(nope.status, 404)
  const wrongMethod = await get('/study/api/goal')
  assert.equal(wrongMethod.status, 404)

  const dirty = await fetch(base + '/study/api/goal', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{ 这不是 json',
  })
  assert.equal(dirty.status, 500)
  assert.equal((await dirty.json()).ok, false)

  const stillAlive = await get('/study/api/state')
  assert.equal(stillAlive.status, 200)
})

test('重置要确认口令', async () => {
  const refused = await post('/study/api/reset', {})
  assert.equal(refused.status, 400)
  const done = await post('/study/api/reset', { confirm: 'reset' })
  assert.equal(done.status, 200)
  assert.equal((await done.json()).state.map.status, 'draft')
})

after(async () => {
  for (const dispose of disposers) {
    try {
      dispose()
    } catch {
      /* 清理失败不影响结论 */
    }
  }
  await new Promise((resolve) => server.close(resolve))
  rmSync(root, { recursive: true, force: true })
})

test('面板留言能写进档案，顺手把 guide 也带出来', async () => {
  const empty = await post('/study/api/inbox', { text: '   ' })
  assert.equal(empty.status, 400)

  const res = await post('/study/api/inbox', { text: '这块我看不懂' })
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(data.ok, true)
  assert.equal(data.item.text, '这块我看不懂')
  assert.equal(data.item.read, false)
  assert.equal(data.unread, 1)

  const state = await (await get('/study/api/state')).json()
  assert.equal(state.state.inbox.items.length, 1)
  assert.equal(state.state.inbox.items[0].text, '这块我看不懂')
  assert.equal(typeof state.state.guide.text, 'string')
})
