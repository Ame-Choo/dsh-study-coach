/**
 * 读卷页 read.js 的渲染回归。
 *
 * 学生问的是：AI 出的题目、「生成的东西」，别拿纯文本倒给他，要按这个 web 的版式摊开。
 * 这一份盯住那条线 —— 正文画成面板的排版、题号能跳、参考答案折着、读不到时说人话。
 *
 * 和 practice-ui.test.js 一个路子：只 stub 用得到的那点 DOM，对着 innerHTML 断言。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const READ = pathToFileURL(join(HERE, '..', 'assets', 'read.js')).href

const PAPER = 'F:\\示例资料\\ai\\M1.4-随堂小测.md'

const TEXT = [
  '# 随堂小测 · M1.4',
  '',
  '> 8 道，由易到难。先自己做，做完再掀答案。',
  '',
  '## 第 1 题',
  '已知 A 是 3 阶方阵，求 **|2A|**。',
  '',
  '## 参考答案',
  '第 1 题：8|A|。',
  '',
].join('\n')

function stubDom() {
  const boxes = new Map()
  const box = (id) => {
    if (!boxes.has(id)) boxes.set(id, { id, innerHTML: '', className: '', textContent: '' })
    return boxes.get(id)
  }
  box('app')
  box('toast')
  const anchors = new Map()
  const listeners = new Map()
  globalThis.document = {
    title: '',
    querySelector: (sel) => (sel === '#app' ? box('app') : sel === '#toast' ? box('toast') : null),
    querySelectorAll: () => [],
    getElementById: (id) => (anchors.has(id) ? anchors.get(id) : null),
    addEventListener: (type, fn) => listeners.set(type, fn),
  }
  globalThis.window = { addEventListener: (type, fn) => listeners.set(type, fn) }
  return { boxes, anchors, listeners }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 起一次读卷页。`doc` 是 /study/api/doc 要回的 doc；给 `{ fail }` 就当读不到。
 * `point` / `hash` 对应从做题页跳过来的那种地址。
 */
async function boot(doc, tag, { point = '', hash = '', search = null } = {}) {
  const dom = stubDom()
  const fallback = '?path=' + encodeURIComponent(PAPER) + (point ? '&point=' + encodeURIComponent(point) : '')
  const query = search === null ? fallback : search
  globalThis.location = { search: query, hash }
  const calls = []
  globalThis.fetch = async (url) => {
    calls.push(String(url))
    if (!doc) {
      return {
        ok: false,
        status: 404,
        json: async () => ({ ok: false, error: { code: 'not-found', message: '这个文件不在已登记的材料里' } }),
      }
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, doc }) }
  }
  await import(READ + '?v=' + tag)
  await sleep(15)
  return { html: () => dom.boxes.get('app').innerHTML, text: () => dom.boxes.get('app').textContent, calls, dom }
}

const PAPER_DOC = {
  path: PAPER,
  name: 'M1.4-随堂小测.md',
  ext: '.md',
  bytes: TEXT.length,
  truncated: false,
  text: TEXT,
  material: { id: 'mat-ai', title: '随堂小测 · M1.4', kind: 'ai' },
}

test('正文按面板版式画出来：markdown 标记成了真排版，不是源码', async () => {
  const { html, calls } = await boot(PAPER_DOC, 'read1')
  const page = html()

  assert.ok(calls[0].startsWith('/study/api/doc?path='), '正文要从 /study/api/doc 拿')
  assert.match(page, /<h1 id="sec1">随堂小测 · M1\.4<\/h1>/, '标题画成 h1，不是「# 」')
  assert.match(page, /<h2 id="q1">第 1 题<\/h2>/)
  assert.match(page, /<b>\|2A\|<\/b>/, '**粗体** 要成真粗体')
  assert.doesNotMatch(page, /##/, '不该把 markdown 的井号原样露出来')
  assert.doesNotMatch(page, /\*\*/, '不该把星号原样露出来')
  assert.match(page, /class="tag"|rd-kind/, '这一份是「AI 出题」，得写出来')
  assert.match(page, /AI 出题/)
})

test('顶上一排能跳的题号，答案折着 —— 先做，做完再掀', async () => {
  const { html } = await boot(PAPER_DOC, 'read2')
  const page = html()
  assert.match(page, /<div class="rd-row"><b>题目<\/b>/, '顶上要有跳题号那一排')
  assert.match(page, /<a href="#q1">第 1 题<\/a>/)
  assert.match(page, /<details class="md-answer"><summary>参考答案<\/summary>/)
  assert.match(page, /<a class="btn ghost" href="\/study\/file\?path=[^"]*">看原文/)
})

test('从做题页跳过来（带 point）：回得去，页尾直接去做题', async () => {
  const { html } = await boot(PAPER_DOC, 'read3', { point: 'M1.4' })
  const page = html()
  assert.match(page, /href="\/study\/practice\?point=M1\.4"/)
  assert.match(page, /去记这一节的掌握度/)
  assert.doesNotMatch(page, /href="\/study\/materials"/, '有来路就回那一节，别扔回资料页')
})

test('不带 point 自己进来的：退回资料页', async () => {
  const { html } = await boot(PAPER_DOC, 'read4')
  const page = html()
  assert.match(page, /href="\/study\/materials"/)
  assert.match(page, /← 回到资料/)
})

test('长文截断了就直说，别装作全文', async () => {
  const { html } = await boot({ ...PAPER_DOC, truncated: true, bytes: 999999 }, 'read5')
  const page = html()
  assert.match(page, /只读进来前面一部分/)
  assert.match(page, /rd-cut/)
})

test('读不到时说人话，并给一条回得去的路', async () => {
  const { html } = await boot(null, 'read6')
  const page = html()
  assert.match(page, /打不开这份/)
  assert.match(page, /这个文件不在已登记的材料里/)
  assert.match(page, /href="\/study\/materials"/)
})

test('地址里少了 path：当场说清，不去打接口', async () => {
  const { html, calls } = await boot(PAPER_DOC, 'read7', { search: '?point=M1.4' })
  const page = html()
  assert.equal(calls.length, 0, '没说要读哪一份就别浪费一次请求')
  assert.match(page, /地址里没说要读哪一份/)
})
