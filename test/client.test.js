/**
 * DSH 那一半（lib/client.js）。
 *
 * 它不是普通 ESM 模块，是一段交给 window.__ModuleLoader__ 执行的脚本，所以这里造一个
 * 假的加载器与假的 require 把它拉起来——**测的是线上同一条路径**（宿主也是这么调的），
 * 而不是把里面的函数 import 出来单测。
 *
 * 要钉住的三件事：
 *   1. 只 require 平台种子表里的模块（多要一个包就等于多一条 dsh.client.inject，会静默失败）；
 *   2. 导出的 name 必须等于包名，注入的服务名跟 apply 里真用的一致；
 *   3. apply 之后设置里确实多了两处：settings.section 自己一栏（找得到的那条），
 *      settings.plugins.tab 一个页签（习惯从「内置插件」找的人也有路）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SOURCE = readFileSync(join(import.meta.dirname, '..', 'lib', 'client.js'), 'utf8')
const PKG = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'))

/** 只取模板串里的那段 CSS：文件头的注释里也在讲这些 token 的坏话，别把注释当成规则。 */
const CSS_START = SOURCE.indexOf('const CSS = `') + 'const CSS = `'.length
const CSS = SOURCE.slice(CSS_START, SOURCE.indexOf('`', CSS_START))

/** 按线上那样把 bundle 拉起来，回 { id, api }。opts.react 可以换一个会记账的假 React。 */
function load(opts = {}) {
  let captured = null
  const window = {
    __ModuleLoader__: {
      load(spec) {
        captured = spec
      },
    },
    open() {},
  }
  const react = opts.react || {
    createElement: (...args) => ({ type: args[0], props: args[1] || {}, children: args.slice(2) }),
    useState: () => [undefined, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
  }
  const seen = new Set()
  const require = (id) => {
    seen.add(id)
    if (id === 'react') return react
    throw new Error(`这个 bundle 不该 require ${id}`)
  }
  /* 用 window / document / require 三个自由变量喂进去跑一遍 */
  new Function('window', 'document', 'require', SOURCE)(window, undefined, require)
  assert.ok(captured, 'window.__ModuleLoader__.load 没被调用')
  return { spec: captured, has: (id) => seen.has(id), api: captured.factory(require) }
}

test('客户端 bundle：只跟平台要 react，导出名与包名一致', () => {
  const { spec, has, api } = load()
  assert.equal(spec.id, PKG.name, 'bundle id 必须是包名，宿主按它挂到 loader 行上')
  assert.equal(api.name, PKG.name)
  assert.deepEqual(api.inject, ['slots'])
  assert.equal(typeof api.apply, 'function')
  assert.equal(typeof api.StudyCoachTab, 'function')
  assert.deepEqual(has('react'), true)
})

test('客户端 bundle：设置里挂两处（自己一栏 + 内置插件页签），撤得掉', async () => {
  const { api } = load()
  const registered = []
  const effects = []
  const slots = {
    inject(slot, factory) {
      registered.push({ slot, row: factory() })
      return () => {}
    },
    register(row, component) {
      return { row, component }
    },
  }
  const ctx = {
    effect: (fn, label) => {
      effects.push(label)
      fn()
    },
    get: (name) => (name === 'slots' ? slots : undefined),
  }
  await api.apply(ctx)

  // 自己一栏排在前：那才是「找得到」的那条路
  assert.deepEqual(
    registered.map((item) => item.slot),
    ['settings.section', 'settings.plugins.tab'],
  )
  for (const { slot, row } of registered) {
    assert.equal(row.row.name, slot, 'register 的 name 必须跟座位同名')
    assert.equal(row.row.id, 'study-coach')
    assert.equal(typeof row.row.order, 'number')
    assert.ok(row.row.order > 0, 'order 得是个真数，不然会挤到最前面')
    assert.equal(row.row.label, '学习教练')
    assert.equal(typeof row.component, 'function')
  }

  // 样式是 effect 注入的，得有个能撤的标签
  assert.ok(effects.includes('dsh-study-coach: stylesheet'))
})

test('客户端 bundle：ctx.get 拿不到就退回 ctx.slots，两处照样挂上', async () => {
  const { api } = load()
  const registered = []
  const slots = {
    inject(slot, factory) {
      registered.push(slot)
      factory()
      return () => {}
    },
    register: (row, component) => ({ row, component }),
  }
  await api.apply({ effect: () => {}, get: () => undefined, slots })
  assert.deepEqual(registered, ['settings.section', 'settings.plugins.tab'])
})

test('客户端 bundle：没拿到 slots 也不炸，只是什么都不挂', async () => {
  const { api } = load()
  const effects = []
  await api.apply({ effect: (fn, label) => effects.push(label), get: () => undefined })
  assert.deepEqual(effects, ['dsh-study-coach: stylesheet'])
})

test('客户端 bundle：跳转入口覆盖面板那几页，第一条是首页', () => {
  const { api } = load()
  assert.ok(api.PAGES.length >= 5)
  assert.deepEqual(api.PAGES[0], { label: '主页', path: '/study' })
  for (const page of api.PAGES) {
    assert.match(page.path, /^\/study(\/[\w-]+)?$/, `${page.path} 得是 /study 底下的路径`)
    assert.ok(page.label, '每一页都要有能点的名字')
  }
})

test('客户端 bundle：样式只用 --dsw-alias-* 主题 token，不引插件自己面板那套', () => {
  // 面板的 --ink/--card/--accent 在 DSH 里根本没有值，混进来就是一片透明
  assert.doesNotMatch(CSS, /var\(--(ink|card|card-2|text|dim|accent|line)\b/)
  assert.match(CSS, /var\(--dsw-alias-label-primary, /)
  assert.match(CSS, /var\(--dsw-alias-brand-primary, /)
  assert.ok(CSS.includes('.sc-root'), '模板串得真被切出来，别切空了')
})

test('客户端 bundle：--dsw-alias-bg-base 一次都不许出现（它就是「跳转按钮看不见内容」的成因）', () => {
  /*
   * bg-base 是**背景**语义的 token。装了壁纸 / 主题类插件的宿主会把它改成 transparent
   * （dsh-plugin-wallpaper-engine 的 lib/client.js 里就是 `--dsw-alias-bg-base: transparent`），
   * 于是 `color: var(--dsw-alias-bg-base)` 的实心按钮：面在、字没了。
   * 公开的 Theme token 表里又没有「填充色之上那层文字色」，所以这一页干脆不碰 bg-base：
   * 文字走 label-primary，面走 bg-layer-*，强调走 brand 边框 + 左侧信号条。
   */
  assert.doesNotMatch(CSS, /--dsw-alias-bg-base/)
  assert.match(CSS, /\.sc-btn\.primary[^}]*border-color: var\(--dsw-alias-brand-primary, /)
  assert.doesNotMatch(CSS, /\.sc-btn\.primary[^}]*background: var\(--dsw-alias-brand-primary/)
})

test('客户端 bundle：每一个 --dsw-alias-* 都写兜底值（少一个就可能在别的宿主上凭空消失）', () => {
  assert.doesNotMatch(CSS, /var\(--dsw-alias-[a-z0-9-]+\)/, 'var(--dsw-alias-x, 兜底值) —— 逗号后面那个兜底值不能省')
})

/** 摊平一棵假元素树，拿到所有文字。 */
function text(node, out = []) {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    for (const item of node) text(item, out)
    return out
  }
  for (const child of node.children || []) text(child, out)
  return out
}

/** 摊平出一堆按钮：{ label, className, disabled }。 */
function buttons(node, out = []) {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const item of node) buttons(item, out)
    return out
  }
  if (node.type === 'button') {
    out.push({
      label: text(node).join(''),
      className: String((node.props || {}).className || ''),
      disabled: Boolean((node.props || {}).disabled),
    })
  }
  for (const child of node.children || []) buttons(child, out)
  return out
}

const RUNNING = {
  ok: true,
  supported: true,
  running: true,
  port: 19388,
  url: 'http://127.0.0.1:19388/study',
  preferred: 19388,
  hintUrl: 'http://127.0.0.1:19388/study',
  error: '',
  settings: { version: 1, panel: { autoStart: true, port: 19388 } },
  note: '',
}

/** 把页签渲染一遍：按 useState 的调用顺序喂预设值（state/busy/error/port/autoStart）。 */
function renderTab(state) {
  const queue = [state, '', '', '19388', true]
  const react = {
    createElement: (...args) => ({ type: args[0], props: args[1] || {}, children: args.slice(2) }),
    useState: (init) => {
      const next = queue.length > 0 ? queue.shift() : init
      return [next === undefined ? init : next, () => {}]
    },
    useEffect: () => {},
    useCallback: (fn) => fn,
  }
  return load({ react }).api.StudyCoachTab({})
}

test('客户端 bundle：服务跑着时，「打开网页面板」是那个被强调的按钮', () => {
  const tree = renderTab(RUNNING)
  const labels = text(tree).join(' | ')
  assert.match(labels, /面板服务/, '服务开关得有自己的块')
  assert.match(labels, /打开网页面板/)
  assert.match(labels, /127\.0\.0\.1:19388/)

  const all = buttons(tree)
  const primary = all.filter((btn) => btn.className.includes('primary'))
  assert.equal(primary.length, 1, '同时只该有一个被强调的按钮，不然看不出该点哪个')
  assert.equal(primary[0].label, '打开网页面板 ↗')
  assert.equal(primary[0].disabled, false)
  for (const label of ['启动', '停止', '重启']) {
    assert.ok(all.some((btn) => btn.label === label), `服务开关里必须有「${label}」`)
  }
})

test('客户端 bundle：服务停着时，「启动」被强调，「打开网页面板」没地址就灰着', () => {
  const tree = renderTab({ ...RUNNING, running: false, url: '', error: '' })
  const all = buttons(tree)
  const primary = all.filter((btn) => btn.className.includes('primary'))
  assert.equal(primary.length, 1)
  assert.equal(primary[0].label, '启动')
  const stop = all.find((btn) => btn.label === '停止')
  assert.equal(stop.disabled, true, '没跑就没得停')
  assert.match(text(tree).join(' | '), /面板现在没开/)
})

test('客户端 bundle：读不到状态也不炸，三块还在、按钮只是灰着', () => {
  const tree = renderTab(null)
  const all = buttons(tree)
  assert.ok(all.length >= 4, '连不上接口也得把开关摆出来')
  assert.ok(all.every((btn) => btn.disabled))
  assert.match(text(tree).join(' | '), /读取中/)
})

test('package.json：client 半边声明齐了，bundle 文件真在', () => {
  assert.equal(PKG.exports['./client'], './lib/client.js')
  assert.equal(PKG.dsh.client.platform, 'web')
  assert.deepEqual(PKG.dsh.client.inject, ['@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-settings'])
  assert.ok(PKG.files.includes('lib'), 'lib/ 得进 files，client.js 在里面')
})
