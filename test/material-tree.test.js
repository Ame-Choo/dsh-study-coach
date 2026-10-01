/**
 * 「资料图谱」的骨架（`lib/material-tree.js`）：一份材料**自己**的目录摊成三层。
 *
 * 这里只测形状，不测渲染——面板怎么画是 test/panel.test.js 的事。两条路各测各的：
 *   · 书本走 toc / 页级索引（大类 = level 1、模块 = level 2、单元 = 落在这一段里的页）；
 *   · 文件夹走真目录（有子目录就以子目录当模块，没有就切目录名）。
 *
 * `list` 是注入进来的：给一份假目录清单，就不必在 tmp 里造几十层真文件夹。
 *
 * 用法：node --test test/material-tree.test.js
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { agentTree, bookTree, fileKind, folderTree, materialTree, mediaKindOf, mediaTargetOf, splitFolderName, stripIndex, videoForPoint, MAX_UNITS } from '../lib/material-tree.js'

/** 造一棵假的目录清单：`list('/root')` → 里面有什么。 */
function fakeList(shape) {
  // 夹具里的根写的是 Windows 路径（`F:\课件`），而 `join()` 按当前平台拼子路径：
  // 在 Linux 上拼出来是 `F:\课件/02.模块…`。两边都归一成 `/` 再查表，
  // 同一份夹具在哪个平台上都对得上（这份清单本来就是假的，不落盘）。
  const key = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '')
  const kidsOf = (dir) => {
    const want = key(dir)
    for (const [k, v] of Object.entries(shape)) if (key(k) === want) return v
    return []
  }
  return (dir) => kidsOf(dir).map((k) => ({ name: k.name, dir: Boolean(k.dir), path: join(dir, k.name) }))
}

/** 一份假目录：`{ '/root': [ {name, dir} ] }`，直接喂给 `fakeList`。 */

test('目录名开头那截编号剥掉，剩下的切两截', () => {
  assert.equal(stripIndex('02.模块一 基础知识 集合'), '模块一 基础知识 集合')
  assert.equal(stripIndex('第4讲 函数'), '函数')
  assert.equal(stripIndex('3、二次函数'), '二次函数')

  assert.deepEqual(splitFolderName('02.模块一 基础知识 集合'), { group: '模块一 基础知识', module: '集合' })
  assert.deepEqual(splitFolderName('01.试听课'), { group: '试听课', module: '' }, '切不出三截就只给大类，别硬凑')
  assert.deepEqual(splitFolderName('  '), { group: '', module: '' })

  assert.equal(fileKind('01.试听课.mp4'), 'video')
  assert.equal(fileKind('必修一.pdf'), 'book')
  assert.equal(fileKind('随堂小测.md'), 'notes')
  assert.equal(fileKind('讲义.docx'), 'notes')
  assert.equal(fileKind('截图.png'), 'other')
})

test('文件夹：子目录当模块，视频按扩展名认，同名大类合并', () => {
  const shape = {
    'F:\\课件': [
      { name: '02.模块一 基础知识 集合', dir: true },
      { name: '03.模块一 基础知识 逻辑', dir: true },
      { name: '04.模块二 不等式 不等式基础', dir: true },
      { name: '00.说明.txt' },
    ],
  }
  shape['F:\\课件\\02.模块一 基础知识 集合'] = [
    { name: '04.基础知识&基本例题.mp4' },
    { name: '05.题型1：集合间的基本关系.mp4' },
  ]
  shape['F:\\课件\\03.模块一 基础知识 逻辑'] = [{ name: '06.逻辑基础.mp4' }]
  shape['F:\\课件\\04.模块二 不等式 不等式基础'] = [{ name: '12.不等式基础.mp4' }]

  const tree = folderTree('F:\\课件', { list: fakeList(shape) })
  assert.equal(tree.basis, 'folder')
  assert.equal(tree.truncated, false)
  assert.deepEqual(tree.groups.map((g) => g.title), ['模块一 基础知识', '模块二 不等式', '（根目录）'])

  const first = tree.groups.find((g) => g.title === '模块一 基础知识')
  assert.equal(first.count, 3)
  assert.deepEqual(first.modules.map((m) => m.title), ['集合', '逻辑'])
  assert.equal(first.modules[0].units[0].title, '04.基础知识&基本例题.mp4')
  assert.equal(first.modules[0].units[0].kind, 'video')
  assert.match(first.modules[0].units[0].url, /^\/study\/file\?path=/)

  // 根目录下散着的文件单开一块，别塞进某个大类
  const root = tree.groups.find((g) => g.title === '（根目录）')
  assert.equal(root.modules.length, 0)
  assert.equal(root.units[0].kind, 'notes')
})

test('文件夹：有子目录就一层套一层，文件跟在大类下面', () => {
  const shape = {
    'F:\\课件': [
      { name: '05.模块三 函数', dir: true },
      { name: '02.试听课', dir: false },
    ],
  }
  shape['F:\\课件\\05.模块三 函数'] = [
    { name: '00.本模块说明.mp4' },
    { name: '函数基础', dir: true },
  ]
  shape['F:\\课件\\05.模块三 函数\\函数基础'] = [{ name: '01.函数是什么.mp4' }]

  const tree = folderTree('F:\\课件', { list: fakeList(shape) })
  const group = tree.groups.find((g) => g.title === '模块三 函数')
  // 大类下面直接挂着的那个文件
  assert.equal(group.units[0].title, '00.本模块说明.mp4')
  assert.deepEqual(group.modules.map((m) => m.title), ['函数基础'])
  assert.equal(group.modules[0].units[0].title, '01.函数是什么.mp4')
})

test('文件夹：超过上限就截断，别让几百集把响应撑爆', () => {
  const files = Array.from({ length: MAX_UNITS + 20 }, (_, i) => ({ name: `第${i + 1}讲.mp4` }))
  const shape = { 'F:\\课件': [{ name: '01.模块一 集合', dir: true }], 'F:\\课件\\01.模块一 集合': files }
  const tree = folderTree('F:\\课件', { list: fakeList(shape) })
  assert.equal(tree.truncated, true)
  assert.equal(tree.groups[0].count, MAX_UNITS)
})

test('书：目录两级 + 页级索引落到模块里，页码、链接、页图都配齐', () => {
  const root = mkdtempSync(join(tmpdir(), 'study-tree-'))
  try {
    const pageDir = join(root, 'pages')
    mkdirSync(pageDir, { recursive: true })
    writeFileSync(join(pageDir, 'p0010.png'), 'PNG')

    const tree = bookTree({
      material: { title: '必修一', path: 'F:\\课件\\必修一.pdf' },
      shelf: {
        pageDir,
        total: 40,
        toc: [
          { level: 1, title: '专题一 集合', page: 10, pointId: '' },
          { level: 2, title: '1.1 集合', page: 10, pointId: 'M1.1' },
          { level: 2, title: '1.2 逻辑', page: 14, pointId: '' },
          { level: 1, title: '专题二 不等式', page: 20, pointId: '' },
          { level: 2, title: '2.1 不等式', page: 20, pointId: 'M2.1' },
        ],
      },
      spans: [
        { from: 1, to: 8, pointId: '', kind: '目录', note: '封面、编者页、目录' },
        { from: 10, to: 13, pointId: 'M1.1', kind: '讲解', note: '集合的概念与表示；元素与集合的关系' },
        { from: 14, to: 19, pointId: 'M1.2', kind: '习题', note: '' },
        { from: 20, to: 24, pointId: 'M2.1', kind: '讲解', note: '' },
      ],
      total: 40,
    })

    assert.equal(tree.basis, 'toc')
    assert.deepEqual(tree.groups.map((g) => g.title), ['专题一 集合', '专题二 不等式'])
    const first = tree.groups[0]
    // 页码是模块自己的范围：从 1.1 那页起，到下一个模块前一页
    assert.equal(first.page, 10)
    assert.equal(first.to, 19)
    assert.deepEqual(first.modules.map((m) => m.title), ['1.1 集合', '1.2 逻辑'])
    assert.equal(first.modules[0].page, 10)
    assert.equal(first.modules[0].to, 13)
    assert.equal(first.modules[0].pointId, 'M1.1')

    // 目录只到两级：模块自己就是最小单元（leaf），不再拿整专题的 spans 硬凑一层。
    // 旧写法把「和模块页范围有交叠的 span」当单元，于是同一句话被抄进该专题每个模块，
    // 单元 id 还跟模块名对不上（真数据里 1.2 常用逻辑用语 那行显示的是 M1.1）。
    const leaf = first.modules[0]
    assert.equal(leaf.leaf, true)
    assert.deepEqual(leaf.units, [], '目录没有第三级就不许再造一层')
    assert.equal(leaf.pointId, 'M1.1')
    assert.equal(leaf.page, 10)
    assert.equal(leaf.to, 13)
    assert.equal(leaf.title, '1.1 集合')
    assert.match(leaf.url, /%E5%BF%85%E4%BF%AE%E4%B8%80\.pdf#page=10$/)
    // 第 10 页的图拆出来了，其余没拆：只有它带 url
    assert.deepEqual(leaf.pages[0], { page: 10, url: '/study/page?path=' + encodeURIComponent(join(pageDir, 'p0010.png')) })
    assert.equal(leaf.pages[1].url, '')
    assert.equal(leaf.note, '', '说明不再从整专题那条 span 上抄')

    // 谁都没归到的页（封面、目录…）单开一块
    assert.equal(tree.loose.length, 1)
    assert.equal(tree.loose[0].kind, '目录')
    assert.equal(tree.loose[0].title, '目录')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('书：目录里只有一级条目时，整体当一个板块，别空着', () => {
  const tree = bookTree({
    material: { title: '必修二', path: 'F:\\课件\\必修二.pdf' },
    shelf: { pageDir: '', total: 30, toc: [{ level: 1, title: '第一章 数列', page: 5, pointId: '' }] },
    spans: [{ from: 5, to: 12, pointId: 'M1.1', kind: '讲解', note: '' }],
    total: 30,
  })
  assert.equal(tree.basis, 'toc')
  assert.equal(tree.groups.length, 1)
  // 一级条目自己顶成模块；目录没有第三级，它就是 leaf
  assert.equal(tree.groups[0].modules[0].title, '第一章 数列')
  assert.equal(tree.groups[0].modules[0].leaf, true)
  assert.deepEqual(tree.groups[0].modules[0].units, [])
})

test('书：目录压根没读过就退成「一份材料 + 一段一段的页级索引」', () => {
  const tree = bookTree({
    material: { title: '答案精析册', path: 'F:\\课件\\答案.pdf' },
    shelf: { pageDir: '', total: 200, toc: [] },
    spans: [
      { from: 1, to: 2, pointId: '', kind: '讲解', note: '精讲册 1.1 的答案' },
      { from: 3, to: 3, pointId: 'M1.2', kind: '答案', note: '' },
    ],
    total: 200,
  })
  assert.equal(tree.basis, 'spans')
  assert.equal(tree.groups.length, 1)
  assert.equal(tree.groups[0].title, '答案精析册')
  assert.equal(tree.groups[0].modules[0].title, '全部')
  assert.deepEqual(tree.groups[0].modules[0].units.map((u) => u.kind), ['讲解', '答案'])
  // 没挂上单元的那条：标题退回「内容类型」，页面上一眼看得出它还没归位
  assert.equal(tree.groups[0].modules[0].units[0].title, '讲解')

  const empty = bookTree({ material: { title: '空册', path: 'F:\\课件\\空.pdf' }, shelf: { toc: [] }, spans: [], total: 0 })
  assert.equal(empty.basis, 'none')
  assert.deepEqual(empty.groups[0].modules, [])
})

test('entry：路径是文件夹走文件夹那一套，是文件走书那一套', () => {
  const root = mkdtempSync(join(tmpdir(), 'study-tree-entry-'))
  try {
    const dir = join(root, '一轮课程')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, '01.试听课.mp4'), 'x')
    writeFileSync(join(root, '必修一.pdf'), 'x')

    const asDir = materialTree({ material: { title: '一轮课程', path: dir }, shelf: {}, list: fakeList({
      [dir]: [{ name: '01.试听课.mp4' }],
    }) })
    assert.equal(asDir.basis, 'folder')
    assert.equal(asDir.groups[0].units[0].kind, 'video')

    const asFile = materialTree({
      material: { title: '必修一', path: join(root, '必修一.pdf') },
      shelf: { toc: [{ level: 1, title: '第一章', page: 1 }], total: 2 },
      spans: [{ from: 1, to: 2, pointId: 'M1.1', kind: '讲解', note: '' }],
    })
    assert.equal(asFile.basis, 'toc')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('书：目录写到第三级时，最小单元就是那一条，模块不再算 leaf', () => {
  const tree = bookTree({
    material: { title: '方法册', path: 'F:\\课件\\方法册.pdf' },
    shelf: {
      pageDir: '',
      total: 60,
      toc: [
        { level: 1, title: '专题一 集合', page: 10, pointId: '' },
        { level: 2, title: '1.1 集合', page: 10, pointId: 'M1.1' },
        { level: 3, title: '1.1.1 集合的概念', page: 10, pointId: 'M1.1' },
        { level: 3, title: '1.1.2 元素与集合', page: 13, pointId: 'M1.1' },
        { level: 2, title: '1.2 逻辑', page: 20, pointId: 'M1.4' },
      ],
    },
    // 页级索引还是「整专题一条」的老样子：它是兜底，不许再往上顶成单元
    spans: [{ from: 10, to: 19, pointId: 'M1.1', kind: '讲解', note: '整专题一句话' }],
    total: 60,
  })

  assert.equal(tree.basis, 'toc')
  const first = tree.groups[0].modules[0]
  assert.equal(first.leaf, false)
  assert.deepEqual(first.units.map((u) => u.title), ['1.1.1 集合的概念', '1.1.2 元素与集合'])
  assert.equal(first.units[0].from, 10)
  assert.equal(first.units[0].to, 12, '到下一个三级条目前一页')
  assert.equal(first.units[1].from, 13)
  assert.equal(first.units[1].to, 19)
  assert.equal(first.units[0].kind, '讲解', '三级条目没写类型时按讲解算')
  assert.equal(first.units[0].note, '', '三级条目的说明只认它自己，不从整专题那条 span 上抄')
  // 第二个模块目录里没有三级条目：它自己就是最小单元
  assert.equal(tree.groups[0].modules[1].leaf, true)
  assert.deepEqual(tree.groups[0].modules[1].units, [])
})

test('教练写下来的三层优先：页码缺了按兄弟顺序推，模块没写单元就是 leaf', () => {
  const tree = agentTree({
    material: { title: '一轮课程', path: 'F:\\课件\\一轮课程' },
    shelf: { total: 0 },
    tree: [
      {
        title: '模块一 基础知识',
        modules: [
          { title: '集合', pointId: 'M1.1', units: [{ title: '集合的概念', pointId: 'M1.1', page: 3, note: '一句话' }] },
          { title: '逻辑' },
        ],
      },
    ],
  })

  assert.equal(tree.basis, 'agent')
  const g = tree.groups[0]
  assert.equal(g.title, '模块一 基础知识')
  assert.equal(g.count, 2, 'leaf 模块也算一条内容')

  const [m1, m2] = g.modules
  assert.equal(m1.leaf, false)
  assert.equal(m1.units[0].title, '集合的概念', '名字用它自己的标题（人话），不拿 id 顶')
  assert.equal(m1.units[0].pointId, 'M1.1', '挂到哪个单元另存一个字段，面板会单挂一枚筹码')
  assert.equal(m1.units[0].from, 3)
  assert.equal(m1.units[0].to, 3)
  assert.equal(m1.units[0].note, '一句话')
  assert.equal(m2.title, '逻辑')
  assert.equal(m2.leaf, true)
  assert.deepEqual(m2.units, [])
})

test('入口：教练写过就用他写的，没写过才按目录摊', () => {
  const shelf = { toc: [{ level: 1, title: '第一章 集合', page: 1 }], total: 2 }
  const wrote = materialTree({
    material: { title: '必修一', path: 'F:\\课件\\必修一.pdf' },
    shelf,
    tree: [{ title: '第一章 集合', modules: [{ title: '1.1 集合', pointId: 'M1.1' }] }],
  })
  assert.equal(wrote.basis, 'agent')
  assert.equal(wrote.groups[0].modules[0].title, '1.1 集合')

  const auto = materialTree({
    material: { title: '必修一', path: 'F:\\课件\\必修一.pdf' },
    shelf,
    tree: [],
  })
  assert.equal(auto.basis, 'toc')
})

/* ── 「看课」到底开哪一讲 ───────────────────────────────────────────────── */
/*
 * 单元上那颗「看课」原来只认知识点自己挂的 `video`；现在先去资料图谱里找这一讲。
 * 找法三档：图谱里写着同一个 pointId → 讲次名字对得上 → 只对到「这一部分」。
 * 这里全都用注入的假目录，别碰真盘。
 */

test('媒体目标：url 里藏着的路径解得出来，网课 / 别的文件 / 文件夹分得开', () => {
  const root = mkdtempSync(join(tmpdir(), 'mtree-media-'))
  try {
    const mp4 = join(root, '01 集合.mp4')
    writeFileSync(mp4, 'x')
    writeFileSync(join(root, '讲义.pdf'), 'x')

    assert.equal(mediaTargetOf('/study/file?path=' + encodeURIComponent(mp4)), mp4)
    assert.equal(mediaTargetOf(mp4), mp4, '本来就是个路径就原样回')
    assert.equal(mediaTargetOf('/study/read?path=a%2Fb.md#q3'), 'a/b.md', '正文链接带着 #qN，别把页码当路径')
    assert.equal(mediaTargetOf(''), '')

    assert.equal(mediaKindOf(mp4), 'video')
    assert.equal(mediaKindOf(join(root, '01 集合.MP4')), 'video')
    assert.equal(mediaKindOf(join(root, '讲义.pdf')), 'file')
    assert.equal(mediaKindOf(root), 'folder', '盘上真是目录就是目录')
    assert.equal(mediaKindOf(''), '')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('看课：图谱里写着同一个 pointId 就开那一讲，名字对得上也算，PDF 不算看课', () => {
  const root = 'F:\\课件\\一轮课程'
  const open = (name) => '/study/file?path=' + encodeURIComponent(join(root, name))
  const tree = {
    basis: 'folder',
    groups: [
      {
        title: '模块一 基础知识',
        units: [],
        modules: [
          {
            title: '02.模块一 基础知识 集合',
            leaf: false,
            units: [
              { title: '03.集合的概念（讲义）', pointId: '', url: open('03.pdf') },
              { title: '04.基础知识&基本例题', pointId: '', url: open('04.mp4') },
              { title: '05.题型1：集合间的基本关系', pointId: 'M1.1', url: open('05.mp4') },
            ],
          },
        ],
      },
    ],
  }
  const entries = [{ materialId: 'mat-v', materialTitle: '一轮课程', tree }]

  // ① 图谱里写着同一个 pointId —— 最准的一档
  const byId = videoForPoint({ point: { id: 'M1.1', title: '集合' }, entries })
  assert.equal(byId.kind, 'video')
  assert.equal(byId.file, join(root, '05.mp4'))
  assert.equal(byId.level, 'unit')
  assert.equal(byId.material, '一轮课程')
  assert.equal(byId.materialId, 'mat-v')
  assert.match(byId.why, /M1\.1/)

  // ② 名字对得上（pointId 换了也不影响）
  const byName = videoForPoint({ point: { id: 'M9.9', title: '集合间的基本关系' }, entries })
  assert.equal(byName.file, join(root, '05.mp4'))
  assert.match(byName.why, /讲次名字对上了/)

  // ③ 教辅的 PDF 不许当「看课」
  const pdf = videoForPoint({
    point: { id: 'M1.1', title: '集合' },
    entries: [
      {
        materialId: 'mat-b',
        materialTitle: '精讲册',
        tree: {
          groups: [
            {
              title: '专题一 集合',
              units: [],
              modules: [
                {
                  title: '1.1 集合',
                  leaf: true,
                  pointId: 'M1.1',
                  url: '/study/file?path=' + encodeURIComponent('F:\\教辅\\精讲册.pdf'),
                },
              ],
            },
          ],
        },
      },
    ],
  })
  assert.equal(pdf, null, 'pointId 对上了也不开教辅 PDF——「看课」要的是课')
})

test('看课：两个文件夹里都有「基础知识」那种课，靠文件夹把两份讲次分开', () => {
  // 真课就是这样：`02.模块一 基础知识 集合\04.基础知识&基本例题.mp4`
  // 和 `03.模块一 基础知识 逻辑\14.基础知识与基本例题.mp4` 都像「基础知识与基本例题」，
  // 光看文件名分不出来，得看父目录跟这一节的名字哪边更贴。
  const root = 'F:\\课件\\一轮课程'
  const open = (...parts) => '/study/file?path=' + encodeURIComponent(join(root, ...parts))
  const entries = [
    {
      materialId: 'mat-v',
      materialTitle: '一轮课程',
      tree: {
        basis: 'folder',
        groups: [
          { title: '02.模块一 基础知识 集合', units: [{ title: '04.基础知识&基本例题', pointId: '', url: open('02.模块一 基础知识 集合', '04.基础知识&基本例题.mp4') }], modules: [] },
          { title: '03.模块一 基础知识 逻辑', units: [{ title: '14.基础知识与基本例题', pointId: '', url: open('03.模块一 基础知识 逻辑', '14.基础知识与基本例题.mp4') }], modules: [] },
        ],
      },
    },
  ]

  const set = videoForPoint({ point: { id: 'M1.1', title: '集合基础知识与基本例题' }, entries })
  assert.equal(set.file, join(root, '02.模块一 基础知识 集合', '04.基础知识&基本例题.mp4'))

  const logic = videoForPoint({ point: { id: 'M1.4', title: '逻辑基础知识与基本例题' }, entries })
  assert.equal(logic.file, join(root, '03.模块一 基础知识 逻辑', '14.基础知识与基本例题.mp4'))
})

test('看课：只对到「这一部分」时摆文件夹，里面只有一讲就展开；挂的 video 是最后的兜底', () => {
  const root = 'F:\\课件\\一轮课程'
  const open = (name) => '/study/file?path=' + encodeURIComponent(join(root, name))
  const tree = {
    groups: [
      {
        title: '模块一 基础知识',
        units: [],
        modules: [
          {
            title: '02.模块一 基础知识 集合',
            leaf: false,
            units: [
              { title: '04.热身', pointId: '', url: open('04.mp4') },
              { title: '05.讲解', pointId: '', url: open('05.mp4') },
            ],
          },
        ],
      },
    ],
  }
  const entries = [{ materialId: 'mat-v', materialTitle: '一轮课程', tree }]
  const two = fakeList({ [root]: [{ name: '04.mp4' }, { name: '05.mp4' }] })

  // 模块名对得上、讲次名对不上 —— 只能定位到这一部分
  const part = videoForPoint({ point: { id: 'M1.2', title: '基础知识' }, entries, list: two })
  assert.equal(part.level, 'part')
  assert.equal(part.kind, 'folder')
  assert.equal(part.file, root)
  assert.match(part.why, /里面 2 个视频/)

  // 同一档，但那个文件夹里只有一讲 —— 直接开那一讲
  const one = videoForPoint({
    point: { id: 'M1.2', title: '基础知识' },
    entries,
    list: fakeList({ [root]: [{ name: '04.mp4' }] }),
  })
  assert.equal(one.kind, 'video')
  assert.equal(one.file, join(root, '04.mp4'))
  assert.match(one.why, /只有这一讲/)

  // 图谱里什么都没有：才轮到知识点自己挂的那个 video
  const own = videoForPoint({
    point: { id: 'M9.1', title: '导数', video: join(root, '09.mp4') },
    entries: [],
  })
  assert.equal(own.file, join(root, '09.mp4'))
  assert.equal(own.why, '这个单元上挂着的')

  // 挂的是文件夹：只有一讲就展开，多了就摆文件夹
  const folder = videoForPoint({
    point: { id: 'M9.2', title: '导数', video: root },
    entries: [],
    list: two,
  })
  assert.equal(folder.kind, 'folder')
  assert.equal(folder.file, root)

  // 什么都没有：回 null，让面板去问
  assert.equal(videoForPoint({ point: { id: 'M9.3', title: '导数' }, entries: [] }), null)
})
