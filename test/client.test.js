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

/** 按线上那样把 bundle 拉起来，回 { id, api }。 */
function load() {
  let captured = null
  const window = {
    __ModuleLoader__: {
      load(spec) {
        captured = spec
      },
    },
    open() {},
  }
  const react = {
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
  assert.doesNotMatch(SOURCE, /var\(--(ink|card|card-2|text|dim|accent|line)\b/)
  assert.match(SOURCE, /var\(--dsw-alias-label-primary\)/)
  assert.match(SOURCE, /var\(--dsw-alias-brand-primary\)/)
})

test('package.json：client 半边声明齐了，bundle 文件真在', () => {
  assert.equal(PKG.exports['./client'], './lib/client.js')
  assert.equal(PKG.dsh.client.platform, 'web')
  assert.deepEqual(PKG.dsh.client.inject, ['@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-settings'])
  assert.ok(PKG.files.includes('lib'), 'lib/ 得进 files，client.js 在里面')
})
