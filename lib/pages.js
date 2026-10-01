import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
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

/** 找得到哪个 python 就用哪个。装依赖的是 DSH 自带的那份。 */
export function findPython(home) {
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
