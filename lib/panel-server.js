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
        close: () => new Promise((resolve) => server.close(() => resolve())),
      }
    } catch (error) {
      if (error && error.code === 'EADDRINUSE') continue
      throw error
    }
  }
  throw new Error(`端口 ${port} 到 ${port + tries - 1} 全被占了`)
}
