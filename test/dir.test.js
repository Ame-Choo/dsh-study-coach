// /study/file 点开文件夹那条路：看课的入口给的就是一节课的文件夹，
// 得把里面的 mp4 列出来让用户自己挑。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHandler } from '../lib/handler.js'

const assetsDir = join(import.meta.dirname, '..', 'assets')

function fakeRes() {
  const res = { code: 0, headers: {}, chunks: [], body: '' }
  res.writeHead = (code, headers) => {
    res.code = code
    res.headers = headers ?? {}
  }
  res.end = (chunk) => {
    if (chunk) res.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    res.body = Buffer.concat(res.chunks).toString('utf8')
  }
  return res
}

test('点开一节课的文件夹，把里面的文件列出来', async () => {
  const root = mkdtempSync(join(tmpdir(), 'study-dir-'))
  try {
    const lesson = join(root, '08.行列式的定义')
    mkdirSync(lesson)
    writeFileSync(join(lesson, '01.观看指南.mp4'), 'x')
    writeFileSync(join(lesson, '02.基础知识与基本例题.mp4'), 'x')
    const store = { read: () => ({ materials: [{ path: root }] }) }
    const handler = createHandler(store, () => ({ code: 404, body: {} }), { assetsDir })
    const req = { method: 'GET', url: '/study/file?path=' + encodeURIComponent(lesson), headers: {} }
    const res = fakeRes()
    await handler(req, res)
    assert.equal(res.code, 200)
    assert.match(String(res.headers['content-type']), /text\/html/)
    assert.match(res.body, /01\.观看指南\.mp4/)
    assert.match(res.body, /02\.基础知识与基本例题\.mp4/)
    assert.match(res.body, /\/study\/file\?path=/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('登记过的材料、盘上没了：410，不是 404', async () => {
  // 404 是面板判「服务端还是旧代码」的信号（`fileAlive()`）；移动硬盘没插的时候
  // 文件本来就该找不到，那时候回 404 会让体检卡举着红条喊「重启 DSH」。
  const root = mkdtempSync(join(tmpdir(), 'study-dir-'))
  try {
    const store = { read: () => ({ materials: [{ path: root }] }) }
    const handler = createHandler(store, () => ({ code: 404, body: {} }), { assetsDir })
    const gone = join(root, '还没插硬盘就找不到的那本.pdf')
    const req = { method: 'GET', url: '/study/file?path=' + encodeURIComponent(gone), headers: {} }
    const res = fakeRes()
    await handler(req, res)
    assert.equal(res.code, 410)
    assert.match(res.body, /找不到了/)
    assert.match(res.body, /"code":"gone"/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('登记材料范围外的文件夹不给看', async () => {
  const root = mkdtempSync(join(tmpdir(), 'study-dir-'))
  const outside = mkdtempSync(join(tmpdir(), 'study-out-'))
  try {
    const store = { read: () => ({ materials: [{ path: root }] }) }
    const handler = createHandler(store, () => ({ code: 404, body: {} }), { assetsDir })
    const req = { method: 'GET', url: '/study/file?path=' + encodeURIComponent(outside), headers: {} }
    const res = fakeRes()
    await handler(req, res)
    assert.equal(res.code, 404)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})
