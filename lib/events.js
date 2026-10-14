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
 *
 * **每一帧都带 id（单调递增的 seq）**，最近 `HISTORY_MAX` 帧留在内存里。这么做的来由是
 * 断线那一小段：浏览器自己会重连 EventSource，带 `Last-Event-ID` 回来（或者面板自己带
 * `?after=`），服务端就能把断掉那几帧补给它，而不是「断了就当无事发生，靠 2.5 秒轮询慢慢追」。
 * 事件本身不带业务数据（面板收到就重新拉快照），所以补帧只是「多提醒了一次」，不会错序。
 *
 * `PROTOCOL_VERSION` 跟着 /study/api/events 这条通道的帧格式走：加字段不动它，改帧的
 * 语义（或去掉某个字段）就得 +1，面板那边 `hello.protocolVersion` 对不上就退回轮询兜底。
 */
export const EVENTS_PATH = '/study/api/events'

/** 帧格式的版本号。只有「语义变了」才动它，加字段不算。 */
export const PROTOCOL_VERSION = 1

/** 留多少帧供断线重连补发。够覆盖一次刷新/短暂断网，又不至于攒住内存。 */
const HISTORY_MAX = 128

function frame(id, event, data) {
  /* `id:` 这一行是 SSE 规范里的 last event id：浏览器重连时会把它塞进 Last-Event-ID 头。 */
  return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`
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
  /* 环形缓冲：断线重连时按 id 补发。里面放的是已经拼好的帧文本，省得再拼一遍。 */
  const history = []

  function nextSeq() {
    seq += 1
    /* seq 溢出就当没发生过（2^53 之后的事，这里不操心），但别让它变成字符串。 */
    return seq
  }

  function remember(id, chunk) {
    history.push({ id, chunk })
    if (history.length > HISTORY_MAX) history.splice(0, history.length - HISTORY_MAX)
  }

  function emit(event, data) {
    const id = nextSeq()
    const chunk = frame(id, event, { ...data, seq: id })
    remember(id, chunk)
    return chunk
  }

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
    const chunk = emit('tick', { at: now() })
    for (const client of [...clients]) send(client, chunk)
  }

  /**
   * 接一个 SSE 长连接。路由那边拿到 `res` 直接交进来，自己就不管了。
   * @param {import('node:http').ServerResponse} res
   * @param {{ after?: number|string|null }} [options] 断线前收到的最后一个 id，补发它之后的帧
   * @returns {() => void} 退订
   */
  function subscribe(res, { after = null } = {}) {
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
    /* 断线重连：把断掉那几帧先补上。`after` 解析不出数就当没给（第一次连、或别人乱写）。
       补完照旧发 hello——面板收到任何一帧都会重新拉快照，多一次不算错。 */
    const from = Number(after)
    if (Number.isFinite(from) && from > 0) {
      for (const item of history) {
        if (item.id > from) send(client, item.chunk)
      }
    }
    send(client, emit('hello', { at: now(), protocolVersion: PROTOCOL_VERSION }))
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
    const chunk = emit('change', { topic: String(topic), at: now(), ...extra })
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

  return {
    subscribe,
    publish,
    stop,
    size: () => clients.size,
    path: EVENTS_PATH,
    version: PROTOCOL_VERSION,
    /** 缓冲里现在有几帧（测试看这个数，别拿它当接口用）。 */
    buffered: () => history.length,
    lastId: () => seq,
  }
}
