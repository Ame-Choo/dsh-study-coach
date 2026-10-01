/**
 * 多档案（Library）下的 study_plan：任务能排给别的课，不用先 study_library 切过去。
 * 这条线在面板和模型两边都得通，所以单独测一遍——名字写错必须当场报错，
 * 绝对不能顺手新建一份档案出来。
 *
 * 后半段是回收站：删档案是软删，误点「删掉」之后唯一的回头路就是 trash()/restore()。
 * 那里连老格式（没有 manifest 的目录）都得认，不然这次事故里的 87 个知识点就真埋了。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Library } from '../lib/library.js'
import { Store } from '../lib/store.js'
import { createRouter } from '../lib/routes.js'
import { buildTools } from '../lib/tools.js'

const EXEC = { signal: { throwIfAborted() {} } }
const DATE = '2026-10-05'

function fresh() {
  const root = mkdtempSync(join(tmpdir(), 'study-tools-lib-'))
  const store = new Library(root)
  store.ensure()
  store.create({ title: '线性代数', subject: '线性代数', minutesPerDay: 30 })
  const second = store.list().find((p) => p.id !== 'default').id
  store.select('default')
  const specs = buildTools(store, { panelPath: '/study' })
  const byName = new Map(specs.map((s) => [s.name, s]))
  return {
    root,
    store,
    second,
    call: (name, args = {}) => byName.get(name).execute(args, EXEC),
    done: () => rmSync(root, { recursive: true, force: true }),
  }
}

test('study_plan 带 profileId：排给另一门课，不切档案也落得进去', async () => {
  const f = fresh()
  try {
    const out = await f.call('study_plan', { action: 'add', date: DATE, title: '线代：行列式', profileId: f.second, minutes: 20 })
    assert.equal(out.profileId, f.second)
    assert.equal(out.tasks.length, 1)
    assert.match(out.summary, /线代：行列式/)

    // 落在那一门，没落到当前在用的高数上
    const mine = await f.call('study_plan', { action: 'add', date: DATE, title: '高数：看第 3 讲' })
    assert.equal(mine.profileId, '')
    assert.equal(mine.tasks.length, 1)

    const other = f.store.store(f.second).read('tasks')
    assert.deepEqual(other.days[DATE].map((t) => t.title), ['线代：行列式'])

    // 勾掉也认门
    const taskId = other.days[DATE][0].id
    const flipped = await f.call('study_plan', { action: 'toggle', date: DATE, taskId, profileId: f.second })
    assert.equal(flipped.tasks[0].done, true)
    assert.equal(f.store.read('tasks').days[DATE][0].done, false, '高数那条不许被连坐')
  } finally {
    f.done()
  }
})

test('study_plan 的 profileId 写错了要当场报错，别建出一门新档案', async () => {
  const f = fresh()
  try {
    const before = f.store.list().length
    await assert.rejects(
      () => f.call('study_plan', { action: 'add', date: DATE, title: '随便', profileId: '没有这门课' }),
      /没有「没有这门课」这份学习目标/,
    )
    assert.equal(f.store.list().length, before)
    assert.ok(!existsSync(join(f.root, 'profiles', '没有这门课')))
  } finally {
    f.done()
  }
})

test('单档案的根也能用：没有 store() 就照旧落在当前那份上', async () => {
  const root = mkdtempSync(join(tmpdir(), 'study-tools-single-'))
  try {
    const { Store } = await import('../lib/store.js')
    const single = new Store(root)
    single.ensure()
    const specs = buildTools(single, { panelPath: '/study' })
    const plan = specs.find((s) => s.name === 'study_plan')
    const out = await plan.execute({ action: 'add', date: DATE, title: '看第一讲', profileId: '随便写的' }, EXEC)
    assert.equal(out.tasks.length, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

/* ── 回收站：误删的档案得看得见、也能恢复回来 ─────────────────────────── */

/** 一份地图：两个模块三个点，用来验 modules / points 数得对不对。 */
const SAMPLE_MAP = {
  version: 1,
  revision: 1,
  status: 'confirmed',
  confirmedAt: null,
  modules: [
    { id: 'M1', title: '随机事件', points: [{ id: 'M1.1' }, { id: 'M1.2' }] },
    { id: 'M2', title: '随机变量', points: [{ id: 'M2.1' }] },
  ],
}

function freshLib(prefix = 'study-trash-') {
  const root = mkdtempSync(join(tmpdir(), prefix))
  const lib = new Library(root)
  lib.ensure()
  return { root, lib, done: () => rmSync(root, { recursive: true, force: true }) }
}

test('删掉的档案进回收站：trash() 里 id/title/modules/points 都对得上', () => {
  const f = freshLib()
  try {
    const made = f.lib.create({ title: '概率论', subject: '概率论', minutesPerDay: 45 })
    f.lib.store(made.id).write('map', SAMPLE_MAP)
    f.lib.remove(made.id)

    const rows = f.lib.trash()
    assert.equal(rows.length, 1)
    const row = rows[0]
    assert.equal(row.id, made.id)
    assert.equal(row.title, '概率论')
    assert.equal(row.subject, '概率论')
    assert.equal(row.modules, 2)
    assert.equal(row.points, 3)
    assert.ok(row.at, '得有时间')
    assert.ok(existsSync(join(f.root, 'trash', row.entry, 'manifest.json')), 'manifest 得落在条目目录里')
  } finally {
    f.done()
  }
})

test('restore 把档案挪回 profiles 并重新登记，回收站里就没了', () => {
  const f = freshLib()
  try {
    const made = f.lib.create({ title: '英语', subject: '英语', minutesPerDay: 30 })
    f.lib.store(made.id).write('map', SAMPLE_MAP)
    f.lib.remove(made.id)
    const entry = f.lib.trash()[0].entry

    const out = f.lib.restore(entry)
    assert.equal(out.ok, true)
    assert.equal(out.profile.id, made.id)
    assert.ok(existsSync(join(f.root, 'profiles', made.id)))
    assert.ok(f.lib.list().some((p) => p.id === made.id), 'registry 里得重新有它')
    assert.equal(f.lib.trash().length, 0)
    // 内容原样回来，不是新建一份空的
    assert.equal(f.lib.store(made.id).read('profile').goal.subject, '英语')
    assert.equal(f.lib.store(made.id).read('map').modules.length, 2)
    assert.ok(!existsSync(join(f.root, 'profiles', made.id, 'manifest.json')), '纸条别留在档案里')
  } finally {
    f.done()
  }
})

test('目标 id 被占用时 restore 必须拒绝，不许覆盖在用的档案', () => {
  const f = freshLib()
  try {
    const keep = f.lib.create({ title: '高数', subject: '高数', minutesPerDay: 60 })
    const gone = f.lib.create({ title: '线代', subject: '线代', minutesPerDay: 30 })
    f.lib.remove(gone.id)
    const entry = f.lib.trash()[0].entry

    assert.throws(() => f.lib.restore(entry, { id: keep.id }), /已经有一个叫/)
    // 拒绝了就得原地不动：两边都还在
    assert.ok(existsSync(join(f.root, 'trash', entry)))
    assert.ok(existsSync(join(f.root, 'profiles', keep.id)))
    assert.throws(() => f.lib.restore('没有这个条目'), /回收站里没有这个条目/)
  } finally {
    f.done()
  }
})

test('老格式条目（没有 manifest）也能被 trash() 读出来、也能恢复', () => {
  const f = freshLib()
  try {
    const entry = 'old-20260101000000'
    const dir = join(f.root, 'trash', entry)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'profile.json'), JSON.stringify({ version: 1, goal: { subject: '离散数学' } }), 'utf8')
    writeFileSync(join(dir, 'map.json'), JSON.stringify({ modules: [{ id: 'M1', points: [{ id: 'M1.1' }] }] }), 'utf8')

    const rows = f.lib.trash()
    assert.equal(rows.length, 1)
    const row = rows[0]
    assert.equal(row.entry, entry)
    assert.equal(row.id, 'old', 'id 只能靠去掉最后一个 -<时间戳> 猜')
    assert.equal(row.title, '离散数学')
    assert.equal(row.modules, 1)
    assert.equal(row.points, 1)
    assert.ok(row.at)
    assert.ok(!Number.isNaN(Date.parse(row.at)), 'at 得是个能解析的时间')

    const out = f.lib.restore(entry)
    assert.equal(out.profile.id, 'old')
    assert.ok(existsSync(join(f.root, 'profiles', 'old')))
    assert.equal(f.lib.trash().length, 0)
  } finally {
    f.done()
  }
})

test('路由：GET library 带 trash，POST library/restore 能恢复、缺 entry 回 400', () => {
  const f = freshLib('study-trash-route-')
  try {
    const handle = createRouter(f.lib)
    const made = f.lib.create({ title: '数据结构', subject: '数据结构', minutesPerDay: 40 })
    f.lib.remove(made.id)

    const listed = handle({ method: 'GET', pathname: '/study/api/library' })
    assert.equal(listed.code, 200)
    assert.equal(listed.body.trash.length, 1)
    assert.equal(listed.body.trash[0].id, made.id)

    const empty = handle({ method: 'POST', pathname: '/study/api/library/restore', body: {} })
    assert.equal(empty.code, 400)
    assert.match(empty.body.error.message, /entry/)

    const missing = handle({ method: 'POST', pathname: '/study/api/library/restore', body: { entry: '没这个' } })
    assert.equal(missing.code, 400)
    assert.match(missing.body.error.message, /回收站里没有这个条目/)

    const ok = handle({ method: 'POST', pathname: '/study/api/library/restore', body: { entry: listed.body.trash[0].entry } })
    assert.equal(ok.code, 200)
    assert.equal(ok.body.ok, true)
    assert.equal(ok.body.restored.id, made.id)
    assert.ok(ok.body.profiles.some((p) => p.id === made.id))
    assert.ok(Array.isArray(ok.body.trash))
    assert.deepEqual(ok.body.trash, [])
    assert.equal(typeof ok.body.active, 'string')
  } finally {
    f.done()
  }
})

test('路由：拿到没有 trash() 的老 store 时回空回收站，不炸', () => {
  const f = freshLib('study-trash-legacy-')
  try {
    // 老的 Store 只装得下一个档案，这里模拟「有 list/create 但没 trash」的那一版
    const legacy = {
      list: () => f.lib.list(),
      create: (input) => f.lib.create(input),
      activeId: () => f.lib.activeId(),
      snapshot: () => f.lib.snapshot(),
    }
    const handle = createRouter(legacy)
    const listed = handle({ method: 'GET', pathname: '/study/api/library' })
    assert.equal(listed.code, 200)
    assert.equal(listed.body.supported, true)
    assert.deepEqual(listed.body.trash, [])

    const restore = handle({ method: 'POST', pathname: '/study/api/library/restore', body: { entry: 'x' } })
    assert.equal(restore.code, 400)
    assert.match(restore.body.error.message, /不支持恢复/)
  } finally {
    f.done()
  }
})

test('单档案的根（真 Store）：library 那两条照旧不炸', () => {
  const root = mkdtempSync(join(tmpdir(), 'study-trash-single-'))
  try {
    const single = new Store(root)
    single.ensure()
    const handle = createRouter(single)
    const listed = handle({ method: 'GET', pathname: '/study/api/library' })
    assert.equal(listed.code, 200)
    assert.equal(listed.body.supported, false)
    assert.deepEqual(listed.body.trash, [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
