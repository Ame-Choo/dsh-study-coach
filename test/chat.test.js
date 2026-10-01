/**
 * 把对话读回面板那条线。
 *
 * 假一个 sessionController 挂进 ctx.get()，然后走真的 HTTP（和 ask.test.js 一个路数）：
 * 面板打 /study/api/chat 时到底拿到什么、子 agent 会话会不会混进来、follow 挂了怎么办。
 *
 * 事件形状照磁盘上 session.v4 日志实测的样子造（见 lib/chat.js 顶部注释），
 * 所以这一份过了，说明解析口径和真实日志对得上。
 *
 * 全塞进一个 test：同一文件里的用例会并发跑，共用一份档案会互相踩。
 */
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toMessages } from '../lib/chat.js'
import { Library } from '../lib/library.js'
import { createRouter } from '../lib/routes.js'

const root = mkdtempSync(join(tmpdir(), 'study-chat-'))
process.env.DSH_STUDY_ROOT = root

const NOW = Date.now()

/** 一段真日志的样子：有正文、有推理、有工具调用、还有不该露面的系统消息。 */
const LOG = [
  { type: 'user/message', seq: 9, time: NOW - 5000, data: { content: [{ type: 'text', text: '这节的含参讨论我没跟上' }] } },
  { type: 'step/start', seq: 10, time: NOW - 4900, data: { turn: 1, step: 1 } },
  {
    type: 'assistant/message',
    seq: 16,
    time: NOW - 3000,
    data: {
      turn: 1,
      step: 1,
      message: {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: '这段推理不该画出来' },
          { type: 'text', text: '我们把它拆成两步看。' },
          { type: 'tool-call', id: 'c1', name: 'read' },
        ],
      },
      usage: { totalTokens: 120 },
    },
  },
  { type: 'tool/call', seq: 17, time: NOW - 2900, data: { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: '{"file_path":"F:\\\\讲义.pdf"}' } },
  {
    type: 'tool/result',
    seq: 18,
    time: NOW - 2800,
    data: { turn: 1, step: 1, message: { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: '（讲义内容）' }] } },
  },
  { type: 'system/message', seq: 19, time: NOW - 2700, data: { turn: 1, step: 1, message: { role: 'system', content: [{ type: 'text', text: '这段话不该出现在面板里' }] } } },
  { type: 'session-log-deepseek/delivery-accepted', seq: 20, time: NOW - 2600, data: { sessionId: 'live-1', throughSeq: 19 } },
]

const pushed = []
const sessionsCalls = []
let failFollow = false

const sessionController = {
  async list() {
    sessionsCalls.push(1)
    return {
      items: [
        // 子 agent：教练自己的手脚，不该出现在面板的会话选择里
        { sessionId: 'sub-1', updatedAt: NOW, parentSessionId: 'session-a', origin: 'subagent' },
        { sessionId: 'old-1', updatedAt: NOW - 10000, title: '旧会话' },
        { sessionId: 'blank-1', updatedAt: NOW + 1000, blank: true, title: '刚开的' },
        { sessionId: 'live-1', updatedAt: NOW, title: '学习教练' },
      ],
    }
  },
  async prompt(request) {
    pushed.push(request)
    return { accepted: true }
  },
  follow(request, signal) {
    const seen = { request, aborted: false }
    if (signal) signal.addEventListener('abort', () => {
      seen.aborted = true
    })
    return (async function* () {
      if (failFollow) throw new Error('日志读不出来')
      yield { type: 'snapshot', header: { title: '学习教练' }, cursor: 20, hasMore: false, records: LOG.map((event) => ({ type: 'event', event })) }
      // 后面这些不该被读到：实现拿到 snapshot 就该退订
      yield { type: 'event', event: { type: 'user/message', seq: 21, time: NOW, data: { content: [{ type: 'text', text: '这条不该进结果' }] } } }
    })()
  },
}

const routes = []
const disposers = []
const ctx = {
  effect(fn) {
    const d = fn()
    if (typeof d === 'function') disposers.push(d)
    return () => {}
  },
  get(name) {
    return name === 'sessionController' ? sessionController : undefined
  },
  webServer: {
    register(route) {
      routes.push(route)
      return () => {}
    },
  },
  tools: { register: () => () => {} },
  agentPresets: { register: async () => () => {} },
}

const mod = await import('../index.js')
mod.apply(ctx)

const server = createServer((req, res) => routes[0].handler(req, res))
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

after(async () => {
  await new Promise((resolve) => server.close(resolve))
  for (const dispose of disposers) {
    try {
      dispose()
    } catch {
      /* 收尾失败不该盖掉断言结果 */
    }
  }
  rmSync(root, { recursive: true, force: true })
})

test('对话读进面板：只留正文，推理和系统消息不露面，内容对得上', async () => {
  // 一、解析口径
  const messages = toMessages(LOG.map((event) => ({ type: 'event', event })))
  assert.deepEqual(
    messages.map((m) => m.role),
    ['user', 'assistant', 'tool', 'result'],
    'system/message、step/*、session-log-* 都该被丢掉',
  )
  assert.equal(messages[0].text, '这节的含参讨论我没跟上')
  assert.equal(messages[1].text, '我们把它拆成两步看。')
  assert.doesNotMatch(messages[1].text, /推理/, 'reasoning 不该进正文')
  assert.deepEqual(messages[1].tools, ['read'])
  assert.equal(messages[1].tokens, 120)
  assert.equal(messages[2].tool.name, 'read')
  assert.equal(messages[2].tool.hint, 'F:\\讲义.pdf', '工具参数摘要要挑出最好认的那个值')
  assert.equal(messages[3].role, 'result')
  assert.equal(messages[3].tool.callId, 'c1')
  assert.ok(messages.every((m) => typeof m.seq === 'number'), '每条都要带 seq，前端才好按序合并')

  // 二、接口侧：不给 sessionId，服务端自己挑最近那个有内容的会话
  const one = await (await fetch(base + '/study/api/chat')).json()
  assert.equal(one.ok, true)
  assert.equal(one.available, true)
  assert.equal(one.sessionId, 'live-1', 'blank 和「刚开的」要被跳过')
  assert.equal(one.title, '学习教练')
  assert.equal(one.cursor, 20)
  assert.equal(one.messages.length, 4)
  assert.equal(one.messages.at(-1).role, 'result', '拿到 snapshot 就该退订，seq 21 那条不该混进来')

  // 三、会话清单：子 agent 不进面板
  const two = await (await fetch(base + '/study/api/chat/sessions')).json()
  assert.equal(two.available, true)
  assert.deepEqual(
    two.sessions.map((s) => s.sessionId),
    ['blank-1', 'live-1', 'old-1'],
    '按更新时间倒序，且没有 sub-1',
  )
  assert.ok(sessionsCalls.length >= 1)

  // 四、投递：说出去的话进的是同一个会话
  const three = await (
    await fetch(base + '/study/api/chat/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '再讲一遍第九组', sessionId: 'live-1' }),
    })
  ).json()
  assert.equal(three.ok, true)
  assert.equal(three.sessionId, 'live-1')
  assert.equal(pushed.length, 1)
  assert.equal(pushed[0].sessionId, 'live-1')
  assert.equal(pushed[0].content[0].text, '再讲一遍第九组')

  // 五、空话不发
  const four = await fetch(base + '/study/api/chat/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '   ' }),
  })
  assert.equal(four.status, 400)
  assert.equal(pushed.length, 1, '空内容不该投出去')

  // 六、日志读不出来时要说清原因，别装作没事
  failFollow = true
  const five = await (await fetch(base + '/study/api/chat')).json()
  assert.equal(five.ok, false)
  assert.equal(five.available, true, '通道在，是这一次读失败')
  assert.match(five.error, /日志读不出来/)
  assert.deepEqual(five.messages, [])
  failFollow = false
})

test('没有会话服务时：插件照样装得上，接口只回一句「没接通」', async () => {
  const store = new Library(mkdtempSync(join(tmpdir(), 'study-chat-none-')))
  try {
    store.ensure()
    const handle = createRouter(store, {})
    const out = await handle({ method: 'GET', pathname: '/study/api/chat', query: {} })
    assert.equal(out.code, 200)
    assert.equal(out.body.ok, false)
    assert.equal(out.body.available, false)
    assert.match(out.body.error, /没有会话通道/)
    assert.deepEqual(out.body.messages, [])
  } finally {
    rmSync(store.root, { recursive: true, force: true })
  }
})
