/**
 * 「教辅拆到页」那一截：analysis 里 chapter.marks 写对了，做题页才给得出一排页码按钮。
 *
 * 这一条链子（marks → marksFor → pageHits → #page=N）最容易断在「marks 没给 pointId」上，
 * 所以专门盯住：pointId 对的才算、label 对不上的不能混进来、页码要从小到大。
 */
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Library } from '../lib/library.js'
import { createRouter } from '../lib/routes.js'
import { emptyMap, emptyProfile } from '../lib/store.js'

const root = mkdtempSync(join(tmpdir(), 'study-pagemarks-'))
const store = new Library(root)
store.ensure()

const LECTURE = 'F:\\示例资料\\线性代数讲义\\1.1 行列式的定义.pdf'
const OTHER = 'F:\\示例资料\\线性代数讲义\\2.1 矩阵的运算.pdf'

const profile = emptyProfile()
profile.materials = [
  { id: 'mat-lecture', kind: 'notes', title: '线性代数讲义', path: 'F:\\示例资料\\线性代数讲义' },
]
store.write('profile', profile)

const map = emptyMap()
map.status = 'confirmed'
map.modules = [
  {
    id: 'M1',
    group: '线性代数',
    title: '行列式',
    points: [
      { id: 'M1.1', title: '行列式的定义与几何意义', source: '讲义 1.1 行列式的定义', practice: LECTURE },
      { id: 'M1.4', title: '带参数的行列式讨论与反求参数', source: '讲义 1.1 行列式的定义', practice: LECTURE },
      { id: 'M1.9', title: '这一节手里没有页码', source: '讲义 1.1 行列式的定义', practice: LECTURE },
    ],
  },
  {
    id: 'M2',
    group: '线性代数',
    title: '矩阵',
    points: [{ id: 'M2.1', title: '矩阵的基本运算', source: '讲义 2.1 矩阵的运算', practice: OTHER }],
  },
]
store.write('map', map)

store.write('analysis', {
  version: 1,
  byMaterial: {
    'mat-lecture': {
      materialId: 'mat-lecture',
      title: '线性代数讲义',
      coverage: '部分通读',
      chapters: [
        {
          no: '1.1',
          title: '行列式',
          pages: '1-16',
          file: LECTURE,
          // 故意乱序写，看服务端会不会替学生排好
          marks: [
            { label: '带参数：按行列展开反求参数（第九组）', page: '4', pointId: 'M1.4' },
            { label: '知识框架：行列式的定义、几何意义', page: '1', pointId: 'M1.1' },
            { label: '带参数：行列式为零反求参数范围', page: '11', pointId: 'M1.4' },
            { label: '基本例题：二阶与三阶行列式的计算', page: '2', pointId: 'M1.1' },
            { label: '写错了 pointId，不该借给别人', page: '9', pointId: 'M9.9' },
          ],
        },
        {
          no: '2.1',
          title: '矩阵的运算',
          pages: '1-12',
          file: OTHER,
          marks: [{ label: '矩阵的基本运算与转置性质', page: '2' }],
        },
      ],
    },
  },
})

after(() => rmSync(root, { recursive: true, force: true }))

const route = createRouter(store, {})
const practice = (point) => route({ method: 'GET', pathname: '/study/api/practice', query: { point } }).body

test('marks 写对了，做题页就给得出页码，而且按页码排好', () => {
  const one = practice('M1.1')
  assert.equal(one.pageHits.length, 2)
  assert.deepEqual(one.pageHits.map((h) => h.page), ['1', '2'], '页码得从小到大，不能按 marks 的书写顺序')
  assert.equal(one.pageHits[0].label, '知识框架：行列式的定义、几何意义')
  assert.equal(one.pageHits[0].file, LECTURE, '页码要带上文件，前端才知道翻哪一份')
  assert.equal(one.pageHits[0].materialId, 'mat-lecture')
  assert.equal(one.pageHits[0].no, '1.1')
  assert.equal(one.pageHits[0].title, '行列式')

  const four = practice('M1.4')
  assert.deepEqual(four.pageHits.map((h) => h.page), ['4', '11'])

  // 别人的 marks 不能跟着过来
  assert.ok(!four.pageHits.some((h) => h.page === '9'))
  assert.ok(!four.pageHits.some((h) => h.pointId))

  // pointId 认不出来、label 也对不上（不到三字/不含标题）→ 一条都不给，而不是随便塞一张
  assert.deepEqual(practice('M1.9').pageHits, [])

  // 没给 pointId 的 marks 靠 label 与知识点标题互含来兜底，但只有一条能对上
  const two = practice('M2.1')
  assert.equal(two.chapters[0].no, '2.1')
  assert.deepEqual(two.pageHits.map((h) => h.page), ['2'])
})

test('材料那一栏看得出「拆到页」拆了多少', () => {
  const body = route({ method: 'GET', pathname: '/study/api/state' }).body
  const mat = body.state.profile.materials.find((m) => m.id === 'mat-lecture')
  assert.equal(mat.analyzed, true)
  assert.equal(mat.chapterCount, 2)
  assert.equal(mat.pagedCount, 2, '两份章都有 marks，pagedCount 就该是 2')
  assert.equal(mat.coverage, '部分通读')

  const p = practice('M1.1')
  assert.equal(p.materials[0].chapterCount, 2)
  assert.equal(p.materials[0].pagedCount, 2)
})
