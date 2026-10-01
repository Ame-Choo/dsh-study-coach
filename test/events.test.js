/**
 * 广播通道：`lib/events.js` 与 `/study/api/events`。
 *
 * 「收到的消息要手动刷新才显示」的根子是浏览器会把后台标签页里的 `setInterval` 压到一分钟一次
 * 甚至冻住（切回来也不补），所以改成服务端推。这一份钉住：帧长什么样、多久一发、
 * 断开以后必须退订（不然那条 SSE 长连接会一直挂在进程里）、以及没接通道时 HTTP 得说清楚。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { EVENTS_PATH, createEvents } from '../lib/events.js'
import { createHandler } from '../lib/handler.js'
import { createRouter } from '../lib/routes.js'
import { Store } from '../lib/store.js'

/** 一个够用的假响应：事件接口只用到 writeHead / write / end / on。 */
function fakeRes() {
  const res = new EventEmitter()
  res.headers = null
  res.chunks = []
  res.ended = false
  res.writeHead = (code, headers) => {
    res.code = code
    res.headers = headers
    return res
  }
  res.write = (chunk) => {
    res.chunks.push(String(chunk))
    return true
  }
  res.end = () => {
    res.ended = true
    return res
  }
  return res
}

const body = (res) => res.chunks.join('')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('接上就写对头、发一帧 hello；断开就退订', () => {
  const events = createEvents({ intervalMs: 60000 })
  const res = fakeRes()
  const off = events.subscribe(res)
  assert.equal(res.code, 200)
  assert.equal(res.headers['content-type'], 'text/event-stream; charset=utf-8')
  assert.equal(res.headers['cache-control'], 'no-cache, no-transform')
  assert.equal(res.headers.connection, 'keep-alive')
  /* 先一条注释帧：有些代理要看到第一个字节才肯把响应头放出去 */
  assert.match(body(res), /^: 学习教练广播通道\n\n/)
  assert.match(body(res), /event: hello\n/)
  assert.match(body(res), /"seq":0/)
  assert.equal(events.size(), 1)

  off()
  assert.equal(events.size(), 0)
  events.stop()
})

test('心跳按节奏推 tick；写操作 publish 立刻推 change', async () => {
  const events = createEvents({ intervalMs: 250 })
  const res = fakeRes()
  events.subscribe(res)
  await sleep(400)
  assert.match(body(res), /event: tick\n/)
  const ticks = body(res).match(/event: tick/g) || []
  assert.ok(ticks.length >= 1, '心跳至少发了一帧')

  const before = body(res)
  assert.equal(events.publish('chat'), 1)
  assert.match(body(res).slice(before.length), /event: change\n/)
  assert.match(body(res).slice(before.length), /"topic":"chat"/)
  events.stop()
})

test('一个人都没有时 publish 不写东西，也不空转定时器', () => {
  const events = createEvents({ intervalMs: 10 })
  assert.equal(events.publish('chat'), 0)
  const res = fakeRes()
  const off = events.subscribe(res)
  off()
  /* 退订之后再 publish：还是没人收 */
  assert.equal(events.publish('chat'), 0)
  assert.equal(res.ended, true)
  events.stop()
  /* stop 之后再接：直接不收（返回一个空退订，不会留下没人管的连接） */
  const late = fakeRes()
  events.subscribe(late)
  assert.equal(events.size(), 0)
  assert.equal(body(late), '')
})

test('客户端自己断了（close/error）要退订，不然长连接会一直挂着', () => {
  const events = createEvents({ intervalMs: 60000 })
  const res = fakeRes()
  events.subscribe(res)
  assert.equal(events.size(), 1)
  res.emit('close')
  assert.equal(events.size(), 0)
  res.emit('error')
  assert.equal(events.size(), 0)

  const other = fakeRes()
  events.subscribe(other)
  other.emit('error')
  assert.equal(events.size(), 0)
  events.stop()
})

test('HTTP：HEAD 探活回 JSON，GET 是一条真的 SSE 流，没接通道时 503', async () => {
  const root = mkdtempSync(join(tmpdir(), 'study-events-'))
  const store = new Store(root)
  const assets = fileURLToPath(new URL('../assets', import.meta.url))
  const events = createEvents({ intervalMs: 250 })
  const served = createHandler(store, createRouter(store, { events }), { assetsDir: assets })
  const bare = createHandler(store, createRouter(store, {}), { assetsDir: assets })
  const server = createServer((req, res) => {
    void served(req, res)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`

  try {
    assert.equal(EVENTS_PATH, '/study/api/events')
    /* HEAD 探活：路由按 GET 找，只有头没有体 */
    const head = await fetch(`${base}${EVENTS_PATH}`, { method: 'HEAD' })
    assert.equal(head.status, 200)

    const res = await fetch(`${base}${EVENTS_PATH}`)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8')
    const reader = res.body.getReader()
    let seen = ''
    /** 读到出现某一帧为止（一帧可能被拆成好几个 chunk）。 */
    async function until(re, ms = 2000) {
      const deadline = Date.now() + ms
      while (!re.test(seen) && Date.now() < deadline) {
        const { value, done } = await reader.read()
        if (done) break
        seen += Buffer.from(value).toString('utf8')
      }
      return seen
    }
    await until(/event: hello/)
    assert.match(seen, /event: hello/)
    await until(/event: tick/)
    assert.match(seen, /event: tick/)
    await reader.cancel()
    await sleep(30)
    /* 断开之后不能还留着订阅 */
    assert.equal(events.size(), 0)
  } finally {
    events.stop()
    await new Promise((resolve) => server.close(resolve))
    rmSync(root, { recursive: true, force: true })
  }

  const gone = createServer((req, res) => {
    void bare(req, res)
  })
  await new Promise((resolve) => gone.listen(0, '127.0.0.1', resolve))
  try {
    const res = await fetch(`http://127.0.0.1:${gone.address().port}${EVENTS_PATH}`)
    assert.equal(res.status, 503)
    assert.match(await res.text(), /没接广播通道/)
  } finally {
    await new Promise((resolve) => gone.close(resolve))
  }
})
