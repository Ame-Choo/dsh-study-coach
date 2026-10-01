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
 * `unknown study route`。所以在这里钉一条：两边必须一模一样——**除了**下面这张
 * 老地址表：页面并掉了，可地址不能突然 404，服务端就得继续认它。
 */

/*
 * 服务端多留的老地址：并进别的页了，但那条 URL 还得能开。
 * 对应 `assets/panel.js` 的 `resolvePage()` 里那张 `alias` 表——加一条要两边一起加，
 * 并且在这里写清为什么留着。
 */
const LEGACY_PAGES = {
  ability: '「能力」整页并进了知识地图页（掌握度那一节），老的 /study/ability 照旧能开',
}

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

/** 从源码里抠出 `resolvePage()` 里那张老地址表（`'/study/ability': 'map'`）。 */
function legacyAliases() {
  const src = readFileSync(join(here, '..', 'assets', 'panel.js'), 'utf8')
  const at = src.indexOf('const alias = {')
  assert.notEqual(at, -1, 'assets/panel.js 的 resolvePage() 里找不到 `const alias = {`')
  const end = src.indexOf('}', at)
  assert.notEqual(end, -1, '`const alias = {` 没有找到收尾的 `}`')
  const out = {}
  for (const m of src.slice(at, end).matchAll(/'\/study\/([^']+)':\s*'([^']+)'/g)) out[m[1]] = m[2]
  return out
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

  // 服务端漏了导航里那几页 = 那个地址会回 unknown study route，这条是硬伤
  const missing = fromPanel.filter((p) => !PANEL_PAGES.includes(p))
  assert.deepEqual(missing, [], 'PAGES 里有页面没登记进 lib/handler.js 的 PANEL_PAGES（那个地址会回 unknown study route）')

  // 服务端多出来的只能是写明了的老地址
  const extra = PANEL_PAGES.filter((p) => !fromPanel.includes(p)).sort()
  assert.deepEqual(
    extra,
    Object.keys(LEGACY_PAGES).sort(),
    'PANEL_PAGES 里多了没写明理由的页；要么它该进 PAGES，要么把它记进 LEGACY_PAGES 并说清为什么留着',
  )

  // 老地址表本身也得对得上：服务端认它，前端得有 alias 指到活着的页上
  const alias = legacyAliases()
  assert.deepEqual(
    Object.keys(alias).sort(),
    Object.keys(LEGACY_PAGES).sort(),
    'assets/panel.js 的 alias 表与 LEGACY_PAGES 对不上',
  )
  for (const [from, to] of Object.entries(alias)) {
    assert.ok(fromPanel.includes(to), `老地址 ${from} 指的 ${to} 不是活着的页`)
  }
})
