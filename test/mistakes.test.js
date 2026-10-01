/**
 * 错题本。三块一起验：
 *   1. store 层的四条自校验——「没有错因和订正，就不许标成已订正」这条规矩必须真的挡得住；
 *   2. 汇总（跨模块、倒序、筛选、截断）与工具层（study_record 记/改、study_mistakes 读）；
 *   3. 路由层（GET /study/api/mistakes、mastery 带 mistake、practice/ask 的 mistake 档）。
 *
 * 用法：node --test test/mistakes.test.js
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Store, MISTAKE_STATUS, normalizeMistake, mistakesOf } from '../lib/store.js'
import { buildTools } from '../lib/tools.js'
import { createRouter } from '../lib/routes.js'

const EXEC = { signal: { throwIfAborted() {} } }

const MODULES = [
  {
    id: 'M1',
    group: '集合与逻辑',
    title: '集合',
    summary: '打底',
    points: [{ id: 'M1.4', title: '参数讨论与反求范围', why: '压轴常客', source: '第一章第九组' }],
  },
  {
    id: 'M2',
    group: '函数与极限',
    title: '函数',
    summary: '主力',
    points: [{ id: 'M2.1', title: '定义域', why: '第一步', source: '第二章' }],
  },
]

function fresh() {
  const root = mkdtempSync(join(tmpdir(), 'study-mistakes-'))
  const store = new Store(root)
  store.ensure()
  const specs = buildTools(store, { panelPath: '/study' })
  const byName = new Map(specs.map((s) => [s.name, s]))
  return {
    root,
    store,
    call: (name, args = {}) => byName.get(name).execute(args, EXEC),
    done: () => rmSync(root, { recursive: true, force: true }),
  }
}

test('normalizeMistake：四条自校验挡在写之前，没传的字段留着上一次的', () => {
  assert.deepEqual(MISTAKE_STATUS, ['待验证', '已订正', '已复做对'])

  assert.throws(() => normalizeMistake('nope'), /要是一个对象/)
  assert.throws(() => normalizeMistake({ status: '待验证' }), /origin/)
  assert.throws(() => normalizeMistake({ origin: '第一章 3', redoAt: '2026/1/1' }), /YYYY-MM-DD/)
  assert.throws(() => normalizeMistake({ origin: '第一章 3', status: '已订正' }), /cause/)
  assert.throws(() => normalizeMistake({ origin: '第一章 3', status: '已复做对', cause: '把 A=∅ 当默认' }), /fix/)
  // 状态写错不许静默吞成「待验证」
  assert.throws(() => normalizeMistake({ origin: '第一章 3', status: '已改正' }), /status 只能是/)

  // 「待验证」不要求错因和订正——学生刚说「我错了」的时候本来就只有现象
  const bare = normalizeMistake({ origin: '第一章 3', step: 'A≠∅ 的下界没写' })
  assert.equal(bare.status, '待验证')
  assert.match(bare.id, /^w-/)
  assert.ok(bare.at, '得有时间戳')

  // 只改状态时，origin/step/id/at 都不该被冲掉
  const fixed = normalizeMistake({ status: '已订正', cause: '把 A=∅ 当默认情形', fix: '先分两类再取交' }, bare)
  assert.equal(fixed.id, bare.id, 'id 不许换，换了面板和对话就对不上了')
  assert.equal(fixed.origin, bare.origin)
  assert.equal(fixed.step, bare.step)
  assert.equal(fixed.at, bare.at)
  assert.equal(fixed.status, '已订正')
})

test('mistakesOf：跨模块汇总、按做错的时刻倒序、能筛能截', () => {
  const map = { modules: MODULES }
  const mastery = { points: {} }
  // 错题自带 at（记下来的时刻），排序看的就是它——这里手动定死，免得同一毫秒打平。
  const a = { ...normalizeMistake({ origin: '第一章第九组 3', status: '待验证' }), at: '2026-10-01T10:00:00.000Z' }
  const b = {
    ...normalizeMistake({ origin: '第二章 1', cause: '忘了根号内非负', fix: '先列限制再取交', status: '已订正' }),
    at: '2026-10-02T10:00:00.000Z',
  }
  mastery.points['M1.4'] = { evidence: [{ kind: 'quiz', at: '2026-10-01T10:00:00.000Z', note: '错了', mistake: a }] }
  mastery.points['M2.1'] = { evidence: [{ kind: 'quiz', at: '2026-10-02T10:00:00.000Z', note: '又错了', mistake: b }] }

  const all = mistakesOf(map, mastery)
  assert.equal(all.total, 2)
  assert.deepEqual(all.byStatus, { 待验证: 1, 已订正: 1, 已复做对: 0 })
  assert.equal(all.items[0].origin, '第二章 1', '新的在前')
  assert.equal(all.items[0].pointTitle, '定义域', '标题得从地图里补上')
  assert.equal(all.items[0].moduleTitle, '函数')
  assert.equal(all.items[0].group, '函数与极限')
  assert.equal(all.items[0].kind, 'quiz')

  assert.equal(mistakesOf(map, mastery, { status: '待验证' }).items.length, 1)
  assert.equal(mistakesOf(map, mastery, { pointId: 'M9.9' }).items.length, 0)
  assert.equal(mistakesOf(map, mastery, { limit: 1 }).items.length, 1)
  assert.equal(mistakesOf(map, mastery, { limit: 1 }).total, 2, 'total 是筛完的总数，不受 limit 影响')
  // 没挂错题的证据不该冒出来
  mastery.points['M2.1'].evidence.push({ kind: 'self', at: '2026-10-03T10:00:00.000Z', note: '自己评的' })
  assert.equal(mistakesOf(map, mastery).total, 2)
})

test('study_record：记错题、再改错题状态，档位都不被错题推着走', async () => {
  const f = fresh()
  try {
    await f.call('study_map', { action: 'set', modules: MODULES })
    await f.call('study_map', { action: 'confirm' })

    // 记一条证据，顺带把错题挂上去
    const first = await f.call('study_record', {
      pointId: 'M1.4',
      kind: 'quiz',
      note: '第一章第九组 第 3 题做错',
      stage: '见过',
      mistake: { origin: '《1000 题》第一章第九组 第 3 题', step: 'A≠∅ 的下界没写', status: '待验证' },
    })
    assert.equal(first.stage, '见过')
    assert.match(first.mistakeId, /^w-/)
    assert.equal(first.mistakeStatus, '待验证')
    assert.match(first.summary, /错题记下了/)

    // 拦得住：没有错因和订正，不许标成「已订正」
    await assert.rejects(
      () => f.call('study_record', { pointId: 'M1.4', mistakeId: first.mistakeId, mistake: { status: '已订正' } }),
      /cause/,
    )

    // 改状态：只动错题，不新增证据、不动档位
    const before = await f.call('study_report', {})
    const evidenceBefore = before.modules[0].points[0].evidenceCount
    const fixed = await f.call('study_record', {
      pointId: 'M1.4',
      mistakeId: first.mistakeId,
      mistake: { status: '已订正', cause: '把 A=∅ 当成了允许的默认情形', fix: '先分 A=∅ / A≠∅ 两类再取交', redoAt: '2026-10-05' },
    })
    assert.equal(fixed.mistakeId, first.mistakeId)
    assert.equal(fixed.mistakeStatus, '已订正')
    assert.equal(fixed.stage, '见过', '订正不是新的掌握度证据，档位不该动')
    assert.match(fixed.summary, /档位没动/)

    const after = await f.call('study_report', {})
    const point = after.modules[0].points[0]
    assert.equal(point.evidenceCount, evidenceBefore, '改错题不该多出一条证据')
    assert.equal(point.stage, '见过')

    // 档案里跟着一起端出来
    const arc = await f.call('study_archive', { level: 'point', key: 'M1.4' })
    const withMistake = arc.evidence.find((e) => e.mistake)
    assert.ok(withMistake, '错题得挂在证据上一起出来')
    assert.equal(withMistake.mistake.status, '已订正')
    assert.equal(withMistake.mistake.redoAt, '2026-10-05')

    // 改一条不存在的错题 -> 报错
    await assert.rejects(() => f.call('study_record', { pointId: 'M1.4', mistakeId: 'w-nope', mistake: {} }), /没有这条错题/)
  } finally {
    f.done()
  }
})

test('study_mistakes：空本也要能读，记上之后按状态和单元筛', async () => {
  const f = fresh()
  try {
    await f.call('study_map', { action: 'set', modules: MODULES })
    await f.call('study_map', { action: 'confirm' })

    const empty = await f.call('study_mistakes', {})
    assert.equal(empty.total, 0)
    assert.equal(empty.pending, 0)
    assert.deepEqual(empty.items, [])
    assert.match(empty.summary, /空的/)

    await f.call('study_record', {
      pointId: 'M2.1',
      kind: 'quiz',
      note: '定义域漏了根号',
      mistake: { origin: '第二章 第 1 题', status: '待验证' },
    })
    const one = await f.call('study_mistakes', {})
    assert.equal(one.total, 1)
    assert.equal(one.pending, 1)
    assert.equal(one.byStatus, '待验证 1 / 已订正 0 / 已复做对 0')
    assert.equal(one.items[0].pointId, 'M2.1')

    // 筛一个不存在的档位要被拦，别静默回空表
    await assert.rejects(() => f.call('study_mistakes', { status: '已改正' }), /status 只能是/)
    assert.equal((await f.call('study_mistakes', { status: '已订正' })).total, 0)
    assert.equal((await f.call('study_mistakes', { pointId: 'M2.1' })).total, 1)
    assert.equal((await f.call('study_mistakes', { pointId: 'M1.4' })).total, 0)
  } finally {
    f.done()
  }
})

test('路由：GET/mistakes 汇总、mastery 带 mistake、practice/ask 的 mistake 档', async () => {
  const root = mkdtempSync(join(tmpdir(), 'study-mistakes-route-'))
  const store = new Store(root)
  store.ensure()
  const specs = buildTools(store, { panelPath: '/study' })
  const byName = new Map(specs.map((s) => [s.name, s]))
  const call = (name, args = {}) => byName.get(name).execute(args, EXEC)
  const prompts = []
  const handle = createRouter(store, { bridge: { send: async (text) => { prompts.push(text); return { ok: true } } } })

  try {
    await call('study_map', { action: 'set', modules: MODULES })
    await call('study_map', { action: 'confirm' })

    // 面板自评那条路也能带错题
    const rated = await handle({
      method: 'POST',
      pathname: '/study/api/mastery',
      body: { pointId: 'M1.4', stage: '见过', kind: 'quiz', note: '第九组 3 做错', mistake: { origin: '第一章第九组 3', status: '待验证' } },
    })
    assert.equal(rated.code, 200)

    const listed = await handle({ method: 'GET', pathname: '/study/api/mistakes', query: {} })
    assert.equal(listed.code, 200)
    assert.equal(listed.body.total, 1)
    assert.equal(listed.body.items[0].pointTitle, '参数讨论与反求范围')
    assert.equal(listed.body.byStatus['待验证'], 1)

    // 带筛选
    const none = await handle({ method: 'GET', pathname: '/study/api/mistakes', query: { status: '已订正' } })
    assert.equal(none.body.total, 0)
    const byPoint = await handle({ method: 'GET', pathname: '/study/api/mistakes', query: { point: 'M1.4' } })
    assert.equal(byPoint.body.total, 1)

    // 做题页那个「这题做错了」按钮
    const asked = await handle({
      method: 'POST',
      pathname: '/study/api/practice/ask',
      body: { pointId: 'M1.4', mode: 'mistake', origin: '第一章第九组 3', text: 'A 是空集那种情况我没管' },
    })
    assert.equal(asked.code, 200)
    assert.equal(asked.body.mode, 'mistake')
    assert.equal(asked.body.pushed, true)
    assert.equal(prompts.length, 1)
    assert.match(prompts[0], /【面板·错题】/)
    assert.match(prompts[0], /第一章第九组 3/)
    assert.match(prompts[0], /A 是空集那种情况我没管/)
    assert.match(prompts[0], /study_record/, '得明确要求把这条记进错题本')
    // 只报现象、连题号都没有 -> 拦掉
    const bare = await handle({ method: 'POST', pathname: '/study/api/practice/ask', body: { pointId: 'M1.4', mode: 'mistake' } })
    assert.equal(bare.code, 400)
    // 老的两档还在
    const other = await handle({ method: 'POST', pathname: '/study/api/practice/ask', body: { pointId: 'M1.4', mode: 'nope' } })
    assert.equal(other.code, 400)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
