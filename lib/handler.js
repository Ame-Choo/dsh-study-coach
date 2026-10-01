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
 *   GET  /study/read       → 读卷页（.md/.txt 那些按面板版式摊开，不是倒源码）
 *   GET  /study/api/doc    → 读卷页要的正文（只在已登记材料范围内）
 *   *    /study/api/*      → 学习档案读写（见 lib/routes.js）
 */
import { closeSync, createReadStream, createWriteStream, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'

import { pagesRootOf, uploadRootOf } from './paths.js'
import { DOC_EXTS } from './urls.js'

export const ASSET_PREFIX = '/study/assets/'

/**
 * 面板的子页面。都发同一份 panel.html，具体看哪一页由前端按 location.pathname 认。
 * 一页一件事：主页面只回答「现在什么情况、下一步去哪儿」，干活的东西在各自子页面里。
 */
export const PANEL_PAGES = ['today', 'map', 'ability', 'library', 'coach', 'materials', 'toolbox']

/**
 * 网页上传原件走的地址。走裸 body 而不是 multipart：省掉一整个 multipart 解析器，
 * 文件名放 `x-file-name` 头里（URI 编码，中文名才不会被 header 的 latin-1 啃掉）。
 */
export const UPLOAD_PATH = '/study/api/material/upload'

/** 一次上传最多多大。比这大的走「粘贴本机路径」——那种不搬原件，只登记。 */
export const MAX_UPLOAD_BYTES = 300 * 1024 * 1024

/**
 * 读卷页一次最多读进来多少正文。超过就在这儿截断，页面里说清楚还有下文。
 * 别整个读进来：材料路径是从档案里来的，有人真会指着一段几百兆的网课视频。
 */
export const MAX_DOC_BYTES = 512 * 1024

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
  '.woff2': 'font/woff2',
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

/** 只读文件的开头最多 max 字节。读不满（文件比 max 短）就读到哪算哪。 */
function readHead(file, max) {
  const fd = openSync(file, 'r')
  try {
    const buf = Buffer.alloc(max)
    let got = 0
    while (got < max) {
      const n = readSync(fd, buf, got, max - got, got)
      if (n <= 0) break
      got += n
    }
    return buf.subarray(0, got)
  } finally {
    closeSync(fd)
  }
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

/** 文件名里只留最后一段，别让人用 `../` 写到别处去。 */
function safeName(raw) {
  const base = String(raw || '').split(/[\\/]/).pop() || ''
  return base.replace(/[\u0000-\u001f<>:"|?*]/g, '_').trim().slice(0, 160)
}

/**
 * 收一个上传的原件，边收边落盘。
 *
 * 不缓冲到内存：一本教辅上百兆，Buffer.concat 一把就把它整个塞进堆里。
 * 落盘位置由调用方给（插件的数据根），原件不动用户自己的文件夹。
 */
async function receiveUpload(req, root) {
  const name = safeName(decodeURIComponent(String(req.headers['x-file-name'] || '')))
  if (!name) return { code: 400, body: { ok: false, error: { code: 'bad-request', message: '请求头里没有 x-file-name，不知道这个文件叫什么' } } }
  const dir = join(root, 'up-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7))
  try {
    mkdirSync(dir, { recursive: true })
  } catch (error) {
    return { code: 500, body: { ok: false, error: { code: 'fs-error', message: `建不了上传目录：${error.message}` } } }
  }
  const target = join(dir, name)
  let size = 0
  const out = createWriteStream(target)
  try {
    for await (const chunk of req) {
      size += chunk.length
      if (size > MAX_UPLOAD_BYTES) throw new Error(`这个文件太大了（超过 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB），走「粘贴本机路径」吧，那个不搬原件`)
      if (!out.write(chunk)) await new Promise((done) => out.once('drain', done))
    }
    await new Promise((done, fail) => out.end((error) => (error ? fail(error) : done())))
  } catch (error) {
    out.destroy()
    try {
      rmSync(target, { force: true })
    } catch {
      /* 删不掉就算了，下次覆盖 */
    }
    return { code: 400, body: { ok: false, error: { code: 'upload-failed', message: error.message } } }
  }
  if (!size) return { code: 400, body: { ok: false, error: { code: 'bad-request', message: '收到一个空文件' } } }
  return { code: 200, body: { savedPath: target, name, size, dir } }
}

/**
 * @param {object} store   Store 实例（留给将来插手静态之外的路径）
 * @param {(request: object) => { code: number, body: unknown }} router
 * @param {{ assetsDir: string }} options
 */
export function createHandler(store, router, { assetsDir, uploadRoot, pagesRoot } = {}) {
  /** 网页上传的原件落哪儿。默认档案库根下的 uploads/，不动用户自己的文件夹。 */
  const uploads = uploadRootOf(store, uploadRoot)
  /** 拆出来的页图落哪儿。这些图不在任何登记过的材料路径底下，所以单独开一条只读出口。 */
  const pages = pagesRootOf(store, pagesRoot)

  /**
   * 只放行 pagesRoot 底下的文件——学生能点开的页图仅限这里。
   * 和 allowedTarget 一个道理：不是「给了路径就发」，而是「先认它归不归我管」。
   */
  function allowedPage(raw) {
    if (!pages || !raw) return null
    const target = resolve(String(raw))
    if (target !== pages && !target.startsWith(pages + sep)) return null
    try {
      if (!existsSync(target) || !statSync(target).isFile()) return null
    } catch {
      return null
    }
    return target
  }

  /** 面板和它的静态资源只从 assets 目录出，别的地方一律 404。 */
  function resolveAsset(pathname) {
    const rel = pathname.slice(ASSET_PREFIX.length)
    if (rel === '') return null
    const target = normalize(join(assetsDir, rel))
    if (!target.startsWith(assetsDir)) return null
    if (!existsSync(target) || !statSync(target).isFile()) return null
    return target
  }

  /** `/study`、`/study/` 与 /study/<子页> 都归面板；practice / file / assets / api 各有自己的分支。 */
  function isPanelPath(pathname) {
    const clean = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
    if (clean === '/study') return true
    if (!clean.startsWith('/study/')) return false
    return PANEL_PAGES.includes(clean.slice('/study/'.length))
  }

  return async function handler(req, res) {
    const url = new URL(req.url ?? '/', 'http://dsh.internal')
    const path = url.pathname
    try {
      if (isPanelPath(path)) {
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
      if (path === '/study/read' || path === '/study/read/') {
        const page = join(assetsDir, 'read.html')
        if (existsSync(page)) sendFile(res, page)
        else sendJson(res, 500, { ok: false, error: { code: 'missing-page', message: 'assets/read.html 不在' } })
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
      if (path === '/study/page') {
        const file = allowedPage(url.searchParams.get('path'))
        if (!file) {
          sendJson(res, 404, {
            ok: false,
            error: { code: 'not-found', message: '这一页还没拆出来' },
          })
          return
        }
        sendStream(req, res, file)
        return
      }
      /**
       * 读卷页要的正文。走的还是 allowedTarget 那张白名单 —— 只有已登记材料底下的文件读得到。
       * 只发纯文字：别的（PDF、视频）让浏览器按原样打开更合适，从这儿吐出去只会是一堆乱码。
       * 长文在上限处截断并说清楚，不整个读进内存。
       */
      if (path === '/study/api/doc') {
        const file = allowedTarget(store, url.searchParams.get('path'))
        if (!file) {
          sendJson(res, 404, {
            ok: false,
            error: { code: 'not-found', message: '这个文件不在已登记的材料里，或者已经不在那个位置了' },
          })
          return
        }
        let stat = null
        try {
          stat = statSync(file)
        } catch {
          stat = null
        }
        if (!stat || !stat.isFile()) {
          sendJson(res, 400, { ok: false, error: { code: 'not-file', message: '这不是一个文件' } })
          return
        }
        const ext = extname(file).toLowerCase()
        if (!DOC_EXTS.includes(ext)) {
          sendJson(res, 415, {
            ok: false,
            error: { code: 'not-text', message: `这一份不是文字稿（${ext || '没有后缀'}），点开原文更合适` },
          })
          return
        }
        const truncated = stat.size > MAX_DOC_BYTES
        const text = readHead(file, Math.min(stat.size, MAX_DOC_BYTES)).toString('utf8')
        const materials = store.read('profile').materials
        const hit = (Array.isArray(materials) ? materials : []).find((m) => {
          if (!m || !m.path) return false
          try {
            return resolve(String(m.path)) === file
          } catch {
            return false
          }
        })
        sendJson(res, 200, {
          ok: true,
          doc: {
            path: file,
            name: file.slice(file.lastIndexOf(sep) + 1),
            ext,
            bytes: stat.size,
            truncated,
            text,
            material: hit
              ? { id: String(hit.id ?? ''), title: String(hit.title ?? ''), kind: String(hit.kind ?? '') }
              : null,
          },
        })
        return
      }
      const wantsBody = req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH'
      // 上传原件走裸 body：这里先落盘，再把落盘结果当 body 交给路由去登记。
      if (wantsBody && path === UPLOAD_PATH) {
        if (!uploads) {
          sendJson(res, 500, { ok: false, error: { code: 'no-upload-root', message: '没给上传目录' } })
          return
        }
        const saved = await receiveUpload(req, uploads)
        if (saved.code !== 200) {
          sendJson(res, saved.code, saved.body)
          return
        }
        const result = await router({
          method: req.method,
          pathname: path,
          query: Object.fromEntries(url.searchParams),
          body: saved.body,
        })
        sendJson(res, result.code, result.body)
        return
      }
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
