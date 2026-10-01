/**
 * 「点开这份东西」那半：只有已登记材料底下的文件放得出去，支持 Range，别的一律 404。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Store } from '../lib/store.js'
import { createRouter } from '../lib/routes.js'
import { createHandler } from '../lib/handler.js'
import { startPanelServer } from '../lib/panel-server.js'

const ASSETS = join(import.meta.dirname, '..', 'assets')

function fixture() {
  const store = new Store(mkdtempSync(join(tmpdir(), 'study-file-')))
  store.ensure()
  const root = mkdtempSync(join(tmpdir(), 'study-media-'))
  const lessonDir = join(root, '网课')
  mkdirSync(lessonDir, { recursive: true })
  const video = join(lessonDir, '01_行列式的定义.mp4')
  writeFileSync(video, Buffer.from('0123456789abcdef'))
  const outsider = join(root, '别的东西.txt')
  writeFileSync(outsider, 'nope')
  store.update('profile', (p) => {
    p.materials = [{ id: 'mat-1', kind: 'video', title: '线代网课', path: lessonDir, note: '' }]
    return p
  })
  return {
    store,
    video,
    outsider,
    handler: createHandler(store, createRouter(store), { assetsDir: ASSETS }),
  }
}

test('已登记材料里的文件能放出去，类型也对', async () => {
  const { video, handler } = fixture()
  const server = await startPanelServer(handler, { port: 0 })
  try {
    const res = await fetch(`${server.url}/file?path=${encodeURIComponent(video)}`)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'video/mp4')
    assert.equal(res.headers.get('accept-ranges'), 'bytes')
    assert.equal(await res.text(), '0123456789abcdef')
  } finally {
    await server.close()
  }
})

test('带 Range 就回 206，视频才拖得动进度条', async () => {
  const { video, handler } = fixture()
  const server = await startPanelServer(handler, { port: 0 })
  try {
    const res = await fetch(`${server.url}/file?path=${encodeURIComponent(video)}`, {
      headers: { range: 'bytes=4-7' },
    })
    assert.equal(res.status, 206)
    assert.equal(res.headers.get('content-range'), 'bytes 4-7/16')
    assert.equal(await res.text(), '4567')
  } finally {
    await server.close()
  }
})

test('没登记过的文件打不开', async () => {
  const { outsider, handler } = fixture()
  const server = await startPanelServer(handler, { port: 0 })
  try {
    const res = await fetch(`${server.url}/file?path=${encodeURIComponent(outsider)}`)
    assert.equal(res.status, 404)
  } finally {
    await server.close()
  }
})

test('拿 .. 往材料目录外面钻也不行', async () => {
  const { video, handler } = fixture()
  const sneaky = join(video, '..', '..', '别的东西.txt')
  const server = await startPanelServer(handler, { port: 0 })
  try {
    const res = await fetch(`${server.url}/file?path=${encodeURIComponent(sneaky)}`)
    assert.equal(res.status, 404)
  } finally {
    await server.close()
  }
})

test('材料登记的是个不存在的路径，也别炸', async () => {
  const { store, handler } = fixture()
  // 路径按当前平台拼：写成 `Z:\没有这个目录` 的话，Linux 上 resolve() 之后前缀对不上，
  // 会落到 404 那一支——那测的就不是「材料没了」，而是「路径写法不对」。
  const goneDir = join('Z:', '没有这个目录')
  const goneFile = join(goneDir, 'a.mp4')
  store.update('profile', (p) => {
    p.materials = [{ id: 'mat-x', kind: 'other', title: '早就删了', path: goneDir, note: '' }]
    return p
  })
  const server = await startPanelServer(handler, { port: 0 })
  try {
    const res = await fetch(`${server.url}/file?path=${encodeURIComponent(goneFile)}`)
    // 410 而不是 404：面板的探活就是拿 404 判「服务端还是旧代码」的，
    // 移动硬盘没插时回 404 会让它举着红条喊「重启 DSH」
    assert.equal(res.status, 410)
    const body = await res.json()
    assert.equal(body.error.code, 'gone')
  } finally {
    await server.close()
  }
})
