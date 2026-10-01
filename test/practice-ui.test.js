/**
 * 做题页 practice.js 的渲染回归 —— 专盯「教辅哪一页」那一排按钮。
 *
 * 学生问的就是这个：既然把讲义拆成图看过了页码，那页面上就得真出现「第 6 页」这种
 * 一点就翻过去的按钮。这里把服务端已经算好的 chapters[].marks 喂进去，
 * 看它有没有渲染成 <a href="...#page=N">；顺手也验一下没拆过页时那句实话。
 *
 * 和 panel.test.js 一个路子：只 stub 用得到的那点 DOM，对着 innerHTML 断言。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const PRACTICE = pathToFileURL(join(HERE, '..', 'assets', 'practice.js')).href

const LECTURE = 'F:\\示例资料\\线性代数讲义\\1.1 行列式的定义.pdf'

function stubDom() {
  const boxes = new Map()
  const box = (id) => {
    if (!boxes.has(id)) boxes.set(id, { id, innerHTML: '', className: '', textContent: '', value: '', classList: { add() {}, remove() {} } })
    return boxes.get(id)
  }
  box('app')
  box('toast')
  // 页面上那几个输入框：点击委托要从它们身上读学生写的话
  for (const id of ['ask-text', 'self-title', 'self-minutes', 'note']) box(id)
  const listeners = new Map()
  globalThis.document = {
    querySelector: (sel) =>
      sel === '#app' ? box('app') : sel === '#toast' ? box('toast') : sel.startsWith('#') ? box(sel.slice(1)) : null,
    querySelectorAll: () => [],
    addEventListener: (type, fn) => listeners.set(type, fn),
  }
  return { boxes, listeners }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const PAYLOAD = {
  ok: true,
  pointId: 'M1.4',
  point: {
    id: 'M1.4',
    title: '带参数的行列式讨论与反求参数',
    why: '把行列式方程翻译成参数的条件',
    source: '讲义 1.1 行列式的定义',
    video: 'F:\\示例资料\\网课\\02.行列式的定义',
    practice: LECTURE,
  },
  module: { id: 'M1', group: '线性代数', title: '行列式' },
  stage: '见过',
  stageAll: [],
  progress: 20,
  chapters: [
    {
      no: '1.1',
      title: '行列式',
      pages: '1-16',
      materialId: 'mat-lecture',
      material: '线性代数讲义',
      file: LECTURE,
      topics: '带参数讨论是它的重点题型',
      marks: [
        { label: '带参数：按行列展开反求参数（第九组）', page: '4' },
        { label: '带参数：行列式为零反求参数范围（综合应用 3-5）', page: '6' },
      ],
    },
  ],
  materials: [
    { id: 'mat-lecture', kind: 'notes', title: '线性代数讲义', path: 'F:\\示例资料\\线性代数讲义', chapterCount: 48, pagedCount: 1 },
  ],
}

/** 起一次做题页，喂一份假数据，等它渲染完。extra 按路径前缀覆盖某一条接口的返回。 */
async function boot(payload, tag, extra = {}) {
  const { boxes, listeners } = stubDom()
  const calls = []
  globalThis.location = { search: '?point=M1.4', href: 'http://127.0.0.1:19388/study/practice?point=M1.4' }
  globalThis.fetch = async (path, init) => {
    calls.push({ path, body: init && init.body ? JSON.parse(init.body) : null })
    const hit = Object.keys(extra).find((k) => String(path).startsWith(k))
    return { ok: true, status: 200, json: async () => (hit ? extra[hit] : payload) }
  }
  await import(PRACTICE + '?v=' + tag)
  for (let i = 0; i < 60 && !boxes.get('app').innerHTML; i += 1) await sleep(5)
  return { html: () => boxes.get('app').innerHTML, boxes, listeners, calls }
}

test('讲义拆到页之后，做题页给出一排「第 N 页」，点了带 #page 翻过去', async () => {
  const page = await boot(PAYLOAD, 'marks')
  const html = page.html()

  // 这一节本身的两条路
  assert.match(html, /观看本节网课/)
  assert.match(html, /打开配套练习/)
  assert.match(html, /第 1\.1 章/)

  // 页码按钮：两条 marks 都要在，而且 href 得带 #page=N
  assert.equal((html.match(/class="pg-btn"/g) || []).length, 2, '两条 marks 就该有两个页码按钮')
  assert.match(html, /第 4 页/)
  assert.match(html, /第 6 页/)
  assert.ok(html.includes('1.1%20%E8%A1%8C%E5%88%97%E5%BC%8F%E7%9A%84%E5%AE%9A%E4%B9%89.pdf#page=4'), '文件路径要编码，后面缀上 #page=4')
  assert.ok(html.includes('#page=6'), '第二条页码也得带上')

  // 拆过了就不该再劝人去拆
  assert.doesNotMatch(html, /还没到「第几页」/)

  // 三块「练什么你定」
  assert.match(html, /使用现有材料/)
  assert.match(html, /由教练出题/)
  assert.match(html, /自行安排/)
})

test('没拆过页的时候，页面直说只到「哪一份」，别装', async () => {
  const payload = {
    ...PAYLOAD,
    chapters: [{ ...PAYLOAD.chapters[0], marks: [] }],
    materials: [{ ...PAYLOAD.materials[0], pagedCount: 0 }],
  }
  const page = await boot(payload, 'nopages')
  const html = page.html()
  assert.equal((html.match(/class="pg-btn"/g) || []).length, 0)
  assert.match(html, /还没到「第几页」/)
  assert.match(html, /本章尚未按页拆解/, '每一章都要自己说清楚，别让学生以为按钮被吃了')
  // 章还是翻得开的，别把整块藏起来
  assert.match(html, /打开/)
})

test('按页直达：同一个单元，各本教辅各占哪几页，点页码直接翻过去', async () => {
  const hits = {
    ok: true,
    pointId: 'M1.4',
    hits: [
      {
        materialId: 'mat-a', material: '必修一', kind: 'book', from: '12', to: '13',
        pageKind: '例题', note: '含参讨论的三种情形',
        pages: [
          { page: 12, url: '/study/page?path=C%3A%2Fdata%2Fp0012.png' },
          { page: 13, url: '' },
        ],
      },
      {
        materialId: 'mat-b', material: '一千题', kind: 'book', from: '30', to: '30',
        pageKind: '习题', note: '',
        pages: [{ page: 30, url: '/study/page?path=C%3A%2Fdata%2Fp0030.png' }],
      },
    ],
  }
  const page = await boot(PAYLOAD, 'hits', { '/study/api/point/pages': hits })
  const html = page.html()

  assert.match(html, /按页直达/)
  assert.ok(page.calls.some((c) => c.path.startsWith('/study/api/point/pages?point=M1.4')))

  // 两本教辅各一段，段头写清「哪一本、占哪几页、是什么页」
  assert.match(html, /必修一/)
  assert.match(html, /一千题/)
  assert.match(html, /12—13 页 · 例题/)
  assert.match(html, /30 页 · 习题/)
  assert.match(html, /含参讨论的三种情形/)

  // 拆出来的页是链接，没拆的是灰的
  assert.ok(html.includes('/study/page?path=C%3A%2Fdata%2Fp0012.png'), '拆出来的页要能点进去看')
  assert.match(html, /<span class="pg-btn off">第 13 页<\/span>/, '第 13 页没拆出来，别给死链')
})

test('AI 出的卷子在做题页跟教辅平级：它没有页图，from/to 是题号', async () => {
  // 需求5 的联动就落在这儿：同一节，一本教辅给的是页，一份 AI 卷给的是题，
  // 都点得开。写错单位（把题号说成页码）会让这份卷看起来像扫描件。
  const hits = {
    ok: true,
    pointId: 'M1.4',
    hits: [
      {
        materialId: 'mat-a', material: '必修一', kind: 'book', from: '12', to: '12',
        pageKind: '例题', note: '',
        pages: [{ page: 12, url: '/study/page?path=C%3A%2Fdata%2Fp0012.png' }],
      },
      {
        materialId: 'mat-ai', material: '随堂小测 · M1.4（2026-10-01）', kind: 'ai', from: '1', to: '3',
        pageKind: '习题', note: '8 道，由易到难', path: 'C:\\data\\ai\\M1.4-随堂小测.md',
        pages: [{ page: 1, url: '' }, { page: 2, url: '' }, { page: 3, url: '' }],
      },
    ],
  }
  const html = (await boot(PAYLOAD, 'hits2', { '/study/api/point/pages': hits })).html()

  assert.match(html, /AI 出题/, '标签要写「AI 出题」，别落到「其他」')
  assert.match(html, /随堂小测 · M1\.4（2026-10-01）/)
  assert.match(html, /1—3 题 · 习题/, 'AI 卷的单位是「题」不是「页」')
  assert.match(html, /class="hit ai"/)

  // 它的 from/to 是题号，点题号开的是那份卷，而不是一个根本不存在的页图
  const ai = html.slice(html.indexOf('class="hit ai"'))
  assert.ok(ai.includes('/study/file?path=C%3A%5Cdata%5Cai%5CM1.4-'), 'AI 卷的题号要链到正文那份 md')
  assert.doesNotMatch(ai, /pg-btn off/, 'AI 卷不该出现「没拆出来」的灰按钮')
})

test('材料对应位置那张卡认出 AI 卷：打标签、说「题」不说「页」', async () => {
  // 上面那张卡是按**章**列的，教辅和 AI 卷会混在一起。不把类别写出来，
  // 学生看到「第 1 章 随堂小测 · M1.4」会以为那也是一本教辅。
  const payload = {
    ...PAYLOAD,
    chapters: [
      ...PAYLOAD.chapters,
      {
        no: '1',
        title: '随堂小测 · M1.4',
        materialId: 'mat-ai',
        material: '随堂小测 · M1.4（2026-10-01）',
        kind: 'ai',
        file: 'C:\\data\\ai\\M1.4-随堂小测.md',
        exercises: '1—4 题',
      },
    ],
  }
  const html = (await boot(payload, 'chai')).html()

  assert.match(html, /材料对应位置/, '这张卡现在也装 AI 卷，标题不能只说教辅')
  assert.match(html, /class="ch-row ai"/)
  const ai = html.slice(html.indexOf('class="ch-row ai"'))
  assert.match(ai.slice(0, 400), /<span class="tag">AI 出题<\/span>/)
  assert.match(ai.slice(0, 600), /1—4 题/, 'AI 卷的习题区间本来写全了，别再补一个「习题」前缀')
  assert.match(ai.slice(0, 600), /这份卷还没标到具体题号/, 'AI 卷不该说「仅能打开整份 PDF」')
})

test('这一节还没归过页的时候，直说，别摆一张空卡', async () => {
  const page = await boot(PAYLOAD, 'nohits', { '/study/api/point/pages': { ok: true, hits: [] } })
  assert.match(page.html(), /按页直达/)
  assert.match(page.html(), /还没有哪本教辅把这一节归过页/)
  assert.doesNotMatch(page.html(), /class="hit"/)
})

test('点「让 AI 出几道」把这一节和补的话一起递过去', async () => {
  const page = await boot(PAYLOAD, 'ask')
  page.boxes.get('ask-text').value = '来点带参数的'
  const click = page.listeners.get('click')
  assert.equal(typeof click, 'function', 'practice.js 得挂上点击委托')

  // 只 stub 到 closest 这一层：点击委托自己也用 target.closest 找按钮
  const button = { dataset: { act: 'ask-ai' } }
  await click({ target: { closest: () => button } })
  await sleep(20)

  const ask = page.calls.find((c) => c.path === '/study/api/practice/ask')
  assert.ok(ask, '得往 /study/api/practice/ask 发一条')
  assert.deepEqual(ask.body, { pointId: 'M1.4', mode: 'ai', text: '来点带参数的' })
  assert.match(page.boxes.get('toast').textContent || '', /已提交|已暂存/)
})
