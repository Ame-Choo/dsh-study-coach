/**
 * 数据层 + 路由层的测试。不依赖 DSH，`node --test` 直接跑。
 * 用法：cd dsh-study-coach && node --test test/
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Store, STAGES } from '../lib/store.js'
import { masterySummary, pointState } from '../lib/map.js'
import { createRouter } from '../lib/routes.js'

function fresh() {
  const root = mkdtempSync(join(tmpdir(), 'study-coach-'))
  const store = new Store(root)
  store.ensure()
  return { root, store, handle: createRouter(store), done: () => rmSync(root, { recursive: true, force: true }) }
}

test('ensure 建出四份档案文件', () => {
  const f = fresh()
  try {
    assert.equal(f.store.read('profile').goal.minutesPerDay, 60)
    assert.equal(f.store.read('map').status, 'draft')
    assert.deepEqual(f.store.read('mastery').points, {})
    assert.deepEqual(f.store.read('tasks').days, {})
  } finally {
    f.done()
  }
})

test('坏掉的 JSON 当成默认值，不抛', () => {
  const f = fresh()
  try {
    writeFileSync(f.store.path('profile'), '{ 这不是 json')
    assert.equal(f.store.read('profile').goal.subject, '')
  } finally {
    f.done()
  }
})

test('写 goal：合法值落盘，非法值挡回去', () => {
  const f = fresh()
  try {
    let r = f.handle({ method: 'POST', pathname: '/study/api/goal', body: { subject: '线性代数', outcome: '考研数一能独立做', minutesPerDay: '90' } })
    assert.equal(r.code, 200)
    assert.equal(r.body.goal.minutesPerDay, 90)
    assert.equal(f.store.read('profile').goal.subject, '线性代数')

    r = f.handle({ method: 'POST', pathname: '/study/api/goal', body: { deadline: '2027/1/1' } })
    assert.equal(r.code, 400)

    r = f.handle({ method: 'POST', pathname: '/study/api/goal', body: { minutesPerDay: -5 } })
    assert.equal(r.code, 400)
  } finally {
    f.done()
  }
})

test('材料可以加可以删', () => {
  const f = fresh()
  try {
    let r = f.handle({ method: 'POST', pathname: '/study/api/materials', body: { kind: 'book', title: '线代讲义' } })
    assert.equal(r.code, 200)
    const id = r.body.material.id
    assert.equal(r.body.materials.length, 1)

    r = f.handle({ method: 'POST', pathname: '/study/api/materials', body: {} })
    assert.equal(r.code, 400)

    // 类别写错要拦下来：以前是照单全收，`textbook` 会落成一份哪个分组都不认的材料。
    r = f.handle({ method: 'POST', pathname: '/study/api/materials', body: { kind: 'textbook', title: '线代讲义' } })
    assert.equal(r.code, 400)
    assert.match(r.body.error.message, /材料类别只能是/)
    assert.equal(f.store.read('profile').materials.length, 1, '被拒的那条不该落盘')

    // kind=ai 是「AI 出题」，跟教辅平级，允许没有本机文件。
    r = f.handle({ method: 'POST', pathname: '/study/api/materials', body: { kind: 'ai', title: '随堂小测 · M1.4（2026-10-01）' } })
    assert.equal(r.code, 200)
    assert.equal(r.body.material.kind, 'ai')
    assert.equal(r.body.material.path, '')
    // 两次 add 撞在同一毫秒里也不能撞 id —— 撞了 remove 会把两份一起删掉。
    assert.notEqual(r.body.material.id, id, '同一毫秒里连加两份，id 也得各是各的')

    r = f.handle({ method: 'POST', pathname: '/study/api/materials/remove', body: { id } })
    assert.equal(r.body.materials.length, 1)
  } finally {
    f.done()
  }
})

test('地图：整份替换、追加模块、定稿', () => {
  const f = fresh()
  try {
    const modules = [
      { id: 'M1', title: '行列式', points: [{ id: 'M1.1', title: '定义' }, { id: 'M1.2', title: '性质' }] },
    ]
    let r = f.handle({ method: 'POST', pathname: '/study/api/map/replace', body: { modules } })
    assert.equal(r.body.count, 1)
    assert.equal(f.store.read('map').status, 'draft')

    r = f.handle({ method: 'POST', pathname: '/study/api/map/module', body: { id: 'M2', title: '矩阵' } })
    assert.equal(f.store.read('map').modules.length, 2)

    r = f.handle({ method: 'POST', pathname: '/study/api/map/confirm' })
    assert.equal(r.body.status, 'confirmed')
    assert.ok(f.store.read('map').confirmedAt)

    r = f.handle({ method: 'POST', pathname: '/study/api/map/replace', body: { modules: [] } })
    assert.equal(f.store.read('map').status, 'draft', '重新生成要退回草稿')
  } finally {
    f.done()
  }
})

test('掌握度：记证据推进档位，未知知识点拒绝', () => {
  const f = fresh()
  try {
    f.handle({ method: 'POST', pathname: '/study/api/map/replace', body: { modules: [{ id: 'M1', title: '行列式', points: [{ id: 'M1.1', title: '定义' }] }] } })

    let r = f.handle({ method: 'POST', pathname: '/study/api/mastery', body: { pointId: 'M1.1', kind: 'self', stage: '见过', confidence: 0.4, note: '看过一遍' } })
    assert.equal(r.code, 200)
    assert.equal(r.body.point.stage, '见过')
    assert.equal(r.body.point.evidence.length, 1)

    // 跳档会被压回一档：他点「能独立做」，实际只落在「能跟做」
    r = f.handle({ method: 'POST', pathname: '/study/api/mastery', body: { pointId: 'M1.1', kind: 'quiz', stage: '能独立做', confidence: 0.8 } })
    assert.equal(r.body.point.evidence.length, 2, '证据要累积')
    assert.equal(r.body.point.stage, '能跟做', '一次只前进一档，学生这条也一样')
    assert.equal(r.body.clamped, true)

    // 这一档不跳了；「能独立做」要 1 条 quiz/photo，上面那条已经攒够
    r = f.handle({ method: 'POST', pathname: '/study/api/mastery', body: { pointId: 'M1.1', kind: 'self', stage: '能独立做' } })
    assert.equal(r.body.point.stage, '能独立做')
    assert.equal(r.body.advanced, true)

    // 「熟练稳定」要 2 条 quiz/photo，现在只有 1 条：他的话记下来，档位不动
    r = f.handle({ method: 'POST', pathname: '/study/api/mastery', body: { pointId: 'M1.1', kind: 'self', stage: '熟练稳定', note: '我觉得我挺熟了' } })
    assert.equal(r.body.point.stage, '能独立做', '门拦住了，档位不许动')
    assert.equal(r.body.advanced, false)
    assert.match(r.body.note, /2 条/)
    assert.equal(r.body.point.evidence.length, 4, '他说的话还是要记下来')

    r = f.handle({ method: 'POST', pathname: '/study/api/mastery', body: { pointId: 'NOPE', stage: '见过' } })
    assert.equal(r.code, 404)

    r = f.handle({ method: 'POST', pathname: '/study/api/mastery', body: { pointId: 'M1.1', stage: '天下第一' } })
    assert.equal(r.code, 400)

    r = f.handle({ method: 'GET', pathname: '/study/api/summary' })
    assert.equal(r.body.summary.total, 1)
    assert.equal(r.body.summary.touched, 1)
    assert.equal(r.body.summary.byStage['能独立做'], 1)
  } finally {
    f.done()
  }
})

test('没记录过的知识点返回默认档位', () => {
  const f = fresh()
  try {
    f.handle({ method: 'POST', pathname: '/study/api/map/replace', body: { modules: [{ id: 'M1', title: 'x', points: [{ id: 'M1.1', title: 'a' }] }] } })
    const r = f.handle({ method: 'GET', pathname: '/study/api/summary' })
    assert.equal(r.body.summary.byStage['没接触过'], 1)
    assert.equal(r.body.summary.avgConfidence, 0)
    assert.deepEqual(pointState(f.store.read('mastery'), 'M1.1').evidence, [])
  } finally {
    f.done()
  }
})

test('每日任务：加、打勾、取消', () => {
  const f = fresh()
  try {
    let r = f.handle({ method: 'POST', pathname: '/study/api/task', body: { date: '2026-10-01', title: '看第3讲', kind: 'watch', target: 'M1.1', minutes: 30 } })
    assert.equal(r.code, 200)
    const id = r.body.task.id
    assert.equal(r.body.task.done, false)

    r = f.handle({ method: 'POST', pathname: '/study/api/task/toggle', body: { date: '2026-10-01', id } })
    assert.equal(r.body.task.done, true)

    r = f.handle({ method: 'POST', pathname: '/study/api/task/toggle', body: { date: '2026-10-01', id, done: false } })
    assert.equal(r.body.task.done, false)

    r = f.handle({ method: 'POST', pathname: '/study/api/task/toggle', body: { date: '2026-10-01', id: 'nope' } })
    assert.equal(r.code, 404)

    r = f.handle({ method: 'POST', pathname: '/study/api/task', body: { date: '10/1', title: 'x' } })
    assert.equal(r.code, 400)
  } finally {
    f.done()
  }
})

test('未知路由 404，方法不匹配也 404', () => {
  const f = fresh()
  try {
    assert.equal(f.handle({ method: 'GET', pathname: '/study/api/nope' }).code, 404)
    assert.equal(f.handle({ method: 'GET', pathname: '/study/api/goal' }).code, 404)
  } finally {
    f.done()
  }
})

test('state 一次端全四份', () => {
  const f = fresh()
  try {
    const r = f.handle({ method: 'GET', pathname: '/study/api/state' })
    assert.equal(r.code, 200)
    for (const k of ['profile', 'map', 'mastery', 'tasks']) assert.ok(r.body.state[k], k)
    assert.deepEqual(r.body.state.stage, STAGES)
  } finally {
    f.done()
  }
})

test('reset 要显式确认', () => {
  const f = fresh()
  try {
    assert.equal(f.handle({ method: 'POST', pathname: '/study/api/reset', body: {} }).code, 400)
    f.handle({ method: 'POST', pathname: '/study/api/map/replace', body: { modules: [{ id: 'M1', title: 'x' }] } })
    assert.equal(f.handle({ method: 'POST', pathname: '/study/api/reset', body: { confirm: 'reset' } }).code, 200)
    assert.equal(f.store.read('map').modules.length, 0)
  } finally {
    f.done()
  }
})

test('masterySummary 对空地图不炸', () => {
  const s = masterySummary({ modules: [] }, { points: {} })
  assert.equal(s.total, 0)
  assert.equal(s.avgConfidence, 0)
})

/* ── 指引与留言 ─────────────────────────────────────────────────────────── */

test('指引与留言：写、读、标掉', async () => {
  const { emptyGuide, emptyInbox } = await import('../lib/store.js')
  const { setGuide, addInboxItem, unreadInbox, markInboxRead } = await import('../lib/notice.js')
  const g = setGuide(emptyGuide(), '回对话里答三个问题', 'ask')
  assert.equal(g.text, '回对话里答三个问题')
  assert.equal(g.kind, 'ask')
  assert.ok(g.at)
  setGuide(g, '')
  assert.equal(g.text, '')

  const box = emptyInbox()
  assert.throws(() => addInboxItem(box, '   '), /text required/)
  const item = addInboxItem(box, ' 这块看不懂 ')
  assert.equal(item.text, '这块看不懂')
  assert.equal(item.read, false)
  assert.equal(unreadInbox(box).length, 1)
  markInboxRead(box)
  assert.equal(unreadInbox(box).length, 0)
  assert.equal(box.items[0].read, true)
})

test('snapshot 带上 guide 和 inbox', async () => {
  const { Store } = await import('../lib/store.js')
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const root = mkdtempSync(join(tmpdir(), 'study-store-'))
  const store = new Store(root)
  store.ensure()
  const s = store.snapshot()
  assert.equal(typeof s.guide.text, 'string')
  assert.ok(Array.isArray(s.inbox.items))
  rmSync(root, { recursive: true, force: true })
})
