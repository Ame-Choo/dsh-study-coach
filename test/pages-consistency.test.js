import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { PANEL_PAGES } from '../lib/handler.js'

/*
 * 面板有哪几页，被写在两个地方，而且没法互相 import：
 *   · `lib/handler.js` 的 PANEL_PAGES —— 服务端要知道 `/study/<id>` 认不认（handler 层拦不拦）
 *   · `assets/panel.js` 的 PAGES       —— 前端要知道导航栏画哪几项、地址怎么认页
 * 这两份曾经真的漂过一次：加 `toolbox` 那轮只改了前端，`/study/toolbox` 直接回
 * `unknown study route`。所以在这里钉一条：两边必须一模一样。
 */

const here = dirname(fileURLToPath(import.meta.url))

/** 从源码里抠出 `const PAGES = [ … ]` 那一段（到第一个顶格 `]` 为止）。 */
function panelMenuPaths() {
  const src = readFileSync(join(here, '..', 'assets', 'panel.js'), 'utf8')
  const at = src.indexOf('const PAGES = [')
  assert.notEqual(at, -1, 'assets/panel.js 里找不到 `const PAGES = [`')
  const end = src.indexOf('\n]', at)
  assert.notEqual(end, -1, '`const PAGES = [` 没有找到收尾的 `]`')
  const block = src.slice(at, end)
  const paths = [...block.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1])
  assert.ok(paths.length >= 2, `PAGES 里只抠到 ${paths.length} 条 path，正则多半失效了`)
  return paths
}

test('前端导航与服务端 PANEL_PAGES 是同一份清单', () => {
  const paths = panelMenuPaths()

  // '/study' 是主页：它不走 handler 的那道「子页面」白名单，两边本来就不该有它。
  assert.ok(paths.includes('/study'), "PAGES 里应该有主页 '/study'")
  const fromPanel = paths
    .filter((p) => p !== '/study')
    .map((p) => {
      assert.ok(p.startsWith('/study/'), `PAGES 里的路径写法不对：${p}`)
      return p.slice('/study/'.length)
    })

  assert.equal(new Set(fromPanel).size, fromPanel.length, `PAGES 里有重复的页：${fromPanel.join(', ')}`)
  assert.deepEqual(
    [...fromPanel].sort(),
    [...PANEL_PAGES].sort(),
    'assets/panel.js 的 PAGES 与 lib/handler.js 的 PANEL_PAGES 对不上了；' +
      '加了新页面必须两边一起改，否则那个地址在旧服务端上会回 unknown study route',
  )
})
