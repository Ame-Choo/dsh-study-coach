/**
 * 掌握度账本：证据只增不改（作废 ≠ 删除）、档位照流水重算、账对不上要能当场指出来。
 *
 * 这一段是照 DeepTutor 那套「证据不可变 + 结论由引擎重算」抄过来的（它的
 * `learning/models.py` 里 `LearningEvidence` 只增不改，档位由引擎重算）。
 * 债的形态是：档位是**写下来的**，写下的那一刻之后就没人再核——一条证据记错了单元、
 * 或者旧版本绕过闸门直接写了档位，账面上看不出破绽。所以这个文件盯三件事：
 *
 *   ① 作废是盖章，不是删行：`voidEvidence` 之后那条还在，但不算数了；
 *   ② 档位是流水的函数：把它撑起来的那条作废掉，档位要跟着降回去；
 *   ③ 对不上就要报：`driftOf` / `study_ability.drift` / `study_archive.points[].drift`
 *      三处都得把「账上写的比证据撑得起的高」端出来，工具层还要能把三道拦说清楚。
 *
 * 用法：node --test test/ledger.test.js
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Store } from '../lib/store.js'
import { buildTools } from '../lib/tools.js'
import {
  derivedStage,
  driftOf,
  findEvidence,
  gateStage,
  isVoided,
  liveEvidence,
  pointState,
  recordEvidence,
  voidEvidence,
  workCountOf,
} from '../lib/map.js'

const EXEC = { signal: { throwIfAborted() {} } }

function fresh() {
  const root = mkdtempSync(join(tmpdir(), 'study-ledger-'))
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

const MODULES = [
  {
    id: 'M1',
    group: '行列式',
    title: '行列式',
    summary: '打底',
    points: [
      { id: 'M1.1', title: '定义与几何意义', why: '后面全靠它', source: '教辅第1章' },
      { id: 'M1.2', title: '性质与展开', why: '计算主力', source: '第2讲' },
    ],
  },
]

/**
 * 记一条证据，跟真账走同一条路：先过 `gateStage` 那道门，再把门放行的档位写进流水。
 * 直接 `recordEvidence(..., { stage })` 是不过门的（门是调用方的事），拿它造夹具会造出
 * 一份「账上写的比证据撑得起的高」的假账——那是要测的东西，不是要用的起点。
 */
function step(mastery, pointId, kind, wanted, note) {
  const g = gateStage(mastery, pointId, wanted, kind)
  return recordEvidence(mastery, { pointId, kind, stage: g.stage, note })
}

/** 三次做题，把 M1.1 推到「能独立做」：① 见过 ② 能跟做 ③ 能独立做。 */
function threeQuizzes() {
  const mastery = { points: {} }
  step(mastery, 'M1.1', 'quiz', '能跟做', '第九组第 3 题')
  step(mastery, 'M1.1', 'quiz', '能独立做', '第十组第 1 题')
  step(mastery, 'M1.1', 'quiz', '能独立做', '第十组第 4 题')
  return mastery
}

/* ── 流水那一层（lib/map.js 的纯函数） ────────────────────────────────────── */

test('作废撑住档位的那条：档位照着剩下的证据降回去，来源换人，章留在行上', () => {
  const mastery = threeQuizzes()
  const before = pointState(mastery, 'M1.1')
  assert.equal(before.stage, '能独立做')
  assert.equal(workCountOf(before), 3)
  assert.equal(before.voidedCount, 0)

  const last = before.evidence[2]
  const r = voidEvidence(mastery, last.id, '按错单元了')
  assert.equal(r.already, false)
  assert.equal(r.before, '能独立做')
  assert.equal(r.after, '能跟做', '最后一条做题被撤掉，撑不住「能独立做」了')

  const after = pointState(mastery, 'M1.1')
  assert.equal(after.stage, '能跟做')
  assert.equal(after.voidedCount, 1)
  assert.equal(after.evidence.length, 3, '作废不是删除：行还在')
  assert.equal(workCountOf(after), 2, '作废的那条不再算「真做过」')
  assert.equal(after.source, before.evidence[1].id, '档位换成还撑着它的那条证据')
  assert.equal(isVoided(last), true)
  assert.equal(last.voidReason, '按错单元了')
  assert.equal(liveEvidence(after).length, 2)
})

test('同一条作废两遍是幂等的，先写的理由不会被后来那句话冲掉', () => {
  const mastery = threeQuizzes()
  const id = mastery.points['M1.1'].evidence[2].id
  voidEvidence(mastery, id, '按错单元了')
  const again = voidEvidence(mastery, id, '换个说法')
  assert.equal(again.already, true)
  assert.equal(again.after, '能跟做')
  assert.equal(mastery.points['M1.1'].evidence[2].voidReason, '按错单元了')
})

test('没这条 id、或者压根没给 id：都要炸出来，别静默成功', () => {
  const mastery = threeQuizzes()
  assert.throws(() => voidEvidence(mastery, 'e-不存在', '按错了'), /没有这条证据/)
  assert.throws(() => voidEvidence(mastery, '', '按错了'), /evidenceId required/)
})

test('老证据（没有 item.stage）只算 work，不让它推动档位', () => {
  const state = {
    stage: '见过',
    evidence: [{ id: 'old', kind: 'quiz', at: '2026-09-01T09:00:00Z', note: '加 id 之前记的' }],
  }
  const d = derivedStage(state)
  assert.equal(d.stage, '没接触过', '证得了「他做过」，证不了「当时判成了哪一档」')
  assert.equal(d.work, 1, '但还是算一条真做过的')
  assert.equal(d.source, null)
  assert.equal(driftOf({ points: { 'M1.1': state } })[0].pointId, 'M1.1', '账上写着见过，证据撑不起来')
})

test('driftOf：只有账上写的比证据撑得起的高才报；对得上就空', () => {
  const mastery = threeQuizzes()
  assert.deepEqual(driftOf(mastery), [], '三次做题撑到能独立做，账对得上')

  /* 模拟「旧版本绕过闸门写了档位」：证据没变，账上写成能讲明白。 */
  mastery.points['M1.1'].stage = '能讲明白'
  const rows = driftOf(mastery, { modules: MODULES })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].pointId, 'M1.1')
  assert.equal(rows[0].stage, '能讲明白')
  assert.equal(rows[0].derived, '能独立做')
  assert.equal(rows[0].work, 3)
  assert.equal(rows[0].title, '定义与几何意义', '给了地图就用知识点名，别只端 id')

  /* 作废掉撑档的那条，账照样降下来，缺口就补上了。 */
  const m2 = threeQuizzes()
  m2.points['M1.1'].stage = '能讲明白'
  const last = m2.points['M1.1'].evidence[2]
  voidEvidence(m2, last.id, '那是我讲的例题，不是他做的')
  assert.equal(m2.points['M1.1'].stage, '能跟做', '作废之后档位重算，不再虚高')
  assert.deepEqual(driftOf(m2), [])
})

test('findEvidence 连它挂在哪个单元上一起返回', () => {
  const mastery = threeQuizzes()
  recordEvidence(mastery, { pointId: 'M1.2', kind: 'self', stage: '见过' })
  const id = mastery.points['M1.2'].evidence[0].id
  const hit = findEvidence(mastery, id)
  assert.equal(hit.pointId, 'M1.2')
  assert.equal(hit.item.id, id)
  assert.equal(findEvidence(mastery, 'e-没有'), null)
  assert.equal(findEvidence(mastery, '  '), null)
})

test('recordEvidence 把「这条之后的档位」和「谁把档位推上来的」一起写下来', () => {
  const mastery = { points: {} }
  step(mastery, 'M1.1', 'quiz', '能跟做', '第九组第 3 题')
  const first = mastery.points['M1.1']
  assert.equal(first.evidence[0].stage, '见过', '一次只前进一档，证据上记的是门放行的那个档')
  assert.equal(first.source, first.evidence[0].id)

  /* 又记一条、档位没动：来源还是原来那条，重算时才认得出「谁」把它推上来的。 */
  recordEvidence(mastery, { pointId: 'M1.1', kind: 'self', stage: '见过', note: '他说这块熟' })
  assert.equal(mastery.points['M1.1'].stage, '见过')
  assert.equal(mastery.points['M1.1'].source, first.source)
})

/* ── 工具那一层（教练真正会调的 study_record / study_ability / study_archive） ── */

test('study_record 作废：降档说出来，档案里那行带着章和理由', async () => {
  const f = fresh()
  try {
    await f.call('study_map', { action: 'set', modules: MODULES })
    await f.call('study_record', { pointId: 'M1.1', kind: 'quiz', stage: '能跟做', note: '第九组第 3 题' })
    await f.call('study_record', { pointId: 'M1.1', kind: 'quiz', stage: '能独立做', note: '第十组第 1 题' })
    const third = await f.call('study_record', { pointId: 'M1.1', kind: 'quiz', stage: '能独立做', note: '第十组第 4 题' })
    assert.equal(third.stage, '能独立做')
    assert.equal(third.evidenceCount, 3)

    const undo = await f.call('study_record', {
      pointId: 'M1.1',
      voidEvidenceId: third.stageSource,
      voidReason: '那是我讲的例题，不是他做的',
    })
    assert.equal(undo.stage, '能跟做')
    assert.equal(undo.evidenceCount, 2, '作废的那条不算数')
    assert.match(undo.summary, /作废了/)
    assert.match(undo.summary, /那是我讲的例题/)
    assert.match(undo.summary, /档位从「能独立做」降到「能跟做」/)

    const archive = await f.call('study_archive', { level: 'point', key: 'M1.1' })
    const point = archive.points[0]
    assert.equal(point.stage, '能跟做')
    assert.equal(point.voidedCount, 1)
    assert.equal(point.workCount, 2)
    assert.equal(point.derivedStage, '能跟做')
    assert.equal(point.drift, false, '降回来之后账对得上')
    assert.equal(archive.evidenceTotal, 3, '流水一共三条，作废的那条照样列出来')
    const voided = archive.evidence.find((e) => e.voided)
    assert.ok(voided, '被作废的那条还在证据列表里')
    assert.equal(voided.voidReason, '那是我讲的例题，不是他做的')
  } finally {
    f.done()
  }
})

test('study_record 作废的三道拦：缺理由、没这条、单元不符', async () => {
  const f = fresh()
  try {
    await f.call('study_map', { action: 'set', modules: MODULES })
    const a = await f.call('study_record', { pointId: 'M1.1', kind: 'quiz', stage: '能跟做', note: '第九组第 3 题' })
    const b = await f.call('study_record', { pointId: 'M1.2', kind: 'self', stage: '见过', note: '他说这块熟' })
    const bId = b.stageSource

    await assert.rejects(
      () => f.call('study_record', { pointId: 'M1.1', voidEvidenceId: a.stageSource }),
      /要写 voidReason/,
    )
    await assert.rejects(
      () => f.call('study_record', { pointId: 'M1.1', voidEvidenceId: 'e-没有这条', voidReason: '按错了' }),
      /没有这条证据/,
    )
    /* 单元填错了要在盖章之前拦住——先动手再发现找错单元，那条就已经不算数了。 */
    await assert.rejects(
      () => f.call('study_record', { pointId: 'M1.1', voidEvidenceId: bId, voidReason: '按错了' }),
      /挂在「M1.2」上，不是「M1.1」/,
    )
    assert.equal(f.store.read('mastery').points['M1.2'].evidence[0].voidedAt, undefined, '被拦下就没盖章')
  } finally {
    f.done()
  }
})

test('只靠自述撑起来的档位，summary 里要说明白', async () => {
  const f = fresh()
  try {
    await f.call('study_map', { action: 'set', modules: MODULES })
    const r = await f.call('study_record', { pointId: 'M1.1', kind: 'self', stage: '能跟做', note: '他说这块熟' })
    assert.equal(r.stage, '见过', '没有做题证据就不许过 STAGE_NEEDS 那道闸')
    assert.match(r.summary, /是自述撑着的/)
    const done = await f.call('study_record', { pointId: 'M1.1', kind: 'quiz', stage: '能跟做', note: '第九组第 3 题' })
    assert.ok(!/是自述撑着的/.test(done.summary), '有做题证据之后就不再提这一句')

    /* 想一步跳到「能讲明白」：门一次只放一档，压回「能独立做」，而且当场就要说清。 */
    const jumped = await f.call('study_record', { pointId: 'M1.1', kind: 'quiz', stage: '能讲明白', note: '第十组第 1 题' })
    assert.equal(jumped.stage, '能独立做')
    assert.match(jumped.summary, /跳档了/)
  } finally {
    f.done()
  }
})

test('账对不上：study_ability 报 drift，study_archive 点行也报，due 行带一句人话理由', async () => {
  const f = fresh()
  try {
    await f.call('study_map', { action: 'set', modules: MODULES })
    await f.call('study_record', { pointId: 'M1.1', kind: 'quiz', stage: '能跟做', note: '第九组第 3 题' })
    await f.call('study_record', {
      pointId: 'M1.1',
      kind: 'quiz',
      stage: '能独立做',
      note: '第十组第 1 题',
      nextReview: '2026-01-01',
    })
    /* 模拟旧版本绕过闸门写上去的档位：证据一条没变，账上直接写到能讲明白。 */
    f.store.update('mastery', (m) => {
      m.points['M1.1'].stage = '能讲明白'
      return m
    })

    const ability = await f.call('study_ability', {})
    assert.equal(ability.driftTotal, 1)
    assert.equal(ability.drift[0].pointId, 'M1.1')
    assert.equal(ability.drift[0].stage, '能讲明白')
    assert.equal(ability.drift[0].derivedStage, '能跟做')
    assert.equal(ability.drift[0].work, 2)
    assert.match(ability.summary, /档位比证据撑得起的高/)
    assert.match(ability.summary, /voidEvidenceId/, '报账的时候要顺手告诉他怎么修')

    const archive = await f.call('study_archive', { level: 'point', key: 'M1.1' })
    const point = archive.points[0]
    assert.equal(point.drift, true)
    assert.equal(point.derivedStage, '能跟做')
    assert.equal(point.stageSource, f.store.read('mastery').points['M1.1'].evidence[1].id)
    assert.match(archive.summary, /档位比证据撑得起的高/)

    assert.equal(archive.due.length, 1, '排到 2026-01-01，早就该复习了')
    assert.match(archive.due[0].why, /现在是「能讲明白」/)
    assert.match(archive.due[0].why, /逾期/)
  } finally {
    f.done()
  }
})
