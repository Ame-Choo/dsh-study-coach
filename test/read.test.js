/**
 * 读卷那半：AI 出的卷子（.md）不再从 /study/file 倒源码，而是走 /study/read 按面板版式摊开。
 * 这一份盯住服务端那一半 —— 页面发得出去、正文读得到、不该给的一律拦下。
 *
 * 前端的排版见 test/md.test.js（渲染器）与 test/read-ui.test.js（这一页怎么画）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Store } from '../lib/store.js'
import { createRouter } from '../lib/routes.js'
import { MAX_DOC_BYTES, createHandler } from '../lib/handler.js'
import { startPanelServer } from '../lib/panel-server.js'

const ASSETS = join(import.meta.dirname, '..', 'assets')

const PAPER = [
  '# 随堂小测 · M1.4',
  '',
  '> 8 道，由易到难。先自己做，做完再掀答案。',
  '',
  '## 第 1 题',
  '已知 A 是 3 阶方阵，求 |2A|。',
  '',
  '## 参考答案',
  '第 1 题：8|A|。',
  '',
].join('\n')

function fixture() {
  const store = new Store(mkdtempSync(join(tmpdir(), 'study-read-')))
  store.ensure()
  const root = mkdtempSync(join(tmpdir(), 'study-doc-'))
  const aiDir = join(root, 'ai')
  mkdirSync(aiDir, { recursive: true })
  const paper = join(aiDir, 'M1.4-随堂小测.md')
  writeFileSync(paper, PAPER)
  const notes = join(root, '讲义.txt')
  writeFileSync(notes, '第一行\n第二行\n')
  const pdf = join(root, '真题.pdf')
  writeFileSync(pdf, Buffer.from('%PDF-1.4 假装是一份 PDF'))
  const outsider = join(mkdtempSync(join(tmpdir(), 'study-outside-')), '外面的.md')
  writeFileSync(outsider, '# 没登记，读不到')
  store.update('profile', (p) => {
    p.materials = [
      { id: 'mat-ai', kind: 'ai', title: '随堂小测 · M1.4', path: paper, note: '' },
      { id: 'mat-notes', kind: 'notes', title: '讲义', path: root, note: '' },
    ]
    return p
  })
  return {
    store,
    root,
    paper,
    notes,
    pdf,
    outsider,
    handler: createHandler(store, createRouter(store), { assetsDir: ASSETS }),
  }
}

test('读卷页发得出去：带 read.css 和 read.js，不是那张面板', async () => {
  const { handler } = fixture()
  const server = await startPanelServer(handler, { port: 0 })
  try {
    const res = await fetch(`${server.url}/read`)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8')
    const html = await res.text()
    assert.match(html, /\/study\/assets\/read\.css/)
    assert.match(html, /\/study\/assets\/read\.js/)
    assert.doesNotMatch(html, /panel\.js/, '读卷页别顺手把面板那套脚本也拉进来')
  } finally {
    await server.close()
  }
})

test('已登记的 .md 读得到：正文、文件名、归属材料都对得上', async () => {
  const { paper, handler } = fixture()
  const server = await startPanelServer(handler, { port: 0 })
  try {
    const res = await fetch(`${server.url}/api/doc?path=${encodeURIComponent(paper)}`)
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.ok, true)
    assert.equal(data.doc.text, PAPER)
    assert.equal(data.doc.name, 'M1.4-随堂小测.md')
    assert.equal(data.doc.ext, '.md')
    assert.equal(data.doc.truncated, false)
    assert.deepEqual(data.doc.material, { id: 'mat-ai', title: '随堂小测 · M1.4', kind: 'ai' })
  } finally {
    await server.close()
  }
})

test('.txt 也认；登记的是文件夹，底下的文件读得到但不算某一份材料的', async () => {
  const { notes, handler } = fixture()
  const server = await startPanelServer(handler, { port: 0 })
  try {
    const res = await fetch(`${server.url}/api/doc?path=${encodeURIComponent(notes)}`)
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.doc.text, '第一行\n第二行\n')
    assert.equal(data.doc.material, null)
  } finally {
    await server.close()
  }
})

test('没登记过的东西读不到 —— 别让它变成任意文件读取器', async () => {
  const { outsider, handler } = fixture()
  const server = await startPanelServer(handler, { port: 0 })
  try {
    const res = await fetch(`${server.url}/api/doc?path=${encodeURIComponent(outsider)}`)
    assert.equal(res.status, 404)
    const data = await res.json()
    assert.equal(data.error.code, 'not-found')
  } finally {
    await server.close()
  }
})

test('非文字稿（PDF）挡在 415：从这儿吐出去只会是一堆乱码', async () => {
  const { pdf, handler } = fixture()
  const server = await startPanelServer(handler, { port: 0 })
  try {
    const res = await fetch(`${server.url}/api/doc?path=${encodeURIComponent(pdf)}`)
    assert.equal(res.status, 415)
    const data = await res.json()
    assert.equal(data.error.code, 'not-text')
  } finally {
    await server.close()
  }
})

test('长文在上限处截断，并说清楚还有下文', async () => {
  const { store, root, handler } = fixture()
  const long = join(root, '讲义.txt')
  writeFileSync(long, 'a'.repeat(MAX_DOC_BYTES + 4096))
  store.update('profile', (p) => {
    p.materials = [{ id: 'mat-long', kind: 'notes', title: '超长讲义', path: long, note: '' }]
    return p
  })
  const server = await startPanelServer(handler, { port: 0 })
  try {
    const res = await fetch(`${server.url}/api/doc?path=${encodeURIComponent(long)}`)
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.doc.truncated, true)
    assert.equal(data.doc.bytes, MAX_DOC_BYTES + 4096)
    assert.equal(data.doc.text.length, MAX_DOC_BYTES, '读进来的正好是上限那么多')
  } finally {
    await server.close()
  }
})

test('指着一个文件夹要正文，回 400 而不是炸', async () => {
  const { root, handler } = fixture()
  const server = await startPanelServer(handler, { port: 0 })
  try {
    const res = await fetch(`${server.url}/api/doc?path=${encodeURIComponent(root)}`)
    assert.equal(res.status, 400)
    const data = await res.json()
    assert.equal(data.error.code, 'not-file')
  } finally {
    await server.close()
  }
})

test('地址里没带 path 就当没有，别读出一个空文档', async () => {
  const { handler } = fixture()
  const server = await startPanelServer(handler, { port: 0 })
  try {
    const res = await fetch(`${server.url}/api/doc`)
    assert.equal(res.status, 404)
  } finally {
    await server.close()
  }
})
