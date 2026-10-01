/**
 * 今日复盘图。三块：
 *   1. buildReview——一天的数据怎么摊成 1—6 个分支；什么都没动就返回 null；
 *   2. reviewSvg——版式的三条硬校验，尤其是「错题数必须等于带错题的分支数」；
 *   3. 路由 GET /study/api/review。
 *
 * 用法：node --test test/review.test.js
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Store } from '../lib/store.js'
import { buildReview, reviewSvg, REVIEW_WIDTH } from '../lib/review.js'
import { buildTools } from '../lib/tools.js'
import { createRouter } from '../lib/routes.js'

const EXEC = { signal: { throwIfAborted() {} } }
const DATE = '2026-10-01'

const MODULES = [
  {
    id: 'M1',
    group: '集合与逻辑',
    title: '集合',
    summary: '打底',
    points: [
      { id: 'M1.1', title: '集合的表示与关系', why: '打底', source: '第一章' },
      { id: 'M1.4', title: '参数讨论与反求范围', why: '压轴常客', source: '第一章第九组' },
    ],
  },
  {
    id: 'M2',
    group: '函数与极限',
    title: '函数',
    summary: '主力',
    points: [{ id: 'M2.1', title: '定义域', why: '第一步', source: '第二章' }],
  },
]

function seed() {
  const root = mkdtempSync(join(tmpdir(), 'study-review-'))
  const store = new Store(root)
  store.ensure()
  const byName = new Map(buildTools(store, { panelPath: '/study' }).map((s) => [s.name, s]))
  return { root, store, call: (name, args = {}) => byName.get(name).execute(args, EXEC) }
}

/** 直接往掌握度里塞当天的证据——工具层会把 at 写成现在，测试要定死的日期。 */
function stamp(store, rows) {
  store.update('mastery', (m) => {
    for (const [pointId, evidence] of rows) m.points[pointId] = { stage: '见过', confidence: 0.3, evidence }
    return m
  })
}

test('buildReview：没动过任何单元就返回 null，动过才摊图', () => {
  const f = seed()
  try {
    f.store.update('map', (m) => {
      m.modules = MODULES
      m.confirmed = true
      return m
    })
    assert.equal(buildReview(f.store.snapshot(), { date: DATE }), null, '空白的一天不该硬凑一张图')

    stamp(f.store, [['M1.1', [{ kind: 'quiz', at: DATE + 'T10:00:00.000Z', note: '做了 5 道' }]]])
    const data = buildReview(f.store.snapshot(), { date: DATE })
    assert.ok(data, '有证据就该有图')
    assert.equal(data.branches.length, 1)
    assert.equal(data.branches[0].side, 'left')
    assert.equal(data.branches[0].title, '集合的表示与关系')
    assert.equal(data.branches[0].category, '集合与逻辑')
    assert.equal(data.branches[0].error, undefined)
    assert.equal(data.branches[0].check, '当前「见过」')
    assert.equal(data.error_count, 0)

    // 别的日子不算今天
    assert.equal(buildReview(f.store.snapshot(), { date: '2026-10-02' }), null)
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
})

test('buildReview：错题进 error 分支、error_count 对得上、每侧不超过 3 个', async () => {
  const f = seed()
  try {
    await f.call('study_map', { action: 'set', modules: MODULES })
    await f.call('study_map', { action: 'confirm' })
    for (const id of ['M1.1', 'M1.4', 'M2.1']) {
      await f.call('study_record', { pointId: id, stage: '见过', kind: 'quiz', note: '做了一组' })
    }
    await f.call('study_record', {
      pointId: 'M1.4',
      kind: 'quiz',
      note: '第九组 3 做错',
      mistake: { origin: '《1000 题》第一章第九组 3', step: '只讨论了 A≠∅', cause: '漏了 A=∅ 那一支' },
    })
    await f.call('study_record', {
      pointId: 'M2.1',
      kind: 'quiz',
      note: '定义域忘条件',
      mistake: { origin: '教材第二章课后 1', step: '根号忘了非负', cause: '只看了分母不为零', fix: '先列全限制再取交集', status: '已订正' },
    })

    /* 工具层写的 at 是「现在」，跟 DATE 对不上；直接改成 DATE 再摊图。 */
    f.store.update('mastery', (m) => {
      for (const p of Object.values(m.points)) for (const e of p.evidence || []) e.at = DATE + 'T12:00:00.000Z'
      return m
    })

    const data = buildReview(f.store.snapshot(), { date: DATE })
    assert.equal(data.branches.length, 3)
    assert.equal(data.error_count, 2)
    assert.equal(data.branches.filter((b) => b.error).length, 2)
    assert.equal(data.branches.filter((b) => b.side === 'left').length, 2, '3 个分支时左 2 右 1')
    assert.equal(data.branches.filter((b) => b.side === 'right').length, 1)
    assert.equal(data.status, '待验证 1 道错题')
    const wrong = data.branches.filter((b) => b.error).map((b) => b.error)
    assert.deepEqual(wrong.map((w) => w.number), [1, 2], '错题编号从 01 起连着排')
    assert.match(data.workload, /3 个单元/)

    const svg = reviewSvg(data)
    assert.ok(svg.startsWith('<svg'))
    assert.ok(svg.includes(`viewBox="0 0 ${REVIEW_WIDTH} 1180"`))
    assert.ok(svg.includes('参数讨论与反求范围'))
    assert.ok(svg.includes('错题 01'))
    assert.ok(svg.includes('错题 02'))
    assert.ok(svg.includes('档位'))
    assert.ok(svg.endsWith('</svg>\n'))
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
})

test('reviewSvg：版式的三条硬校验挡在画之前', () => {
  const base = {
    title: '今日复盘',
    description: '一句话',
    eyebrow: 'DAY REVIEW',
    subtitle: '2026-10-01 · 周四',
    status: '今天没有记错题',
    core_label: 'DAY REVIEW',
    core_title: '10 月 1 日',
    core_subtitle: '1 个单元',
    workload: '1 个单元 · 1 条记录',
    core_foot: '下一步 接着往下走',
    error_count: 0,
    legend: '彩色分支',
    note_legend: '没有错题',
    footer: '下一步：接着往下走',
  }
  const branch = (side, extra = {}) => ({ side, category: '集合与逻辑', title: '定义域', rule: '做了题', detail: '到「见过」', check: '当前「见过」', check_fix: '还没排复习', ...extra })

  assert.throws(() => reviewSvg(null), /没有 branches/)
  assert.throws(() => reviewSvg({ ...base, branches: [] }), /1—6 个分支/)
  assert.throws(() => reviewSvg({ ...base, branches: new Array(7).fill(0).map(() => branch('left')) }), /1—6 个分支/)
  assert.throws(() => reviewSvg({ ...base, branches: [{ ...branch('middle') }] }), /side 只能是 left 或 right/)
  assert.throws(
    () => reviewSvg({ ...base, branches: [branch('left'), branch('left'), branch('left'), branch('left')] }),
    /left 侧最多挂 3 个/,
  )
  /* 最值钱的那条：错题数必须等于带错题的分支数，「演示数据别算真实表现」才不是口号。 */
  assert.throws(
    () =>
      reviewSvg({
        ...base,
        error_count: 0,
        branches: [branch('left', { error: { number: 1, label: '错题', mistake: '错了', fix: '改了' } }), branch('right')],
      }),
    /error_count 是 0，但带错题的分支有 1 个/,
  )
  const ok = reviewSvg({
    ...base,
    error_count: 1,
    branches: [branch('left', { error: { number: 1, label: '错题', mistake: '错了', fix: '改了' } }), branch('right')],
  })
  assert.ok(ok.includes('<line x1="76" y1="1095"'))

  /* 第 7 种 category 不许像参考实现那样直接崩——按调色板循环取色。 */
  const many = [0, 1, 2, 3, 4, 5].map((i) => branch(i < 3 ? 'left' : 'right', { category: '第' + i + '类' }))
  const svg = reviewSvg({ ...base, branches: many })
  assert.ok(svg.includes('#18D1FF') && svg.includes('#F1C644'), '六类各自取到调色板里的颜色，轮着来不重样')
})

test('buildReview：一天超过 6 个单元也只画 6 个，先画有错题的', async () => {
  const f = seed()
  try {
    const modules = [
      {
        id: 'M1',
        group: '集合与逻辑',
        title: '集合',
        summary: '',
        points: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ id: `M1.${n}`, title: `单元 ${n}`, why: '', source: '' })),
      },
    ]
    await f.call('study_map', { action: 'set', modules })
    await f.call('study_map', { action: 'confirm' })
    for (let n = 1; n <= 8; n += 1) {
      await f.call('study_record', { pointId: `M1.${n}`, stage: '见过', kind: 'quiz', note: `做了 ${n}` })
    }
    await f.call('study_record', {
      pointId: 'M1.8',
      kind: 'quiz',
      note: '第八单元错了一道',
      mistake: { origin: '第八单元 2', step: '符号看反了' },
    })
    f.store.update('mastery', (m) => {
      for (const p of Object.values(m.points)) for (const e of p.evidence || []) e.at = DATE + 'T12:00:00.000Z'
      return m
    })
    const data = buildReview(f.store.snapshot(), { date: DATE })
    assert.equal(data.branches.length, 6)
    assert.equal(data.branches[0].error !== undefined, true, '有错题的排最前')
    assert.equal(data.error_count, 1)
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
})

test('路由：GET /review 给数据和拼好的 SVG；空白的一天给 null 和空串', async () => {
  const root = mkdtempSync(join(tmpdir(), 'study-review-route-'))
  const store = new Store(root)
  store.ensure()
  const handle = createRouter(store, {})

  try {
    const empty = await handle({ method: 'GET', pathname: '/study/api/review', query: { date: DATE } })
    assert.equal(empty.code, 200)
    assert.equal(empty.body.ok, true)
    assert.equal(empty.body.data, null)
    assert.equal(empty.body.svg, '')

    const bad = await handle({ method: 'GET', pathname: '/study/api/review', query: { date: '2026/10/01' } })
    assert.equal(bad.code, 400)
    assert.match(bad.body.error.message, /YYYY-MM-DD/)

    store.update('map', (m) => {
      m.modules = MODULES
      m.confirmed = true
      return m
    })
    stamp(store, [['M1.1', [{ kind: 'lesson', at: DATE + 'T09:00:00.000Z', note: '看了第一节' }]]])
    const one = await handle({ method: 'GET', pathname: '/study/api/review', query: { date: DATE } })
    assert.equal(one.code, 200)
    assert.equal(one.body.data.branches.length, 1)
    assert.ok(one.body.svg.includes('<svg'))
    assert.ok(one.body.svg.includes('集合的表示与关系'))

    // 不传 date 就是今天
    const todayRes = await handle({ method: 'GET', pathname: '/study/api/review', query: {} })
    assert.equal(todayRes.code, 200)
    assert.match(todayRes.body.date, /^\d{4}-\d{2}-\d{2}$/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
