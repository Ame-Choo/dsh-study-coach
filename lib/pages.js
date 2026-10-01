import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * 把扫描版 PDF 一页一页渲成编号 PNG，好让 agent 用 read_image 真的看见内容。
 *
 * 为什么非得绕这一道：讲义几乎全是扫描件（一整页就是一张 1587×2245 的位图），
 * pypdf 抽出来是 0 个字符。光靠文件名只能知道「有哪几份、各多少页」，
 * 想知道「这个知识点在第 6 页」就只能把那一页变成图片看一眼。
 *
 * 页码从 1 起，文件名固定 p0007.png，跟 PDF 自己的页码一一对应——
 * 这样 agent 看完图就能直接把页码写进 study_analysis，学生点一下就跳到那一页。
 */

export const DEFAULT_DPI = 110
export const MAX_PAGES_PER_CALL = 40

/**
 * 找得到哪个 python 就用哪个。装依赖的是 DSH 自带的那份。
 *
 * 不传 home 就按当前用户的家目录找——忘了传的时候不能悄悄退到系统 python 上
 * （那份通常没有 pymupdf），否则报错会变成看不懂的「这份 python 里没有 pymupdf：python」。
 */
export function findPython(home = homedir()) {
  const candidates = [
    process.env.DSH_STUDY_PYTHON,
    home ? join(home, '.dsh', 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'python', 'python.exe') : '',
    process.env.DSH_PYTHON,
    'python',
    'python3',
  ].filter(Boolean)
  for (const c of candidates) {
    if (c === 'python' || c === 'python3') return c
    if (existsSync(c)) return c
  }
  return null
}

/** 一份 PDF 渲出来的图放哪儿。同一个路径永远落同一个目录，渲过的不用重来。 */
export function pagesDirFor(root, pdfPath) {
  const h = createHash('sha1').update(String(pdfPath)).digest('hex').slice(0, 10)
  const name = String(pdfPath).split(/[\\/]/).pop().replace(/\.pdf$/i, '')
  return join(root, `${name}-${h}`)
}

const SCRIPT = `
import sys, json, os
import pymupdf
pdf, out, frm, to, dpi = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
doc = pymupdf.open(pdf)
total = doc.page_count
if frm > total:
    print(json.dumps({'total': total, 'error': 'page out of range: want %d, document has %d' % (frm, total)}))
    raise SystemExit(0)
to = min(to, total)
os.makedirs(out, exist_ok=True)
made = []
for i in range(frm, to + 1):
    p = os.path.join(out, 'p%04d.png' % i)
    if not (os.path.exists(p) and os.path.getsize(p) > 0):
        pix = doc.load_page(i - 1).get_pixmap(dpi=dpi)
        pix.save(p)
    made.append({'page': i, 'file': p})
print(json.dumps({'total': total, 'pages': made}))
`

/**
 * 渲 [from, to] 这几页。返回真实存在的 PNG 清单，失败就把原因说清楚——
 * 缺 pymupdf 和「页码越界」是两回事，别混成一句「失败了」。
 */
export function renderPages(pdfPath, options = {}) {
  const python = options.python || findPython(options.home)
  if (!python) return { ok: false, error: '找不到 python，设 DSH_STUDY_PYTHON 指过去就行' }
  if (!existsSync(pdfPath)) return { ok: false, error: `这份文件不在：${pdfPath}` }

  const dir = options.outDir
  if (!dir) return { ok: false, error: '没给 outDir' }
  try {
    mkdirSync(dir, { recursive: true })
  } catch (error) {
    return { ok: false, error: `建不出目录 ${dir}：${error.message}` }
  }

  const from = Math.max(1, Number(options.from) || 1)
  const to = Math.max(from, Number(options.to) || from)
  const dpi = Math.min(220, Math.max(60, Number(options.dpi) || DEFAULT_DPI))
  if (to - from + 1 > MAX_PAGES_PER_CALL) {
    return { ok: false, error: `一次最多 ${MAX_PAGES_PER_CALL} 页，收到 ${to - from + 1} 页。分了批来` }
  }

  let stdout = ''
  try {
    stdout = execFileSync(python, ['-X', 'utf8', '-c', SCRIPT, pdfPath, dir, String(from), String(to), String(dpi)], {
      encoding: 'utf8',
      timeout: 180000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    const tail = String(error.stderr || error.message || '').split('\n').filter(Boolean).slice(-1)[0] || ''
    if (/No module named|ModuleNotFoundError/.test(tail)) {
      return { ok: false, error: `这份 python 里没有 pymupdf：${python}。装一下：${python} -m pip install pymupdf` }
    }
    return { ok: false, error: `渲染失败：${tail || error.message}` }
  }

  const line = String(stdout).split('\n').filter((l) => l.trim().startsWith('{')).pop()
  if (!line) return { ok: false, error: `渲染没吐出结果：${String(stdout).slice(-200)}` }
  let parsed
  try {
    parsed = JSON.parse(line)
  } catch (error) {
    return { ok: false, error: `渲染结果读不出来：${error.message}` }
  }

  const pages = (parsed.pages || []).filter((p) => existsSync(p.file) && statSync(p.file).size > 0)
  if (parsed.error) {
    return {
      ok: false,
      error: `页码越界：这份一共 ${Number(parsed.total) || 0} 页，${String(parsed.error).replace(/^page out of range: /, '你要的是 ')}`
        + '。先确认这一章在 analysis 里记的 pages 是不是对的',
    }
  }
  if (!pages.length) return { ok: false, error: '一页都没渲出来' }
  return { ok: true, dir, total: Number(parsed.total) || 0, from, to, dpi, pages }
}

/* ── 拆整本书 ────────────────────────────────────────────────────────────── */

/**
 * 一份 PDF 的书目信息：多少页、有没有真书签（目录）、是不是扫描件。
 *
 * 书签是白捡的目录——出版社做过书签的 PDF，`get_toc()` 直接给出「第几页是什么标题」，
 * 比让 agent 一页页看图数页码准得多也快得多。没有书签才退回去渲目录页。
 */
const INFO_SCRIPT = `
import sys, json
import pymupdf
doc = pymupdf.open(sys.argv[1])
toc = []
try:
    for t in doc.get_toc():
        if len(t) >= 3:
            toc.append([int(t[0]), str(t[1]), int(t[2])])
except Exception:
    toc = []
meta = doc.metadata or {}
probe = []
seen = set()
for i in list(range(min(3, doc.page_count))) + list(range(max(0, doc.page_count - 2), doc.page_count)):
    if i in seen:
        continue
    seen.add(i)
    try:
        probe.append({'page': i + 1, 'chars': len(doc.load_page(i).get_text().strip())})
    except Exception:
        pass
print(json.dumps({'total': doc.page_count, 'toc': toc, 'title': str(meta.get('title') or ''), 'probe': probe}))
`

/** 读书目信息。抽不到文字的前几页 chars 接近 0，就是扫描件——那种只能看图。 */
export function bookInfo(pdfPath, options = {}) {
  const python = options.python || findPython(options.home)
  if (!python) return { ok: false, error: '找不到 python，设 DSH_STUDY_PYTHON 指过去就行' }
  if (!existsSync(pdfPath)) return { ok: false, error: `这份文件不在：${pdfPath}` }
  if (!/\.pdf$/i.test(String(pdfPath))) return { ok: false, error: `只认 PDF，收到的是：${pdfPath}` }
  let stdout = ''
  try {
    stdout = execFileSync(python, ['-X', 'utf8', '-c', INFO_SCRIPT, pdfPath], {
      encoding: 'utf8',
      timeout: 120000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    const tail = String(error.stderr || error.message || '').split('\n').filter(Boolean).slice(-1)[0] || ''
    if (/No module named|ModuleNotFoundError/.test(tail)) {
      return { ok: false, error: `这份 python 里没有 pymupdf：${python}。装一下：${python} -m pip install pymupdf` }
    }
    return { ok: false, error: `读不出来：${tail || error.message}` }
  }
  const line = String(stdout).split('\n').filter((l) => l.trim().startsWith('{')).pop()
  if (!line) return { ok: false, error: `读书目没吐出结果：${String(stdout).slice(-200)}` }
  let parsed
  try {
    parsed = JSON.parse(line)
  } catch (error) {
    return { ok: false, error: `书目结果读不出来：${error.message}` }
  }
  const total = Number(parsed.total) || 0
  const toc = (parsed.toc || []).map((t) => ({ level: Number(t[0]) || 1, title: String(t[1] || ''), page: String(t[2] || '') }))
  const probe = (parsed.probe || []).map((p) => ({ page: Number(p.page) || 0, chars: Number(p.chars) || 0 }))
  const scanned = probe.length > 0 && probe.every((p) => p.chars < 20)
  return { ok: true, total, toc, title: String(parsed.title || ''), probe, scanned, pdf: String(pdfPath) }
}

/* ── 拆好的书放在哪 ─────────────────────────────────────────────────────── */

export const MANIFEST = 'manifest.json'

/** 一本拆好的书自己的目录，里面 p0001.png… 和一份 manifest.json。 */
export function readManifest(dir) {
  const file = join(String(dir), MANIFEST)
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    // 上次拆到一半断电，清单坏了不算灾难：图还在，重拆一遍会把清单补回来。
    return null
  }
}

function writeManifest(dir, data) {
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, MANIFEST), JSON.stringify(data, null, 2), 'utf8')
    return true
  } catch {
    return false
  }
}

/**
 * 把整本 PDF 拆成 p0001.png…p0300.png，落在 root 下的一个固定目录里。
 *
 * 分批渲，每批写完就更新清单——一本三百页的书要跑几分钟，中途被打断时
 * 已经渲好的那些页得算数，重跑也是接着渲（renderPages 会跳过已存在的页）。
 */
export function renderBook(pdfPath, options = {}) {
  const root = options.root
  if (!root) return { ok: false, error: '没给 root（拆出来的图要落哪个目录）' }
  const info = options.info || bookInfo(pdfPath, options)
  if (!info.ok) return info
  if (!info.total) return { ok: false, error: `这份 PDF 一页都没有：${pdfPath}` }

  const dir = options.outDir || pagesDirFor(root, pdfPath)
  const dpi = Math.min(220, Math.max(60, Number(options.dpi) || DEFAULT_DPI))
  const manifest = {
    pdf: String(pdfPath),
    dir,
    dpi,
    total: info.total,
    scanned: Boolean(info.scanned),
    title: String(info.title || ''),
    toc: info.toc || [],
    rendered: 0,
    rendering: true,
    at: new Date().toISOString(),
  }
  writeManifest(dir, manifest)

  const done = []
  for (let from = 1; from <= info.total; from += MAX_PAGES_PER_CALL) {
    const to = Math.min(info.total, from + MAX_PAGES_PER_CALL - 1)
    const batch = renderPages(pdfPath, { ...options, outDir: dir, from, to, dpi })
    if (!batch.ok) {
      // 渲到一半失败也得把已经拿到的页数报出来，不然面板上显示成「一页没拆」。
      writeManifest(dir, { ...manifest, rendered: done.length, rendering: false, at: new Date().toISOString() })
      return { ok: false, error: batch.error, dir, total: info.total, rendered: done.length }
    }
    for (const p of batch.pages) done.push(Number(p.page))
    writeManifest(dir, { ...manifest, rendered: done.length, at: new Date().toISOString() })
    if (typeof options.onProgress === 'function') options.onProgress(done.length, info.total)
  }
  done.sort((a, b) => a - b)
  // rendering 落回 false 才算拆完——面板和 agent 都靠这个字段判断还要不要等。
  writeManifest(dir, { ...manifest, rendered: done.length, rendering: false, at: new Date().toISOString() })
  return {
    ok: true,
    dir,
    total: info.total,
    dpi,
    scanned: Boolean(info.scanned),
    toc: info.toc || [],
    pages: done,
    rendered: done.length,
  }
}
