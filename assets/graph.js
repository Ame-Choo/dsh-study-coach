/**
 * 知识图谱渲染。纯前端、零依赖，只画图，不碰数据、不碰别的 DOM。
 *
 * 三层折叠树，不是一股脑摊平：
 *   大类（group）→ 模块（module）→ 单元（point，一个点就是一节网课）
 * 默认只显示大类，点一下展开一层。最小单元上挂着「看课」「做题」两个按钮。
 *
 * 画布能拖、能滚轮缩放——东西多了全靠这两下看。
 * 几何全在这文件里算，皮在 graph.css。
 *
 * 调用方只需要给容器和这几样东西：
 *   renderGraph(host, { modules, mastery, stages, colorOf, openPoint, onPick, onOpen })
 * 其中 onOpen(kind, point) 的 kind 是 'video' | 'practice'。
 */

const SVG_NS = 'http://www.w3.org/2000/svg'

const GROUP_W = 116
const GROUP_H = 40
const MOD_W = 140
const MOD_H = 32
const UNIT_H = 36
const VGAP = 10
const GROUP_GAP = 18

const COL0 = 26
const COL1 = COL0 + GROUP_W + 66
const COL2 = COL1 + MOD_W + 58

const GROUP_NAME_MAX = 7
const MOD_NAME_MAX = 10
const NAME_MAX = 12
const BTN_H = 18

const MIN_K = 0.4
const MAX_K = 2.4
const CH_SIZE = 6.5

/** 展开状态和视图位置跨调用留着：自评一下不该把画布弹回原位。 */
const state = {
  open: new Set(),
  view: { tx: 0, ty: 0, k: 1 },
  /* 当前画的是哪份地图、上次聚焦的是哪个单元——换地图或换聚焦目标时都得知道。 */
  dataset: null,
  focused: null,
}

/** 换没换地图，看这个指纹。只收会进图的那些字。 */
function fingerprint(modules) {
  const parts = []
  for (const mod of modules) {
    parts.push(String(mod.group || ''), String(mod.id ?? mod.title ?? ''))
    for (const point of Array.isArray(mod.points) ? mod.points : []) {
      parts.push(String(point && point.id ? point.id : ''))
    }
  }
  return parts.join('\u0001')
}

function svgEl(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag)
  if (attrs) {
    for (const key of Object.keys(attrs)) {
      const value = attrs[key]
      if (value === undefined || value === null) continue
      node.setAttribute(key, String(value))
    }
  }
  return node
}

/** 长了就截断。用 Array.from 是按码点切，不会把 emoji 劈成两半。 */
function clip(text, max) {
  const clean = String(text == null ? '' : text).replace(/\s+/g, ' ').trim()
  const chars = Array.from(clean)
  return chars.length > max ? chars.slice(0, max).join('') + '…' : clean
}

/** 中文字宽按 13px 估、别的按 7px 估。估不准也只是按钮挪一点，不致命。 */
function textWidth(text) {
  let w = 0
  for (const ch of Array.from(String(text == null ? '' : text))) w += ch.charCodeAt(0) > 0x2e80 ? 13 : 7
  return w
}

function clear(host) {
  while (host.firstChild) host.removeChild(host.firstChild)
}

function emptyState(host) {
  const box = document.createElement('div')
  box.className = 'kg-empty'
  box.textContent = '暂无知识点'
  host.appendChild(box)
}

/** 一个能点的胶囊按钮。返回节点和它的宽度，宽度得算出来才能排版。 */
function pill(label, extraClass, onClick) {
  const w = Math.round(textWidth(label) + 22)
  const node = svgEl('g', { class: 'kg-btn' + (extraClass ? ' ' + String(extraClass).trim() : ''), tabindex: '0' })
  node.appendChild(svgEl('rect', { class: 'kg-btn-bg', width: w, height: BTN_H, rx: BTN_H / 2 }))
  const text = svgEl('text', { class: 'kg-btn-text', x: w / 2, y: 13, 'text-anchor': 'middle' })
  text.textContent = label
  node.appendChild(text)
  node.addEventListener('click', (event) => {
    event.stopPropagation()
    onClick()
  })
  node.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    event.stopPropagation()
    onClick()
  })
  return { node, w }
}

/**
 * @param {HTMLElement} host 容器，会被清空
 * @param {{modules?: any[], mastery?: any, stages?: string[], colorOf?: Function, openPoint?: string|null,
 *          onPick?: Function, onOpen?: Function}} options
 * @returns {undefined}
 */
export function renderGraph(host, options) {
  if (!host) return
  clear(host)

  const opt = options || {}
  const rawModules = Array.isArray(opt.modules) ? opt.modules : []
  const stages = Array.isArray(opt.stages) && opt.stages.length ? opt.stages : ['没接触过']
  const fallbackStage = stages[0]
  const mastery = opt.mastery && opt.mastery.points ? opt.mastery.points : {}
  const openPoint = opt.openPoint || null
  const onPick = typeof opt.onPick === 'function' ? opt.onPick : null
  const onOpen = typeof opt.onOpen === 'function' ? opt.onOpen : null
  const colorOf = (stage) => (typeof opt.colorOf === 'function' ? opt.colorOf(stage) : null) || '#5b6472'

  const modules = rawModules.filter((m) => m && (m.title || m.id))
  if (modules.length === 0) {
    emptyState(host)
    return
  }

  /* ── 建树：按 group 分堆，没写 group 的归到「未分类」 ─────────────────── */

  const buckets = new Map()
  for (const mod of modules) {
    const name = String(mod.group || '').trim() || '未分类'
    if (!buckets.has(name)) buckets.set(name, [])
    buckets.get(name).push(mod)
  }

  const tree = []
  for (const [title, mods] of buckets) {
    tree.push({
      kind: 'group',
      key: 'G:' + title,
      title,
      children: mods.map((mod) => {
        /* key 带大类前缀：两个大类里各有一个 id 相同的模块（换档案很容易撞），
           光用模块 id 做 key，点一个会两个一起展开。 */
        const modKey = 'M:' + title + '/' + String(mod.id ?? mod.title ?? '')
        return {
          kind: 'mod',
          key: modKey,
          title: String(mod.title || mod.id || ''),
          children: (Array.isArray(mod.points) ? mod.points : [])
            .filter((p) => p && p.id)
            .map((p) => ({ kind: 'unit', key: modKey + '/P:' + String(p.id), point: p })),
        }
      }),
    })
  }

  /* 换了一份地图就把展开状态和视图清掉：旧 key 留着只会让新图莫名其妙地半开着。
     自评引起的重渲染指纹不变，所以画布不会弹回原位。 */
  const print = fingerprint(modules)
  if (state.dataset !== print) {
    state.dataset = print
    state.focused = null
    state.open = new Set()
    state.view = { tx: 0, ty: 0, k: 1 }
  }

  /* 选中的单元要是被折叠在里面，画布上就什么都看不出来——从下面列表点一个点正是这情形。
     只在选中目标变了的时候替它撑开祖先，之后学生自己收起就不要再弹开。 */
  if (openPoint && state.focused !== openPoint) {
    state.focused = openPoint
    for (const group of tree) {
      for (const mod of group.children) {
        if (!mod.children.some((unit) => unit.point.id === openPoint)) continue
        state.open.add(group.key)
        state.open.add(mod.key)
      }
    }
  }

  const isOpen = (node) => state.open.has(node.key)
  const widthOf = (node) => (node.kind === 'group' ? GROUP_W : node.kind === 'mod' ? MOD_W : 0)
  const heightOf = (node) => (node.kind === 'group' ? GROUP_H : node.kind === 'mod' ? MOD_H : UNIT_H)
  const xOf = (node) => (node.kind === 'group' ? COL0 : node.kind === 'mod' ? COL1 : COL2)

  /** 一遍递归：算出每棵子树多高，父节点自己摆在这块高度的中间。 */
  function layout(node) {
    node.h = heightOf(node)
    const kids = isOpen(node) ? node.children : []
    if (!kids.length) {
      node.subH = node.h
      node.top = 0
      node.y = node.h / 2
      return
    }
    let y = 0
    for (const kid of kids) {
      layout(kid)
      kid.y = y + kid.subH / 2
      y += kid.subH + VGAP
    }
    const sum = y - VGAP
    node.subH = Math.max(node.h, sum)
    node.top = (node.subH - sum) / 2
    node.y = node.subH / 2
  }

  let cursor = 0
  for (const group of tree) {
    layout(group)
    group.y = cursor + group.subH / 2
    cursor += group.subH + GROUP_GAP
  }

  const contentH = Math.max(120, cursor - GROUP_GAP)
  const vw = Math.max(320, Math.round(host.clientWidth || 0))
  /* 高度不封顶：大类一多（十二个往上）硬压到 620 就会把最后几个盒子关在画布外，只能靠拖。
     让它跟着内容长、页面自己滚，比悄悄裁掉强。 */
  const vh = Math.max(320, Math.round(contentH + 48))

  const svg = svgEl('svg', {
    class: 'kg-svg',
    viewBox: `0 0 ${vw} ${vh}`,
    width: '100%',
    height: String(vh),
    role: 'tree',
    'aria-label': '知识图谱',
  })

  const view = svgEl('g', { class: 'kg-view' })
  const lines = svgEl('g', { class: 'kg-lines' })
  const nodes = svgEl('g', { class: 'kg-nodes' })
  view.appendChild(lines)
  view.appendChild(nodes)
  svg.appendChild(view)

  const applyView = () => {
    view.setAttribute('transform', `translate(${state.view.tx} ${state.view.ty}) scale(${state.view.k})`)
  }
  applyView()

  /* ── 画 ────────────────────────────────────────────────────────────────── */

  let unitCount = 0

  for (const group of tree) {
    drawNode(group, 0)
  }

  function drawNode(node, baseY) {
    const x = xOf(node)
    const y = baseY + node.y
    const kids = isOpen(node) ? node.children : []

    for (const kid of kids) {
      const kx = xOf(kid)
      const ky = baseY + node.top + kid.y
      lines.appendChild(svgEl('path', {
        class: 'kg-link kg-link-' + kid.kind,
        d: `M ${x + widthOf(node)} ${y} C ${x + widthOf(node) + 26} ${y}, ${kx - 26} ${ky}, ${kx} ${ky}`,
      }))
      if (kid.kind === 'unit') unitCount += 1
    }

    if (node.kind === 'unit') nodes.appendChild(unitNode(node.point, x, y))
    else nodes.appendChild(branchNode(node, x, y, kids.length))

    /* 子节点的坐标是相对「我这棵子树的顶」算的，所以得把自己那半截高度挪掉——
       不然同级的第二个子树会跟第一个叠在同一个 y 上。 */
    for (const kid of kids) drawNode(kid, baseY + node.y - node.subH / 2 + node.top)
  }

  function branchNode(node, x, y, kidCount) {
    const w = widthOf(node)
    const h = heightOf(node)
    const attrs = { class: 'kg-' + node.kind, tabindex: '0', role: 'treeitem' }
    if (kidCount) attrs['aria-expanded'] = String(isOpen(node))
    const g = svgEl('g', attrs)

    const tip = svgEl('title')
    tip.textContent = node.title + (kidCount ? `（${kidCount} 项，点一下${isOpen(node) ? '收起' : '展开'}）` : '（空）')
    g.appendChild(tip)

    g.appendChild(svgEl('rect', { class: 'kg-box', x, y: y - h / 2, width: w, height: h, rx: 10 }))

    const title = svgEl('text', {
      class: 'kg-title',
      x: x + w / 2,
      y: kidCount || node.kind === 'group' ? y - 2 : y + 4,
      'text-anchor': 'middle',
    })
    title.textContent = clip(node.title, node.kind === 'group' ? GROUP_NAME_MAX : MOD_NAME_MAX)
    g.appendChild(title)

    if (node.kind === 'group') {
      const sub = svgEl('text', { class: 'kg-sub', x: x + w / 2, y: y + 13, 'text-anchor': 'middle' })
      sub.textContent = kidCount ? `${kidCount} 个模块` : '空'
      g.appendChild(sub)
    } else if (kidCount) {
      const sub = svgEl('text', { class: 'kg-sub', x: x + w / 2, y: y + 13, 'text-anchor': 'middle' })
      sub.textContent = `${kidCount} 节`
      g.appendChild(sub)
    }

    const toggle = () => {
      if (!node.children.length) return
      if (isOpen(node)) state.open.delete(node.key)
      else state.open.add(node.key)
      renderGraph(host, opt)
    }
    g.addEventListener('click', (event) => {
      event.stopPropagation()
      toggle()
    })
    g.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      event.stopPropagation()
      toggle()
    })

    return g
  }

  function unitNode(point, x, y) {
    const rec = mastery[point.id]
    const stage = rec && typeof rec.stage === 'string' && stages.indexOf(rec.stage) >= 0 ? rec.stage : fallbackStage
    const fill = colorOf(stage)

    const g = svgEl('g', { class: 'kg-point' + (openPoint === point.id ? ' is-open' : ''), tabindex: '0', role: 'treeitem' })
    const tip = svgEl('title')
    tip.textContent = (point.title || point.id) + ' · ' + stage
    g.appendChild(tip)

    if (openPoint === point.id) g.appendChild(svgEl('circle', { class: 'kg-halo', cx: x + CH_SIZE, cy: y, r: 9.5 }))
    g.appendChild(svgEl('circle', { class: 'kg-dot', cx: x + CH_SIZE, cy: y, r: 5.5, fill, 'data-stage': stage }))

    const name = svgEl('text', { class: 'kg-name', x: x + 20, y: y - 2 })
    name.textContent = clip(point.title || point.id, NAME_MAX)
    g.appendChild(name)

    const tag = svgEl('text', { class: 'kg-stage', x: x + 20, y: y + 12 })
    tag.textContent = stage
    g.appendChild(tag)

    const pick = () => {
      if (onPick) onPick(point.id)
    }
    g.addEventListener('click', (event) => {
      event.stopPropagation()
      pick()
    })
    g.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      event.stopPropagation()
      pick()
    })

    const row = svgEl('g', { class: 'kg-unit-row' })

    /* 按钮宽度得先量出来，才知道这条底色该多宽。 */
    let bx = x + 24 + Math.round(textWidth(clip(point.title || point.id, NAME_MAX)))
    let right = bx
    const buttons = []
    if (onOpen) {
      for (const [kind, label, target] of [
        ['video', '看课', String(point.video || '')],
        ['practice', '做题', String(point.practice || '')],
      ]) {
        const btn = pill(label, target ? '' : 'is-empty', () => onOpen(kind, point))
        buttons.push({ btn, at: bx })
        right = bx + btn.w
        bx += btn.w + 6
      }
    }

    /* 一个单元垫一条浅底：两个模块都展开的时候，光靠圆点和文字分不出谁是谁。 */
    row.appendChild(svgEl('rect', {
      class: 'kg-unit-bg',
      x: x - 8,
      y: y - UNIT_H / 2,
      width: Math.max(130, right - x + 18),
      height: UNIT_H - 4,
      rx: 8,
    }))
    row.appendChild(g)
    for (const { btn, at } of buttons) {
      btn.node.setAttribute('transform', `translate(${at} ${y - BTN_H / 2})`)
      row.appendChild(btn.node)
    }

    return row
  }

  if (unitCount === 0) {
    const hint = svgEl('text', { class: 'kg-hint', x: vw / 2, y: vh - 16, 'text-anchor': 'middle' })
    hint.textContent = '展开大类与模块，即可查看各单元网课'
    view.appendChild(hint)
  }

  /* ── 工具箱：不受拖动缩放影响，钉在右上角 ─────────────────────────────── */

  const tools = svgEl('g', { class: 'kg-tools' })
  let tx = vw - 12
  for (const item of [
    { label: '全部收起', keep: false },
    { label: '复位视图', keep: true },
  ]) {
    const w = Math.round(textWidth(item.label) + 20)
    tx -= w
    const btn = svgEl('g', { class: 'kg-tool', tabindex: '0', transform: `translate(${tx} 12)` })
    btn.appendChild(svgEl('rect', { class: 'kg-tool-bg', width: w, height: 22, rx: 11 }))
    const label = svgEl('text', { class: 'kg-tool-text', x: w / 2, y: 15, 'text-anchor': 'middle' })
    label.textContent = item.label
    btn.appendChild(label)

    const act = () => {
      if (item.keep) {
        state.view = { tx: 0, ty: 0, k: 1 }
      } else {
        state.open.clear()
      }
      renderGraph(host, opt)
    }
    btn.addEventListener('click', (event) => {
      event.stopPropagation()
      act()
    })
    btn.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      event.stopPropagation()
      act()
    })
    tools.appendChild(btn)
    tx -= 8
  }
  svg.appendChild(tools)

  /* ── 拖和缩放 ─────────────────────────────────────────────────────────── */

  let dragging = null
  let captured = false

  svg.addEventListener('pointerdown', (event) => {
    if (event.target.closest && event.target.closest('.kg-group, .kg-mod, .kg-point, .kg-btn, .kg-tool')) return
    dragging = { x: event.clientX, y: event.clientY, tx: state.view.tx, ty: state.view.ty }
    captured = false
    if (svg.setPointerCapture) {
      try {
        svg.setPointerCapture(event.pointerId)
        captured = true
      } catch {
        /* 指针已经没了，无所谓 */
      }
    }
    svg.classList.add('is-panning')
  })

  svg.addEventListener('pointermove', (event) => {
    if (!dragging) return
    state.view.tx = dragging.tx + (event.clientX - dragging.x)
    state.view.ty = dragging.ty + (event.clientY - dragging.y)
    applyView()
  })

  const endDrag = () => {
    if (!dragging) return
    dragging = null
    svg.classList.remove('is-panning')
  }
  svg.addEventListener('pointerup', endDrag)
  svg.addEventListener('pointercancel', endDrag)
  /* 捕获成功时事件会一直送到 svg 身上，拖出画布也不会丢；捕获没成功的浏览器
     只能靠 pointerleave 兜底，不然一松手就粘着鼠标不放。 */
  svg.addEventListener('pointerleave', () => {
    if (!captured) endDrag()
  })

  svg.addEventListener('wheel', (event) => {
    event.preventDefault()
    const next = Math.min(MAX_K, Math.max(MIN_K, state.view.k * Math.exp(-event.deltaY * 0.0015)))
    if (next === state.view.k) return
    const box = svg.getBoundingClientRect()
    const px = event.clientX - box.left
    const py = event.clientY - box.top
    const ratio = next / state.view.k
    state.view.tx = px - (px - state.view.tx) * ratio
    state.view.ty = py - (py - state.view.ty) * ratio
    state.view.k = next
    applyView()
  }, { passive: false })

  host.appendChild(svg)
}
