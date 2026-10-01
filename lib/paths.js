/**
 * dsh-study-coach — 档案库的位置，只有这一份。
 *
 * 「档案库根底下那几个固定目录」（拆出来的页图 `pages/`、网页上传的原件 `uploads/`）
 * 原来在四个地方各推一遍：
 *
 *   · `index.js` 算 `DATA_ROOT/pages` 交给路由和 handler；
 *   · `lib/routes.js` 自己兜 `store.root/pages`；
 *   · `lib/handler.js` 又兜一遍 `store.root/pages`（页图、上传各一次）；
 *   · `lib/tools.js` 两处兜的是 `opts.pagesRoot || opts.scratchDir || ~/.dsh/study-coach/pages`。
 *
 * 前三处答案碰巧一样（`Library.root` 就是 `DATA_ROOT`），**第四处不是**：
 * 谁要是只传 `pagesRoot` 之外的写法、或者干脆没传，`study_pages` 会把页图渲到另一棵树上，
 * 而 `/study/page` 只在 `pagesRoot` 那棵树下放行 —— 学生点开就是 404，
 * 而且这种 404 只在「别人怎么调 registerTools」这个层面才看得出来，很难查。
 *
 * 现在收成这里两个函数，谁也不许自己 `join(root, 'pages')`。
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 页图目录名。 */
export const PAGES_DIR = 'pages'
/** 上传原件目录名。 */
export const UPLOADS_DIR = 'uploads'

/** 没设 `DSH_STUDY_ROOT` 时档案库落这儿。 */
export const DEFAULT_DATA_ROOT = join(homedir(), '.dsh', 'study-coach')

/** 档案库根。`index.js` 与 `scripts/preview.mjs` 都从这儿取，别再各读一次环境变量。 */
export function dataRoot(env = process.env) {
  const given = env && env.DSH_STUDY_ROOT ? String(env.DSH_STUDY_ROOT).trim() : ''
  return given || DEFAULT_DATA_ROOT
}

/** `Store` 与 `Library` 都有 `.root`；拿不到就空串（调用方自己判）。 */
export function rootOf(store) {
  return store && typeof store.root === 'string' ? store.root : ''
}

/** 拆出来的页图落哪儿：显式给的优先，其次档案库根下，最后退回默认菜谱。 */
export function pagesRootOf(store, explicit) {
  const given = explicit ? String(explicit) : ''
  if (given) return given
  return join(rootOf(store) || DEFAULT_DATA_ROOT, PAGES_DIR)
}

/** 网页上传的原件落哪儿。规矩同上。 */
export function uploadRootOf(store, explicit) {
  const given = explicit ? String(explicit) : ''
  if (given) return given
  return join(rootOf(store) || DEFAULT_DATA_ROOT, UPLOADS_DIR)
}
