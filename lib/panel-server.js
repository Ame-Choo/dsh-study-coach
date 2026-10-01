/**
 * 插件自己起的小 HTTP 服务器，只为绕开 DSH 内嵌浏览器的「不许开 DSH 自身」。
 *
 * 面板的接口全部相对 /study，所以这里复用同一个 handler，页面上不用改一行。
 * 只监听 127.0.0.1，不对外。
 */
import { createServer } from 'node:http'

export const DEFAULT_PORT = 19388
export const PORT_TRIES = 20
export const HOST = '127.0.0.1'

function listen(handler, port, host) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      Promise.resolve(handler(req, res)).catch((error) => {
        try {
          const body = JSON.stringify({
            ok: false,
            error: { code: 'internal', message: String((error && error.message) ?? error) },
          })
          res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
          res.end(body)
        } catch {
          /* 客户端已经跑了，没法再回话 */
        }
      })
    })
    const onError = (error) => reject(error)
    server.once('error', onError)
    server.listen(port, host, () => {
      server.removeListener('error', onError)
      resolve(server)
    })
  })
}

/**
 * 从 port 起往后一个个试，占用就换下一个。
 * @returns {Promise<{ port: number, url: string, close: () => Promise<void> }>}
 */
export async function startPanelServer(handler, { port = DEFAULT_PORT, tries = PORT_TRIES, host = HOST } = {}) {
  for (let i = 0; i < tries; i += 1) {
    const candidate = port + i
    try {
      const server = await listen(handler, candidate, host)
      const actual = server.address().port
      return {
        port: actual,
        url: `http://${host}:${actual}/study`,
        /* 先把挂着的连接掐了再关。浏览器跟我们一直是 keep-alive，光 close() 要等那根
           连接自己断——面板上点「停止」或「重启」就会一直转圈，而浏览器永远不松手。 */
        close: () =>
          new Promise((resolve) => {
            if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
            server.close(() => resolve())
          }),
      }
    } catch (error) {
      if (error && error.code === 'EADDRINUSE') continue
      throw error
    }
  }
  throw new Error(`端口 ${port} 到 ${port + tries - 1} 全被占了`)
}

/**
 * 把「面板服务开着没有」收成一个可问、可开、可关的小控制器。
 *
 * 这段状态原来散在 index.js 的 effect 里（一个 state.stopped 布尔 + 一个直接
 * await 的 startPanelServer），够用是因为那时根本没打算让人事后动它。既然要给出
 * 「启动键」，就得能问状态、能停、能换端口重启，而且连着点几下不能起出两个
 * 服务器——所以挪到这里，带上幂等和并发的合流。
 *
 * 起不来不算失败：端口全被占这种事记进 info().error 就完事，让面板上看得见，
 * 不能让插件加载直接挂掉。
 */
export function createPanelControl({ handler, port = DEFAULT_PORT, tries = PORT_TRIES, host = HOST } = {}) {
  const state = { server: null, port: null, url: null, error: null, preferred: port, starting: null }

  function info() {
    return {
      running: Boolean(state.server),
      port: state.server ? state.port : null,
      url: state.server ? state.url : null,
      preferred: state.preferred,
      /* 没起来时也得给人一个能粘的地址：首选端口那个。 */
      hintUrl: `http://${host}:${state.preferred}/study`,
      error: state.error,
    }
  }

  /** 起服务。已经开着就直接回报，正在起就合流到同一个 promise——别起出两个。 */
  function start(nextPort) {
    if (nextPort !== undefined) state.preferred = nextPort
    if (state.server) return Promise.resolve(info())
    if (state.starting) return state.starting
    state.error = null
    state.starting = startPanelServer(handler, { port: state.preferred, tries, host })
      .then((server) => {
        state.server = server
        state.port = server.port
        state.url = server.url
        return info()
      })
      .catch((error) => {
        state.error = String((error && error.message) ?? error)
        return info()
      })
      .finally(() => {
        state.starting = null
      })
    return state.starting
  }

  function stop() {
    const server = state.server
    state.server = null
    state.port = null
    state.url = null
    state.error = null
    if (!server) return Promise.resolve(info())
    return server.close().then(() => info())
  }

  function restart(nextPort) {
    return stop().then(() => start(nextPort))
  }

  return { info, start, stop, restart }
}
