import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { emptyStudent, emptyMastery, emptyMap, recordEvidence, FACT_KINDS, Store } from '../lib/store.js'
import { createRouter } from '../lib/routes.js'
import { buildTools } from '../lib/tools.js'
import {
  addFact,
  allEvidence,
  auditFacts,
  evidenceKey,
  evidenceList,  findFact,
  listFacts,
  normalizeFact,
  patchFact,
  removeFact,
  renderFact,
  studentBody,
} from '../lib/student.js'

/** 一张小地图：两个模块四个单元，够验引用了。 */
function freshMap() {
  const map = emptyMap()
  map.status = 'confirmed'
  map.modules = [
    {
      id: 'M1',
      group: '集合与常用逻辑用语',
      title: '集合',
      points: [
        { id: 'M1.1', title: '集合的表示' },
        { id: 'M1.2', title: '集合间的关系' },
      ],
    },
    {
      id: 'M2',
      group: '函数与导数',
      title: '函数',
      points: [{ id: 'M2.1', title: '函数的概念' }],
    },
  ]
  return map
}

/** 攒点证据：每条都带 id（recordEvidence 现在会发）。 */
function withEvidence() {
  const mastery = emptyMastery()
  recordEvidence(mastery, { pointId: 'M1.1', kind: 'quiz', note: '第一章第九组第 3 题做对了', stage: '能跟做' })
  recordEvidence(mastery, { pointId: 'M1.1', kind: 'quiz', note: '隔三天重做同类题，独立做对', stage: '能独立做' })
  recordEvidence(mastery, { pointId: 'M1.2', kind: 'self', note: '自评能跟做' })
  return mastery
}

test('证据有 id 了；老数据没有 id 也能推一个稳定的 key', () => {
  const mastery = withEvidence()
  const rows = evidenceList(mastery, 'M1.1')
  assert.equal(rows.length, 2)
  assert.match(rows[0].key, /^e-/, '新证据用自己的 id')
  assert.equal(rows[0].kind, 'quiz')

  // 老证据：把 id 抹掉，key 退化成「单元@时刻」
  const legacy = { id: undefined, at: '2026-09-01T00:00:00.000Z', kind: 'quiz', note: '老的' }
  assert.equal(evidenceKey('M1.1', legacy), 'M1.1@2026-09-01T00:00:00.000Z')
  // 同一毫秒同一单元撞了才补序号，补法必须稳定
  assert.equal(evidenceKey('M1.1', legacy, 1), 'M1.1@2026-09-01T00:00:00.000Z#1')

  // 所有单元摊平，带上 pointId
  const all = allEvidence(mastery)
  assert.equal(all.length, 3)
  assert.deepEqual([...new Set(all.map((r) => r.pointId))].sort(), ['M1.1', 'M1.2'])
})

test('记一条判断：必须挂真证据，编一个 id 会被当场拒掉', () => {
  const map = freshMap()
  const mastery = withEvidence()
  const student = emptyStudent()
  const ctx = { map, mastery }
  const [e1, e2] = evidenceList(mastery, 'M1.1').map((r) => r.key)

  // ① 没证据不行——这是这一层跟「随口评价」唯一的区别
  assert.throws(() => normalizeFact({ text: '他算得慢' }, null, '', ctx), /至少要挂一条证据/)
  assert.throws(() => normalizeFact({ text: '他算得慢', evidence: [] }, null, '', ctx), /至少要挂一条证据/)

  // ② 编一个 id 不行
  assert.throws(
    () => normalizeFact({ text: '他算得慢', evidence: ['e-编的'] }, null, '', ctx),
    /没有任何一条证据的 id 是/,
  )

  // ③ 单元写错也不行
  assert.throws(
    () => normalizeFact({ text: '他算得慢', evidence: [{ pointId: 'M9.9', key: e1 }] }, null, '', ctx),
    /地图里没有这个单元：M9\.9/,
  )
  // 单元对了但那条 id 不在这个单元下
  assert.throws(
    () => normalizeFact({ text: '他算得慢', evidence: [{ pointId: 'M1.2', key: e1 }] }, null, '', ctx),
    /M1\.2 上没有 id 是/,
  )

  // ④ 只给 id、不给单元：能自己找出来
  const found = addFact(student, { text: '换元之后容易忘记回代', evidence: [e1] }, ctx)
  assert.equal(found.kind, '习惯', '不给类别默认「习惯」')
  assert.equal(found.evidence.length, 1)
  assert.equal(found.evidence[0].pointId, 'M1.1', '只给 id 也要把单元补上')
  assert.match(found.id, /^f-/)

  // ⑤ 一条判断挂两条证据、重复的引用去掉
  const two = addFact(student, { text: '越难越容易放弃', kind: '弱项', evidence: [e1, e2, e1] }, ctx)
  assert.equal(two.evidence.length, 2, '同一个引用不重复挂')
  assert.equal(two.kind, '弱项')

  // ⑥ 类别白名单
  assert.throws(() => addFact(student, { text: 'x', kind: '玄学', evidence: [e1] }, ctx), /类别只能是/)
  assert.deepEqual(FACT_KINDS, ['习惯', '强项', '弱项', '偏好', '背景'])

  // ⑦ 一句话不许写成一段分析
  assert.throws(() => addFact(student, { text: '啊'.repeat(121), evidence: [e1] }, ctx), /超过 120 字/)
  assert.throws(() => addFact(student, { text: '   ', evidence: [e1] }, ctx), /要写一句话/)
})

test('改和删：改措辞不该把挂的证据冲掉，改证据也不该把话冲掉', () => {
  const map = freshMap()
  const mastery = withEvidence()
  const student = emptyStudent()
  const ctx = { map, mastery }
  const keys = evidenceList(mastery, 'M1.1').map((r) => r.key)
  const u2 = evidenceList(mastery, 'M1.2').map((r) => r.key)[0]

  const fact = addFact(student, { text: '换元之后容易忘记回代', kind: '弱项', evidence: [keys[0]], note: '出现过两次' }, ctx)
  const id = fact.id
  const at = fact.at

  // 只改措辞：kind / evidence / note / at 都留着
  const renamed = patchFact(student, id, { text: '换元之后经常忘记回代' }, ctx)
  assert.equal(renamed.text, '换元之后经常忘记回代')
  assert.equal(renamed.kind, '弱项')
  assert.equal(renamed.evidence.length, 1)
  assert.equal(renamed.evidence[0].key, keys[0])
  assert.equal(renamed.note, '出现过两次')
  assert.equal(renamed.at, at, '记下来的时刻不动')
  assert.equal(renamed.id, id)

  // 只改证据：话留着
  const rerouted = patchFact(student, id, { evidence: [keys[1], u2] }, ctx)
  assert.equal(rerouted.text, '换元之后经常忘记回代')
  assert.equal(rerouted.evidence.length, 2)
  assert.deepEqual(rerouted.evidence.map((e) => e.pointId).sort(), ['M1.1', 'M1.2'])

  // 改不存在的
  assert.throws(() => patchFact(student, 'f-nope', { text: 'x' }, ctx), /没有这条判断：f-nope/)
  assert.throws(() => removeFact(student, 'f-nope'), /没有这条判断：f-nope/)

  // 删
  assert.ok(findFact(student, id))
  removeFact(student, id)
  assert.equal(findFact(student, id), null)
  assert.equal(student.facts.length, 0)
})

test('读回来：证据兑成人话，兑不上的显式记账', () => {
  const map = freshMap()
  const mastery = withEvidence()
  const student = emptyStudent()
  const ctx = { map, mastery }
  const keys = evidenceList(mastery, 'M1.1').map((r) => r.key)

  addFact(student, { text: '换元之后容易忘记回代', kind: '弱项', evidence: [keys[0]] }, ctx)
  addFact(student, { text: '早读效率高', kind: '习惯', evidence: [evidenceList(mastery, 'M1.2')[0].key] }, ctx)

  // 兑得上：带单元标题、那次是什么类型、原话
  const body = studentBody(student, map, mastery)
  assert.equal(body.total, 2)
  assert.equal(body.byKind['弱项'], 1)
  assert.equal(body.byKind['习惯'], 1)
  assert.equal(body.byKind['强项'], 0, '每一类都要在，哪怕是 0')
  assert.equal(body.orphans.length, 0)

  const weak = body.facts.find((f) => f.kind === '弱项')
  assert.equal(weak.evidence[0].ok, true)
  assert.equal(weak.evidence[0].pointTitle, '集合的表示')
  assert.equal(weak.evidence[0].kind, 'quiz')
  assert.match(weak.evidence[0].note, /第一章第九组第 3 题/)

  // 筛：按类别、按单元
  assert.equal(listFacts(student, { kind: '习惯' }).length, 1)
  assert.equal(listFacts(student, { pointId: 'M1.1' }).length, 1)
  assert.equal(listFacts(student, { pointId: 'M2.1' }).length, 0)
  assert.equal(listFacts(student, { limit: 1 }).length, 1)

  // 把那条证据抹掉（模拟「证据后来没了」），兑不上要显式说出来
  const gone = JSON.parse(JSON.stringify(mastery))
  gone.points['M1.1'].evidence.shift()
  const after = studentBody(student, map, gone)
  assert.equal(after.total, 2, '证据没了判断还在')
  const broken = after.facts.find((f) => f.kind === '弱项')
  assert.equal(broken.evidence[0].ok, false, '兑不上的那一格要标出来，不能静默')
  assert.equal(after.orphans.length, 1)
  assert.equal(after.orphans[0].bad[0].why, '这条证据找不到了')

  // 地图重画把单元改了名 → 另一条也兑不上，理由是「地图里没这个单元了」
  const redrawn = freshMap()
  redrawn.modules[0].points[0].id = 'M1.1x'
  const orphan2 = auditFacts(student, mastery, redrawn)
  assert.equal(orphan2.length, 1, '只有引 M1.1 那条失效')
  assert.equal(orphan2[0].bad[0].why, '地图里没这个单元了')
})

test('渲染单条：给面板和工具用同一份，兑不上的不隐藏', () => {
  const map = freshMap()
  const mastery = withEvidence()
  const ctx = { map, mastery }
  const fact = {
    id: 'f-1',
    kind: '弱项',
    text: '换元之后容易忘记回代',
    note: '',
    at: '2026-10-01T00:00:00.000Z',
    evidence: [
      { pointId: 'M1.1', key: evidenceList(mastery, 'M1.1')[0].key },
      { pointId: 'M1.1', key: 'e-不存在' },
    ],
  }
  const view = renderFact(fact, map, mastery)
  assert.equal(view.evidence.length, 2)
  assert.equal(view.evidence[0].ok, true)
  assert.equal(view.evidence[0].pointTitle, '集合的表示')
  assert.equal(view.evidence[1].ok, false)
  assert.equal(view.evidence[1].pointTitle, '集合的表示', '单元还在，是那条证据没了')
  assert.equal(view.evidence[1].at, '')
})

/* ── 接线层：路由、工具、study_report 里那一句 ─────────────────────────── */

/** 一个落在临时目录上的真档案，地图和证据都灌好了。 */
function fresh() {
  const root = mkdtempSync(join(tmpdir(), 'study-student-'))
  const store = new Store(root)
  store.ensure()
  store.update('map', (map) => {
    const next = freshMap()
    Object.assign(map, next)
    return map
  })
  store.update('mastery', (mastery) => {
    recordEvidence(mastery, { pointId: 'M1.1', kind: 'quiz', note: '第一章第九组第 3 题做对了', stage: '能跟做' })
    recordEvidence(mastery, { pointId: 'M1.1', kind: 'quiz', note: '隔三天重做同类题，独立做对', stage: '能独立做' })
    recordEvidence(mastery, { pointId: 'M1.2', kind: 'self', note: '自评能跟做' })
    return mastery
  })
  const specs = buildTools(store, { panelPath: '/study' })
  const byName = new Map(specs.map((s) => [s.name, s]))
  return {
    root,
    store,
    call: (name, args = {}) => byName.get(name).execute(args, { signal: { throwIfAborted() {} } }),
    handle: createRouter(store, {}),
    done: () => rmSync(root, { recursive: true, force: true }),
  }
}

test('路由层：读得到、写得进、中文报错原样回 400', async () => {
  const env = fresh()
  try {
    const call = (method, pathname, body, query = {}) => env.handle({ method, pathname, query, body })

    // 空档案：读得到，不是空响应
    let res = await call('GET', '/study/api/student')
    assert.equal(res.code, 200)
    assert.equal(res.body.ok, true)
    assert.equal(res.body.total, 0)
    assert.equal(res.body.byKind['强项'], 0, '每一类都要在，哪怕是 0')
    assert.deepEqual(res.body.orphans, [])

    // 拿一条真证据的 id
    const key = env.store.snapshot().mastery.points['M1.1'].evidence[0].id
    assert.match(key, /^e-/)

    // 记一条：只给 id，单元自己补
    res = await call('POST', '/study/api/student', { action: 'add', kind: '弱项', text: '换元之后容易忘记回代', evidence: [key] })
    assert.equal(res.code, 200)
    assert.equal(res.body.ok, true)
    assert.equal(res.body.fact.text, '换元之后容易忘记回代')
    assert.equal(res.body.fact.evidence.length, 1)
    assert.equal(res.body.fact.evidence[0].pointId, 'M1.1')
    assert.equal(res.body.total, 1, '写完之后顺手把新的总览也回了')
    const id = res.body.fact.id

    // 编一个 id → 400，并且那句中文要原样回来
    res = await call('POST', '/study/api/student', { action: 'add', text: '随口一说', evidence: ['e-编的'] })
    assert.equal(res.code, 400)
    assert.match(res.body.error.message, /没有任何一条证据的 id 是/)
    assert.equal(env.store.read('student').facts.length, 1, '被拒的那条不许落盘')

    // action 不认识
    res = await call('POST', '/study/api/student', { action: 'clear' })
    assert.equal(res.code, 400)
    assert.match(res.body.error.message, /action 只能是 add \/ patch \/ remove/)

    // patch 缺 id
    res = await call('POST', '/study/api/student', { action: 'patch', text: 'x' })
    assert.equal(res.code, 400)
    assert.match(res.body.error.message, /patch 要带 id/)

    // 改措辞：证据留着
    res = await call('POST', '/study/api/student', { action: 'patch', id, text: '换元之后经常忘记回代' })
    assert.equal(res.code, 200)
    assert.equal(res.body.fact.text, '换元之后经常忘记回代')
    assert.equal(res.body.fact.evidence.length, 1)

    // 筛
    res = await call('GET', '/study/api/student', null, { kind: '弱项' })
    assert.equal(res.body.total, 1)
    res = await call('GET', '/study/api/student', null, { kind: '习惯' })
    assert.equal(res.body.total, 0)
    res = await call('GET', '/study/api/student', null, { point: 'M1.1' })
    assert.equal(res.body.total, 1)

    // 删
    res = await call('POST', '/study/api/student', { action: 'remove', id })
    assert.equal(res.code, 200)
    assert.equal(res.body.total, 0)
    assert.equal(env.store.read('student').facts.length, 0)
  } finally {
    env.done()
  }
})

test('工具层：study_student 记账，study_report 把它带出来，study_ability 能引用它', async () => {
  const env = fresh()
  try {
    const key = env.store.snapshot().mastery.points['M1.1'].evidence[0].id

    // ① 第一遍 list：空
    let out = await env.call('study_student', { action: 'list' })
    assert.equal(out.total, 0)
    assert.match(out.summary, /学生画像 0 条判断/)

    // ② add：没证据要被拒——这是这一层存在的意义
    await assert.rejects(() => env.call('study_student', { action: 'add', text: '他算得慢' }), /要挂证据/)
    await assert.rejects(() => env.call('study_student', { action: 'add', text: '他算得慢', evidence: ['e-编的'] }), /没有任何一条证据的 id 是/)

    out = await env.call('study_student', { action: 'add', kind: '习惯', text: '遇到新符号会先查定义', evidence: [key], note: '连着两次都这样' })
    assert.equal(out.total, 1)
    assert.equal(out.fact.kind, '习惯')
    assert.match(out.summary, /记下了（习惯）/)
    const id = out.fact.id

    // ③ study_report 里带出来（只给话，不摊开证据）
    const report = await env.call('study_report', {})
    assert.equal(report.studentFacts.length, 1)
    assert.equal(report.studentFacts[0].text, '遇到新符号会先查定义')
    assert.equal(report.studentFacts[0].evidenceCount, 1)
    assert.match(report.summary, /学生画像 1 条判断/)

    // ④ study_ability 写判词时可以引用它
    out = await env.call('study_ability', { action: 'set', text: '基础能跟做，但换元之后容易断', from: [id] })
    assert.deepEqual(out.judgement.from, [id])

    // ⑤ patch / remove
    out = await env.call('study_student', { action: 'patch', id, text: '遇到新符号会先查定义，这点很稳' })
    assert.match(out.summary, /改好了/)
    out = await env.call('study_student', { action: 'remove', id })
    assert.match(out.summary, /删掉了/)
    assert.equal((await env.call('study_student', { action: 'list' })).total, 0)

    // ⑥ 挂证据的 id 是从哪儿拿的：study_archive 的 evidence[].id。
    // 档案里不端出 id 的话，教练只能挂到整个单元，说不清是哪一次让他这么想的。
    const archive = await env.call('study_archive', { level: 'point', key: 'M1.1' })
    assert.match(String(archive.evidence[0].id), /^e-/, '档案里每条证据都要带 id')
    assert.equal(archive.evidence[0].pointTitle, '集合的表示')

    // 加 id 之前记的老证据：档案得推一个 key 出来，而且跟 evidenceKey() 推的一模一样，
    // 否则教练从档案里抄下来的引用永远兑不上。
    env.store.update('mastery', (mastery) => {
      mastery.points['M1.2'].evidence.push({ kind: 'quiz', at: '2026-09-01T00:00:00.000Z', note: '老的，没 id' })
      return mastery
    })
    const legacy = await env.call('study_archive', { level: 'point', key: 'M1.2' })
    const old = legacy.evidence.find((e) => e.note === '老的，没 id')
    // M1.2 上本来就有一条证据，所以老这条排第二，key 尾部带 #1（同一毫秒同一单元才需要区分）
    assert.equal(old.id, 'M1.2@2026-09-01T00:00:00.000Z#1')
    assert.equal(old.id, evidenceKey('M1.2', { at: '2026-09-01T00:00:00.000Z' }, 1), '两边必须是同一套算法')
    // 拿这个 key 就能挂上判断
    const late = await env.call('study_student', { action: 'add', kind: '习惯', text: '老证据也挂得上', evidence: [old.id] })
    assert.equal(late.facts[0].evidence[0].pointId, 'M1.2')
  } finally {
    env.done()
  }
})
