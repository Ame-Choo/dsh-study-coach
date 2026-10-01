/**
 * study_book：拆一本教辅、查一个单元在各教辅里的页。
 *
 * 真拆 PDF 是 lib/pages.js 的事，这里把 bookInfo / spawnBuild 注入进来，
 * 测的是「该拦的拦住、该派的活派对了、返回值够不够 agent 用」。
 *
 * 用法：node --test test/booktool.test.js
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Store } from '../lib/store.js'
import { pageFileOf, upsertAnalysis } from '../lib/analysis.js'
import { buildTools } from '../lib/tools.js'
import { MANIFEST, pagesDirFor } from '../lib/pages.js'

function fresh(over = {}) {
  const root = mkdtempSync(join(tmpdir(), 'study-booktool-'))
  const store = new Store(root)
  store.ensure()
  const pagesRoot = join(root, 'pages')
  mkdirSync(pagesRoot, { recursive: true })
  const spawned = []
  const specs = buildTools(store, {
    panel: { path: '/study' },
    pagesRoot,
    bookInfo: () =>
      over.bookInfo ?? { ok: true, total: 164, toc: [], title: '', probe: [], scanned: true, pdf: 'x' },
    spawnBuild: (script, argv) => {
      spawned.push({ script, argv })
      return { pid: 777, unref() {} }
    },
  })
  const byName = new Map(specs.map((s) => [s.name, s]))
  return {
    root,
    store,
    pagesRoot,
    spawned,
    run: (name, args) => byName.get(name).execute(args, { signal: { throwIfAborted() {} } }),
    done: () => rmSync(root, { recursive: true, force: true }),
  }
}

function registerBook(f, title, pdfPath) {
  const id = `MAT-${f.store.read('profile').materials.length + 1}`
  f.store.update('profile', (p) => {
    p.materials.push({ id, kind: 'book', title, path: pdfPath, note: '', addedAt: new Date().toISOString() })
    return p
  })
  return id
}

function fakePdf(f, name) {
  const file = join(f.root, name)
  writeFileSync(file, '%PDF-1.4\n')
  return file
}

test('study_book info：读页数、写进分析、说清是不是扫描件', async (t) => {
  const f = fresh()
  t.after(f.done)
  const pdf = fakePdf(f, '必修一.pdf')
  const id = registerBook(f, '必修一', pdf)

  const r = await f.run('study_book', { materialId: id })
  assert.equal(r.ok, true)
  assert.equal(r.total, 164)
  assert.equal(r.scanned, true)
  assert.equal(r.tocCount, 0)
  assert.equal(r.rendered, 0)
  assert.equal(r.rendering, false)
  assert.match(r.summary, /164 页/)
  assert.match(r.summary, /扫描件/)
  assert.match(r.summary, /没有书签/)
  assert.match(r.summary, /action=build/)

  // 页数写进分析了，面板和别的工具都读得到。
  const a = f.store.read('analysis').byMaterial[id]
  assert.equal(a.pageCount, 164)
  assert.equal(a.pageDir, pagesDirFor(f.pagesRoot, pdf))
  assert.equal(a.coverage, '只翻目录', '没通读就不该假装通读过')
})

test('study_book info：书签会顺手写进目录，有文字层就直说', async (t) => {
  const f = fresh({
    bookInfo: {
      ok: true,
      total: 88,
      toc: [{ level: 1, title: '第一章 集合', page: 1 }, { level: 2, title: '1.1 集合的概念', page: 3 }],
      title: '精讲册',
      probe: [{ page: 1, chars: 900 }],
      scanned: false,
      pdf: 'x',
    },
  })
  t.after(f.done)
  const pdf = fakePdf(f, '精讲册.pdf')
  const id = registerBook(f, '精讲册', pdf)

  const r = await f.run('study_book', { materialId: id })
  assert.equal(r.scanned, false)
  assert.equal(r.tocCount, 2)
  assert.deepEqual(r.toc.map((x) => [x.level, x.title, x.page]), [[1, '第一章 集合', 1], [2, '1.1 集合的概念', 3]])
  assert.match(r.summary, /有文字层|书签 2 条/)
  assert.equal(f.store.read('analysis').byMaterial[id].toc.length, 2)
})

test('study_book build：起后台进程、dpi 夹回去、正在拆就不重复起', async (t) => {
  const f = fresh()
  t.after(f.done)
  const pdf = fakePdf(f, '必修一.pdf')
  const id = registerBook(f, '必修一', pdf)

  const r = await f.run('study_book', { action: 'build', materialId: id, dpi: 9999 })
  assert.equal(r.ok, true)
  assert.equal(r.rendering, true)
  assert.equal(r.pid, 777)
  assert.match(r.summary, /别在这儿等/)
  assert.equal(f.spawned.length, 1)
  assert.match(f.spawned[0].script, /build-pages\.mjs$/)
  assert.deepEqual(f.spawned[0].argv, [pdf, f.pagesRoot, '220'], 'dpi 要夹到 220')

  // 造一份「正在拆」的清单，再调一次不该又起一个进程。
  const dir = pagesDirFor(f.pagesRoot, pdf)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, MANIFEST), JSON.stringify({
    dir, total: 164, rendered: 40, rendering: true, scanned: true, at: new Date().toISOString(),
  }))
  const again = await f.run('study_book', { action: 'build', materialId: id })
  assert.equal(again.rendering, true)
  assert.equal(again.rendered, 40)
  assert.equal(again.total, 164)
  assert.equal(f.spawned.length, 1, '已经在拆就别再起一个')
  assert.match(again.summary, /已经在拆/)

  // 十分钟没动过就当它没在跑（进程被 kill 会永远停在 rendering:true）。
  writeFileSync(join(dir, MANIFEST), JSON.stringify({
    dir, total: 164, rendered: 40, rendering: true, scanned: true, at: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
  }))
  await f.run('study_book', { action: 'build', materialId: id })
  assert.equal(f.spawned.length, 2, '十分钟没动过就该重起')
})

test('study_book：路径不对各有各的说法', async (t) => {
  const f = fresh()
  t.after(f.done)
  const pdf = fakePdf(f, '必修一.pdf')
  const id = registerBook(f, '必修一', pdf)
  writeFileSync(join(f.root, '讲义.docx'), 'x')
  const docId = registerBook(f, '讲义', join(f.root, '讲义.docx'))

  await assert.rejects(() => f.run('study_book', {}), /materialId 和 pdfPath 至少给一个/)
  await assert.rejects(() => f.run('study_book', { materialId: 'nope' }), /没有材料「nope」/)
  await assert.rejects(() => f.run('study_book', { materialId: docId }), /只认 PDF/)
  await assert.rejects(() => f.run('study_book', { pdfPath: join(f.root, '没有.pdf') }), /这份文件不在/)
  await assert.rejects(() => f.run('study_book', { materialId: id, action: 'nope' }), /action 只能是 info \/ build \/ pages/)
  await assert.rejects(() => f.run('study_book', { action: 'pages' }), /要带 pointId/)
})

test('study_book pages：一个单元在两本教辅里各占哪几页，直接给出能点开的地址', async (t) => {
  const f = fresh()
  t.after(f.done)
  const a = fakePdf(f, '必修一.pdf')
  const b = fakePdf(f, '一千题.pdf')
  const idA = registerBook(f, '必修一', a)
  const idB = registerBook(f, '一千题', b)

  const dirA = pagesDirFor(f.pagesRoot, a)
  const dirB = pagesDirFor(f.pagesRoot, b)
  mkdirSync(dirA, { recursive: true })
  mkdirSync(dirB, { recursive: true })
  writeFileSync(pageFileOf(dirA, 4), 'PNG')
  writeFileSync(pageFileOf(dirB, 12), 'PNG')

  f.store.update('analysis', (an) => {
    upsertAnalysis(an, idA, { pageCount: 20, pageDir: dirA, pages: [{ from: 4, to: 6, pointId: 'M1.4', kind: '讲解' }] })
    upsertAnalysis(an, idB, { pageCount: 30, pageDir: dirB, pages: [{ from: 12, to: 12, pointId: 'M1.4', kind: '习题' }] })
    return an
  })

  const r = await f.run('study_book', { action: 'pages', pointId: 'M1.4' })
  assert.equal(r.ok, true)
  assert.equal(r.hits.length, 2)
  assert.deepEqual(r.hits.map((h) => [h.material, h.from, h.to, h.pageKind]), [
    ['必修一', 4, 6, '讲解'],
    ['一千题', 12, 12, '习题'],
  ])
  const p4 = r.hits[0].pages.find((p) => p.page === 4)
  assert.match(p4.url, /^\/study\/page\?path=/)
  assert.match(decodeURIComponent(p4.url), /p0004\.png$/)
  assert.equal(r.hits[0].pages.find((p) => p.page === 5).url, '', '没拆出来的页不给死链')
  assert.match(r.summary, /必修一 4—6 页（讲解）/)
  assert.match(r.summary, /一千题 12—12 页（习题）/)

  const none = await f.run('study_book', { action: 'pages', pointId: 'M9.9' })
  assert.equal(none.hits.length, 0)
  assert.match(none.summary, /没有哪份教辅把 M9.9 归过页/)
})

test('study_analysis save 写区间，读回来是合并好的区间 + 还没归的页', async (t) => {
  const f = fresh()
  t.after(f.done)
  const pdf = fakePdf(f, '必修一.pdf')
  const id = registerBook(f, '必修一', pdf)
  f.store.update('analysis', (an) => {
    upsertAnalysis(an, id, { pageCount: 12, pageDir: pagesDirFor(f.pagesRoot, pdf) })
    return an
  })

  const r = await f.run('study_analysis', {
    action: 'save',
    materialId: id,
    spans: [
      { from: 1, to: 3, pointId: 'M1.1', kind: '讲解' },
      { from: 4, to: 5, pointId: 'M1.1', kind: '讲解' },
      { from: 6, to: 7, pointId: 'M1.4', kind: '例题' },
    ],
  })
  assert.equal(r.indexed, 7)
  assert.deepEqual(r.spans.map((s) => [s.from, s.to, s.pointId, s.kind, s.count]), [
    [1, 5, 'M1.1', '讲解', 5],
    [6, 7, 'M1.4', '例题', 2],
  ], '相邻同单元同类型要合并成一段')
  assert.equal(r.gaps, '8, 9, 10, 11, 12', '还没归的页要如实报出来')

  // 补上剩下的，gaps 该空。
  const r2 = await f.run('study_analysis', { action: 'save', materialId: id, spans: [{ from: 8, to: 12, pointId: 'M1.4', kind: '习题' }] })
  assert.equal(r2.indexed, 12)
  assert.equal(r2.gaps, '')

  const got = await f.run('study_analysis', { action: 'get', materialId: id })
  assert.equal(got.pageCount, 12)
  assert.equal(got.indexed, 12)
  assert.deepEqual(got.spans.map((s) => [s.from, s.to]), [[1, 5], [6, 7], [8, 12]])
})
