/**
 * 独立端口那半：能端出跟同源一模一样的页面和接口，端口被占会往后挪，关得掉。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Store } from '../lib/store.js'
import { createRouter } from '../lib/routes.js'
import { createHandler } from '../lib/handler.js'
import { startPanelServer } from '../lib/panel-server.js'

const ASSETS = join(import.meta.dirname, '..', 'assets')

function fixture() {
  const store = new Store(mkdtempSync(join(tmpdir(), 'study-panel-')))
  store.ensure()
  return { store, handler: createHandler(store, createRouter(store), { assetsDir: ASSETS }) }
}

test('独立端口端出面板、静态资源和接口', async () => {
  const { handler } = fixture()
  const server = await startPanelServer(handler, { port: 0 })
  try {
    const page = await fetch(server.url)
    assert.equal(page.status, 200)
    assert.match(await page.text(), /学习教练/)

    const js = await fetch(`${server.url}/assets/panel.js`)
    assert.equal(js.status, 200)
    assert.match(js.headers.get('content-type') ?? '', /javascript/)

    const state = await (await fetch(`${server.url}/api/state`)).json()
    assert.equal(state.ok, true)

    const written = await (await fetch(`${server.url}/api/goal`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subject: '线性代数', minutesPerDay: 45 }),
    })).json()
    assert.equal(written.ok, true)
    assert.equal(written.goal.subject, '线性代数')
  } finally {
    await server.close()
  }
})

test('端口被占就往后挪', async () => {
  const { handler } = fixture()
  const first = await startPanelServer(handler, { port: 0 })
  try {
    const second = await startPanelServer(handler, { port: first.port })
    try {
      assert.ok(second.port > first.port, `期望大于 ${first.port}，实际 ${second.port}`)
      assert.notEqual(second.url, first.url)
    } finally {
      await second.close()
    }
  } finally {
    await first.close()
  }
})

test('关掉之后端口真的空了', async () => {
  const { handler } = fixture()
  const server = await startPanelServer(handler, { port: 0 })
  await server.close()
  await assert.rejects(() => fetch(server.url))
})
