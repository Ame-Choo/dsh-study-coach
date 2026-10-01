/**
 * 模型面向工具的测试。defineTool 由宿主注入，这里用 stub 顶替，
 * 所以整个文件不需要 DSH 就能跑。
 *
 * 用法：node --test test/tools.test.js
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Store } from '../lib/store.js'
import { buildTools } from '../lib/tools.js'

const EXEC = { signal: { throwIfAborted() {} } }

function fresh() {
  const root = mkdtempSync(join(tmpdir(), 'study-tools-'))
  const store = new Store(root)
  store.ensure()
  const specs = buildTools(store, { panelPath: '/study' })
  const byName = new Map(specs.map((s) => [s.name, s]))
  return {
    root,
    store,
    specs,
    call: (name, args = {}) => byName.get(name).execute(args, EXEC),
    callWith: (name, args = {}) => byName.get(name).execute(args, EXEC),
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
      {
        id: 'M1.1',
        title: '定义与几何意义',
        why: '后面全靠它',
        source: '教辅第1章',
        video: 'F:\\网课\\01-行列式的定义.mp4',
        practice: 'F:\\教辅\\第1章 习题.pdf',
      },
      { id: 'M1.2', title: '性质与展开', why: '计算主力', source: '第2讲' },
    ],
  },
]

test('study_map：三层结构和大类、网课路径都存得住', async () => {
  const f = fresh()
  try {
    await f.call('study_map', { action: 'set', modules: MODULES })
    const r = await f.call('study_report', {})
    const mod = r.modules[0]
    assert.equal(mod.group, '行列式', '大类得跟着模块出来')
    const p = mod.points.find((x) => x.id === 'M1.1')
    assert.equal(p.video, 'F:\\网课\\01-行列式的定义.mp4')
    assert.equal(p.practice, 'F:\\教辅\\第1章 习题.pdf')
    const bare = mod.points.find((x) => x.id === 'M1.2')
    assert.equal(bare.video, '', '没挂课的就是空串，不是 undefined')
    assert.equal(bare.practice, '')
  } finally {
    f.done()
  }
})

test('study_map：append 也吃 group 和网课路径', async () => {
  const f = fresh()
  try {
    await f.call('study_map', {
      action: 'append',
      module: {
        id: 'M9',
        group: '行列式',
        title: '性质与展开',
        points: [{ id: 'M9.1', title: '定义', video: 'F:\\网课\\09.mp4' }],
      },
    })
    const mod = f.store.read('map').modules[0]
    assert.equal(mod.group, '行列式')
    assert.equal(mod.points[0].video, 'F:\\网课\\09.mp4')
    assert.equal(mod.points[0].practice, '', '没传的字段补空串，别留 undefined')
  } finally {
    f.done()
  }
})

test('工具集名字不重复，schema 结构合法', () => {
  const f = fresh()
  try {
    const names = f.specs.map((s) => s.name)
    assert.equal(new Set(names).size, names.length)
    for (const spec of f.specs) {
      assert.match(spec.name, /^study_[a-z_]+$/)
      assert.ok(spec.description.length > 20, spec.name + ' 缺 description')
      assert.equal(spec.output.schema.type, 'object')
      assert.equal(spec.output.schema.additionalProperties, false)
      assert.equal(typeof spec.execute, 'function')
      assert.equal(typeof spec.output.render, 'function')
      for (const [key, prop] of Object.entries(spec.output.schema.properties)) {
        assert.ok(prop.description, `${spec.name}.${key} 缺 description`)
        assert.ok(prop.type, `${spec.name}.${key} 缺 type`)
      }
    }
  } finally {
    f.done()
  }
})

test('study_goal：部分更新、缺要素时提醒、非法值报错', async () => {
  const f = fresh()
  try {
    let r = await f.call('study_goal', { subject: '线性代数' })
    assert.equal(r.complete, false)
    assert.match(r.summary, /还缺要素/)
    assert.equal(f.store.read('profile').goal.subject, '线性代数')
    assert.equal(f.store.read('profile').goal.minutesPerDay, 60, '没传就不动')

    r = await f.call('study_goal', { outcome: '中档题能独立做', minutesPerDay: 90 })
    assert.equal(r.complete, true)
    assert.equal(f.store.read('profile').goal.minutesPerDay, 90)

    await assert.rejects(() => f.call('study_goal', { deadline: '明天' }), /YYYY-MM-DD/)
    await assert.rejects(() => f.call('study_goal', { minutesPerDay: -1 }), /非负/)
  } finally {
    f.done()
  }
})

test('study_map：set 落草稿、append 追加、confirm 定稿、空地图不给定稿', async () => {
  const f = fresh()
  try {
    let r = await f.call('study_map', { action: 'set', modules: MODULES })
    assert.equal(r.status, 'draft')
    assert.equal(r.moduleCount, 1)
    assert.equal(r.pointCount, 2)

    r = await f.call('study_map', { action: 'append', module: { id: 'M2', title: '矩阵', points: [{ id: 'M2.1', title: '乘法' }] } })
    assert.equal(r.moduleCount, 2)
    assert.equal(r.pointCount, 3)

    r = await f.call('study_map', { action: 'confirm' })
    assert.equal(r.status, 'confirmed')
    assert.ok(f.store.read('map').confirmedAt)

    r = await f.call('study_map', { action: 'set', modules: MODULES })
    assert.equal(f.store.read('map').status, 'draft', '重写草稿要退回 draft')

    await assert.rejects(() => f.call('study_map', { action: 'set' }), /要带 modules/)
    await assert.rejects(() => f.call('study_map', { action: 'set', modules: [] }), /要带 modules/)
    await assert.rejects(() => f.call('study_map', { action: 'append' }), /要带 module/)
    await assert.rejects(() => f.call('study_map', { action: '熔断' }), /action 只能是/)
  } finally {
    f.done()
  }
})

test('study_map：空地图定稿要被拦', async () => {
  const f = fresh()
  try {
    await assert.rejects(() => f.call('study_map', { action: 'confirm' }), /还是空的/)
  } finally {
    f.done()
  }
})

test('study_record：推进档位、累积证据、拦未知知识点', async () => {
  const f = fresh()
  try {
    await f.call('study_map', { action: 'set', modules: MODULES })

    let r = await f.call('study_record', { pointId: 'M1.1', stage: '见过', confidence: 0.4, kind: 'self', note: '翻了一遍' })
    assert.equal(r.title, '定义与几何意义')
    assert.equal(r.stage, '见过')
    assert.equal(r.evidenceCount, 1)
    assert.match(r.summary, /定义与几何意义/)

    r = await f.call('study_record', { pointId: 'M1.1', kind: 'quiz', stage: '能跟做', confidence: 0.6 })
    assert.equal(r.stage, '能跟做')
    assert.equal(r.evidenceCount, 2)

    r = await f.call('study_record', { pointId: 'M1.1', kind: 'quiz', stage: '能独立做', confidence: 0.85 })
    assert.equal(r.evidenceCount, 3)
    assert.equal(r.confidence, 0.85)

    r = await f.call('study_record', { pointId: 'M1.1', kind: 'photo', note: '作业第3题' })
    assert.equal(r.stage, '能独立做', '不传 stage 就保持原档')
    assert.equal(r.evidenceCount, 4)

    r = await f.call('study_record', { pointId: 'M1.2', stage: '熟练稳定', confidence: 0.9 })
    assert.equal(r.stage, '见过', '从没接触过一次跳两级，要被压回上一档')
    assert.match(r.summary, /跳档/)

    await assert.rejects(() => f.call('study_record', { pointId: 'NOPE' }), /地图里没有知识点/)
    await assert.rejects(() => f.call('study_record', {}), /pointId 必填/)
    await assert.rejects(() => f.call('study_record', { pointId: 'M1.1', nextReview: '下周三' }), /YYYY-MM-DD/)

    const st = f.store.read('mastery').points['M1.1']
    assert.equal(st.evidence[0].kind, 'self')
    assert.equal(st.evidence[3].note, '作业第3题')
  } finally {
    f.done()
  }
})

test('study_plan：排任务、翻状态、卡非法输入', async () => {
  const f = fresh()
  try {
    let r = await f.call('study_plan', { action: 'add', date: '2026-10-02', title: '看第3讲', kind: 'watch', target: 'M1.1', minutes: 30 })
    assert.equal(r.tasks.length, 1)
    const taskId = r.tasks[0].id
    assert.match(r.summary, /共 1 项、约 30 分钟/)

    r = await f.call('study_plan', { action: 'add', date: '2026-10-02', title: '做课后1-5题', kind: 'practice', minutes: 20 })
    assert.equal(r.tasks.length, 2)

    r = await f.call('study_plan', { action: 'toggle', date: '2026-10-02', taskId })
    assert.equal(r.tasks.find((t) => t.id === taskId).done, true)
    assert.match(r.summary, /做完了/)

    r = await f.call('study_plan', { action: 'toggle', date: '2026-10-02', taskId, done: false })
    assert.equal(r.tasks.find((t) => t.id === taskId).done, false)

    await assert.rejects(() => f.call('study_plan', { action: 'add', title: 'x', date: '10/2' }), /YYYY-MM-DD/)
    await assert.rejects(() => f.call('study_plan', { action: 'toggle', date: '2026-10-02', taskId: 'zzz' }), /没有任务/)
    await assert.rejects(() => f.call('study_plan', { action: 'add', title: '' }), /要带 title/)
  } finally {
    f.done()
  }
})

test('study_material：登记与删除', async () => {
  const f = fresh()
  try {
    let r = await f.call('study_material', { action: 'add', kind: 'video', title: '线代网课', path: 'D:\\网课\\线代', note: '共 24 讲' })
    assert.equal(r.count, 1)
    const id = r.materials[0].id

    r = await f.call('study_material', { action: 'add', kind: 'book', title: '线代讲义' })
    assert.equal(r.count, 2)

    r = await f.call('study_material', { action: 'remove', id })
    assert.equal(r.count, 1)

    await assert.rejects(() => f.call('study_material', { action: 'remove', id: 'nope' }), /没有材料/)
    await assert.rejects(() => f.call('study_material', { action: 'add' }), /要带 title/)
  } finally {
    f.done()
  }
})

test('study_tool_level：新增与更新基本工具', async () => {
  const f = fresh()
  try {
    let r = await f.call('study_tool_level', { name: '行列式手算', stage: '能跟做', confidence: 0.5, note: '要看着公式' })
    assert.equal(r.tools.length, 1)

    r = await f.call('study_tool_level', { name: '行列式手算', stage: '熟练稳定' })
    assert.equal(r.tools.length, 1, '同名要更新不要新增')
    assert.equal(r.tools[0].stage, '熟练稳定')
    assert.equal(r.tools[0].confidence, 0.5, '没传就不动')

    await assert.rejects(() => f.call('study_tool_level', {}), /name 必填/)
  } finally {
    f.done()
  }
})

test('study_report：一次端全，含面板路径与今日任务', async () => {
  const f = fresh()
  try {
    await f.call('study_goal', { subject: '线性代数', outcome: '中档题', minutesPerDay: 60 })
    await f.call('study_map', { action: 'set', modules: MODULES })
    await f.call('study_record', { pointId: 'M1.2', stage: '见过', confidence: 0.3 })
    await f.call('study_record', { pointId: 'M1.2', stage: '能跟做', confidence: 0.5 })
    await f.call('study_plan', { action: 'add', date: '2026-10-03', title: '看第2讲' })

    let r = await f.call('study_report', { date: '2026-10-03' })
    assert.equal(r.mapStatus, 'draft')
    assert.equal(r.moduleCount, 1)
    assert.equal(r.pointCount, 2)
    assert.equal(r.tasks.length, 1)
    assert.equal(r.panelPath, '/study')
    assert.match(r.summary, /线性代数/)
    assert.match(r.summary, /有 1 项任务/)
    assert.equal(r.modules[0].points.find((p) => p.id === 'M1.2').stage, '能跟做')
    assert.equal(r.modules[0].points.find((p) => p.id === 'M1.1').stage, '没接触过')
    assert.equal(r.masterySummary.byStage['能跟做'], 1)
    assert.equal(r.masterySummary.byStage['没接触过'], 1)
    assert.equal(r.masterySummary.touched, 1)

    r = await f.call('study_report', {})
    assert.equal(r.tasks.length, 0, '不传日期就是今天，没人排过')

    await assert.rejects(() => f.call('study_report', { date: '2026/10/03' }), /YYYY-MM-DD/)
  } finally {
    f.done()
  }
})

test('render 是纯文本投影，不吃 args', async () => {
  const f = fresh()
  try {
    const spec = f.specs.find((s) => s.name === 'study_goal')
    const value = await f.call('study_goal', { subject: '概率论', outcome: '能做真题', minutesPerDay: 45 })
    const blocks = spec.output.render({}, value)
    assert.equal(blocks.length, 1)
    assert.equal(blocks[0].type, 'text')
    assert.match(blocks[0].text, /概率论/)
  } finally {
    f.done()
  }
})

/* ── 指引与留言（对话 ↔ 面板之间那根线） ───────────────────────────────── */

test('study_guide：写上去、再清掉', async () => {
  const f = fresh()
  try {
    const on = await f.call('study_guide', { text: '看完第 3 讲回来答三个问题', kind: 'ask' })
    assert.equal(on.text, '看完第 3 讲回来答三个问题')
    const saved = f.store.read('guide')
    assert.equal(saved.text, '看完第 3 讲回来答三个问题')
    assert.equal(saved.kind, 'ask')
    assert.ok(saved.at)
    const off = await f.call('study_guide', { text: '' })
    assert.equal(off.text, '')
    assert.equal(f.store.read('guide').text, '')
  } finally {
    f.done()
  }
})

test('study_inbox：面板留的话能读到、能按 id 标掉', async () => {
  const f = fresh()
  try {
    f.store.update('inbox', (box) => {
      box.items.push({ id: 'm1', text: '这块我看不懂', at: new Date().toISOString(), read: false })
      box.items.push({ id: 'm2', text: '能不能慢点', at: new Date().toISOString(), read: false })
      return box
    })
    const list = await f.call('study_inbox', {})
    assert.equal(list.count, 2)
    assert.equal(list.items[0].text, '这块我看不懂')
    assert.ok(list.summary.includes('这块我看不懂'))

    // 只标掉第一条，第二条还得留着——处理不完时就用这种打法。
    const partial = await f.call('study_inbox', { action: 'read', ids: ['m1'] })
    assert.equal(partial.count, 1)
    const left = await f.call('study_inbox', {})
    assert.equal(left.count, 1)
    assert.equal(left.items[0].id, 'm2')

    const read = await f.call('study_inbox', { action: 'read' })
    assert.equal(read.count, 0, 'read 返回的是动完之后的剩余未读')
    assert.ok(read.summary.includes('处理掉 1 条'))
    assert.equal((await f.call('study_inbox', {})).count, 0)

    await assert.rejects(() => f.call('study_inbox', { action: 'nope' }), /list \/ read/)
  } finally {
    f.done()
  }
})

test('study_report 带上面板指引和未读留言', async () => {
  const f = fresh()
  try {
    await f.call('study_map', { action: 'set', modules: MODULES })
    await f.call('study_guide', { text: '自评完喊我一声' })
    f.store.update('inbox', (box) => {
      box.items.push({ id: 'm2', text: '想换个教材', at: new Date().toISOString(), read: false })
      return box
    })
    const r = await f.call('study_report', {})
    assert.equal(r.guide, '自评完喊我一声')
    assert.equal(r.inboxItems.length, 1)
    assert.equal(r.inboxItems[0].text, '想换个教材')
    assert.ok(r.summary.includes('1 条留言'))
    assert.equal(r.moduleCount, 1)
    assert.equal(r.pointCount, 2)
  } finally {
    f.done()
  }
})

test('study_analysis：通读结论能写能读、章节分批喂、材料删了分析也走', async () => {
  const f = fresh()
  try {
    const mat = await f.call('study_material', {
      action: 'add',
      kind: 'book',
      title: '线性代数辅导讲义',
      path: 'F:\\books\\linalg.pdf',
    })
    const id = mat.materials[0].id
    assert.equal(mat.materials[0].analyzed, false)
    assert.equal(mat.materials[0].chapterCount, 0)

    // 还没分析过时 get 不该炸，得说清楚。
    const empty = await f.call('study_analysis', { action: 'get', materialId: id })
    assert.equal(empty.chapters.length, 0)
    assert.ok(empty.summary.includes('还没分析过'))

    // 第一批：整份材料的定位 + 一章。
    const first = await f.call('study_analysis', {
      action: 'save',
      materialId: id,
      coverage: '部分通读',
      role: '主线讲解，例题够用',
      pairing: '配第 1-3 讲网课一起看',
      chapters: [
        {
          no: '1',
          title: '行列式',
          pages: '1-24',
          topics: '定义与性质',
          examples: '例1-例8',
          exercises: '习题1.1 第1-12题',
          difficulty: '基础',
          role: '打地基',
        },
      ],
    })
    assert.equal(first.chapterCount, 1)
    assert.equal(first.chapters[0].title, '行列式')
    assert.ok(first.summary.includes('部分通读'))

    // 第二批：同 no 覆盖、新 no 追加，没传的字段保留原值。
    const second = await f.call('study_analysis', {
      action: 'save',
      materialId: id,
      chapters: [
        { no: '1', title: '行列式（改过）', difficulty: '中等' },
        {
          no: '2',
          title: '矩阵',
          pages: '25-60',
          exercises: '习题2.1 第1-20题',
          difficulty: '中等',
          role: '计算主力',
        },
      ],
    })
    assert.equal(second.chapterCount, 2)
    assert.equal(second.chapters[0].title, '行列式（改过）')
    assert.equal(second.chapters[0].pages, '1-24', '这一批没传 pages，得保留上一批的')
    assert.equal(second.coverage, '部分通读', '这一批没传 coverage，得保留上一批的')
    assert.equal(second.chapters[1].role, '计算主力')

    // 单章回读。
    const one = await f.call('study_analysis', { action: 'get', materialId: id, chapterNo: '2' })
    assert.equal(one.chapters.length, 1)
    assert.equal(one.chapters[0].no, '2')
    assert.equal(one.chapterCount, 2, 'chapterCount 报的是总数，不是这次返回的条数')
    await assert.rejects(
      () => f.call('study_analysis', { action: 'get', materialId: id, chapterNo: '99' }),
      /没有第 99 章/,
    )

    // 报告里一眼能看出这份读过没有。
    const report = await f.call('study_report', {})
    assert.equal(report.materials[0].analyzed, true)
    assert.equal(report.materials[0].chapterCount, 2)

    // 材料删了，它的分析也一起走，省得以后重新登记时撞上旧结论。
    await f.call('study_material', { action: 'remove', id })
    assert.deepEqual(f.store.read('analysis').byMaterial, {})

    await assert.rejects(() => f.call('study_analysis', { action: 'get', materialId: 'MAT没有这个' }), /没有材料/)
    await assert.rejects(() => f.call('study_analysis', { action: 'save', materialId: id }), /没有材料/)
    await assert.rejects(() => f.call('study_analysis', { action: 'nope', materialId: 'MAT没有这个' }), /没有材料/)
  } finally {
    f.done()
  }
})
