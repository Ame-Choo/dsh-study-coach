/**
 * 「教辅拆到页」这条链子的测试：PDF → 编号 PNG → 页码写进 analysis.marks → 做题页一跳就到。
 *
 * 真渲染那一节要靠本机的 pymupdf，装不上就 skip——不能让整份测试卡在环境上。
 *
 * 用法：node --test test/pages.test.js
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, sep } from 'node:path'

import { Store } from '../lib/store.js'
import { buildTools } from '../lib/tools.js'
import { createRouter } from '../lib/routes.js'
import { findPython, pagesDirFor, renderPages } from '../lib/pages.js'
import { pagesRootOf } from '../lib/paths.js'

const EXEC = { signal: { throwIfAborted() {} } }

/** 手搓一份最小 PDF：两页空白。pymupdf 能读，就不必往仓库里塞测试素材。 */
function tinyPdf(path, pages = 2) {
  const objs = ['1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj']
  const kids = []
  for (let i = 0; i < pages; i += 1) kids.push(`${i + 3} 0 R`)
  objs.push(`2 0 obj<</Type/Pages/Kids[${kids.join(' ')}]/Count ${pages}>>endobj`)
  for (let i = 0; i < pages; i += 1) {
    objs.push(`${i + 3} 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj`)
  }
  let body = '%PDF-1.4\n'
  const offs = []
  for (const o of objs) {
    offs.push(body.length)
    body += o + '\n'
  }
  const xref = body.length
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  body += offs.map((n) => String(n).padStart(10, '0') + ' 00000 n \n').join('')
  body += `trailer<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`
  writeFileSync(path, body, 'latin1')
}

function fresh() {
  const root = mkdtempSync(join(tmpdir(), 'study-pages-'))
  const store = new Store(root)
  store.ensure()
  // 老写法是传一个自己的 scratchDir；现在目录算法统一走 lib/paths.js，
  // 这里显式传 pagesRoot，值仍然在 store 根底下，和生产里那套是同一套。
  const pagesRoot = pagesRootOf(store)
  const specs = buildTools(store, { panelPath: '/study', pagesRoot })
  const byName = new Map(specs.map((s) => [s.name, s]))
  return {
    root,
    store,
    pagesRoot,
    call: (name, args = {}) => byName.get(name).execute(args, EXEC),
    route: (request) => createRouter(store, {})(request),
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
        title: '带参数的行列式讨论与反求参数',
        why: '计算主力',
        source: '讲义 1.1 行列式的定义',
        video: 'F:\\示例资料\\网课\\02.行列式',
        practice: 'F:\\示例资料\\线性代数讲义\\1.1 行列式的定义.pdf',
      },
      { id: 'M1.2', title: '行列式的性质与展开', why: '基础', source: '讲义 1.2 行列式的性质' },
    ],
  },
]

test('pagesDirFor：同一份 PDF 每次落到同一个目录，不同 PDF 不会撞', () => {
  const root = 'F:\\scratch\\pages'
  const a = pagesDirFor(root, 'F:\\示例资料\\线性代数讲义\\1.1 行列式的定义.pdf')
  const b = pagesDirFor(root, 'F:\\示例资料\\线性代数讲义\\1.1 行列式的定义.pdf')
  const c = pagesDirFor(root, 'F:\\示例资料\\线性代数讲义\\1.2 行列式的性质.pdf')
  assert.equal(a, b, '同一个路径必须算出一模一样的目录')
  assert.notEqual(a, c, '两份不同的 PDF 不能共用目录')
  assert.ok(a.startsWith(root + sep), `目录要落在 scratch 里，实际 ${a}`)
  assert.ok(a.includes('1.1 行列式的定义'), `目录名要带得动文件名，实际 ${a}`)
})

test('study_pages：把 PDF 拆成按页码编号的 PNG，页码跟 PDF 自己的页码一致', async (t) => {
  const f = fresh()
  try {
    const pdf = join(f.root, 'book.pdf')
    tinyPdf(pdf, 2)
    const out = await f.call('study_pages', { pdfPath: pdf, from: 1, to: 2, dpi: 60 })
    if (!out.ok && /pymupdf|No module named/i.test(out.error)) {
      t.skip(`本机没有 pymupdf：${out.error}`)
      return
    }
    assert.equal(out.ok, true, out.error)
    assert.equal(out.totalPages, 2)
    assert.deepEqual(out.pages.map((p) => p.page), [1, 2], '页码从 1 起，跟 PDF 自己的页码对上')
    for (const p of out.pages) {
      assert.ok(existsSync(p.file), `${p.file} 没落盘`)
      assert.ok(statSync(p.file).size > 0, `${p.file} 是空文件`)
      assert.match(p.file, new RegExp(`p${String(p.page).padStart(4, '0')}\\.png$`), '文件名要带页码')
    }
    assert.ok(out.dir.startsWith(f.pagesRoot), `图片要落在数据目录的 pages 里，实际 ${out.dir}`)

    // 渲过的页不重来：再渲一次拿到的还是同一个文件。
    const again = await f.call('study_pages', { pdfPath: pdf, from: 1, to: 1, dpi: 60 })
    assert.equal(again.pages[0].file, out.pages[0].file, '同一页必须复用同一个 PNG')
    assert.match(out.summary, /第 1–2 页/, `概览要说清渲了哪几页，实际 ${out.summary}`)
  } finally {
    f.done()
  }
})

test('study_pages：参数不对时把话说清楚，不糊一个空结果给模型', async () => {
  const f = fresh()
  try {
    await assert.rejects(() => f.call('study_pages', {}), /materialId 和 pdfPath 至少给一个/)
    await assert.rejects(() => f.call('study_pages', { pdfPath: 'F:\\讲义.txt' }), /只认 PDF/)
    await assert.rejects(
      () => f.call('study_pages', { pdfPath: 'F:\\示例资料\\不存在.pdf' }),
      /这份文件不在/,
    )

    // materialId 指向一个装着好几份 PDF 的目录：不能说「随便挑一份」，得给例子。
    const dir = join(f.root, '课程讲义')
    mkdirSync(dir, { recursive: true })
    tinyPdf(join(dir, '1.1 行列式的定义.pdf'), 1)
    tinyPdf(join(dir, '1.2 行列式的性质.pdf'), 1)
    await f.call('study_material', {
      action: 'add',
      title: '线性代数讲义',
      kind: 'notes',
      path: dir,
      note: '48 份 PDF',
    })
    const id = f.store.read('profile').materials[0].id
    await assert.rejects(
      () => f.call('study_pages', { materialId: id }),
      (error) => /2 份 PDF/.test(error.message) && /1\.1 行列式的定义\.pdf/.test(error.message),
      '目录里有多份 PDF 时要报错并给一份现成的例子',
    )
    // 直接把其中一份写上就通得过参数这一关（渲不渲得成看 pymupdf，不属于这条断言）。
    const one = await f.call('study_pages', { materialId: id, pdfPath: join(dir, '1.1 行列式的定义.pdf'), from: 1, to: 1 })
    assert.equal(typeof one.ok, 'boolean')
  } finally {
    f.done()
  }
})

test('页码写进 marks 之后：报告里数得出来，做题页一跳就到那一页', async () => {
  const f = fresh()
  try {
    await f.call('study_map', { action: 'set', modules: MODULES })
    await f.call('study_map', { action: 'confirm' })
    const lecture = 'F:\\示例资料\\线性代数讲义\\1.1 行列式的定义.pdf'
    await f.call('study_material', {
      action: 'add',
      title: '线性代数讲义',
      kind: 'notes',
      path: 'F:\\示例资料\\线性代数讲义',
      note: '48 份',
    })
    const matId = f.store.read('profile').materials[0].id

    // 拆页之前：只有章节文件，没有页码。
    const before = await f.call('study_report', {})
    assert.equal(before.materials[0].pagedCount, 0, '还没拆到页时 pagedCount 必须是 0')

    await f.call('study_analysis', {
      action: 'save',
      materialId: matId,
      coverage: '部分通读',
      chapters: [
        {
          no: '1.1',
          title: '行列式',
          pages: '1-16',
          file: lecture,
          marks: [
            { label: '带参数的行列式讨论', page: '6', pointId: 'M1.1' },
            { label: '行列式的性质与展开', page: '9' },
          ],
        },
      ],
    })

    const after = await f.call('study_report', {})
    assert.equal(after.materials[0].pagedCount, 1, '拆过页的章要数进 pagedCount')
    const analysed = await f.call('study_analysis', { action: 'get', materialId: matId, chapterNo: '1.1' })
    assert.deepEqual(analysed.chapters[0].marks, [
      { label: '带参数的行列式讨论', page: '6', pointId: 'M1.1' },
      { label: '行列式的性质与展开', page: '9', pointId: '' },
    ])

    const res = await f.route({ method: 'GET', pathname: '/study/api/practice', query: { point: 'M1.1' } })
    assert.equal(res.code, 200)
    assert.equal(res.body.chapters[0].file, lecture)
    assert.deepEqual(
      res.body.pageHits,
      [{
        label: '带参数的行列式讨论',
        page: '6',
        file: lecture,
        materialId: matId,
        material: '线性代数讲义',
        no: '1.1',
        title: '行列式',
      }],
      '绑了 pointId 的那一页才算数，M1.1 不该拿到隔壁的 9 页',
    )

    // M1.2 靠标题互含也能认出来（「行列式的性质与展开」对「行列式的性质与展开」）。
    const res2 = await f.route({ method: 'GET', pathname: '/study/api/practice', query: { point: 'M1.2' } })
    assert.deepEqual(res2.body.pageHits.map((h) => h.page), ['9'])

    // 面板状态里也要能看出「哪份材料只到章、没到页」。
    const state = await f.route({ method: 'GET', pathname: '/study/api/state' })
    assert.equal(state.body.state.profile.materials[0].pagedCount, 1)
    assert.equal(state.body.state.profile.materials[0].chapterCount, 1)
  } finally {
    f.done()
  }
})

test('findPython：认 DSH 装的那份 python，找不到就退回命令名', () => {
  const before = process.env.DSH_STUDY_PYTHON
  // 自己造一个假家目录，把「DSH 自带的那份 python」放进去——CI 上没有 DSH 安装，
  // 拿真家目录去断言等于在赌 runner 的环境。
  const home = mkdtempSync(join(tmpdir(), 'study-python-'))
  try {
    const dir = join(home, '.dsh', 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'python')
    mkdirSync(dir, { recursive: true })
    const bundled = join(dir, 'python.exe')
    writeFileSync(bundled, '')

    // 得是个真存在的文件才认，这正是「别把不存在的路径当答案」。
    process.env.DSH_STUDY_PYTHON = process.execPath
    assert.equal(findPython(home), process.execPath, '显式设的路径优先')
    delete process.env.DSH_STUDY_PYTHON
    assert.equal(findPython(home), bundled, '没设就用 DSH 自带的那份')

    process.env.DSH_STUDY_PYTHON = 'D:\\py\\不存在.exe'
    assert.equal(findPython(home), bundled, '设了个不存在的路径就往回退给 DSH 自带的那份')

    assert.ok(/python(\.exe)?$/i.test(findPython('D:\\没有这个用户')), '退回应是命令名')
  } finally {
    if (before === undefined) delete process.env.DSH_STUDY_PYTHON
    else process.env.DSH_STUDY_PYTHON = before
    rmSync(home, { recursive: true, force: true })
  }
})

test('renderPages：文件不在、页码越界都给 ok:false 加一句人话', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'study-render-'))
  try {
    const gone = renderPages(join(dir, 'nope.pdf'), { outDir: join(dir, 'out'), from: 1, to: 1 })
    assert.equal(gone.ok, false)
    assert.match(gone.error, /这份文件不在/)

    const pdf = join(dir, 'one.pdf')
    tinyPdf(pdf, 1)
    const over = renderPages(pdf, { outDir: join(dir, 'out'), from: 9, to: 9, python: findPython(homedir()) })
    // 「本机 python 里没 pymupdf」和「python 压根跑不起来」都是环境问题，不是这条用例要测的；
    // 越界那句人话（「页码越界：这份一共 N 页」）不会提到 python，所以这条判据不会误吞。
    if (/pymupdf|No module named|ENOENT|spawn/i.test(over.error || '')) {
      t.skip(`本机的 python 渲不了 PDF：${over.error}`)
      return
    }
    assert.equal(over.ok, false, '越界必须失败')
    assert.match(over.error, /页码越界/, `越界要说清是越界，实际 ${over.error}`)

    // 一次要太多页也要拦住，别让 read_image 排队排到天亮。
    const many = renderPages(pdf, { outDir: join(dir, 'out'), from: 1, to: 999, python: findPython(homedir()) })
    assert.equal(many.ok, false)
    assert.match(many.error, /一次最多 40 页/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
