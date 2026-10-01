/**
 * 面板 → 对话 那条线自己的一层：挑会话、投话、出错不炸。
 *
 * 这里不碰 HTTP，直接喂一个假的 sessionController 进来——真实服务在没有 DSH 的
 * 环境里根本起不来，而这条线的分支（没有服务 / 挑不到会话 / 投递被拒 / 投成功记住会话）
 * 全都能用假件逼出来。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createBridge } from '../lib/bridge.js'

/** 一个只记事的假 sessionController。 */
function fakeController({ items = [], fail = null } = {}) {
  const calls = { list: 0, prompt: [] }
  return {
    calls,
    async list() {
      calls.list += 1
      return { items }
    },
    async prompt(request) {
      calls.prompt.push(request)
      if (fail) throw fail
      return { accepted: true }
    },
  }
}

test('bridge：没有 sessionController 时不炸，只回一句话', async () => {
  const bridge = createBridge({ resolve: () => undefined })
  assert.equal(bridge.available, false)
  const out = await bridge.send('在吗')
  assert.equal(out.ok, false)
  assert.match(out.error, /sessionController/)
  assert.equal(bridge.sessionId, '')
})

test('bridge：空话不投', async () => {
  const bridge = createBridge({ resolve: () => fakeController() })
  const out = await bridge.send('   ')
  assert.equal(out.ok, false)
  assert.match(out.error, /没写东西/)
})

test('bridge：list 里挑第一个不是子 agent 的会话', async () => {
  const controller = fakeController({
    items: [
      { sessionId: 'sub-1', parentSessionId: 'p', origin: 'subagent', updatedAt: 9 },
      { sessionId: 'child', parentSessionId: 'p', updatedAt: 8 },
      { sessionId: 'main', updatedAt: 1 },
    ],
  })
  const bridge = createBridge({ resolve: () => controller })
  assert.equal(bridge.available, true)

  const out = await bridge.send('给我出三道题')
  assert.equal(out.ok, true)
  assert.equal(out.sessionId, 'main', '子 agent 的会话不能收面板的话')
  assert.equal(controller.calls.prompt.length, 1)

  const sent = controller.calls.prompt[0]
  assert.equal(sent.sessionId, 'main')
  assert.equal(sent.mode, 'queue')
  assert.equal(sent.content.length, 1)
  assert.equal(sent.content[0].type, 'text')
  assert.equal(sent.content[0].text, '给我出三道题')
  assert.ok(sent.requestId, '每次投递得有自己的 requestId')
})

test('bridge：投成功就记住那个会话，下一句不再 list', async () => {
  const controller = fakeController({ items: [{ sessionId: 'main' }] })
  const bridge = createBridge({ resolve: () => controller })

  await bridge.send('第一句')
  assert.equal(bridge.sessionId, 'main')
  const listed = controller.calls.list

  await bridge.send('第二句')
  assert.equal(controller.calls.list, listed, '记住的会话就别再挑一遍')
  assert.equal(controller.calls.prompt[1].sessionId, 'main')
})

test('bridge：投递被拒也只回 ok:false，不往外抛', async () => {
  const controller = fakeController({ items: [{ sessionId: 'main' }], fail: new Error('session is gone') })
  const bridge = createBridge({ resolve: () => controller })
  const out = await bridge.send('在吗')
  assert.equal(out.ok, false)
  assert.equal(out.sessionId, 'main')
  assert.match(out.error, /session is gone/)
})

test('bridge：挑不到会话时说清楚', async () => {
  const controller = fakeController({ items: [] })
  const bridge = createBridge({ resolve: () => controller })
  const out = await bridge.send('在吗')
  assert.equal(out.ok, false)
  assert.match(out.error, /没找到能收话的会话/)
})

test('bridge：resolve 抛错也算没有服务', async () => {
  const bridge = createBridge({
    resolve: () => {
      throw new Error('service not mounted')
    },
  })
  assert.equal(bridge.available, false)
  const out = await bridge.send('在吗')
  assert.equal(out.ok, false)
})
