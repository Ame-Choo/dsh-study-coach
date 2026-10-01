/**
 * graph.js 的回归测试。纯 node:test + node:assert/strict，零依赖。
 *
 * graph.js 是纯前端模块，在 node 里跑得自己搭一层最小 SVG DOM。
 * stub 只实现 graph.js 真正用到的那几样：
 *   document.createElementNS / createElement
 *   setAttribute / getAttribute、appendChild / removeChild / firstChild
 *   addEventListener / dispatch（带冒泡和 stopPropagation）
 *   classList.add/remove/contains、className、textContent
 *   getBoundingClientRect、closest（支持 ".a, .b"）、setPointerCapture
 * 查询用自己写的 walk / findAll.
 *
 * 坑：graph.js 里的 state（展开的节点 + 画布位移）是模块级单例，跨用例会串味。
 * resetState() 先渲染一次底稿，再点「全部收起」和「复位视图」，把它清干净。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderGraph } from '../assets/graph.js'

/* ── 最小 DOM stub ────────────────────────────────────────────────────── */

function classesOf(el) {
  const raw = el.attrs.get('class')
  return raw ? raw.split(/\s+/).filter(Boolean) : []
}

function matchesSelector(el, sel) {
  if (sel.startsWith('.')) return classesOf(el).includes(sel.slice(1))
  if (sel.startsWith('#')) return el.getAttribute('id') === sel.slice(1)
  return el.tagName.toLowerCase() === sel.toLowerCase()
}

class StubElement {
  constructor(tagName, namespaceURI = null) {
    this.tagName = tagName
    this.namespaceURI = namespaceURI
    this.attrs = new Map()
    this.childNodes = []
    this.parentNode = null
    this._text = ''
    this._listeners = new Map()
    this._rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
    this.pointerCaptures = []
    this.classList = {
      add: (...names) => {
        const set = new Set(classesOf(this))
        for (const n of names) set.add(n)
        this.attrs.set('class', [...set].join(' '))
      },
      remove: (...names) => {
        const drop = new Set(names)
        this.attrs.set('class', classesOf(this).filter((c) => !drop.has(c)).join(' '))
      },
      contains: (name) => classesOf(this).includes(name),
      toggle: (name) => {
        if (this.classList.contains(name)) this.classList.remove(name)
        else this.classList.add(name)
      },
    }
  }

  get firstChild() {
    return this.childNodes.length ? this.childNodes[0] : null
  }

  get children() {
    return this.childNodes
  }

  get className() {
    return this.attrs.get('class') || ''
  }

  set className(value) {
    this.attrs.set('class', String(value))
  }

  get textContent() {
    return this._text + this.childNodes.map((c) => c.textContent).join('')
  }

  set textContent(value) {
    for (const c of this.childNodes) c.parentNode = null
    this.childNodes = []
    this._text = String(value)
  }

  setAttribute(key, value) {
    this.attrs.set(key, String(value))
  }

  getAttribute(key) {
    return this.attrs.has(key) ? this.attrs.get(key) : null
  }

  removeAttribute(key) {
    this.attrs.delete(key)
  }

  appendChild(node) {
    if (node.parentNode) node.parentNode.removeChild(node)
    node.parentNode = this
    this.childNodes.push(node)
    return node
  }

  removeChild(node) {
    const i = this.childNodes.indexOf(node)
    if (i < 0) throw new Error('removeChild: 不是我的孩子')
    this.childNodes.splice(i, 1)
    node.parentNode = null
    return node
  }

  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, [])
    this._listeners.get(type).push(fn)
  }

  /** 派发一个事件，按 parentNode 往上冒泡；stopPropagation 就地截断。 */
  dispatch(type, init = {}) {
    const event = {
      type,
      target: this,
      currentTarget: this,
      clientX: 0,
      clientY: 0,
      deltaY: 0,
      key: '',
      pointerId: 1,
      defaultPrevented: false,
      stopped: false,
    }
    event.preventDefault = () => {
      event.defaultPrevented = true
    }
    event.stopPropagation = () => {
      event.stopped = true
    }
    Object.assign(event, init)
    for (let node = this; node; node = node.parentNode) {
      event.currentTarget = node
      const handlers = node._listeners.get(type)
      if (handlers) for (const fn of [...handlers]) fn(event)
      if (event.stopped) break
    }
    return event
  }

  closest(sel) {
    const parts = String(sel)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    for (let node = this; node; node = node.parentNode) {
      if (parts.some((p) => matchesSelector(node, p))) return node
    }
    return null
  }

  getBoundingClientRect() {
    return { ...this._rect }
  }

  setPointerCapture(id) {
    this.pointerCaptures.push(id)
  }

  releasePointerCapture() {}
}

const documentStub = {
  createElement: (tag) => new StubElement(tag),
  createElementNS: (ns, tag) => new StubElement(tag, ns),
}

// graph.js 读的是全局 document；import 是提升的，但它模块体里不碰 document，
// 所以这里挂上去就够（用例回调都在模块体跑完之后才执行）。
globalThis.document = documentStub

/* 查询助手：递归遍历，不依赖任何 selector 引擎 */

function walk(root, visit) {
  for (const child of root.childNodes) {
    visit(child)
    walk(child, visit)
  }
}

function findAll(root, pred) {
  const out = []
  walk(root, (el) => {
    if (pred(el)) out.push(el)
  })
  return out
}

const byClass = (root, cls) => findAll(root, (el) => el.classList.contains(cls))
const byTag = (root, tag) => findAll(root, (el) => el.tagName === tag)
const allTexts = (root) => byTag(root, 'text').map((el) => el.textContent)

/* ── 夹具 ─────────────────────────────────────────────────────────────── */

const STAGES = ['没接触过', '见过', '能跟做', '能独立做', '熟练稳定', '能讲明白']
const COLORS = {
  没接触过: '#101010',
  见过: '#202020',
  能跟做: '#303030',
  能独立做: '#404040',
  熟练稳定: '#505050',
  能讲明白: '#606060',
}
const colorOf = (stage) => COLORS[stage] || '#f0f0f0'

/** 一个大类、两个模块、三个单元。 */
const MODULES = [
  {
    id: 'M1',
    group: '行列式',
    title: '性质与展开',
    points: [
      { id: 'M1.1', title: '定义', video: 'F:\\a.mp4', practice: '' },
      { id: 'M1.2', title: '判定', video: '', practice: 'F:\\b.pdf' },
    ],
  },
  {
    id: 'M2',
    group: '行列式',
    title: '计算技巧',
    points: [{ id: 'M2.1', title: '判别', video: '', practice: '' }],
  },
]

function baseOpts(extra = {}) {
  return {
    modules: MODULES,
    mastery: { points: {} },
    stages: STAGES,
    colorOf,
    openPoint: null,
    ...extra,
  }
}

function makeHost(clientWidth = 900) {
  const host = new StubElement('div')
  host.clientWidth = clientWidth
  return host
}

/** 找到带某段标题文字的 .kg-group / .kg-mod 节点。 */
function findByTitle(root, cls, text) {
  return byClass(root, cls).find((node) => {
    const title = byClass(node, 'kg-title')[0]
    return title && title.textContent.includes(text)
  })
}

function clickNode(root, cls, text) {
  const node = findByTitle(root, cls, text)
  assert.ok(node, `找不到 .${cls}（标题含「${text}」）`)
  node.dispatch('click')
  return node
}

function clickTool(root, label) {
  const tool = byClass(root, 'kg-tool').find((t) => t.textContent.includes(label))
  assert.ok(tool, `找不到工具按钮「${label}」`)
  tool.dispatch('click')
  return tool
}

/** 展开到单元可见：大类 + 指定模块。 */
function drillDown(root, groupTitle = '行列式', modTitle = '性质与展开') {
  clickNode(root, 'kg-group', groupTitle)
  clickNode(root, 'kg-mod', modTitle)
}

/**
 * 连线得落在子节点的中心线上。折线的五段数字是 `M x y H mx V ky H kx`：
 * 第 4 个数（ky）就是终点的 y，它必须等于某个可见节点的中心线——不然线头指在空白处。
 */
test('每一条连线都落在子节点的中心线上，不会连到空白处', () => {
  const host = makeHost()
  resetState(host)
  renderGraph(host, baseOpts())
  drillDown(host)
  assert.ok(byClass(host, 'kg-link').length >= 4, '展开后总该有几条线')

  const near = (n) => Math.round(n * 10) / 10
  const centers = new Set()
  for (const box of byClass(host, 'kg-box')) {
    centers.add(near(Number(box.getAttribute('y')) + Number(box.getAttribute('height')) / 2))
  }
  for (const row of byClass(host, 'kg-unit-bg')) {
    centers.add(near(Number(row.getAttribute('y')) + Number(row.getAttribute('height')) / 2))
  }

  for (const link of byClass(host, 'kg-link')) {
    const d = link.getAttribute('d')
    const nums = (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number)
    assert.equal(nums.length, 5, `折线格式变了：${d}`)
    assert.ok(centers.has(near(nums[3])), `线头 ${nums[3]} 不在任何节点的中心线上：${d}`)
  }
})

/** state 是模块级单例：渲染一次底稿，再把展开和视图都清掉。 */
function resetState(host) {
  renderGraph(host, baseOpts())
  clickTool(host, '全部收起')
  clickTool(host, '复位视图')
}

function viewTransform(host) {
  const view = byClass(host, 'kg-view')[0]
  return view ? view.getAttribute('transform') : null
}

function readScale(host) {
  const m = /scale\(([\d.]+)\)/.exec(viewTransform(host) || '')
  return m ? Number(m[1]) : NaN
}

function svgOf(host) {
  const svg = byTag(host, 'svg')[0]
  assert.ok(svg, 'host 里没有 svg')
  svg._rect = { left: 0, top: 0, right: 900, bottom: 620, width: 900, height: 620 }
  return svg
}

/* ── 用例 ─────────────────────────────────────────────────────────────── */

test('没有任何模块：出一个 .kg-empty，不抛错', () => {
  const host = makeHost()
  resetState(host)
  renderGraph(host, baseOpts({ modules: [] }))

  assert.equal(byClass(host, 'kg-empty').length, 1)
  assert.equal(host.childNodes.length, 1)
  assert.equal(byTag(host, 'svg').length, 0)
})

test('空 options / null options：不抛错，走空态', () => {
  const host = makeHost()
  resetState(host)

  assert.doesNotThrow(() => renderGraph(host, {}))
  assert.equal(byClass(host, 'kg-empty').length, 1)

  assert.doesNotThrow(() => renderGraph(host, null))
  assert.equal(byClass(host, 'kg-empty').length, 1)

  assert.doesNotThrow(() => renderGraph(null, baseOpts()))
})

test('默认只显示大类：模块名、单元名都不进 SVG 文本', () => {
  const host = makeHost()
  resetState(host)
  renderGraph(host, baseOpts())

  assert.equal(byClass(host, 'kg-group').length, 1)
  assert.equal(byClass(host, 'kg-mod').length, 0)
  assert.equal(byClass(host, 'kg-point').length, 0)
  assert.equal(byClass(host, 'kg-btn').length, 0)

  const texts = allTexts(host)
  assert.ok(texts.some((t) => t.includes('行列式')), '大类名应该在')
  assert.ok(!texts.some((t) => t.includes('性质与展开')), '折叠时不该出现模块名')
  assert.ok(!texts.some((t) => t.includes('计算技巧')), '折叠时不该出现模块名')
  assert.ok(!texts.some((t) => t.includes('定义')), '折叠时不该出现单元名')
})

test('点大类展开出模块名，再点模块展开出单元名', () => {
  const host = makeHost()
  resetState(host)
  renderGraph(host, baseOpts())

  clickNode(host, 'kg-group', '行列式')
  assert.equal(byClass(host, 'kg-mod').length, 2)
  assert.equal(byClass(host, 'kg-point').length, 0)
  assert.ok(allTexts(host).some((t) => t.includes('性质与展开')))
  assert.ok(allTexts(host).some((t) => t.includes('计算技巧')))

  clickNode(host, 'kg-mod', '性质与展开')
  assert.equal(byClass(host, 'kg-point').length, 2)
  assert.ok(allTexts(host).some((t) => t.includes('定义')))
  assert.ok(allTexts(host).some((t) => t.includes('判定')))
  assert.equal(byClass(host, 'kg-point').length, 2, '另一个模块还没展开')

  clickNode(host, 'kg-mod', '计算技巧')
  assert.equal(byClass(host, 'kg-point').length, 3)

  // 再点一次收起
  clickNode(host, 'kg-mod', '计算技巧')
  assert.equal(byClass(host, 'kg-point').length, 2)
})

test('键盘 Enter 也能展开大类', () => {
  const host = makeHost()
  resetState(host)
  renderGraph(host, baseOpts())

  const group = findByTitle(host, 'kg-group', '行列式')
  const event = group.dispatch('keydown', { key: 'Enter' })
  assert.equal(event.defaultPrevented, true)
  assert.equal(byClass(host, 'kg-mod').length, 2)

  // 别的键不该动它
  const again = findByTitle(host, 'kg-group', '行列式')
  again.dispatch('keydown', { key: 'a' })
  assert.equal(byClass(host, 'kg-mod').length, 2)
})

test('给了 onOpen：每个可见单元恰好两个按钮，文字是看课/做题', () => {
  const host = makeHost()
  resetState(host)
  renderGraph(host, baseOpts({ onOpen: () => {} }))
  drillDown(host)

  const rows = byClass(host, 'kg-unit-row')
  assert.equal(rows.length, 2, '可见单元两个')
  const buttons = byClass(host, 'kg-btn')
  assert.equal(buttons.length, 4)
  for (const row of rows) assert.equal(byClass(row, 'kg-btn').length, 2)
  assert.deepEqual(
    buttons.map((b) => byClass(b, 'kg-btn-text')[0].textContent),
    ['看课', '做题', '看课', '做题'],
  )
})

test('不给 onOpen：一个按钮都不渲染，单元本身还在', () => {
  const host = makeHost()
  resetState(host)
  renderGraph(host, baseOpts())
  drillDown(host)

  assert.equal(byClass(host, 'kg-point').length, 2)
  assert.equal(byClass(host, 'kg-unit-row').length, 2)
  assert.equal(byClass(host, 'kg-btn').length, 0)
})

test('没挂材料的按钮带 is-empty', () => {
  const host = makeHost()
  resetState(host)
  renderGraph(host, baseOpts({ onOpen: () => {} }))
  drillDown(host)

  const rows = byClass(host, 'kg-unit-row')
  const labels = (row) => byClass(row, 'kg-btn').map((b) => byClass(b, 'kg-btn-text')[0].textContent)
  const isEmpty = (row) =>
    byClass(row, 'kg-btn').map((b) => b.classList.contains('is-empty'))

  // M1.1 有 video、没有 practice
  assert.deepEqual(labels(rows[0]), ['看课', '做题'])
  assert.deepEqual(isEmpty(rows[0]), [false, true])
  // M1.2 只有 practice
  assert.deepEqual(labels(rows[1]), ['看课', '做题'])
  assert.deepEqual(isEmpty(rows[1]), [true, false])
})

test('点 .kg-btn：kind 是 video/practice，第二个参数是那个 point', () => {
  const host = makeHost()
  const calls = []
  const picks = []
  resetState(host)
  renderGraph(
    host,
    baseOpts({
      onOpen: (kind, point) => calls.push([kind, point]),
      onPick: (id) => picks.push(id),
    }),
  )
  drillDown(host)

  const buttons = byClass(host, 'kg-btn')
  buttons[0].dispatch('click')
  buttons[1].dispatch('click')
  buttons[2].dispatch('click')

  assert.deepEqual(
    calls.map((c) => c[0]),
    ['video', 'practice', 'video'],
  )
  assert.equal(calls[0][1].id, 'M1.1')
  assert.equal(calls[1][1].id, 'M1.1')
  assert.equal(calls[2][1].id, 'M1.2')
  assert.equal(calls[0][1].video, 'F:\\a.mp4')
  assert.equal(calls[1][1].practice, '')
  assert.equal(picks.length, 0, '点按钮不该顺带触发 onPick')
})

test('点 .kg-point 给对 pointId；点 .kg-group 不触发 onPick', () => {
  const host = makeHost()
  const picks = []
  resetState(host)
  renderGraph(host, baseOpts({ onPick: (id) => picks.push(id) }))

  clickNode(host, 'kg-group', '行列式')
  assert.deepEqual(picks, [], '点大类只展开，不该 pick')

  clickNode(host, 'kg-mod', '性质与展开')
  const point = byClass(host, 'kg-point').find((g) =>
    byClass(g, 'kg-name')[0].textContent.includes('定义'),
  )
  assert.ok(point, '找不到 M1.1 的节点')
  point.dispatch('click')
  assert.deepEqual(picks, ['M1.1'])

  const other = byClass(host, 'kg-point').find((g) =>
    byClass(g, 'kg-name')[0].textContent.includes('判定'),
  )
  other.dispatch('click')
  assert.deepEqual(picks, ['M1.1', 'M1.2'])
})

test('重复 renderGraph 同一个 host：子节点被清干净，不翻倍', () => {
  const host = makeHost()
  resetState(host)

  renderGraph(host, baseOpts())
  renderGraph(host, baseOpts())

  assert.equal(host.childNodes.length, 1)
  assert.equal(byTag(host, 'svg').length, 1)
  assert.equal(byClass(host, 'kg-group').length, 1)
  assert.equal(byClass(host, 'kg-tool').length, 2)

  clickNode(host, 'kg-group', '行列式')
  assert.equal(byClass(host, 'kg-mod').length, 2)
})

test('没有 points 的模块：展开不炸，也不渲染按钮', () => {
  const host = makeHost()
  resetState(host)
  const modules = [
    { id: 'E1', group: '行列式', title: '空模块', points: [] },
    { id: 'E2', group: '行列式', title: '没写points' },
    { id: 'E3', group: '行列式', title: '点没id', points: [{ title: '无名' }] },
  ]
  renderGraph(host, baseOpts({ modules, onOpen: () => {} }))
  clickNode(host, 'kg-group', '行列式')

  assert.equal(byClass(host, 'kg-mod').length, 3)
  assert.doesNotThrow(() => clickNode(host, 'kg-mod', '空模块'))
  assert.doesNotThrow(() => clickNode(host, 'kg-mod', '没写points'))
  assert.doesNotThrow(() => clickNode(host, 'kg-mod', '点没id'))

  assert.equal(byClass(host, 'kg-point').length, 0)
  assert.equal(byClass(host, 'kg-btn').length, 0)
  assert.equal(byClass(host, 'kg-unit-row').length, 0)
})

test('mastery 为 {} / null / points:null：不炸，圆点用第一档颜色', () => {
  for (const mastery of [{}, null, { points: null }, undefined]) {
    const host = makeHost()
    resetState(host)
    renderGraph(host, baseOpts({ mastery }))
    drillDown(host)

    const dots = byClass(host, 'kg-dot')
    assert.equal(dots.length, 2, `mastery=${JSON.stringify(mastery)}`)
    for (const dot of dots) {
      assert.equal(dot.getAttribute('fill'), colorOf(STAGES[0]))
      assert.equal(dot.getAttribute('data-stage'), STAGES[0])
    }
  }
})

test('mastery 命中：颜色按 stage 走；非法 stage 退回第一档', () => {
  const host = makeHost()
  resetState(host)
  renderGraph(
    host,
    baseOpts({ mastery: { points: { 'M1.1': { stage: '能跟做', confidence: 0.7 } } } }),
  )
  drillDown(host)

  const dots = byClass(host, 'kg-dot')
  assert.equal(dots[0].getAttribute('fill'), colorOf('能跟做'))
  assert.equal(dots[0].getAttribute('data-stage'), '能跟做')
  assert.equal(dots[1].getAttribute('fill'), colorOf(STAGES[0]))

  const host2 = makeHost()
  resetState(host2)
  renderGraph(host2, baseOpts({ mastery: { points: { 'M1.1': { stage: '神仙档' } } } }))
  drillDown(host2)
  assert.equal(byClass(host2, 'kg-dot')[0].getAttribute('fill'), colorOf(STAGES[0]))
})

test('openPoint 命中的单元带 is-open，并多一个 .kg-halo', () => {
  const host = makeHost()
  resetState(host)
  /* 带 openPoint 渲染时祖先是自动撑开的，不用再 drillDown——从下面列表点一个点就是这条路。 */
  renderGraph(host, baseOpts({ openPoint: 'M1.2' }))

  const points = byClass(host, 'kg-point')
  assert.equal(points.length, 2)
  const opened = points.filter((g) => g.classList.contains('is-open'))
  assert.equal(opened.length, 1)
  assert.equal(byClass(opened[0], 'kg-name')[0].textContent, '判定')
  assert.equal(byClass(opened[0], 'kg-halo').length, 1)
  assert.equal(byClass(host, 'kg-halo').length, 1)

  const host2 = makeHost()
  resetState(host2)
  renderGraph(host2, baseOpts({ openPoint: null }))
  drillDown(host2)
  assert.equal(byClass(host2, 'kg-point').filter((g) => g.classList.contains('is-open')).length, 0)
  assert.equal(byClass(host2, 'kg-halo').length, 0)
})

test('多个大类按 group 分堆，没写 group 的进「未分类」', () => {
  const host = makeHost()
  resetState(host)
  const modules = [
    { id: 'A1', group: '行列式', title: '性质与展开', points: [] },
    { id: 'A2', group: '矩阵', title: '秩', points: [] },
    { id: 'A3', title: '没写组', points: [] },
    { id: 'A4', group: '   ', title: '空白组', points: [] },
  ]
  renderGraph(host, baseOpts({ modules }))

  const titles = byClass(host, 'kg-group').map((g) => byClass(g, 'kg-title')[0].textContent)
  assert.deepEqual(titles, ['行列式', '矩阵', '未分类'])

  clickNode(host, 'kg-group', '未分类')
  assert.deepEqual(
    byClass(host, 'kg-mod').map((m) => byClass(m, 'kg-title')[0].textContent).sort(),
    ['没写组', '空白组'].sort(),
  )
  const sub = byClass(findByTitle(host, 'kg-group', '未分类'), 'kg-sub')[0]
  assert.ok(sub.textContent.includes('2 个模块'), '未分类下有两个模块')
})

test('画布宽度跟着 host.clientWidth，取不到就兜 320', () => {
  const wide = makeHost(900)
  resetState(wide)
  clickNode(wide, 'kg-group', '行列式')
  assert.ok(svgOf(wide).getAttribute('viewBox').startsWith('0 0 900 '))

  const narrow = makeHost(0)
  resetState(narrow)
  renderGraph(narrow, baseOpts({ modules: MODULES }))
  assert.ok(svgOf(narrow).getAttribute('viewBox').startsWith('0 0 320 '))
})

test('12 个大类也不炸；高度跟着内容长，不封顶', () => {
  const host = makeHost()
  resetState(host)
  const modules = Array.from({ length: 12 }, (_, i) => ({
    id: 'G' + i,
    group: '组' + i,
    title: '模块' + i,
    points: [],
  }))
  renderGraph(host, baseOpts({ modules }))

  assert.equal(byClass(host, 'kg-group').length, 12)
  assert.equal(byClass(host, 'kg-box').length, 12)

  const h = Number(svgOf(host).getAttribute('height'))
  assert.ok(h > 620, `十二个大类该把画布撑过 620，实际 ${h}`)
  const boxes = byClass(host, 'kg-box')
  const last = boxes[boxes.length - 1]
  const bottom = Number(last.getAttribute('y')) + Number(last.getAttribute('height'))
  assert.ok(bottom <= h, '最后一个大类不该被关在画布外')
})

test('选中被折叠起来的单元时，祖先自动撑开', () => {
  const host = makeHost()
  resetState(host)
  renderGraph(host, baseOpts({ openPoint: 'M1.1' }))
  assert.equal(byClass(host, 'kg-point').length, 2, '一下没点也得看得见那节课')
  assert.equal(byClass(host, 'kg-halo').length, 1)
})

test('换一份地图，展开状态不会跟着串到新图里', () => {
  const host = makeHost()
  resetState(host)
  drillDown(host)
  assert.equal(byClass(host, 'kg-point').length, 2)

  const other = [{ id: 'M1', group: '行列式', title: '性质与展开', points: [{ id: 'M1.1', title: '定义' }] }]
  renderGraph(host, baseOpts({ modules: other }))
  assert.equal(byClass(host, 'kg-group').length, 1)
  assert.equal(byClass(host, 'kg-mod').length, 0, '新地图该是收着的')
})

test('两个大类里的同名模块 id 不会互相带着展开', () => {
  const host = makeHost()
  resetState(host)
  const modules = [
    { id: 'X', group: '行列式', title: '在行列式里', points: [{ id: 'p1', title: '一' }] },
    { id: 'X', group: '矩阵', title: '在矩阵里', points: [{ id: 'p2', title: '二' }] },
  ]
  renderGraph(host, baseOpts({ modules }))
  clickNode(host, 'kg-group', '行列式')
  assert.equal(byClass(host, 'kg-mod').length, 1, '只该展开「行列式」下面那一个')
  clickNode(host, 'kg-mod', '在行列式里')
  assert.equal(byClass(host, 'kg-point').length, 1)
  assert.equal(byClass(host, 'kg-name')[0].textContent, '一')
})

test('图的 role 是 tree，不是 img', () => {
  const host = makeHost()
  resetState(host)
  assert.equal(svgOf(host).getAttribute('role'), 'tree')
})

test('工具按钮：全部收起清空展开，复位视图把 transform 复位', () => {
  const host = makeHost()
  resetState(host)
  renderGraph(host, baseOpts())

  clickNode(host, 'kg-group', '行列式')
  clickNode(host, 'kg-mod', '性质与展开')
  assert.equal(byClass(host, 'kg-point').length, 2)

  clickTool(host, '全部收起')
  assert.equal(byClass(host, 'kg-mod').length, 0)
  assert.equal(byClass(host, 'kg-point').length, 0)

  const svg = svgOf(host)
  svg.dispatch('pointerdown', { clientX: 10, clientY: 10, pointerId: 7 })
  svg.dispatch('pointermove', { clientX: 60, clientY: 30 })
  assert.equal(viewTransform(host), 'translate(50 20) scale(1)')
  // 索引板与工具箱是钉在视口上的：拖动时反向补一次，不然它们会跟着画布跑掉
  assert.equal(byClass(host, 'kg-plate')[0].getAttribute('transform'), 'translate(-50 -20) scale(1)')
  assert.equal(byClass(host, 'kg-tools')[0].getAttribute('transform'), 'translate(-50 -20) scale(1)')

  clickTool(host, '复位视图')
  assert.equal(viewTransform(host), 'translate(0 0) scale(1)')
  assert.equal(byClass(host, 'kg-plate')[0].getAttribute('transform'), 'translate(0 0) scale(1)')
})

test('滚轮缩放夹在 0.4x–2.4x，并 preventDefault', () => {
  const host = makeHost()
  resetState(host)
  renderGraph(host, baseOpts())
  const svg = svgOf(host)

  assert.equal(readScale(host), 1)
  const zoomIn = svg.dispatch('wheel', { deltaY: -10000, clientX: 450, clientY: 300 })
  assert.equal(zoomIn.defaultPrevented, true)
  assert.equal(readScale(host), 2.4)

  const zoomOut = svg.dispatch('wheel', { deltaY: 10000, clientX: 450, clientY: 300 })
  assert.equal(zoomOut.defaultPrevented, true)
  assert.equal(readScale(host), 0.4)

  // 很小的 delta 也要挪一点点（不是纹丝不动）
  svg.dispatch('wheel', { deltaY: -100, clientX: 450, clientY: 300 })
  assert.ok(readScale(host) > 0.4)
})

test('滚轮缩放钉在指针底下：那一点的画布坐标不动，缩放不飘', () => {
  const host = makeHost(900)
  resetState(host)
  renderGraph(host, baseOpts())
  const svg = svgOf(host)
  const view = byClass(host, 'kg-view')[0]
  const read = () => {
    const m = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([\d.]+)\)/.exec(view.getAttribute('transform') || '')
    return { tx: Number(m[1]), ty: Number(m[2]), k: Number(m[3]) }
  }
  /* 屏上（viewBox 单位）→ 画布坐标，缩放锚点要钉的就是这个换算。 */
  const atX = (v, screen) => (screen - v.tx) / v.k
  const atY = (v, screen) => (screen - v.ty) / v.k

  const box = svg._rect
  const [, , vbW, vbH] = svg.getAttribute('viewBox').split(' ').map(Number)
  const scale = Math.min(box.width / vbW, box.height / vbH) || 1
  const screenX = 300 / scale
  const screenY = 220 / scale

  for (const deltaY of [-100, -100, -100, 200, 200]) {
    const before = read()
    const ux = atX(before, screenX)
    const uy = atY(before, screenY)
    svg.dispatch('wheel', { deltaY, clientX: 300, clientY: 220 })
    const after = read()
    assert.notEqual(after.k, before.k, '这一下该真的缩放')
    assert.ok(Math.abs(after.k * ux + after.tx - screenX) < 0.5, `横着飘了：${after.k * ux + after.tx} ≠ ${screenX}`)
    assert.ok(Math.abs(after.k * uy + after.ty - screenY) < 0.5, `竖着飘了：${after.k * uy + after.ty} ≠ ${screenY}`)
  }
})

test('空白处能拖动画布；按在单元上不拖', () => {
  const host = makeHost()
  resetState(host)
  renderGraph(host, baseOpts())
  const svg = svgOf(host)

  const down = svg.dispatch('pointerdown', { clientX: 5, clientY: 5, pointerId: 3 })
  assert.ok(svg.classList.contains('is-panning'))
  assert.deepEqual(svg.pointerCaptures, [3])
  svg.dispatch('pointermove', { clientX: 105, clientY: 45 })
  assert.equal(viewTransform(host), 'translate(100 40) scale(1)')

  svg.dispatch('pointerup', {})
  assert.ok(!svg.classList.contains('is-panning'))
  assert.equal(down.defaultPrevented, false)

  // 拖动结束，再动也不该跟着走
  svg.dispatch('pointermove', { clientX: 500, clientY: 500 })
  assert.equal(viewTransform(host), 'translate(100 40) scale(1)')

  // 从单元上按下：不该开始拖
  clickTool(host, '复位视图')
  drillDown(host)
  const svg2 = svgOf(host)
  const point = byClass(host, 'kg-point')[0]
  point.dispatch('pointerdown', { clientX: 5, clientY: 5, pointerId: 4 })
  assert.ok(!svg2.classList.contains('is-panning'))
  point.dispatch('pointermove', { clientX: 200, clientY: 200 })
  assert.equal(viewTransform(host), 'translate(0 0) scale(1)')
})
