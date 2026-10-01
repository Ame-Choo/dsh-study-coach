/**
 * dsh-study-coach — 拆书的那个子进程。
 *
 * `renderBook` 内部用 `execFileSync` 调 python，是**同步**的：一本 164 页的教辅要跑
 * 二十来秒，三百页的要跑一分多钟。留在面板进程里跑，整个 HTTP 服务会僵在那里——
 * 学生点一下别的按钮都得等它拆完。
 *
 * 所以拆图一律甩到这个脚本里跑，进度走清单文件（`renderBook` 每渲完一批就更新
 * manifest 的 rendered/rendering），面板和 agent 读清单就够了，不需要 IPC。
 *
 * 用法：node build-pages.mjs <pdf> <root> [dpi]
 */
import { renderBook } from './pages.js'

const [pdf, root, dpi] = process.argv.slice(2)

if (!pdf || !root) {
  console.error('用法：node build-pages.mjs <pdf> <root> [dpi]')
  process.exit(2)
}

const out = renderBook(pdf, { root, dpi: Number(dpi) || undefined })
if (!out.ok) {
  console.error(String(out.error || '拆图失败'))
  process.exit(1)
}
console.log(JSON.stringify({ dir: out.dir, rendered: out.rendered, total: out.total }))
