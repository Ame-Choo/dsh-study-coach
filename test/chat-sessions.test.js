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

function fakeController({ items = [], createValue = null } = {}) {
  const calls = { list: 0, follow: [], create: [] }
  return {
    calls,
    async list() {
      calls.list += 1
      // items 也可以给一个函数：宿主是把新会话的投影异步写下来的，测试要能中途换清单。
      return { items: typeof items === 'function' ? items() : items }
    },
    async create(request) {
      calls.create.push(request)
      if (!createValue) throw new Error('这台宿主不能建会话')
      return createValue
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

test('面板自己新建的会话：报学习教练预设，投影没跟上也照样读得到', async () => {
  // 宿主是异步把新会话的投影写下来的：create 之后清单里才多一行，而且那行还没带预设。
  let rows = [box('code-1', 'coder', { updatedAt: 9 })]
  const controller = fakeController({
    items: () => rows,
    createValue: { sessionId: 'made-1', agentPreset: PRESET_ID },
  })
  const chat = createChat({ resolve: () => controller })

  const made = await chat.create()
  assert.equal(made.ok, true)
  assert.equal(made.sessionId, 'made-1')
  assert.deepEqual(controller.calls.create, [{ agentPreset: PRESET_ID }], '新建时报的预设号得跟判据同一个')

  rows = [box('code-1', 'coder', { updatedAt: 9 }), { sessionId: 'made-1', updatedAt: 20 }]
  const out = await chat.sessions()
  assert.equal(out.filtered, true)
  assert.deepEqual(out.sessions.map((s) => s.sessionId), ['made-1'], '刚建出来的那个不能被自己的筛子筛掉')

  const one = await chat.history({ sessionId: 'made-1' })
  assert.equal(one.ok, true)
  assert.equal(one.sessionId, 'made-1')
  assert.deepEqual(asked(controller.calls), ['made-1'])
})

test('建不出来就说清楚：宿主不认、或者根本没有会话服务', async () => {
  const controller = fakeController({ items: [] })
  const chat = createChat({ resolve: () => controller })
  const made = await chat.create()
  assert.equal(made.ok, false)
  assert.equal(made.sessionId, '')
  assert.match(made.error, /不能建会话/)

  const none = await createChat({ resolve: () => null }).create()
  assert.equal(none.ok, false)
  assert.equal(none.available, false, '面板据此退回「未接通」那一套')
  assert.equal(none.sessionId, '')
})
