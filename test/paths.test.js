/**
 * 档案库位置只有一份：`lib/paths.js`。
 *
 * 原来「页图落哪儿」在四个地方各推一遍（index.js、routes.js、handler.js、tools.js），
 * 前三个答案碰巧一样，`tools.js` 那条兜底却是 `~/.dsh/study-coach/pages` —— 另一棵树。
 * 这里钉住两件事：
 *   1. 三个函数各自的语义（显式优先、其次 store.root、最后默认档案库根）；
 *   2. **只传 store、哪儿都不显式指定时，工具渲图的目录与 /study/page 放行的目录是同一棵**。
 * 第 2 条是真正会害人的那条：对不上就是「图渲染出来了、但学生点开 404」。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Store } from '../lib/store.js'
import { createRouter } from '../lib/routes.js'
import { createHandler } from '../lib/handler.js'
import { startPanelServer } from '../lib/panel-server.js'
import { pagesDirFor } from '../lib/pages.js'
import { DEFAULT_DATA_ROOT, PAGES_DIR, UPLOADS_DIR, dataRoot, pagesRootOf, rootOf, uploadRootOf } from '../lib/paths.js'

const ASSETS = join(import.meta.dirname, '..', 'assets')

test('dataRoot：认 DSH_STUDY_ROOT，空串 / 只有空格都回默认', () => {
  assert.equal(dataRoot({ DSH_STUDY_ROOT: 'F:\\某处' }), 'F:\\某处')
  assert.equal(dataRoot({ DSH_STUDY_ROOT: '   ' }), DEFAULT_DATA_ROOT)
  assert.equal(dataRoot({}), DEFAULT_DATA_ROOT)
  assert.equal(dataRoot(undefined), DEFAULT_DATA_ROOT)
})

test('rootOf：Store / Library 都认，别的给空串', () => {
  assert.equal(rootOf({ root: 'R' }), 'R')
  assert.equal(rootOf({}), '')
  assert.equal(rootOf(null), '')
  assert.equal(rootOf('R'), '', '字符串不算——它没有 .root，别把路径当 store 用')
})

test('显式给的值优先，没给就落在 store.root 底下', () => {
  const store = { root: join('F:\\档案库', 'x') }
  assert.equal(pagesRootOf(store), join('F:\\档案库', 'x', PAGES_DIR))
  assert.equal(uploadRootOf(store), join('F:\\档案库', 'x', UPLOADS_DIR))
  assert.equal(pagesRootOf(store, 'F:\\我自己挑的'), 'F:\\我自己挑的')
  assert.equal(uploadRootOf(store, 'F:\\我自己挑的'), 'F:\\我自己挑的')
  assert.equal(pagesRootOf(store, ''), join('F:\\档案库', 'x', PAGES_DIR), '空串等于没给')
})

test('store 连 root 都没有时，退回默认档案库根，而不是给个相对路径', () => {
  assert.equal(pagesRootOf({}), join(DEFAULT_DATA_ROOT, PAGES_DIR))
  assert.equal(uploadRootOf(undefined), join(DEFAULT_DATA_ROOT, UPLOADS_DIR))
})

test('不显式指定目录时，页图渲进去的地方就是 /study/page 放行的地方', async () => {
  const root = mkdtempSync(join(tmpdir(), 'study-paths-'))
  const store = new Store(root)
  store.ensure()
  try {
    // 工具那边算出来的落脚点（不带 opts.pagesRoot）。
    const pdf = join(root, '讲义.pdf')
    const dir = pagesDirFor(pagesRootOf(store), pdf)
    mkdirSync(dir, { recursive: true })
    const page = join(dir, 'p0001.png')
    writeFileSync(page, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    // handler 也不带 pagesRoot —— 两边都走 paths.js，就该是同一棵树。
    const handler = createHandler(store, createRouter(store), { assetsDir: ASSETS })
    const server = await startPanelServer(handler, { port: 0 })
    try {
      // server.url 本身已经带 /study，别再加一遍。
      const res = await fetch(`${server.url}/page?path=${encodeURIComponent(page)}`)
      assert.equal(res.status, 200, `页图渲在 ${dir}，出口却放不出去`)

      // 文件真的存在，但不在 pages/ 底下 —— 必须还是 404，不能因为「文件在」就放行。
      const outsider = join(root, '别处.png')
      writeFileSync(outsider, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
      const outside = await fetch(`${server.url}/page?path=${encodeURIComponent(outsider)}`)
      assert.equal(outside.status, 404, 'pages 目录外面的东西一律不放行')
    } finally {
      await server.close()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
