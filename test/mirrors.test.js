/**
 * 跨边界抄过去的那几份表，和 `var(--x, 兜底值)` 的兜底值，都别悄悄腐烂。
 *
 * 前端（`assets/*.js`）跑在浏览器里，后端（`lib/*.js`）跑在宿主里，中间没有构建步骤，
 * 所以有些表只能两边各写一份 —— 六档、错题状态、材料类别、自评四档都是这样。
 * 这是一份**有意的**重复，但没人守着就会漂：这里钉住它们逐字一致。
 *
 * 同理，`assets/graph.css` / `practice.css` 里那些 `var(--x, #RRGGBB)` 的兜底值，
 * 是为了 style.css 还没加载时不花屏。它们的值必须等于 `:root` 的真值 ——
 * 否则「兜底」就变成了第二套配色，而且只有首帧才看得见，谁也不会发现。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { STAGES, MISTAKE_STATUS, FACT_KINDS, MATERIAL_KIND_LABELS, CARD_GRADES, CARD_KINDS } from '../lib/store.js'
import { STAGES as UI_STAGES } from '../assets/stages.js'

const ASSETS = join(import.meta.dirname, '..', 'assets')
const read = (name) => readFileSync(join(ASSETS, name), 'utf8')

/**
 * 从源码里抠出 `const NAME = [ 'a', 'b' ]`（可以跨行）。
 * 抠不到就当场失败 —— 正则失效时必须吵，不能静默「通过」。
 */
function listConst(source, file, name) {
  const m = source.match(new RegExp(`^(?:export\\s+)?const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`, 'm'))
  assert.ok(m, `${file} 里没找到 \`const ${name} = [\`，正则多半失效了`)
  const items = m[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      assert.match(s, /^'[^']*'$|^"[^"]*"$/, `${file} 的 ${name} 里有一项不是字符串字面量：${s}`)
      return s.slice(1, -1)
    })
  assert.ok(items.length > 0, `${file} 的 ${name} 抠出来是空的`)
  return items
}

/** 抠 `const NAME = { key: '值', … }` 这个字面量对象。写成一行或多行都得认。 */
function mapConst(source, file, name) {
  const m = source.match(new RegExp(`^(?:export\\s+)?const\\s+${name}\\s*=\\s*\\{([^}]*)\\}`, 'm'))
  assert.ok(m, `${file} 里没找到 \`const ${name} = {\`，正则多半失效了`)
  const out = {}
  for (const hit of m[1].matchAll(/(?:'([^']+)'|([A-Za-z_$][\w$]*))\s*:\s*'([^']*)'/g)) {
    out[hit[1] ?? hit[2]] = hit[3]
  }
  assert.ok(Object.keys(out).length > 0, `${file} 的 ${name} 抠出来是空的`)
  return out
}

test('六档：前端 assets/stages.js 与后端 lib/store.js 逐字一致', () => {
  assert.deepEqual(UI_STAGES, STAGES)
  assert.equal(UI_STAGES.length, 6, '六档就是六档')
})

test('错题状态：assets/panel.js 抄的那份与 lib/store.js 一致', () => {
  const panel = read('panel.js')
  assert.deepEqual(listConst(panel, 'assets/panel.js', 'MISTAKE_STATUS'), MISTAKE_STATUS)
})

test('学生画像五类：assets/panel.js 抄的那份与 lib/store.js 一致', () => {
  const panel = read('panel.js')
  assert.deepEqual(listConst(panel, 'assets/panel.js', 'FACT_KINDS'), FACT_KINDS)
})

test('材料类别的中文名：面板与做题页那两份 KIND 都跟 lib/store.js 一致', () => {
  const store = mapConst(readFileSync(join(import.meta.dirname, '..', 'lib', 'store.js'), 'utf8'), 'lib/store.js', 'MATERIAL_KIND_LABELS')
  assert.deepEqual(store, MATERIAL_KIND_LABELS, '先确认抠出来的就是 store 里那份表')
  for (const file of ['panel.js', 'practice.js']) {
    assert.deepEqual(mapConst(read(file), `assets/${file}`, 'KIND'), MATERIAL_KIND_LABELS, `assets/${file} 的 KIND 漂了`)
  }
})

test('记忆卡自评四档：assets/panel.js 抄的那份与 lib/store.js 一致', () => {
  const panel = read('panel.js')
  assert.deepEqual(listConst(panel, 'assets/panel.js', 'CARD_GRADES'), CARD_GRADES)
})

test('记忆卡类型：面板少一个「其他」是有意的，但前几项必须同序同字', () => {
  const panel = read('panel.js')
  const ui = listConst(panel, 'assets/panel.js', 'CARD_KINDS')
  // 面板那份只有三个：默认那条「其他」由空串表示（见 panel.js 里紧挨着的注释）。
  assert.deepEqual(ui, CARD_KINDS.slice(0, ui.length), '面板的 CARD_KINDS 必须是 store 那份的前缀')
  assert.ok(!ui.includes('其他'), '面板那份不该有「其他」——它由空串代表')
})

/* ── CSS 兜底值 ─────────────────────────────────────────────────────────── */

/** 把 `:root { … }` 那一块解析成 { '--name': '值' }。行尾那种块注释要一并剥掉。 */
function rootTokens(css) {
  const m = css.match(/:root\s*\{([\s\S]*?)\n\}/)
  assert.ok(m, 'assets/style.css 里没找到 `:root {` 块')
  const out = {}
  for (const line of m[1].split('\n')) {
    const hit = line.match(/^\s*(--[\w-]+)\s*:\s*(.+?);\s*(?:\/\*.*?\*\/\s*)?$/)
    if (hit) out[hit[1]] = hit[2].trim()
  }
  assert.ok(Object.keys(out).length > 20, `:root 只解析出 ${Object.keys(out).length} 个 token，解析多半坏了`)
  return out
}

/** 所有 CSS / JS 里定义过的自定义属性名（含前端内联 `style="--c:…"` 那种）。 */
function definedTokens(files) {
  const out = new Set()
  for (const file of files) {
    for (const m of read(file).matchAll(/(--[\w-]+)\s*:/g)) out.add(m[1])
  }
  return out
}

/** 注释里的 `var(--x, 兜底值)` 只是举例，别当成真声明扫进来。 */
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '')

test('var(--x, 兜底值) 的兜底值必须等于 :root 里的真值', () => {
  const tokens = rootTokens(read('style.css'))
  const files = readdirSync(ASSETS).filter((f) => f.endsWith('.css'))
  const problems = []
  let seen = 0

  for (const file of files) {
    const css = stripComments(read(file))
    for (const m of css.matchAll(/var\((--[\w-]+),\s*([^()]+?)\)/g)) {
      const [, name, fallback] = m
      const real = tokens[name]
      if (real === undefined) {
        problems.push(`${file}: var(${name}, …) 但 :root 里没定义 ${name}`)
        continue
      }
      seen += 1
      const norm = (s) => s.trim().replace(/\s+/g, '').toLowerCase()
      if (norm(fallback) !== norm(real)) {
        problems.push(`${file}: var(${name}, ${fallback.trim()}) —— :root 里是 ${real}`)
      }
    }
  }

  assert.ok(seen > 0, '一份兜底值都没扫到，正则多半失效了')
  assert.deepEqual(problems, [], '兜底值跟 :root 漂了：\n' + problems.join('\n'))
})

test('每处 var(--x) 引用的 token 都真的有人定义', () => {
  const all = readdirSync(ASSETS).filter((f) => f.endsWith('.css') || f.endsWith('.js'))
  const defined = definedTokens(all)
  const missing = new Set()
  for (const file of all.filter((f) => f.endsWith('.css'))) {
    for (const m of stripComments(read(file)).matchAll(/var\((--[\w-]+)/g)) {
      if (!defined.has(m[1])) missing.add(`${file}: ${m[1]}`)
    }
  }
  assert.deepEqual([...missing], [], '有不存在的 token：\n' + [...missing].join('\n'))
})
