/**
 * 面板与接口的 HTTP 处理器。
 *
 * 同一份逻辑挂两个地方：
 *   1. DSH 自己的 webServer —— 同源 /study，系统浏览器和对话里的链接走这条；
 *   2. 插件自己起的独立端口 —— DSH 内嵌浏览器不让开 DSH 自身 origin，
 *      换个端口就是另一个 origin，它才肯加载。
 *
 *   GET  /study            → 面板页面
 *   GET  /study/assets/*   → 面板的 js / css
 *   *    /study/api/*      → 学习档案读写（见 lib/routes.js）
 */
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'

export const ASSET_PREFIX = '/study/assets/'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
}

function sendJson(res, code, value) {
  const body = JSON.stringify(value)
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

function sendFile(res, file, code = 200) {
  const body = readFileSync(file)
  res.writeHead(code, {
    'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': body.length,
    'cache-control': 'no-store',
  })
  res.end(body)
}

/**
 * 面板上「点开这份东西」走这条路：只有已经登记进档案的材料（profile.materials 里
 * 那个 path）底下的文件和文件夹才放行，别的一概当不存在。免得面板变成任意文件读取器。
 * 文件夹也放行——看课那类入口给的就是一节课的文件夹，进去再列出来挑。
 */
function allowedTarget(store, raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return null
  const target = resolve(raw)
  const materials = store.read('profile').materials
  const list = Array.isArray(materials) ? materials : []
  for (const m of list) {
    if (!m || !m.path) continue
    const base = resolve(String(m.path))
    if (target !== base && !target.startsWith(base + sep)) continue
    if (!existsSync(target)) continue
    try {
      statSync(target)
      return target
    } catch {
      /* 文件正好被挪走，当没有 */
    }
  }
  return null
}

/** 目录名、文件名都要拼进 HTML，先转义。 */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 点开的是文件夹（比如一节网课）就连内容一起列出来，让用户自己挑要播哪个。 */
function sendDir(res, dir) {
  let entries = []
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    entries = []
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  const rows = entries
    .map((entry) => {
      const full = join(dir, entry.name)
      const href = '/study/file?path=' + encodeURIComponent(full)
      const tag = entry.isDirectory() ? '<span class="tag">目录</span>' : ''
      return `<li><a href="${href}">${tag}${escapeHtml(entry.name)}</a></li>`
    })
    .join('\n')
  const name = dir.slice(dir.lastIndexOf(sep) + 1) || dir
  const parent = dir.slice(0, dir.lastIndexOf(sep)) || dir
  const back = dir === parent ? '' : `<a class="back" href="/study/file?path=${encodeURIComponent(parent)}">上一层</a>`
  const body = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(name)}</title>
<style>
  :root { color-scheme: dark }
  body { margin: 0; padding: 24px 20px 48px; background: #14161a; color: #dfe3ea;
         font: 15px/1.7 system-ui, -apple-system, "Microsoft YaHei", sans-serif }
  h1 { margin: 0 0 4px; font-size: 17px; font-weight: 600 }
  p.path { margin: 0 0 18px; color: #7d8aa0; font-size: 12px; word-break: break-all }
  ul { list-style: none; margin: 0; padding: 0; max-width: 880px }
  li + li { margin-top: 6px }
  a { display: block; padding: 9px 12px; border: 1px solid #2c313a; border-radius: 8px;
      background: #1b1e24; color: #dfe3ea; text-decoration: none; word-break: break-all }
  a:hover { border-color: #4d9de0; background: #202531 }
  a.back { display: inline-block; margin-bottom: 14px; padding: 5px 10px; font-size: 13px; color: #7d8aa0 }
  .tag { display: inline-block; margin-right: 8px; padding: 1px 6px; border-radius: 4px;
         background: #2c313a; color: #9aa6b8; font-size: 11px; vertical-align: 1px }
</style></head><body>
${back}
<h1>${escapeHtml(name)}</h1>
<p class="path">${escapeHtml(dir)}</p>
<ul>
${rows || '<li style="color:#7d8aa0">这个文件夹里是空的</li>'}
</ul>
</body></html>`
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

/** 流式把文件吐出去，支持 Range——视频要能拖进度条。 */
function sendStream(req, res, file) {
  const size = statSync(file).size
  const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'
  const range = typeof req.headers.range === 'string' ? /^bytes=(\d*)-(\d*)$/.exec(req.headers.range.trim()) : null
  if (range) {
    const open = range[1] === ''
    const start = open ? Math.max(0, size - Number(range[2] || 0)) : Number(range[1])
    const end = open || range[2] === '' ? size - 1 : Number(range[2])
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
      res.writeHead(416, { 'content-range': `bytes */${size}` })
      res.end()
      return
    }
    res.writeHead(206, {
      'content-type': type,
      'content-length': end - start + 1,
      'content-range': `bytes ${start}-${end}/${size}`,
      'accept-ranges': 'bytes',
      'cache-control': 'no-store',
    })
    createReadStream(file, { start, end }).pipe(res)
    return
  }
  res.writeHead(200, {
    'content-type': type,
    'content-length': size,
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
  })
  createReadStream(file).pipe(res)
}

async function readBody(req, limit = 2 << 20) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  return JSON.parse(text)
}

/**
 * @param {object} store   Store 实例（留给将来插手静态之外的路径）
 * @param {(request: object) => { code: number, body: unknown }} router
 * @param {{ assetsDir: string }} options
 */
export function createHandler(store, router, { assetsDir }) {
  /** 面板和它的静态资源只从 assets 目录出，别的地方一律 404。 */
  function resolveAsset(pathname) {
    const rel = pathname.slice(ASSET_PREFIX.length)
    if (rel === '') return null
    const target = normalize(join(assetsDir, rel))
    if (!target.startsWith(assetsDir)) return null
    if (!existsSync(target) || !statSync(target).isFile()) return null
    return target
  }

  return async function handler(req, res) {
    const url = new URL(req.url ?? '/', 'http://dsh.internal')
    const path = url.pathname
    try {
      if (path === '/study' || path === '/study/') {
        const panel = join(assetsDir, 'panel.html')
        if (existsSync(panel)) sendFile(res, panel)
        else sendJson(res, 500, { ok: false, error: { code: 'missing-panel', message: 'assets/panel.html 不在' } })
        return
      }
      if (path === '/study/practice' || path === '/study/practice/') {
        const page = join(assetsDir, 'practice.html')
        if (existsSync(page)) sendFile(res, page)
        else sendJson(res, 500, { ok: false, error: { code: 'missing-page', message: 'assets/practice.html 不在' } })
        return
      }
      if (path.startsWith(ASSET_PREFIX)) {
        const file = resolveAsset(path)
        if (!file) {
          sendJson(res, 404, { ok: false, error: { code: 'not-found', message: '没有这个资源' } })
          return
        }
        sendFile(res, file)
        return
      }
      if (path === '/study/file') {
        const file = allowedTarget(store, url.searchParams.get('path'))
        if (!file) {
          sendJson(res, 404, {
            ok: false,
            error: { code: 'not-found', message: '这个文件不在已登记的材料里，或者已经不在那个位置了' },
          })
          return
        }
        let isDir = false
        try {
          isDir = statSync(file).isDirectory()
        } catch {
          /* 刚被挪走就当文件发，错了自然报错 */
        }
        if (isDir) {
          sendDir(res, file)
          return
        }
        sendStream(req, res, file)
        return
      }
      const wantsBody = req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH'
      const body = wantsBody ? await readBody(req) : {}
      // 有几条路由是异步的（面板往对话里投话），这里必须等它落地，
      // 否则拿到的是一张还没结果的白卷。
      const result = await router({
        method: req.method,
        pathname: path,
        query: Object.fromEntries(url.searchParams),
        body,
      })
      sendJson(res, result.code, result.body)
    } catch (error) {
      const message = String((error && error.message) ?? error)
      sendJson(res, 500, { ok: false, error: { code: 'internal', message } })
    }
  }
}
