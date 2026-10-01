/**
 * 面板那一页读哪些会话：只读学习模式（agentPreset = study-coach）的。
 *
 * 走真的 createChat（不搭 HTTP），假 sessionController 只实现 list / follow 两件事。
 * 钉三件事：清单只列学习会话、显式塞别人的会话 id 也读不到、老宿主（不发会话投影）
 * 原样放行——最后一条最要紧，别把升级成新 DSH 之前的人筛成一片空白。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createChat } from '../lib/chat.js'
import { PRESET_ID } from '../lib/preset.js'

/** 带会话投影的一行（宿主会发 agentPreset 的那种）。 */
const box = (id, agentPreset, extra = {}) => ({
  sessionId: id,
  ...extra,
  projections: { kind: 'cached', asOfSeq: 3, values: { agentPreset } },
})

function fakeController({ items = [] } = {}) {
  const calls = { list: 0, follow: [] }
  return {
    calls,
    async list() {
      calls.list += 1
      return { items }
    },
    follow(request) {
      calls.follow.push(request)
      const sessionId = request && request.address ? request.address.sessionId : ''
      return (async function* () {
        yield { type: 'snapshot', cursor: 3, header: { sessionId }, records: [] }
      })()
    },
  }
}

/** 读过哪几个会话的日志。 */
const asked = (calls) => calls.follow.map((r) => r.address.sessionId)

test('发会话投影的宿主：对话页只列学习模式的会话', async () => {
  const controller = fakeController({
    items: [
      { sessionId: 'code-1', updatedAt: 9, projections: { values: { agentPreset: 'coder' } } },
      box('live-1', PRESET_ID, { updatedAt: 5 }),
      box('plain-1', null, { updatedAt: 8 }),
      box('sub-1', PRESET_ID, { parentSessionId: 'live-1', origin: 'subagent', updatedAt: 10 }),
    ],
  })
  const chat = createChat({ resolve: () => controller })

  const out = await chat.sessions()
  assert.equal(out.ok, true)
  assert.equal(out.filtered, true, 'filtered=true 时面板才会写一句「只看学习模式」')
  assert.deepEqual(out.sessions.map((s) => s.sessionId), ['live-1'])

  const one = await chat.history({})
  assert.equal(one.ok, true)
  assert.equal(one.sessionId, 'live-1', '最近那个是编程会话，也不能顺手读它')
  assert.deepEqual(asked(controller.calls), ['live-1'])
})

test('显式塞一个别的会话：不读它的日志，直接说清楚', async () => {
  const controller = fakeController({
    items: [
      { sessionId: 'code-1', updatedAt: 9, projections: { values: { agentPreset: 'coder' } } },
      box('live-1', PRESET_ID, { updatedAt: 5 }),
    ],
  })
  const chat = createChat({ resolve: () => controller })

  const bad = await chat.history({ sessionId: 'code-1' })
  assert.equal(bad.ok, false)
  assert.equal(bad.filtered, true)
  assert.match(bad.error, /学习教练/)
  assert.deepEqual(bad.messages, [])
  assert.deepEqual(asked(controller.calls), [], '核一下清单就够，不该真去读那条日志')

  // 面板直接带 id 进来、手上还没清单时，也得先自己核一遍
  const fresh = createChat({ resolve: () => controller })
  const blocked = await fresh.history({ sessionId: 'code-1' })
  assert.equal(blocked.ok, false)
  assert.deepEqual(asked(controller.calls), [])

  // 学习模式那个照样读得到
  const good = await chat.history({ sessionId: 'live-1' })
  assert.equal(good.ok, true)
  assert.equal(good.sessionId, 'live-1')
  assert.deepEqual(asked(controller.calls), ['live-1'])
})

test('不发会话投影的老宿主：清单原样列，显式 id 也不拦', async () => {
  const controller = fakeController({
    items: [
      { sessionId: 'a', updatedAt: 2 },
      { sessionId: 'b', updatedAt: 1 },
    ],
  })
  const chat = createChat({ resolve: () => controller })

  const out = await chat.sessions()
  assert.equal(out.filtered, false, 'filtered=false 说的是「这次没敢筛」，面板不该说「只看学习模式」')
  assert.deepEqual(out.sessions.map((s) => s.sessionId), ['a', 'b'])

  const fresh = createChat({ resolve: () => controller })
  const one = await fresh.history({ sessionId: 'b' })
  assert.equal(one.ok, true)
  assert.equal(one.sessionId, 'b')
  assert.deepEqual(asked(controller.calls), ['b'])
})

test('一个学习模式的会话都没有：清单空着，也不去读别人的日志', async () => {
  const controller = fakeController({
    items: [{ sessionId: 'code-1', updatedAt: 3, projections: { values: { agentPreset: 'coder' } } }],
  })
  const chat = createChat({ resolve: () => controller })

  const out = await chat.sessions()
  assert.equal(out.ok, true)
  assert.equal(out.filtered, true)
  assert.deepEqual(out.sessions, [])

  const one = await chat.history({})
  assert.equal(one.ok, true)
  assert.equal(one.sessionId, '')
  assert.deepEqual(one.messages, [])
  assert.deepEqual(asked(controller.calls), [], '宁可不读，也别把别人的日志画到这一页上')
})
