/**
 * 「拆书」那条链的数据层：页级索引（第几页 → 哪个单元）。
 *
 * 这里测的全是纯函数。真正去动 PDF 的是 lib/pages.js 和 lib/book.js，那两个另测。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'

import {
  analysisOf,
  emptyAnalysis,
  expandSpans,
  outOfRange,
  pageFileOf,
  pageRowsOf,
  pagesForPoint,
  spansOf,
  tocOf,
  upsertAnalysis,
} from '../lib/store.js'

test('expandSpans：区间铺成逐页，pages 逐页来，缺口如实报', () => {
  const { rows, gaps } = expandSpans(
    [
      { from: 2, to: 4, pointId: 'M1.1', kind: '讲解' },
      { pages: [7, 9], pointId: 'M1.4', kind: '例题' },
      { from: 9, pointId: 'M1.4', kind: '习题' },
    ],
    { pageCount: 10 },
  )
  assert.deepEqual(rows.map((r) => r.page), ['2', '3', '4', '7', '9'])
  // 同一页写了两遍，后写的赢。
  assert.equal(rows.at(-1).kind, '习题')
  assert.deepEqual(gaps, [1, 5, 6, 8, 10])
})

test('expandSpans：页码写成字符串、带「第 N 页」也认；分不清的 kind 归「其他」', () => {
  const { rows } = expandSpans([{ from: '第 3 页', to: '4', kind: '瞎写的' }])
  assert.deepEqual(rows.map((r) => [r.page, r.kind]), [['3', '其他'], ['4', '其他']])
})

test('spansOf：相邻、同单元、同类型才合并，断页和换类型都断开', () => {
  const rows = [
    { page: '1', pointId: '', kind: '目录' },
    { page: '2', pointId: '', kind: '目录' },
    { page: '3', pointId: 'M1.1', kind: '讲解' },
    { page: '4', pointId: 'M1.1', kind: '讲解' },
    { page: '5', pointId: 'M1.1', kind: '习题' },
    { page: '7', pointId: 'M1.1', kind: '习题' },
  ]
  assert.deepEqual(
    spansOf(rows).map((s) => [s.from, s.to, s.pointId, s.kind, s.count]),
    [
      ['1', '2', '', '目录', 2],
      ['3', '4', 'M1.1', '讲解', 2],
      ['5', '5', 'M1.1', '习题', 1],
      ['7', '7', 'M1.1', '习题', 1],
    ],
  )
})

test('pageRowsOf：页号不合法就丢，同一页只留一条，按页号排好', () => {
  const rows = pageRowsOf([
    { page: '0' },
    { page: '' },
    null,
    'nope',
    { page: '9', pointId: 'M2.1', kind: '习题' },
    { page: '3', pointId: 'M1.1', kind: '讲解' },
    { page: 3, pointId: 'M1.1', kind: '例题' },
  ])
  assert.deepEqual(rows.map((r) => [r.page, r.kind]), [['3', '例题'], ['9', '习题']])
})

test('outOfRange：超出这本书页数的行挑得出来，页数未知时一律放行', () => {
  assert.deepEqual(outOfRange([{ page: '9' }, { page: '99' }], 20).map((r) => r.page), ['99'])
  assert.deepEqual(outOfRange([{ page: '99' }], 0), [])
})

test('tocOf：没标题的丢，level 认不出算 1，页码抠成纯数字', () => {
  assert.deepEqual(tocOf([{ level: 2, title: '1.1 集合', page: '第 7 页' }, { title: '' }, { title: '第一章' }]), [
    { level: 2, title: '1.1 集合', page: '7', pointId: '' },
    { level: 1, title: '第一章', page: '', pointId: '' },
  ])
})

test('pageFileOf：页码进文件名，补到四位', () => {
  assert.equal(pageFileOf('C:\\a\\pages', 7), join('C:\\a\\pages', 'p0007.png'))
  assert.equal(pageFileOf('/a/pages', '第12页'), join('/a/pages', 'p0012.png'))
  assert.equal(pageFileOf('', 7), '')
})

test('upsertAnalysis：页级索引按页合并，新的盖旧的，resetPages 才清空', () => {
  const a = emptyAnalysis()
  upsertAnalysis(a, 'MAT1', { pageCount: 12, pageDir: '/pages/x', dpi: 110, spans: [{ from: 1, to: 3, kind: '目录' }] })
  assert.equal(analysisOf(a, 'MAT1').pages.length, 3)

  // 第二批复归：第 2 页改判到 M1.1，其余两页保持「目录」不动。
  upsertAnalysis(a, 'MAT1', { spans: [{ from: 2, to: 2, pointId: 'M1.1', kind: '讲解' }] })
  const rows = analysisOf(a, 'MAT1').pages
  assert.deepEqual(rows.map((r) => [r.page, r.kind, r.pointId]), [
    ['1', '目录', ''],
    ['2', '讲解', 'M1.1'],
    ['3', '目录', ''],
  ])
  // 元信息还在：这一批没提 pageDir / dpi / pageCount，不许被抹掉。
  const got = analysisOf(a, 'MAT1')
  assert.equal(got.pageCount, 12)
  assert.equal(got.pageDir, '/pages/x')
  assert.equal(got.dpi, 110)

  upsertAnalysis(a, 'MAT1', { resetPages: true, spans: [{ from: 5, to: 5, pointId: 'M1.9', kind: '习题' }] })
  assert.deepEqual(analysisOf(a, 'MAT1').pages.map((r) => r.page), ['5'])
})

test('upsertAnalysis：toc 给了整份换，不给就留着；章和页两条线互不干扰', () => {
  const a = emptyAnalysis()
  upsertAnalysis(a, 'MAT1', {
    toc: [{ level: 1, title: '第一章 集合与常用逻辑用语', page: '1' }],
    chapters: [{ no: '1', title: '集合' }],
  })
  assert.equal(analysisOf(a, 'MAT1').toc.length, 1)
  assert.equal(analysisOf(a, 'MAT1').chapters.length, 1)

  // 只写章：目录还在。
  upsertAnalysis(a, 'MAT1', { chapters: [{ no: '2', title: '函数' }] })
  assert.equal(analysisOf(a, 'MAT1').toc.length, 1)
  assert.equal(analysisOf(a, 'MAT1').chapters.length, 2)

  // 重新读了一遍目录：整份换掉。
  upsertAnalysis(a, 'MAT1', { toc: [{ level: 1, title: '第一章', page: '1' }, { level: 1, title: '第二章', page: '40' }] })
  assert.equal(analysisOf(a, 'MAT1').toc.length, 2)
})

test('pagesForPoint：一个单元在各份教辅里各占哪几页，按材料登记顺序分组', () => {
  const a = emptyAnalysis()
  upsertAnalysis(a, 'MAT1', { pageCount: 30, spans: [{ from: 4, to: 6, pointId: 'M1.4', kind: '讲解' }] })
  upsertAnalysis(a, 'MAT2', {
    pageCount: 50,
    spans: [
      { from: 10, to: 17, pointId: 'M1.4', kind: '习题' },
      { from: 20, to: 21, pointId: 'M1.4', kind: '例题' },
      { from: 30, to: 40, pointId: 'M2.1', kind: '讲解' },
    ],
  })
  const hits = pagesForPoint(a, [{ id: 'MAT1', title: '必修一' }, { id: 'MAT2', title: '一千题' }, { id: 'MAT3', title: '没录过' }], 'M1.4')
  assert.deepEqual(hits.map((h) => [h.material, h.from, h.to, h.pageKind, h.count]), [
    ['必修一', '4', '6', '讲解', 3],
    ['一千题', '10', '17', '习题', 8],
    ['一千题', '20', '21', '例题', 2],
  ])
  assert.deepEqual(pagesForPoint(a, [{ id: 'MAT1' }], ''), [])
  assert.deepEqual(pagesForPoint(a, [], 'M1.4'), [])
})
