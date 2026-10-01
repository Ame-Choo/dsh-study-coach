/**
 * 「书架」那条链的路由层：登记本机路径 / 网页上传 / 起拆图 / 翻页 / 按单元找页。
 *
 * 这里不真的起 python：拆图那条路把 spawn 注入进来（`deps.spawnBuild`），
 * 测的是「有没有把对的活儿派出去、该拦的拦住」，真正拆 PDF 是 lib/pages.js 的事。
 *
 * 用法：node --test test/shelf.test.js
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Store } from '../lib/store.js'
import { pageFileOf, pagesForPoint, upsertAnalysis } from '../lib/analysis.js'
import { createRouter } from '../lib/routes.js'
import { MANIFEST, pagesDirFor } from '../lib/pages.js'

function fresh() {
  const root = mkdtempSync(join(tmpdir(), 'study-shelf-'))
  const store = new Store(root)
  store.ensure()
  const pagesRoot = join(root, 'pages')
  mkdirSync(pagesRoot, { recursive: true })
  const spawned = []
  const router = createRouter(store, {
    pagesRoot,
    spawnBuild: (script, args) => {
      spawned.push({ script, args })
      return { pid: 4242 }
    },
  })
  return {
    root,
    store,
    pagesRoot,
    spawned,
    call: (method, pathname, body, query = {}) => router({ method, pathname, body, query }),
    done: () => rmSync(root, { recursive: true, force: true }),
  }
}

/** 造一份假的 PDF 文件（只判扩展名和在不在，不解析内容）。 */
function fakePdf(dir, name) {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, name)
  writeFileSync(file, '%PDF-1.4\n')
  return file
}

/** 往档案里塞一份材料 + 一段页级索引。pageDir 用的就是目录算法那个值。 */
function seedBook(f, pdfPath, rows) {
  const material = {
    id: 'mat-1',
    kind: 'book',
    title: '一千题',
    path: pdfPath,
    note: '',
    addedAt: new Date().toISOString(),
  }
  f.store.update('profile', (p) => {
    p.materials = [material]
    return p
  })
  f.store.update('analysis', (a) => {
    upsertAnalysis(a, 'mat-1', {
      coverage: '整本通读',
      pageCount: 20,
      pageDir: pagesDirFor(f.pagesRoot, pdfPath),
      dpi: 110,
      pages: rows,
    })
    return a
  })
  return material
}

test('导入：文件夹先列清单，要整夹登记得显式 all', async (t) => {
  const f = fresh()
  t.after(f.done)
  const dir = join(f.root, '教辅')
  const pdf = fakePdf(dir, '必修一.pdf')
  writeFileSync(join(dir, '笔记.txt'), 'x')
  mkdirSync(join(dir, '子文件夹'))

  const listed = await f.call('POST', '/study/api/materials/import', { path: dir })
  assert.equal(listed.code, 200)
  assert.equal(listed.body.dir, true)
  assert.deepEqual(listed.body.files.map((x) => x.name), ['必修一.pdf'])
  assert.deepEqual(listed.body.dirs.map((x) => x.name), ['子文件夹'])
  assert.equal(listed.body.added, undefined, '只列清单不该偷偷登记')

  const all = await f.call('POST', '/study/api/materials/import', { path: dir, all: true })
  assert.equal(all.body.added.length, 1)
  assert.equal(all.body.added[0].path, pdf)
  assert.equal(all.body.added[0].kind, 'book')
  assert.equal(all.body.added[0].title, '必修一')

  // 同一个夹再导一次不该重复登记。
  const again = await f.call('POST', '/study/api/materials/import', { path: dir, all: true })
  assert.equal(again.body.added.length, 0)
  assert.equal(again.body.skipped, 1)
  assert.equal(f.store.read('profile').materials.length, 1)
})

test('导入：单个文件、路径写错、空路径各有各的说法', async (t) => {
  const f = fresh()
  t.after(f.done)
  const pdf = fakePdf(join(f.root, '书'), '精讲册.pdf')

  const one = await f.call('POST', '/study/api/materials/import', { path: pdf })
  assert.equal(one.code, 200)
  assert.equal(one.body.dir, false)
  assert.equal(one.body.added[0].path, pdf)
  assert.equal(one.body.added[0].title, '精讲册')

  // 路径两边粘了引号也要认。
  const quoted = await f.call('POST', '/study/api/materials/import', { path: `"${fakePdf(join(f.root, '书'), '精练册.pdf')}"` })
  assert.equal(quoted.code, 200)
  assert.match(quoted.body.added[0].path, /精练册\.pdf$/)

  const missing = await f.call('POST', '/study/api/materials/import', { path: join(f.root, '没有这个') })
  assert.equal(missing.code, 400)
  assert.match(missing.body.error.message, /找不到这个路径/)

  const empty = await f.call('POST', '/study/api/materials/import', {})
  assert.match(empty.body.error.message, /path required/)
})

test('空文件夹：整夹登记要报「没有能登记的」', async (t) => {
  const f = fresh()
  t.after(f.done)
  const dir = join(f.root, '空的')
  mkdirSync(dir, { recursive: true })
  const r = await f.call('POST', '/study/api/materials/import', { path: dir, all: true })
  assert.equal(r.code, 400)
  assert.match(r.body.error.message, /没有能登记的东西/)
})

test('网页上传：原件已经落盘，路由只负责登记', async (t) => {
  const f = fresh()
  t.after(f.done)
  const saved = join(f.root, 'uploads', 'up-1', '数学.pdf')
  mkdirSync(join(f.root, 'uploads', 'up-1'), { recursive: true })
  writeFileSync(saved, '%PDF-1.4\n')

  const r = await f.call('POST', '/study/api/material/upload', { savedPath: saved, name: '数学.pdf', size: 9 })
  assert.equal(r.code, 200)
  assert.equal(r.body.added[0].kind, 'book')
  assert.equal(r.body.added[0].title, '数学')
  assert.equal(r.body.size, 9)
  assert.equal(f.store.read('profile').materials.length, 1)

  const nothing = await f.call('POST', '/study/api/material/upload', {})
  assert.match(nothing.body.error.message, /没收到落盘路径/)
})

test('拆图：该拦的拦住，该派出去的派出去', async (t) => {
  const f = fresh()
  t.after(f.done)
  const pdf = fakePdf(join(f.root, '书'), '必修一.pdf')
  seedBook(f, pdf, [])

  assert.match((await f.call('POST', '/study/api/materials/build', {})).body.error.message, /materialId required/)
  assert.match((await f.call('POST', '/study/api/materials/build', { materialId: 'nope' })).body.error.message, /没有这份材料/)

  // 登记了但文件已经不在了。
  f.store.update('profile', (p) => {
    p.materials.push({ id: 'mat-gone', kind: 'book', title: '飘了', path: join(f.root, '没有.pdf') })
    return p
  })
  assert.match((await f.call('POST', '/study/api/materials/build', { materialId: 'mat-gone' })).body.error.message, /文件不在那个位置/)

  // 只拆 PDF。
  const docPath = join(f.root, '讲义.docx')
  writeFileSync(docPath, 'x')
  f.store.update('profile', (p) => {
    p.materials.push({ id: 'mat-doc', kind: 'notes', title: '讲义', path: docPath })
    return p
  })
  assert.match((await f.call('POST', '/study/api/materials/build', { materialId: 'mat-doc' })).body.error.message, /只拆 PDF/)

  const ok = await f.call('POST', '/study/api/materials/build', { materialId: 'mat-1', dpi: 150 })
  assert.equal(ok.code, 200)
  assert.equal(ok.body.started, true)
  assert.equal(ok.body.pid, 4242)
  assert.equal(ok.body.dpi, 150)
  assert.equal(f.spawned.length, 1)
  assert.match(f.spawned[0].script, /build-pages\.mjs$/)
  assert.deepEqual(f.spawned[0].args, [pdf, f.pagesRoot, '150'])

  // dpi 离谱也要夹回 60—220。
  await f.call('POST', '/study/api/materials/build', { materialId: 'mat-1', dpi: 9999 })
  assert.equal(f.spawned[1].args[2], '220')
})

test('拆图：已经在拆的不重复起进程，进度从清单里读', async (t) => {
  const f = fresh()
  t.after(f.done)
  const pdf = fakePdf(join(f.root, '书'), '必修一.pdf')
  seedBook(f, pdf, [])
  const dir = pagesDirFor(f.pagesRoot, pdf)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, MANIFEST),
    JSON.stringify({ dir, total: 120, rendered: 40, rendering: true, scanned: true, at: new Date().toISOString() }),
  )

  const again = await f.call('POST', '/study/api/materials/build', { materialId: 'mat-1' })
  assert.equal(again.body.started, false)
  assert.equal(again.body.running, true)
  assert.equal(again.body.rendered, 40)
  assert.equal(again.body.total, 120)
  assert.equal(f.spawned.length, 0, '已经在拆就别再起一个')

  // 书架上也要看得见这份进度。
  const shelf = await f.call('GET', '/study/api/materials')
  const row = shelf.body.materials.find((m) => m.materialId === 'mat-1')
  assert.equal(row.total, 120)
  assert.equal(row.rendered, 40)
  assert.equal(row.rendering, true)
  assert.equal(row.scanned, true)
})

test('书架 + 单本 + 按单元找页', async (t) => {
  const f = fresh()
  t.after(f.done)
  const pdf = fakePdf(join(f.root, '书'), '必修一.pdf')
  seedBook(f, pdf, [
    { from: 4, to: 6, pointId: 'M1.1', kind: '讲解' },
    { from: 10, to: 17, pointId: 'M1.4', kind: '习题' },
  ])
  // 真落一页图，别的页不落——url 只给真的存在的那页。
  const pageDir = pagesDirFor(f.pagesRoot, pdf)
  mkdirSync(pageDir, { recursive: true })
  writeFileSync(pageFileOf(pageDir, 10), 'PNG')

  const shelf = await f.call('GET', '/study/api/materials')
  const row = shelf.body.materials[0]
  assert.equal(row.title, '一千题')
  assert.equal(row.indexed, 11)
  assert.deepEqual(row.points, ['M1.1', 'M1.4'])
  assert.deepEqual(row.kinds, ['讲解', '习题'])
  assert.equal(row.rendered, 1, '列出实际有多少页图在盘上')

  const one = await f.call('GET', '/study/api/material', {}, { materialId: 'mat-1' })
  assert.equal(one.body.toc.length, 0)
  assert.deepEqual(one.body.spans.map((s) => [s.from, s.to, s.pointId]), [[4, 6, 'M1.1'], [10, 17, 'M1.4']])
  const p10 = one.body.pages.find((p) => p.page === '10')
  assert.match(p10.url, /^\/study\/page\?path=/)
  assert.match(decodeURIComponent(p10.url), /p0010\.png$/)
  const p4 = one.body.pages.find((p) => p.page === '4')
  assert.equal(p4.url, '', '这一页还没拆出来，不给死链')

  assert.match((await f.call('GET', '/study/api/material', {}, {})).body.error.message, /materialId required/)
  assert.match((await f.call('GET', '/study/api/material', {}, { materialId: 'nope' })).body.error.message, /没有这份材料/)

  const hit = await f.call('GET', '/study/api/point/pages', {}, { point: 'M1.4' })
  assert.equal(hit.body.hits.length, 1)
  assert.equal(hit.body.hits[0].material, '一千题')
  assert.equal(hit.body.hits[0].from, '10')
  assert.equal(hit.body.hits[0].to, '17')
  assert.equal(hit.body.hits[0].count, 8)
  assert.equal(hit.body.hits[0].pages.find((p) => p.page === 10).url !== '', true)
  assert.equal(hit.body.hits[0].pages.find((p) => p.page === 11).url, '')
  assert.match((await f.call('GET', '/study/api/point/pages', {}, {})).body.error.message, /point required/)
})

test('pagesForPoint 的分组顺序跟材料登记顺序一致（面板要靠它分「教辅 A / 教辅 B」）', () => {
  const materials = [
    { id: 'a', title: '教辅A', path: 'C:\\a.pdf' },
    { id: 'b', title: '教辅B', path: 'C:\\b.pdf' },
  ]
  const analysis = {
    byMaterial: {
      a: {
        materialId: 'a',
        pages: [
          { page: '3', pointId: 'M1.1', kind: '习题', note: '' },
          { page: '9', pointId: 'M1.1', kind: '习题', note: '' },
        ],
      },
      b: {
        materialId: 'b',
        pages: [
          { page: '1', pointId: 'M1.1', kind: '讲解', note: '' },
          { page: '2', pointId: 'M1.1', kind: '讲解', note: '' },
          { page: '3', pointId: 'M1.1', kind: '讲解', note: '' },
        ],
      },
    },
  }
  const hits = pagesForPoint(analysis, materials, 'M1.1')
  assert.deepEqual(hits.map((h) => h.material), ['教辅A', '教辅A', '教辅B'])
  assert.deepEqual(hits.map((h) => h.from), ['3', '9', '1'])
})

/* ── 知识地图上那颗「看课」：这一节该看哪一讲 ───────────────────────────── */

test('看课：先去资料图谱里找这一讲，找不着才用它自己挂的 video', async () => {
  const f = fresh()
  try {
    // 一门网课：一个文件夹，里面躺着两讲
    const dir = join(f.root, 'course')
    mkdirSync(dir, { recursive: true })
    const one = join(dir, '01.集合的概念.mp4')
    writeFileSync(one, 'x')
    writeFileSync(join(dir, '02.逻辑用语.mp4'), 'x')

    f.store.update('profile', (p) => ({
      ...p,
      materials: [{ id: 'mat-v', kind: 'video', title: '一轮课程', path: dir, note: '' }],
    }))
    f.store.update('map', (m) => ({
      ...m,
      status: 'confirmed',
      modules: [
        {
          id: 'M1',
          title: '第一模块',
          group: '第一块',
          points: [
            { id: 'M1.1', title: '集合的概念', why: '', source: '' },
            { id: 'M1.2', title: '逻辑用语', why: '', source: '', video: 'F:\\课件\\没了.mp4' },
          ],
        },
      ],
    }))

    assert.match((await f.call('GET', '/study/api/point/media', {}, {})).body.error.message, /point required/)

    const hit = await f.call('GET', '/study/api/point/media', {}, { point: 'M1.1' })
    assert.equal(hit.body.ok, true)
    assert.equal(hit.body.title, '集合的概念')
    assert.equal(hit.body.video.kind, 'video')
    assert.equal(hit.body.video.file, one, '讲次名字对上了就开那一讲')
    assert.equal(hit.body.video.material, '一轮课程')
    assert.equal(hit.body.video.materialId, 'mat-v')
    assert.equal(hit.body.video.level, 'unit')
    assert.match(hit.body.video.why, /讲次名字对上了/)
    assert.match(hit.body.video.url, /^\/study\/file\?path=/)

    // 图谱里没有这一节（名字也对不上）：回 null，让面板去问教练
    const miss = await f.call('GET', '/study/api/point/media', {}, { point: 'M9.9' })
    assert.equal(miss.body.video, null)
  } finally {
    f.done()
  }
})
