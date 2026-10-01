/**
 * 一条很小的广播通道（Server-Sent Events）。
 *
 * 起因：面板的对话页原来自个儿 `setInterval(…, 2500)` 拉快照。可是**标签页切到后台之后
 * 浏览器会把定时器压到一分钟一次甚至冻住**（切回来也不补一次），学生看到的就是
 * 「消息得手动刷新一下才出来」。服务端的定时器不受这个限制，所以改成服务端推、前端一收到就刷。
 *
 * 只推「该看一眼了」这一件事，不带业务数据：面板本来就有指纹去重（`chatStamp`），
 * 多推几次不会闪，少推几次也没关系——原来那条 2.5 秒轮询留着当兜底，
 * 通道断了（`EventSource.onerror`）就退回老路子。
 *
 * 两条帧：
 *   `hello`  一连上就发一发，让面板立刻刷一次（不用等第一个 tick）
 *   `tick`   每隔 `intervalMs` 一发
 *   `change` 写操作自己 `publish()` 出来的（投话成功、任务被勾掉这类），比 tick 更即时
 */
export const EVENTS_PATH = '/study/api/events'

function frame(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

/**
 * @param {object} [options]
 * @param {number} [options.intervalMs] 心跳间隔（默认 2500，跟面板原来的轮询一个节奏）
 * @param {() => number} [options.now]
 */
export function createEvents({ intervalMs = 2500, now = Date.now } = {}) {
  const clients = new Set()
  let timer = null
  let seq = 0
  let stopped = false

  function drop(client) {
    if (!clients.delete(client)) return
    try {
      client.res.end()
    } catch {
      /* 对面已经走了 */
    }
    /* 一个人都不看了就把定时器停掉——空转的 interval 会拖着进程不让退 */
    if (clients.size === 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }

  function send(client, chunk) {
    try {
      client.res.write(chunk)
    } catch {
      drop(client)
    }
  }

  function tick() {
    if (!clients.size) return
    seq += 1
    const chunk = frame('tick', { seq, at: now() })
    for (const client of [...clients]) send(client, chunk)
  }

  /**
   * 接一个 SSE 长连接。路由那边拿到 `res` 直接交进来，自己就不管了。
   * @param {import('node:http').ServerResponse} res
   * @returns {() => void} 退订
   */
  function subscribe(res) {
    if (!res || stopped) return () => {}
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    /* 开头一条注释帧：有些代理要看到第一个字节才肯把响应头放出去 */
    res.write(': 学习教练广播通道\n\n')
    const client = { res }
    clients.add(client)
    send(client, frame('hello', { seq, at: now() }))
    if (!timer) {
      timer = setInterval(tick, Math.max(250, Number(intervalMs) || 2500))
      if (typeof timer.unref === 'function') timer.unref()
    }
    const close = () => drop(client)
    res.on('close', close)
    res.on('error', close)
    return close
  }

  /** 写操作自己报一声「变了」。返回推给了几个人（测试看这个数）。 */
  function publish(topic = 'change', extra = {}) {
    if (!clients.size) return 0
    const chunk = frame('change', { topic: String(topic), at: now(), ...extra })
    for (const client of [...clients]) send(client, chunk)
    return clients.size
  }

  function stop() {
    stopped = true
    for (const client of [...clients]) drop(client)
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  return { subscribe, publish, stop, size: () => clients.size, path: EVENTS_PATH }
}
