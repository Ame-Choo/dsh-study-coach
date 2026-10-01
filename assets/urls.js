/* ══ 材料路径 → 面板地址 ═══════════════════════════════════════════════════
 * 这一条规则只有这一处实现。宿主那半边（lib/urls.js）直接 re-export 它，
 * 所以别再抄第二份 —— 以前「/study/file?path=…」这句话在 panel.js、practice.js、
 * map.js 里各拼了一遍，加一种打开方式就得满仓库找。
 *
 * 规则：
 *   · http(s) 链接原样放行（网课可以挂在网上）；
 *   · `.md` / `.markdown` / `.txt` 走阅读页 `/study/read` —— 那是给学生看的版式。
 *     直接从 `/study/file` 打开等于把 markdown 源码（`##`、`**` 满天飞）倒给他看，
 *     AI 出的卷子尤其明显；
 *   · 别的（PDF、视频、文件夹）照旧走 `/study/file`。
 *
 * 页码那一位的两种含义：
 *   · PDF 用 `#page=N`，Chrome 自带的阅读器认这个 fragment，点开就在那一页；
 *   · 文档用 `#qN`，阅读页给每一题钉的锚点，N 是**题号**。
 *   两个都带会让浏览器犯迷糊，所以按文件的种类二选一。
 * ═════════════════════════════════════════════════════════════════════════ */

/** 走阅读页的扩展名。别处判「这是不是一份文档」都问它。 */
export const DOC_EXTS = ['.md', '.markdown', '.txt']

export const READ_PATH = '/study/read'
export const FILE_PATH = '/study/file'

/** 去掉 `?query` / `#hash` 再判后缀，免得 `a.md?x=1` 被当成普通文件。 */
function barePath(target) {
  return String(target ?? '').trim().split(/[?#]/)[0].toLowerCase()
}

/** 这份东西该不该用阅读页打开。 */
export function isDocPath(target) {
  const p = barePath(target)
  if (!p) return false
  return DOC_EXTS.some((ext) => p.endsWith(ext))
}

/** 是不是外链。 */
export function isHttpUrl(target) {
  return /^https?:\/\//i.test(String(target ?? '').trim())
}

/** `#page=7` / `#q7` 里的那个数字。没有就是 0。 */
function pageNumber(page) {
  const n = Number(String(page ?? '').replace(/\D/g, ''))
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** 已经是一条面板地址（`/study/...`）就原样放行，别再包一层。 */
export function isStudyPath(target) {
  return String(target ?? '').trim().startsWith('/study/')
}

/**
 * 一份材料 → 面板上打开它的地址。
 *
 * @param {string} target 本地绝对路径、http 链接，或者一条现成的 `/study/...` 地址
 * @param {number|string} [page] PDF 的页码 / 文档的题号；不给就是整份
 * @returns {string} 打开用的地址；target 是空的就回空串（调用方自己判，别给死链）
 */
export function openPath(target, page) {
  const raw = String(target ?? '').trim()
  if (!raw) return ''
  if (isHttpUrl(raw) || isStudyPath(raw)) return raw
  const n = pageNumber(page)
  if (isDocPath(raw)) {
    return READ_PATH + '?path=' + encodeURIComponent(raw) + (n > 0 ? '#q' + n : '')
  }
  return FILE_PATH + '?path=' + encodeURIComponent(raw) + (n > 0 ? '#page=' + n : '')
}
