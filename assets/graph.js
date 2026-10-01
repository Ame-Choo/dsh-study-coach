/**
 * 知识图谱渲染：把课程地图画成一张「关卡面」。纯前端、零依赖，只画图，不碰数据、不碰别的 DOM。
 *
 * 三层折叠树，不是一股脑摊平：
 *   大类（group）→ 模块（module）→ 单元（point，一个点就是一节网课）
 * 默认只显示大类，点一下展开一层。最小单元上挂着「看课」「做题」两个按钮。
 *
 * 版面照 design.md 与「明日方舟关卡选择面」那一套来：
 *   · **正交连线**、方角板块（圆角一律 0）：三列对齐，连出来的是一条折起来的竖路。
 *   · 每个大类一块**分区底板**，左边一条索引轨 + 两位索引字，板块右上角挂完成度。
 *   · 档位是**菱形**（方角转 45°），信号青只给「当前选中」和「进度」，其余全是灰阶。
 *   · 左上角一块**索引板**（HUD，不跟着拖），右上角工具也是方角细规，不抢视线。
 *
 * 画布能拖、能滚轮缩放——东西多了全靠这两下看。
 * 几何全在这文件里算，皮在 graph.css。
 *
 * 调用方只需要给容器和这几样东西：
 *   renderGraph(host, {
 *     modules, mastery, stages, colorOf, openPoint, onPick, onOpen,
 *     progress,   // lib/map.js 的 progressByGroup 输出：{ overall, groups, modules }（可选）
 *     today,      // 'YYYY-MM-DD'：只有给了它才会标「该复习」的那些点（可选）
 *   })
 * 其中 onOpen(kind, point) 的 kind 是 'video' | 'practice'。
 */

const SVG_NS = 'http://www.w3.org/2000/svg'

/* ── 几何 ────────────────────────────────────────────────────────────────────
   三列：大类板 / 模块板 / 单元行。列宽定死，行里也定死栏位 —— 排得齐才像一张图。 */

const COL0 = 46
const GROUP_W = 176
const GROUP_H = 58
const MOD_W = 168
const MOD_H = 48
const UNIT_H = 38

const GAP_GM = 64
const GAP_MU = 58
const COL1 = COL0 + GROUP_W + GAP_GM
const COL2 = COL1 + MOD_W + GAP_MU

const VGAP = 12
const MOD_GAP = 10
/* 两块板块之间得留出「抬头条 + 一条空档」的位置，不然下一块的章条会压在上一块底边上。 */
const GROUP_GAP = 64
const BAND_X = 14
const BAND_PAD = 14
/* 每一块板块顶上的章条：左边索引、中间进度槽、右边百分比。 */
const HEAD_BAR_H = 26
/* 第一块板块的中心线：上面留给索引板、索引板下面那行小字、以及自己的抬头条。 */
const HEAD_Y = 166
const BOTTOM_PAD = 44

const GROUP_NAME_MAX = 8
const MOD_NAME_MAX = 11
const NAME_MAX = 10
const CODE_MAX = 6

/* 单元行里的栏位（相对行左沿）：编号 / 名字 / 档位 / 复习日 / 按钮 */
const CODE_X = 24
/* 编号格与正文格之间那道竖规的位置（在 CODE_X 与 NAME_X 中间偏右）。 */
const CELL_RULE_X = 52
const NAME_X = 62
const STAGE_X = 206
const DUE_X = 274
const BTN_X = 324
const BTN_H = 22
const BTN_GAP = 6

/* 索引板（HUD）：不跟着拖，钉在左上角 */
const PLATE = { x: 14, y: 14, w: 300, h: 56 }
const PLATE_BAR = { x: 28, y: 60, w: 258, h: 3 }

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

/** 一个能点的方角按钮。返回节点和它的宽度，宽度得算出来才能排版。 */
function pill(label, extraClass, onClick) {
  const w = Math.round(textWidth(label) + 22)
  const node = svgEl('g', { class: 'kg-btn' + (extraClass ? ' ' + String(extraClass).trim() : ''), tabindex: '0' })
  node.appendChild(svgEl('rect', { class: 'kg-btn-bg', width: w, height: BTN_H }))
  const text = svgEl('text', { class: 'kg-btn-text', x: w / 2, y: BTN_H / 2 + 4, 'text-anchor': 'middle' })
  text.textContent = label
  node.appendChild(text)
  node.addEventListener('click', (event) => {
    if (draggedFromPress(event)) return
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

/*
 * 手抖不算点。
 *
 * 画布本身能拖着挪了（见 renderGraph 末尾的平移），可「在板块/单元上按住挪一下
 * 再松手」会同时收到一枚 click，把那一块折叠掉——拖完画布顺手收了一块，看着就像地图自己动了。
 * 所以：画布上记下按下的位置，松手时（同一处）挪过 4px 就让这一枚 click 失效。
 * 只在「按下的元素就是点中的元素」时才算数——按在这儿松手在那儿，本来就点不到东西；
 * 键盘派发的 click 前面没有 pointerdown，也不受影响。
 */
let pressAt = null
function watchDrag(node) {
  node.addEventListener('pointerdown', (event) => {
    pressAt = { x: event.clientX || 0, y: event.clientY || 0, at: Date.now(), target: event.target || null }
  })
}
function draggedFromPress(event) {
  const from = pressAt
  pressAt = null
  if (!from) return false
  if (from.target && event && event.target && event.target !== from.target) return false
  if (Date.now() - from.at > 1500) return false
  const dx = (event && event.clientX ? event.clientX : 0) - from.x
  const dy = (event && event.clientY ? event.clientY : 0) - from.y
  return Math.hypot(dx, dy) > 4
}

/**
 * @param {HTMLElement} host 容器，会被清空
 * @param {{modules?: any[], mastery?: any, stages?: string[], colorOf?: Function, openPoint?: string|null,
 *          onPick?: Function, onOpen?: Function, progress?: any, today?: string}} options
 * @returns {undefined}
 */
export function renderGraph(host, options) {
  if (!host) return
  clear(host)

  const opt = options || {}
  const rawModules = Array.isArray(opt.modules) ? opt.modules : []
  // 六档和它们各自的颜色都由调用方给（见 assets/stages.js），这一份只管画。
  // 调用方漏给时的兜底走 currentColor，不写死色值——否则就又多一套跟主题无关的配色。
  const stages = Array.isArray(opt.stages) && opt.stages.length ? opt.stages : ['没接触过']
  const fallbackStage = stages[0]
  const mastery = opt.mastery && opt.mastery.points ? opt.mastery.points : {}
  const openPoint = opt.openPoint || null
  const onPick = typeof opt.onPick === 'function' ? opt.onPick : null
  const onOpen = typeof opt.onOpen === 'function' ? opt.onOpen : null
  const colorOf = (stage) => (typeof opt.colorOf === 'function' ? opt.colorOf(stage) : null) || 'currentColor'
  /* 进度口径以 lib/map.js 那份为准（调用方给）；没给就按六档位置自己算个大概。
     复习日只认调用方给的 today：不给就不标，别让单测跟着系统时钟飘。 */
  const given = opt.progress && typeof opt.progress === 'object' ? opt.progress : null
  const today = typeof opt.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(opt.today) ? opt.today : null

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
          id: String(mod.id ?? mod.title ?? ''),
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

  /* ── 档位与进度：两处都要用 ─────────────────────────────────────────── */

  function stageOf(point) {
    const rec = mastery[point.id]
    return rec && typeof rec.stage === 'string' && stages.indexOf(rec.stage) >= 0 ? rec.stage : fallbackStage
  }

  /** 该复习的日期（YYYY-MM-DD），没到点或调用方没给 today 就回空串。 */
  function dueOf(pointId) {
    if (!today) return ''
    const rec = mastery[pointId]
    const at = rec && typeof rec.nextReview === 'string' ? rec.nextReview.slice(0, 10) : ''
    return /^\d{4}-\d{2}-\d{2}$/.test(at) && at <= today ? at : ''
  }

  /** 一组单元的进度：调用方给了就用它的（口径以 lib/map.js 那份为准），没有就按六档位置平均。 */
  function ratioOf(points, known) {
    if (typeof known === 'number' && Number.isFinite(known)) return Math.max(0, Math.min(100, Math.round(known)))
    if (!points.length) return 0
    const top = stages.length - 1 || 1
    let sum = 0
    for (const p of points) sum += Math.max(0, stages.indexOf(stageOf(p)))
    return Math.round((sum / points.length / top) * 100)
  }

  /* ── 排版 ─────────────────────────────────────────────────────────────── */

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
    /* 模块之间比单元之间再紧一点：同属一块底板，缝太大就不成组了。 */
    const gap = node.kind === 'group' ? MOD_GAP : VGAP
    let y = 0
    for (const kid of kids) {
      layout(kid)
      kid.y = y + kid.subH / 2
      y += kid.subH + gap
    }
    const sum = y - gap
    node.subH = Math.max(node.h, sum)
    node.top = (node.subH - sum) / 2
    node.y = node.subH / 2
  }

  let cursor = HEAD_Y
  for (const group of tree) {
    layout(group)
    group.y = cursor + group.subH / 2
    cursor += group.subH + GROUP_GAP
  }

  const contentH = Math.max(200, cursor - GROUP_GAP + BOTTOM_PAD)
  const vw = Math.max(320, Math.round(host.clientWidth || 0))
  /* 高度不封顶：大类一多（十二个往上）硬压到 620 就会把最后几个盒子关在画布外，只能靠拖。
     让它跟着内容长、页面自己滚，比悄悄裁掉强。 */
  const vh = Math.max(320, Math.round(contentH + 24))
  /* 底板宽度跟着画布走：画布宽就铺满，画布窄就按住内容宽度，剩下的靠拖。 */
  const bandW = Math.max(COL2 + 430, vw - BAND_X - 16) - BAND_X

  const svg = svgEl('svg', {
    class: 'kg-svg',
    viewBox: `0 0 ${vw} ${vh}`,
    /* 万一把画布拉伸了（父级给的高度跟 viewBox 的比例不一样），内容也钉在左上角，
       不要被居中——居中的话一改高度，整张图就会自己漂一下。 */
    preserveAspectRatio: 'xMinYMin meet',
    width: '100%',
    height: String(vh),
    role: 'tree',
    'aria-label': '知识图谱',
  })

  /* SVG 内部没法用 CSS 变量的地方才写死形状 —— 这两块花样的颜色还是走 class。 */
  const defs = svgEl('defs')
  const grid = svgEl('pattern', { id: 'kg-grid', width: 26, height: 26, patternUnits: 'userSpaceOnUse' })
  grid.appendChild(svgEl('path', { d: 'M 26 0 L 0 0 0 26', fill: 'none', class: 'kg-grid-line' }))
  defs.appendChild(grid)
  const hatch = svgEl('pattern', { id: 'kg-hatch', width: 10, height: 10, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(115)' })
  hatch.appendChild(svgEl('rect', { width: 4, height: 10, class: 'kg-hatch-line' }))
  defs.appendChild(hatch)
  svg.appendChild(defs)
  svg.appendChild(svgEl('rect', { class: 'kg-grid', x: 0, y: 0, width: vw, height: vh, fill: 'url(#kg-grid)' }))

  const view = svgEl('g', { class: 'kg-view' })
  const bands = svgEl('g', { class: 'kg-bands' })
  const lines = svgEl('g', { class: 'kg-lines' })
  const nodes = svgEl('g', { class: 'kg-nodes' })
  view.appendChild(bands)
  view.appendChild(lines)
  view.appendChild(nodes)
  svg.appendChild(view)

  /* HUD（索引板 / 工具箱 / 提示句）是直接挂在 <svg> 上的，跟视图层 `.kg-view` 平级——
     它们天生就不吃 `translate(t) scale(k)`，缩放时钉在视口上。
     **别再给它们补什么反向变换**：补了反而会跟着鼠标乱飞（踩过）。 */
  const applyView = () => {
    const { tx, ty, k } = state.view
    view.setAttribute('transform', `translate(${tx} ${ty}) scale(${k})`)
  }
  applyView()

  /* ── 分区底板 + 索引轨 ────────────────────────────────────────────────── */

  const allPoints = []
  for (const group of tree) for (const mod of group.children) for (const unit of mod.children) allPoints.push(unit.point)
  const touched = allPoints.filter((p) => stageOf(p) !== fallbackStage).length
  const overall = ratioOf(allPoints, given && given.overall)

  let maxTop = HEAD_Y
  for (const [index, group] of tree.entries()) {
    const top = group.y - group.subH / 2
    const boardTop = top - BAND_PAD - HEAD_BAR_H
    const boardH = HEAD_BAR_H + BAND_PAD + group.subH + BAND_PAD
    maxTop = Math.max(maxTop, top + group.subH)

    /* 一块板块 = 一张关卡面：抬头条 + 内容区，底沿就是内容区那一圈。 */
    bands.appendChild(svgEl('rect', { class: 'kg-band', x: BAND_X, y: boardTop, width: bandW, height: boardH }))
    bands.appendChild(svgEl('rect', { class: 'kg-band-head', x: BAND_X, y: boardTop, width: bandW, height: HEAD_BAR_H }))
    /* 左上、右下各钉一副角包：方角硬朗的图纸感靠这两笔。 */
    for (const [cx, cy, sx, sy] of [
      [BAND_X, boardTop, 1, 1],
      [BAND_X + bandW, boardTop + boardH, -1, -1],
    ]) {
      bands.appendChild(svgEl('path', {
        class: 'kg-frame',
        d: `M ${cx} ${cy + sy * 11} V ${cy} H ${cx + sx * 11}`,
      }))
    }
    /* 右侧一列刻度：板块有多高，边上那列小刻度就替眼睛量着。 */
    for (let ty = boardTop + HEAD_BAR_H + 12; ty < boardTop + boardH - 8; ty += 22) {
      bands.appendChild(svgEl('line', { class: 'kg-scale', x1: BAND_X + bandW - 6, y1: ty, x2: BAND_X + bandW - 1, y2: ty }))
    }
    bands.appendChild(svgEl('line', {
      class: 'kg-band-rule',
      x1: BAND_X,
      y1: boardTop + HEAD_BAR_H + .5,
      x2: BAND_X + bandW,
      y2: boardTop + HEAD_BAR_H + .5,
    }))

    /* 抬头条左边：两位索引字 + 一道竖规，章节感就靠这两笔。 */
    const ord = svgEl('text', { class: 'kg-ord', x: BAND_X + 13, y: boardTop + 18 })
    ord.textContent = String(index + 1).padStart(2, '0')
    bands.appendChild(ord)
    bands.appendChild(svgEl('line', { class: 'kg-ord-rule', x1: BAND_X + 42.5, y1: boardTop + 7, x2: BAND_X + 42.5, y2: boardTop + 19 }))

    /* 抬头条：中间一条进度槽、右边百分比 —— 这一章读到哪儿，扫一眼就有数。 */
    const points = []
    for (const mod of group.children) for (const unit of mod.children) points.push(unit.point)
    const pctValue = ratioOf(points, given && given.groups ? given.groups[group.title] : undefined)
    const gaugeX = BAND_X + 58
    const gaugeW = Math.max(60, bandW - 58 - 76)
    bands.appendChild(svgEl('rect', { class: 'kg-gauge', x: gaugeX, y: boardTop + HEAD_BAR_H - 7, width: gaugeW, height: 3 }))
    if (pctValue) {
      bands.appendChild(svgEl('rect', {
        class: 'kg-gauge-fill',
        x: gaugeX,
        y: boardTop + HEAD_BAR_H - 7,
        width: gaugeW * (pctValue / 100),
        height: 3,
      }))
    }
    const pctText = svgEl('text', {
      class: 'kg-pct' + (pctValue ? '' : ' is-zero'),
      x: BAND_X + bandW - 13,
      y: boardTop + 18,
      'text-anchor': 'end',
    })
    pctText.textContent = `${pctValue}%`
    bands.appendChild(pctText)

    /* 右侧一枚压淡的大索引字：画布右半边空着的时候不至于太空。 */
    const mark = svgEl('text', { class: 'kg-index', x: BAND_X + bandW - 22, y: top + group.subH / 2 + 14, 'text-anchor': 'end' })
    mark.textContent = String(index + 1).padStart(2, '0')
    bands.appendChild(mark)

    /* 两条「电路通道」：连线的竖段都走这两条线上，底面因此像一张图纸。 */
    for (const cx of [COL1 - GAP_GM / 2, COL2 - GAP_MU / 2]) {
      bands.appendChild(svgEl('line', {
        class: 'kg-col',
        x1: cx + .5,
        y1: boardTop + HEAD_BAR_H,
        x2: cx + .5,
        y2: boardTop + boardH,
      }))
    }

    /* 左沿一条竖进度：这一章读到哪儿，边上一眼量得出来（横向那条在抬头条里）。 */
    const vgY = boardTop + HEAD_BAR_H + BAND_PAD
    const vgH = Math.max(0, group.subH)
    bands.appendChild(svgEl('rect', { class: 'kg-vgauge', x: BAND_X + 9, y: vgY, width: 3, height: vgH }))
    if (pctValue) {
      bands.appendChild(svgEl('rect', {
        class: 'kg-vgauge-fill',
        x: BAND_X + 9,
        y: vgY,
        width: 3,
        height: vgH * (pctValue / 100),
      }))
    }

    /* 这块分区里有该复习的点：抬头条左边贴一条斜纹，一眼就能扫到。 */
    const due = group.children.some((mod) => mod.children.some((unit) => dueOf(unit.point.id)))
    if (due) {
      bands.appendChild(svgEl('rect', {
        class: 'kg-band-hatch',
        x: BAND_X,
        y: boardTop,
        width: 5,
        height: HEAD_BAR_H,
        fill: 'url(#kg-hatch)',
      }))
    }

    /* 整块板块都能点：不必非得戳中左边那块小牌子。画布已经不跟着鼠标拖了（见文末），
       但按住挪一下再松手还是会发一枚 click——那一下被 draggedFromPress() 挡掉。 */
    const hit = svgEl('rect', { class: 'kg-band-hit', x: BAND_X, y: boardTop, width: bandW, height: boardH })
    hit.addEventListener('click', (event) => {
      if (draggedFromPress(event)) return
      toggleNode(group)
    })
    bands.appendChild(hit)
  }
  /* 索引轨画在底板之上：一条竖线 + 每块一格刻度。两位索引字已经搬到抬头条上了。 */
  bands.appendChild(svgEl('line', { class: 'kg-rail', x1: 19.5, y1: Math.max(14, HEAD_Y - 52), x2: 19.5, y2: maxTop + BAND_PAD - 10 }))
  for (const group of tree) {
    bands.appendChild(svgEl('rect', { class: 'kg-tick', x: 18, y: group.y - 11, width: 3, height: 22 }))
  }

  /* ── 索引板（HUD） ────────────────────────────────────────────────────── */

  const modCount = tree.reduce((n, g) => n + g.children.length, 0)
  const plate = svgEl('g', { class: 'kg-plate' })
  plate.appendChild(svgEl('rect', { class: 'kg-plate-bg', x: PLATE.x, y: PLATE.y, width: PLATE.w, height: PLATE.h }))
  plate.appendChild(svgEl('path', { class: 'kg-corner', d: `M ${PLATE.x} ${PLATE.y + 12} L ${PLATE.x} ${PLATE.y} L ${PLATE.x + 12} ${PLATE.y}` }))
  const eyebrow = svgEl('text', { class: 'kg-plate-eyebrow', x: PLATE.x + 14, y: PLATE.y + 19 })
  eyebrow.textContent = 'KNOWLEDGE MAP'
  plate.appendChild(eyebrow)
  const headline = svgEl('text', { class: 'kg-plate-title', x: PLATE.x + 14, y: PLATE.y + 37 })
  headline.textContent = `${tree.length} 大类 · ${modCount} 模块 · ${allPoints.length} 单元`
  plate.appendChild(headline)
  const pct = svgEl('text', { class: 'kg-plate-pct', x: PLATE.x + PLATE.w - 14, y: PLATE.y + 37, 'text-anchor': 'end' })
  pct.textContent = `${overall}%`
  plate.appendChild(pct)
  plate.appendChild(svgEl('rect', { class: 'kg-plate-bar', x: PLATE_BAR.x, y: PLATE_BAR.y, width: PLATE_BAR.w, height: PLATE_BAR.h }))
  if (overall) {
    plate.appendChild(svgEl('rect', { class: 'kg-plate-bar-fill', x: PLATE_BAR.x, y: PLATE_BAR.y, width: PLATE_BAR.w * (overall / 100), height: PLATE_BAR.h }))
  }
  const note = svgEl('text', { class: 'kg-plate-note', x: PLATE.x + 14, y: PLATE.y + PLATE.h + 14 })
  note.textContent = `已接触 ${touched}/${allPoints.length}${today ? ' · 斜纹＝该复习' : ''}`
  plate.appendChild(note)
  /* 挂在 svg 上，不进 `.kg-view`：它就不吃视图变换，钉在视口左上角。 */
  svg.appendChild(plate)

  /* ── 画 ────────────────────────────────────────────────────────────────── */

  let unitCount = 0

  /** 展开 / 收起一个节点。板块上的整块点击、牌子上、键盘上都走这一条。 */
  function toggleNode(node) {
    if (!node.children.length) return
    if (isOpen(node)) state.open.delete(node.key)
    else state.open.add(node.key)
    renderGraph(host, opt)
  }

  for (const group of tree) {
    drawNode(group, 0)
  }

  function drawNode(node, baseY, index = 0) {
    const x = xOf(node)
    const y = baseY + node.y
    const kids = isOpen(node) ? node.children : []
    /* 子节点的坐标是相对「子树内容的顶」算的：先把它算成绝对坐标，
       连线终点和真正画出来的位置必须是同一个数——差一点点线头就指到空白处。 */
    const kidBase = baseY + node.y - node.subH / 2 + node.top

    for (const kid of kids) {
      const kx = xOf(kid)
      const ky = kidBase + kid.y
      /* 正交折线：先横出去、再顺着通道竖着走、再横进目标。关卡面那种走线，比曲线更像图纸。 */
      const mx = x + widthOf(node) + (kx - x - widthOf(node)) / 2
      lines.appendChild(svgEl('path', {
        class: 'kg-link kg-link-' + kid.kind,
        d: `M ${x + widthOf(node)} ${y} H ${mx} V ${ky} H ${kx}`,
      }))
      /* 拐点上钉一颗节点：折线拐弯的地方有个方点，整张图才像电路图。 */
      if (Math.abs(ky - y) > 1) {
        for (const jy of [y, ky]) {
          lines.appendChild(svgEl('rect', { class: 'kg-joint', x: mx - 2.5, y: jy - 2.5, width: 5, height: 5 }))
        }
      }
      if (kid.kind === 'unit') unitCount += 1
    }

    if (node.kind === 'unit') nodes.appendChild(unitNode(node.point, x, y, index))
    else nodes.appendChild(branchNode(node, x, y))

    for (const [ki, kid] of kids.entries()) drawNode(kid, kidBase, ki)
  }

  /** 折叠着也要说得清「里面有几个」——所以栏位上写的是总子数，不是这次画出来的那个数。 */
  function branchNode(node, x, y) {
    const w = widthOf(node)
    const h = heightOf(node)
    const total = node.children.length
    const attrs = { class: 'kg-' + node.kind, tabindex: '0', role: 'treeitem' }
    if (total) attrs['aria-expanded'] = String(isOpen(node))
    const g = svgEl('g', attrs)

    const tip = svgEl('title')
    tip.textContent = node.title + (total ? `（${total} 项，点一下${isOpen(node) ? '收起' : '展开'}）` : '（空）')
    g.appendChild(tip)

    /* 方角板块：圆角一律 0，层次只靠「面」和细规。 */
    g.appendChild(svgEl('rect', { class: 'kg-box', x, y: y - h / 2, width: w, height: h }))
    /* 角包：只钉左上那一小块，标出这块的起点。 */
    g.appendChild(svgEl('path', { class: 'kg-corner', d: `M ${x} ${y - h / 2 + 12} L ${x} ${y - h / 2} L ${x + 12} ${y - h / 2}` }))

    if (node.kind === 'group') {
      const points = []
      for (const mod of node.children) for (const unit of mod.children) points.push(unit.point)
      const done = points.filter((p) => stageOf(p) !== fallbackStage).length

      const title = svgEl('text', { class: 'kg-title', x: x + 14, y: y - 4 })
      title.textContent = clip(node.title, GROUP_NAME_MAX)
      g.appendChild(title)

      const sub = svgEl('text', { class: 'kg-sub', x: x + 14, y: y + 14 })
      sub.textContent = total ? `${total} 个模块 · ${points.length} 单元` : '空'
      g.appendChild(sub)

      /* 百分比搬到板块的抬头条上了，牌子上只留「读到几个」——同一件事不写两遍。 */
      const count = svgEl('text', { class: 'kg-sub', x: x + w - 22, y: y + 14, 'text-anchor': 'end' })
      count.textContent = `${done}/${points.length}`
      g.appendChild(count)
    } else {
      const points = node.children.map((unit) => unit.point)
      const pctValue = ratioOf(points, given && given.modules ? given.modules[node.id] : undefined)
      const done = points.filter((p) => stageOf(p) !== fallbackStage).length

      /* 左沿竖着的进度柱：模块板比大类板窄，槽立起来放左边。 */
      const trackH = h - 8
      g.appendChild(svgEl('rect', { class: 'kg-mark', x: x + 1, y: y - trackH / 2, width: 4, height: trackH }))
      if (pctValue) {
        g.appendChild(svgEl('rect', {
          class: 'kg-mark-fill',
          x: x + 1,
          y: y + trackH / 2 - trackH * (pctValue / 100),
          width: 4,
          height: trackH * (pctValue / 100),
        }))
      }

      const code = svgEl('text', { class: 'kg-code', x: x + 16, y: y - 8 })
      code.textContent = clip(node.id, CODE_MAX)
      g.appendChild(code)

      const pctText = svgEl('text', { class: 'kg-pct' + (pctValue ? '' : ' is-zero'), x: x + w - 22, y: y - 8, 'text-anchor': 'end' })
      pctText.textContent = `${pctValue}%`
      g.appendChild(pctText)

      const title = svgEl('text', { class: 'kg-title', x: x + 16, y: y + 6 })
      title.textContent = clip(node.title, MOD_NAME_MAX)
      g.appendChild(title)

      const sub = svgEl('text', { class: 'kg-sub', x: x + 16, y: y + 20 })
      sub.textContent = total ? `${total} 节 · 掌握 ${done}/${points.length}` : '空'
      g.appendChild(sub)

      /* 收起的时候单元不画行，改在右边摆一条「格带」：一节一个小方格，颜色就是那一节的档位。
         收着也一眼看得出里面几节、读到哪儿了——比只写一个 3/3 有信息，也把右边那块空填上。 */
      if (!isOpen(node) && points.length) {
        const CELL = 9
        const CELL_GAP = 3
        const perRow = Math.max(1, Math.floor(240 / (CELL + CELL_GAP)))
        const rowH = CELL + CELL_GAP
        const top = y - ((Math.ceil(points.length / perRow) - 1) * rowH) / 2 - CELL / 2
        const strip = svgEl('g', { class: 'kg-cells' })
        points.forEach((point, i) => {
          const stage = stageOf(point)
          strip.appendChild(svgEl('rect', {
            class: 'kg-cell' + (stage === fallbackStage ? ' is-empty' : ''),
            x: COL2 + 14 + (i % perRow) * (CELL + CELL_GAP),
            y: top + Math.floor(i / perRow) * rowH,
            width: CELL,
            height: CELL,
            fill: colorOf(stage),
            'data-stage': stage,
          }))
        })
        g.appendChild(strip)
      }
    }

    /* 能展开的话，右沿中间挂一枚小三角：收起时朝右、展开时朝下。 */
    if (total) {
      const cx = x + w - 13
      g.appendChild(svgEl('path', {
        class: 'kg-chevron' + (isOpen(node) ? ' is-open' : ''),
        d: isOpen(node)
          ? `M ${cx - 5} ${y - 3} L ${cx + 5} ${y - 3} L ${cx} ${y + 4} Z`
          : `M ${cx - 3} ${y - 5} L ${cx + 4} ${y} L ${cx - 3} ${y + 5} Z`,
      }))
    }

    g.addEventListener('click', (event) => {
      if (draggedFromPress(event)) return
      event.stopPropagation()
      toggleNode(node)
    })
    g.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      event.stopPropagation()
      toggleNode(node)
    })

    return g
  }

  function unitNode(point, x, y, index = 0) {
    const stage = stageOf(point)
    const fill = colorOf(stage)
    const due = dueOf(point.id)
    const isOpenPoint = openPoint === point.id

    const g = svgEl('g', { class: 'kg-point' + (isOpenPoint ? ' is-open' : ''), tabindex: '0', role: 'treeitem' })
    const tip = svgEl('title')
    tip.textContent = (point.title || point.id) + ' · ' + stage + (due ? ` · ${due} 该复习` : '')
    g.appendChild(tip)

    const cx = x + CH_SIZE
    if (isOpenPoint) {
      /* 选中：菱形外面再套一圈描边（全图只有一个）。 */
      g.appendChild(svgEl('rect', {
        class: 'kg-halo',
        x: cx - 9,
        y: y - 9,
        width: 18,
        height: 18,
        transform: `rotate(45 ${cx} ${y})`,
      }))
    }
    /* 档位点是菱形：方角转 45°，不写圆角。 */
    g.appendChild(svgEl('rect', {
      class: 'kg-dot',
      x: cx - 5.5,
      y: y - 5.5,
      width: 11,
      height: 11,
      transform: `rotate(45 ${cx} ${y})`,
      fill,
      'data-stage': stage,
    }))

    const code = svgEl('text', { class: 'kg-code', x: x + CODE_X, y: y + 4 })
    code.textContent = clip(point.id, CODE_MAX)
    g.appendChild(code)

    const name = svgEl('text', { class: 'kg-name', x: x + NAME_X, y: y - 1 })
    name.textContent = clip(point.title || point.id, NAME_MAX)
    g.appendChild(name)

    const tag = svgEl('text', { class: 'kg-stage', x: x + STAGE_X, y: y + 4 })
    tag.textContent = stage
    g.appendChild(tag)

    if (due) {
      const at = svgEl('text', { class: 'kg-due', x: x + DUE_X, y: y + 4 })
      at.textContent = '↻ ' + due.slice(5)
      g.appendChild(at)
    }

    const pick = () => {
      if (onPick) onPick(point.id)
    }
    g.addEventListener('click', (event) => {
      if (draggedFromPress(event)) return
      event.stopPropagation()
      pick()
    })
    g.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      event.stopPropagation()
      pick()
    })

    const row = svgEl('g', { class: 'kg-unit-row' + (index % 2 ? ' is-alt' : '') })

    /* 栏位定死，所以按钮从 x+BTN_X 起排，不必先量名字。 */
    let right = x + (onOpen ? BTN_X : STAGE_X + 74)
    const buttons = []
    if (onOpen) {
      let bx = x + BTN_X
      /* 这两颗永远点得动：看课会去资料图谱里找这一讲（挂没挂 video 只决定走哪条路），
         做题是把教练叫来布置。所以不再有 is-empty——按钮灰着反而让人以为没救。 */
      for (const [kind, label] of [
        ['video', '看课'],
        ['practice', '做题'],
      ]) {
        const btn = pill(label, '', () => onOpen(kind, point))
        buttons.push({ btn, at: bx })
        bx += btn.w + BTN_GAP
        right = bx - BTN_GAP
      }
    }

    /* 一个单元垫一条槽：两个模块都展开的时候，光靠菱形和文字分不出谁是谁。 */
    row.appendChild(svgEl('rect', {
      class: 'kg-unit-bg',
      x: x - 12,
      y: y - UNIT_H / 2,
      width: right - x + 24,
      height: UNIT_H,
    }))
    /* 编号格和正文格之间立一道竖规：单元一多就是一张表，像关卡面的编号栏。 */
    row.appendChild(svgEl('line', {
      class: 'kg-cell-rule',
      x1: x + CELL_RULE_X,
      y1: y - UNIT_H / 2 + 4,
      x2: x + CELL_RULE_X,
      y2: y + UNIT_H / 2 - 4,
    }))
    /* 行底线：单元一多就是一张表，一条细规把行分开，眼睛才不至于串行。 */
    row.appendChild(svgEl('line', {
      class: 'kg-row-rule',
      x1: x - 12,
      y1: y + UNIT_H / 2 + .5,
      x2: right + 12,
      y2: y + UNIT_H / 2 + .5,
    }))
    /* 选中的那条左边立一道青柱：当前项一眼可见。 */
    if (isOpenPoint) {
      row.appendChild(svgEl('rect', { class: 'kg-row-mark', x: x - 12, y: y - UNIT_H / 2, width: 3, height: UNIT_H }))
    }
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
    /* 挂在 svg 上而不是视图层：拖走画布之后这句提示还得看得见。 */
    svg.appendChild(hint)
  }

  /* ── 工具箱：不受视图缩放影响，钉在右上角 ─────────────────────────────── */

  const tools = svgEl('g', { class: 'kg-tools' })
  let tx = vw - 16
  for (const item of [
    { label: '全部收起', keep: false },
    { label: '复位视图', keep: true },
  ]) {
    const w = Math.round(textWidth(item.label) + 22)
    tx -= w
    const btn = svgEl('g', { class: 'kg-tool', tabindex: '0', transform: `translate(${tx} 14)` })
    btn.appendChild(svgEl('rect', { class: 'kg-tool-bg', width: w, height: 26 }))
    const label = svgEl('text', { class: 'kg-tool-text', x: w / 2, y: 17, 'text-anchor': 'middle' })
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
      if (draggedFromPress(event)) return
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
  applyView()
  watchDrag(svg)

  /* ── 平移（拖着画布挪） + 缩放 ─────────────────────────────────────────
     平移是用户 m21561 要回来的（更早那版「不可动的」把这条路整条拆了，现在装回去，
     但只认**真的挪过 4px** 才算拖：

       · 按在 `.kg-tools` 那两颗按钮上的不算拖（那是点按钮，别把点击吞了）；
       · 挪过 `PAN_SLOP` 才 `is-panning` + 捕获指针；手没挪的那一下照旧是点击——
         `draggedFromPress()` 正是靠这条把「拖过之后松手发出来的那枚 click」吃掉，
         所以拖过板块不会顺手把板块折起来；
       · 指针坐标是屏幕像素，`state.view.tx/ty` 是 viewBox 单位，要除以 CSS 拉伸比
         （`xMinYMin meet` 下就是 `min(w/vw, h/vh)`，跟滚轮缩放同一个换算），不然拖快了会飘；
       · HUD（工具箱 / 索引板 / 提示句）挂在 `<svg>` 上、不在 `.kg-view` 里，天然不跟着走；
       · 拖得太远就 `PAN_MAX` 收住，别把图拖出视口找不回来——`复位视图` 仍然是那条后路。
     普通滚轮照旧滚页面，**要缩放按住 Ctrl/⌘**。 */

  const PAN_SLOP = 4
  const PAN_MAX = 1
  let pan = null

  const scaleOf = () => {
    const box = svg.getBoundingClientRect()
    return Math.min(box.width / vw, box.height / vh) || 1
  }
  const inTools = (node) => Boolean(node && node.closest && node.closest('.kg-tools'))

  svg.addEventListener('pointerdown', (event) => {
    if (event.button != null && event.button !== 0) return
    if (inTools(event.target)) return
    pan = {
      id: event.pointerId,
      x: event.clientX || 0,
      y: event.clientY || 0,
      tx: state.view.tx,
      ty: state.view.ty,
      moved: false,
    }
  })

  svg.addEventListener('pointermove', (event) => {
    if (!pan) return
    if (pan.id != null && event.pointerId != null && event.pointerId !== pan.id) return
    const dx = (event.clientX || 0) - pan.x
    const dy = (event.clientY || 0) - pan.y
    if (!pan.moved) {
      if (Math.hypot(dx, dy) <= PAN_SLOP) return
      pan.moved = true
      svg.classList.add('is-panning')
      if (event.pointerId != null && svg.setPointerCapture) {
        try { svg.setPointerCapture(event.pointerId) } catch { /* 个别实现不认，认了更好 */ }
      }
    }
    event.preventDefault()
    const scale = scaleOf()
    /* 放大的时候能挪的范围也得跟着放大（k = 2 时右边界在 2vw 处），否则放大之后看不到右边。
       缩小时内容比视口还窄，留一屏的余量就够。 */
    const slack = Math.max(1, state.view.k)
    const limitX = vw * PAN_MAX * slack
    const limitY = vh * PAN_MAX * slack
    state.view.tx = Math.max(-limitX, Math.min(limitX, pan.tx + dx / scale))
    state.view.ty = Math.max(-limitY, Math.min(limitY, pan.ty + dy / scale))
    applyView()
  })

  const endPan = () => {
    if (!pan) return
    pan = null
    svg.classList.remove('is-panning')
  }
  svg.addEventListener('pointerup', endPan)
  svg.addEventListener('pointercancel', endPan)
  /* 还没算成拖就走了：把这次按下清掉，免得下一次 move 拿旧起点乱跳。 */
  svg.addEventListener('pointerleave', () => { if (pan && !pan.moved) endPan() })

  svg.addEventListener('wheel', (event) => {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    const next = Math.min(MAX_K, Math.max(MIN_K, state.view.k * Math.exp(-event.deltaY * 0.0015)))
    if (next === state.view.k) return
    /* 指针在屏幕上的位置要换算成 viewBox 里的坐标再当锚点：画布万一被 CSS 拉伸过
       （父级高度跟 viewBox 比例不一致，或者渲染时量到的宽度跟现在的不一样），
       直接用像素当锚点，缩放就会往一边飘。xMinYMin meet 的换算就是「除以那个比例」。 */
    const box = svg.getBoundingClientRect()
    const scale = Math.min(box.width / vw, box.height / vh) || 1
    const px = (event.clientX - box.left) / scale
    const py = (event.clientY - box.top) / scale
    const ratio = next / state.view.k
    state.view.tx = px - (px - state.view.tx) * ratio
    state.view.ty = py - (py - state.view.ty) * ratio
    state.view.k = next
    applyView()
  }, { passive: false })

  host.appendChild(svg)
}
