/**
 * Model-facing tools：让对话里能直接读写学习档案，不用绕 HTTP。
 *
 * defineTool 由 index.js 注入，所以本文件不 import 宿主包，可以脱开 DSH 单测
 * （测试里传一个 stub defineTool 即可）。
 */

import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import {
  DEFAULT_DPI,
  MAX_PAGES_PER_CALL,
  bookInfo,
  findPython,
  pagesDirFor,
  readManifest,
  renderBook,
  renderPages,
} from './pages.js'

import {
  STAGES,
  DIFFICULTY,
  MISTAKE_STATUS,
  PAGE_KINDS,
  masterySummary,
  pointState,
  recordEvidence,
  patchMistake,
  findMistake,
  mistakesOf,
  upsertModule,
  setGuide,
  unreadInbox,
  markInboxRead,
  analysisOf,
  upsertAnalysis,
  dropAnalysis,
  archiveFor,
  abilityReport,
  setAbility,
  taskView,
  groupOf,
  pageFileOf,
  pagesForPoint,
  expandSpans,
  spansOf,
} from './store.js'
import { settleFocus, focusStatus, startFocus, stopFocus, addTodo, patchTodo, removeTodo, listTodos } from './toolbox.js'

/** 把一段结构化返回值投影成纯文本块，给模型看的。 */
function textRender(fn) {
  return (_args, value) => [{ type: 'text', text: fn(value) }]
}

/** 参数描述助手：str('说明') / str('说明', true)。 */
function str(description, required = false) {
  return required ? { type: 'string', required: true, description } : { type: 'string', description }
}

function num(description, required = false) {
  return required ? { type: 'number', required: true, description } : { type: 'number', description }
}

/** 布尔参数。 */
function bool(description, required = false) {
  return required ? { type: 'boolean', required: true, description } : { type: 'boolean', description }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function today() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function parseDate(raw) {
  if (raw === undefined || raw === '') return today()
  if (!DATE_RE.test(raw)) throw new Error(`日期要写成 YYYY-MM-DD，收到「${raw}」`)
  return raw
}

/** 在地图里按 id 找知识点，找不到返回 null。 */
function findPoint(map, pointId) {
  for (const mod of map.modules ?? []) {
    for (const p of mod.points ?? []) if (p.id === pointId) return { module: mod, point: p }
  }
  return null
}

/** 输出 schema 的公共外壳。 */
function out(properties, render) {
  return {
    schema: { type: 'object', additionalProperties: false, properties },
    render: textRender(render),
  }
}

/**
 * 数组返回的元素 schema。
 * 元素里的字段名就是 agent 后面要回填的参数名（taskId / pointId / id），
 * 所以必须逐个列全——不列，调用方就只能靠猜。
 */
function listOf(description, properties, required = true) {
  const spec = {
    type: 'array',
    description,
    items: { type: 'object', additionalProperties: false, properties },
  }
  // 宿主的规矩：required 要么不写，要么写 true，写 false 会被直接拒。
  if (required) spec.required = true
  return spec
}

/** 六档档位写成 enum：填错值会被宿主校验直接拒，不用等工具里再报错。 */
function stageSchema(description) {
  return { type: 'string', enum: [...STAGES], description: `${description}。只能是：${STAGES.join(' / ')}` }
}

/** 任务条目，study_report 和 study_plan 两处共用同一形状。 */
function linkItems(description) {
  return listOf(description, {
    kind: str('video 看课 / practice 配套练习 / point 做题页 / open 自定义', true),
    label: str('按钮上的字，念给学生听或者直接贴进回复', true),
    url: str('点了要打开的地址，已经转义好，直接用', true),
  })
}

function taskItems(description) {
  return listOf(description, {
    id: str('任务 id。study_plan 传 action=toggle / remove / update 时用它当 taskId', true),
    title: str('任务内容', true),
    kind: str('watch 看课 / read 读教辅 / practice 练习 / review 复习 / other 其他', true),
    target: str('对着哪个知识点 id，没填就是空串', true),
    pointId: str('taskView 归出来的知识点 id（通常和 target 一样，对不上时为空）', true),
    pointTitle: str('这个目标知识点叫什么，没对上就是空串', true),
    moduleId: str('它在哪个模块，没对上就是空串', true),
    group: str('它在哪个大类，没对上就是空串', true),
    minutes: num('预计分钟数', true),
    done: { type: 'boolean', required: true, description: '做完没有' },
    note: str('做完之后的记录，没写就是空串', true),
    links: linkItems('这条任务的跳转按钮：看课 / 做练习 / 做题页。学生要的就是「点一下直接开」，所以把 label 和 url 一起给他'),
  })
}

/** 任务条目的原始形状，给 pickTask 裁。 */
function pickTask(map, t) {
  return taskView(map, t)
}

/** 材料条目。 */
function materialItems(description) {
  return listOf(description, {
    id: str('材料 id。study_material 传 action=remove 时用它当 id', true),
    kind: str('book 教辅 / video 网课 / notes 讲义 / past 真题 / other', true),
    title: str('材料名', true),
    path: str('本地路径，没填就是空串', true),
    note: str('讲次、章节范围之类的备注', true),
    analyzed: { type: 'boolean', required: true, description: '这份通读过没有（写没写过 study_analysis）' },
    chapterCount: num('分析里记了几章，没分析过就是 0', true),
    pagedCount: num('其中几章带「知识点 → 页码」对照表（marks）。这个数小于 chapterCount，做题页就只能给「翻哪一份」，给不出「第几页」', true),
  })
}

/** 材料分析里的一章。输入输出共用这套字段。 */
function chapterProps() {
  return {
    no: str('章节号，形如 1 或 1.2', true),
    title: str('章节名', true),
    pages: str('页码范围，可能是空串'),
    topics: str('这一章讲了什么'),
    examples: str('例题范围，可能是空串'),
    exercises: str('习题范围与题量，可能是空串'),
    difficulty: str('基础 / 中等 / 难'),
    role: str('这一章在教学上起什么作用'),
    file: str('这一章对应的文件绝对路径。讲义一章一份 PDF 时，写那一份的路径；写在 materials 的目录里就是那一份'),
    marks: listOf(
      '知识点 / 题型 → 页码。**这张表才是「一键跳到那一页」的依据**，'
      + '用 study_pages 把页面渲成图、read_image 看过之后才写得出来。'
      + 'label 写看着像知识点的那句话（比如「参数讨论的几种情形」），page 写这一份 PDF 自己的页码（从 1 起），'
      + '能对上地图里的单元就把 pointId 填上（M1.4），做题页就能把这一页直接摆给学生。',
      {
        label: str('这个知识点 / 题型叫什么', true),
        page: str('在这一份 PDF 里的页码，从 1 起', true),
        pointId: str('对应地图里的哪个单元，比如 M1.4；对不上就留空'),
      },
      false,
    ),
  }
}

function chapterItems(description) {
  return listOf(description, chapterProps())
}

/** 输入侧：chapters 整块可以不带（action=get 时用不上），所以 required 留空。 */
function chapterInputItems(description) {
  return listOf(description, chapterProps(), false)
}

/* ── 页级索引：整本书拆成页图之后，每一页归到哪个单元 ───────────────────── */

/**
 * 输入侧：**写区间**。
 *
 * 这是整条链上最关键的一个设计：一本 300 页的书，让 agent 一页一页写会写到吐血，
 * 所以入参收区间（「12—15 页是 M1.4 的例题」），盘上落的是逐页表，
 * 面板再按区间合并回来显示。既能「每一页都归好类」，agent 又只用写十几行。
 */
function spanInputItems(description) {
  return listOf(
    description,
    {
      from: num('从第几页（物理页，从 1 起）', true),
      to: num('到第几页（含）。只归到一页就跟 from 一样'),
      pointId: str('这些页讲哪个单元，比如 M1.4。对不上任何单元就留空，别硬凑'),
      kind: str(`这一页是哪一类：${PAGE_KINDS.join(' / ')}`),
      note: str('一句话备注，比如「含参讨论的三种情形」。只放得下短句'),
    },
    false,
  )
}

/** 输出侧：合并回来的区间。 */
function spanItems(description) {
  return listOf(description, {
    from: num('从第几页', true),
    to: num('到第几页（含）', true),
    pointId: str('这一批页属于哪个单元，没归就是空串', true),
    kind: str('哪一类：讲解 / 例题 / 习题 / 目录 / 答案 / 其他', true),
    note: str('备注', true),
    count: num('这一段一共几页', true),
  })
}

/** 书的目录条目。 */
function tocProps() {
  return {
    level: num('第几级，1 是章、2 是节'),
    title: str('条目名', true),
    page: num('物理页，从 1 起', true),
    pointId: str('能对上地图里的单元就填，比如 M1.4；对不上留空'),
  }
}

/** 输出侧：逐页索引里的一页。 */
function pageItems(description) {
  return listOf(description, {
    page: num('第几页，从 1 起', true),
    pointId: str('这一页归到哪个单元，没归就是空串', true),
    kind: str('哪一类', true),
    note: str('备注', true),
    file: str('这一页的 PNG 绝对路径；还没拆出来就是空串', true),
  })
}

/** 基本工具条目。 */
function toolItems(description) {  return listOf(description, {
    name: str('工具名。同一能力请沿用已有的写法，别另起一个名字', true),
    stage: str('当前档位，六档之一', true),
    confidence: num('0 到 1 之间', true),
    note: str('依据', true),
    updatedAt: str('最后一次更新的时间，没记录就是空串', true),
  })
}

/** 面板留言条目。 */
function inboxItemList(description) {
  return listOf(description, {
    id: str('留言 id', true),
    text: str('留言内容', true),
    at: str('留言时间，ISO 字符串', true),
  })
}

/** 知识地图的模块条目，带里面的知识点。 */
function moduleItems(description) {
  return listOf(description, {
    id: str('模块 id', true),
    title: str('模块名', true),
    summary: str('这模块干嘛的，可能是空串', true),
    group: str('属于哪个大类（地图第一层，一科也就那么几个）。没填就是空串', true),
    points: listOf('模块里的知识点。每个点就是一节网课的单元，是最小单位', {
      id: str('知识点 id。study_record 的 pointId 和 study_plan 的 target 都填它', true),
      title: str('知识点名', true),
      why: str('为什么学它，可能是空串', true),
      source: str('对应哪份材料的哪一节，可能是空串', true),
      video: str('这一节网课的文件路径或链接。面板上那个「看课」按钮用它，没挂就是空串', true),
      practice: str('配套练习的文件路径或链接。面板上「做题」按钮用它，没挂就是空串', true),
      stage: str('当前掌握档位，六档之一', true),
      nextReview: str('下次该复习的日期 YYYY-MM-DD，还没排就是空串', true),
    }),
  })
}

/** 输入侧的模块字段。id 是硬契约：掌握度挂在它上面，定了就不许改。 */
function moduleInputProps() {
  return {
    id: str('模块 id，形如 M1。定了就别改——掌握度挂在 id 上，改 id 等于把进度丢了', true),
    title: str('模块名', true),
    summary: str('一句话说清这模块干嘛'),
    group: str('属于哪个大类。地图第一层就是这个，同一大类的模块写同一个 group'),
    points: listOf('这模块下的知识点。每个点就是一节网课的单元，别再往下拆了', {
      id: str('知识点 id，形如 M1.1。定了就别改', true),
      title: str('知识点名，要能跟那一节网课的讲次对上'),
      why: str('为什么学它'),
      source: str('对应哪份材料的哪一节，比如「教辅第1章」或「网课第3讲」'),
      video: str('这一节网课的文件绝对路径或 http 链接。面板上最小单元那个「看课」按钮打开的就是它'),
      practice: str('配套练习的材料绝对路径或 http 链接。面板上「做题」按钮打开它；没材料就留空，学生点了会给你留言'),
    }),
  }
}

/** action=set 的整份模块数组。只在 set 时必填，schema 里留可选，靠 execute 按 action 拦。 */
function moduleInputItems(description) {
  return listOf(description, moduleInputProps(), false)
}

/** action=append 的单个模块对象。同上，schema 里可选。 */
function moduleInputSingle(description) {
  return { type: 'object', additionalProperties: false, description, properties: moduleInputProps() }
}

/*
 * 下面几个 pick* 把档案里的原始对象裁成返回 schema 里声明的那几个字段。
 * schema 是 additionalProperties:false，多带一个字段返回值就会被宿主判违规，
 * 所以要么列全、要么裁掉——这里选裁掉，顺带省点 token。
 */

function pickMessage(m) {
  return { id: String(m.id ?? ''), text: String(m.text ?? ''), at: String(m.at ?? '') }
}

function pickTool(t) {
  return {
    name: String(t.name ?? ''),
    stage: STAGES.includes(t.stage) ? t.stage : '没接触过',
    confidence: typeof t.confidence === 'number' ? t.confidence : 0,
    note: String(t.note ?? ''),
    updatedAt: String(t.updatedAt ?? ''),
  }
}

function pickMaterial(m, analysis) {
  const a = analysisOf(analysis, String(m.id ?? ''))
  return {
    id: String(m.id ?? ''),
    kind: String(m.kind ?? 'other'),
    title: String(m.title ?? ''),
    path: String(m.path ?? ''),
    note: String(m.note ?? ''),
    analyzed: a.chapters.length > 0,
    chapterCount: a.chapters.length,
    pagedCount: a.chapters.filter((c) => Array.isArray(c.marks) && c.marks.length).length,
  }
}

/**
 * 页级索引那一块的返回值：页数 / 页图目录 / 目录 / 归好类的区间 / 还有哪些页没归。
 *
 * `gaps` 是给 agent 的自检口：归完一本书，看一眼 gaps 就知道漏了哪几页。
 */
function pageView(a) {
  const rows = Array.isArray(a.pages) ? a.pages : []
  const spread = expandSpans(rows, { pageCount: Number(a.pageCount) || 0 })
  const gaps = spread.gaps
  return {
    pageCount: Number(a.pageCount) || 0,
    pageDir: String(a.pageDir ?? ''),
    dpi: Number(a.dpi) || 0,
    tocCount: (a.toc ?? []).length,
    toc: (a.toc ?? []).map((t) => ({
      level: Number(t.level) || 1,
      title: String(t.title ?? ''),
      page: Number(t.page) || 0,
      pointId: String(t.pointId ?? ''),
    })),
    indexed: rows.length,
    // spansOf 给的是字符串页码（跟页级索引一套口径），返回 schema 声明的是数字，这里转一道。
    spans: spansOf(rows).map((s) => ({
      from: Number(s.from),
      to: Number(s.to),
      pointId: String(s.pointId ?? ''),
      kind: String(s.kind ?? ''),
      note: String(s.note ?? ''),
      count: Number(s.count) || 0,
    })),
    gaps: gaps.length ? gaps.join(', ') : '',
  }
}

/**
 * 一份材料 → 它那份 PDF 的绝对路径。
 *
 * 登记的 path 可能直接是 PDF，也可能是个文件夹（里面几份 PDF 时不能猜，
 * 直接把候选列出来让它自己挑）。study_pages 和 study_book 共用这一套说法。
 */
function resolvePdf(materials, materialId, pdfPath) {
  let target = String(pdfPath ?? '').trim()
  if (!target && materialId) {
    const found = materials.find((m) => String(m.id) === materialId)
    const base = String(found?.path ?? '')
    const label = String(found?.title ?? materialId)
    if (!base) throw new Error(`《${label}》没登记路径，把 pdfPath 直接写出来`)
    if (!existsSync(base)) throw new Error(`《${label}》登记的位置不在了：${base}`)
    if (statSync(base).isDirectory()) {
      const pdfs = readdirSync(base).filter((f) => /\.pdf$/i.test(f))
      if (pdfs.length !== 1) {
        throw new Error(
          `《${label}》是个目录，里面有 ${pdfs.length} 份 PDF——把 pdfPath 写成你要看的那一份。`
          + (pdfs.length ? `比如：${join(base, pdfs[0])}` : ''),
        )
      }
      target = join(base, pdfs[0])
    } else {
      target = base
    }
  }
  if (!target) throw new Error('materialId 和 pdfPath 至少给一个')
  if (!/\.pdf$/i.test(target)) throw new Error(`只认 PDF，收到「${target}」`)
  if (!existsSync(target)) throw new Error(`这份文件不在：${target}`)
  return target
}

/** 一张页图在面板上的地址。图不在盘上就不给地址（免得给个死链）。 */
function pageUrl(opts, file) {
  if (!file || !existsSync(file)) return ''
  const base = String(opts.panel?.path || '/study').replace(/\/+$/, '')
  return `${base}/page?path=${encodeURIComponent(file)}`
}

/** 盘上真有几张页图。清单丢了也能靠它数出来。 */
function countRendered(a) {
  return (Array.isArray(a?.pages) ? a.pages : []).filter((p) => p.file && existsSync(p.file)).length
}

function pickChapter(c) {
  return {
    no: String(c?.no ?? ''),
    title: String(c?.title ?? ''),
    pages: String(c?.pages ?? ''),
    topics: String(c?.topics ?? ''),
    examples: String(c?.examples ?? ''),
    exercises: String(c?.exercises ?? ''),
    difficulty: DIFFICULTY.includes(c?.difficulty) ? c.difficulty : '中等',
    role: String(c?.role ?? ''),
    file: String(c?.file ?? ''),
    marks: (Array.isArray(c?.marks) ? c.marks : []).map((m) => ({
      label: String(m?.label ?? ''),
      page: String(m?.page ?? ''),
      pointId: String(m?.pointId ?? ''),
    })),
  }
}

function pickModule(m, mastery) {
  return {
    id: String(m.id ?? ''),
    title: String(m.title ?? ''),
    summary: String(m.summary ?? ''),
    group: String(m.group ?? ''),
    points: (m.points ?? []).map((p) => {
      const st = pointState(mastery, p.id)
      return {
        id: String(p.id ?? ''),
        title: String(p.title ?? ''),
        why: String(p.why ?? ''),
        source: String(p.source ?? ''),
        video: String(p.video ?? ''),
        practice: String(p.practice ?? ''),
        stage: st.stage,
        nextReview: String(st.nextReview ?? ''),
      }
    }),
  }
}

/**
 * 学习目标对象的 schema。
 * 宿主的 schema 编译器要求每个 object 节点显式写 additionalProperties，
 * 不写会直接抛 `additionalProperties must be explicitly true or false`；
 * 写了 false 又必须把字段列全，否则返回值会被判 `is not a declared property`。
 */
function goalSchema(description) {
  return {
    type: 'object',
    required: true,
    additionalProperties: false,
    description,
    properties: {
      subject: str('学什么，写学生说的那门课'),
      outcome: str('要掌握到什么程度，用学生自己的话'),
      deadline: str('最晚哪天 YYYY-MM-DD，没定就是空串'),
      minutesPerDay: num('每天大概能学多少分钟'),
    },
  }
}

/** 掌握度汇总的 schema。byStage 的键就是那六个档位，全是常量，列全。 */
function masterySummarySchema(description) {
  return {
    type: 'object',
    required: true,
    additionalProperties: false,
    description,
    properties: {
      total: num('知识点总数'),
      touched: num('碰过的知识点数，档位不是「没接触过」的都算'),
      avgConfidence: num('平均置信度，0 到 1'),
      byStage: {
        type: 'object',
        required: true,
        additionalProperties: false,
        description: '每个档位各有几个知识点',
        properties: Object.fromEntries(STAGES.map((stage) => [stage, num(`档位「${stage}」的知识点数`)])),
      },
    },
  }
}

/**
 * 造出全部工具定义。
 * @param {object} store Store 实例
 * @param {{ panel?: { path?: string, url?: string|null } }} opts
 */
/**
 * 任务能排给别的科目。
 * 多档案的时候 store 是个 Library：给 profileId 就换一份账本，不给就用当前在用的那门。
 * 单档案的根没有 store()/list()，profileId 一律忽略。
 * 名字写错必须当场报错——Library.store(id) 对没见过的 id 是会顺手建目录的。
 */
function bookFor(store, profileId) {
  const id = String(profileId || '')
  if (!id) return store
  if (typeof store.store !== 'function' || typeof store.list !== 'function') return store
  if (!store.list().some((p) => p.id === id)) {
    const known = store.list().map((p) => p.id).join('、')
    throw new Error(`没有「${id}」这份学习目标；现有的是 ${known}。用 study_library 看一眼 id`)
  }
  return store.store(id)
}

/** 回执里带上这份任务落在哪门课，好让下一次调用接着用。 */
function bookId(profileId) {
  return String(profileId || '')
}

export function buildTools(store, opts = {}) {
  const panel = opts.panel ?? { path: '/study' }
  const panelPath = panel.path ?? '/study'

  const report = {
    name: 'study_report',
    description:
      '读学习档案全貌：学习目标、材料清单、知识地图与每个知识点的档位、基本工具表、某天的任务、面板指引、面板留言。'
      + '每次会话开头必调一次；之后任何涉及学生水平、进度、接下来该学什么的判断之前也要先调，别凭记忆猜——'
      + '档案是所有对话共用的一份，别处可能刚改过。'
      + '返回值先看 summary（一句话概览）；inboxItems 非空说明学生在面板上留了话，先处理，处理完用 study_inbox 传 action=read 清掉；'
      + 'modules 里每个知识点带 stage，那是当前档位。要 id 全从返回里拿：pointId 在 modules、taskId 在 tasks、材料 id 在 materials。'
      + 'materials 每条带 analyzed（通读过没有）和 chapterCount——哪份还没分析一眼就能看出来。'
      + '写数据全用工具：目标 study_goal、材料 study_material、材料分析 study_analysis、地图 study_map、掌握度 study_record、任务 study_plan、基本工具 study_tool_level、面板指引 study_guide。'
      + `面板（${panelPath}，内嵌浏览器用 panelUrl）对学生只读，学生自己改不了，别让他去面板上填。`,
    parameters: { date: str('要看哪一天的任务，YYYY-MM-DD，不填就是今天。传了它，返回的 tasks 就是那一天的') },
    output: out(
      {
        today: str('今天的日期，YYYY-MM-DD。排任务、算 nextReview 都用它，别自己猜', true),
        goal: goalSchema('学习目标：学科、要掌握到什么程度、最晚哪天、每天多少分钟'),
        mapStatus: { type: 'string', required: true, description: '知识地图是 draft 还是 confirmed' },
        moduleCount: num('知识地图里的模块数', true),
        pointCount: num('知识点总数', true),
        modules: moduleItems('模块与知识点清单。要拿 pointId 就翻这里'),
        masterySummary: masterySummarySchema('掌握度汇总：知识点总数、各档位数量、平均置信度、碰过的知识点数'),
        tools: toolItems('基本工具能力表（运算、画图、查资料这类）'),
        tasks: taskItems('指定那天的任务清单。要拿 taskId 就翻这里'),
        materials: materialItems('登记过的材料清单。要拿材料 id 就去翻这里'),
        panelPath: { type: 'string', required: true, description: '图形面板路径' },
        panelUrl: { type: 'string', required: true, description: '内嵌浏览器要用的完整地址，没起来就是空串' },
        dataRoot: { type: 'string', required: true, description: '这套档案在硬盘上的家（插件本体只有代码，学生的目标/地图/掌握度/任务全在这个目录里）' },
        profileId: { type: 'string', required: true, description: '当前这份学习目标的档案 id' },
        guide: { type: 'string', required: true, description: '现在面板顶上显示的那句指引，空串就是没写' },
        inboxItems: inboxItemList('学生在面板上留的、还没处理的留言'),
        summary: { type: 'string', required: true, description: '一句话概览' },
      },
      (v) => v.summary,
    ),
    execute: async (args, exec) => {
      exec.signal.throwIfAborted()
      const date = parseDate(args.date)
      const s = store.snapshot()
      const list = (s.map.modules ?? []).map((m) => pickModule(m, s.mastery))
      const summary = masterySummary(s.map, s.mastery)
      const tasks = (s.tasks.days?.[date] ?? []).map((t) => pickTask(s.map, t))
      const inboxItems = unreadInbox(s.inbox).map(pickMessage)
      const tools = (s.profile.tools ?? []).map(pickTool)
      const analysisAll = store.read('analysis')
      const materials = (s.profile.materials ?? []).map((m) => pickMaterial(m, analysisAll))
      const goalText = s.profile.goal.subject === '' ? '还没定目标' : `${s.profile.goal.subject} → ${s.profile.goal.outcome || '（没说清掌握到什么程度）'}`
      const doneCount = tasks.filter((t) => t.done).length
      const summaryText = `目标：${goalText}；地图 ${s.map.status}，${s.map.modules.length} 模块 / ${summary.total} 知识点，`
        + `已接触 ${summary.touched} 个；${date} 有 ${tasks.length} 项任务（完成 ${doneCount}）。`
        + (inboxItems.length ? `面板上还有 ${inboxItems.length} 条留言没处理。` : '')
      return {
        today: today(),
        goal: s.profile.goal,
        mapStatus: s.map.status,
        moduleCount: (s.map.modules ?? []).length,
        pointCount: summary.total,
        modules: list,
        masterySummary: summary,
        tools,
        tasks,
        materials,
        panelPath,
        panelUrl: panel.url ?? '',
        dataRoot: s.libraryRoot ?? s.root ?? '',
        profileId: s.profileId ?? '',
        guide: (s.guide && s.guide.text) || '',
        inboxItems,
        summary: summaryText,
      }
    },
  }

  const goal = {
    name: 'study_goal',
    description:
      '写学习目标。目标只能由你在对话里问清之后写，学生自己在面板上改不了。'
      + '什么时候调：学生说了学什么 / 学到什么程度 / 最晚什么时候 / 每天大概能挤出多少分钟之后。一次只问一两个问题，别一口气盘问。'
      + '怎么填：只传要改的字段，没定下来的留空别编。outcome 要用学生自己的话，他说不清就接着问，别替他总结；'
      + 'minutesPerDay 决定后面每天排多少任务，一定要问到。'
      + '返回：goal 是写入后的完整目标；complete 为 false 说明还有字段空着，接着问。',
    parameters: {
      subject: str('学什么，写学生说的那门课'),
      outcome: str('要掌握到什么程度，用学生自己的话，比如「考研数一能独立做中档题」'),
      deadline: str('最晚哪天，YYYY-MM-DD；传空串就是把这一项清掉'),
      minutesPerDay: num('每天大概能学多少分钟。这个决定每天排多少任务，必须问到'),
      note: str('别的备注'),
    },
    output: out(
      {
        goal: goalSchema('写入后的完整目标'),
        complete: { type: 'boolean', required: true, description: '目标四要素是否齐了' },
        summary: { type: 'string', required: true, description: '一句话概览' },
      },
      (v) => v.summary,
    ),
    execute: async (args, exec) => {
      exec.signal.throwIfAborted()
      if (args.deadline !== undefined && args.deadline !== '' && !DATE_RE.test(args.deadline)) {
        throw new Error(`deadline 要写成 YYYY-MM-DD，收到「${args.deadline}」`)
      }
      if (args.minutesPerDay !== undefined && (!Number.isFinite(args.minutesPerDay) || args.minutesPerDay < 0)) {
        throw new Error('minutesPerDay 要是非负数')
      }
      const next = store.update('profile', (p) => {
        // 字段传了才动：传空串就是把那一项清掉，不传就保持原样。
        for (const key of ['subject', 'outcome', 'deadline']) {
          if (typeof args[key] === 'string') p.goal[key] = args[key].trim()
        }
        if (args.minutesPerDay !== undefined) p.goal.minutesPerDay = args.minutesPerDay
        return p
      })
      const g = next.goal
      const complete = g.subject !== '' && g.outcome !== '' && g.minutesPerDay > 0
      const summary = `目标记下了：${g.subject || '（还没写学什么）'}，程度「${g.outcome || '未填'}」，`
        + `每天 ${g.minutesPerDay} 分钟，截止 ${g.deadline || '未定'}。`
        + (complete ? '' : '还缺要素，接着问。')
      return { goal: g, complete, summary }
    },
  }

  const map = {
    name: 'study_map',
    description:
      '写知识地图：学生接下来该学什么的总纲。在对话里生成，学生改不了。'
      + '地图分三层，别摊平：第一层 group 是学科大类（一科也就几个，按这门课自己的分法来）；'
      + '第二层 module 是大类下面的小模块（一章、一个专题这种粒度）；'
      + '第三层 point 是最小单元，一个点必须对应一整节网课的单元，别再往下拆。'
      + '每个 point 尽量挂上 video（那一节网课的文件路径或链接）和 practice（配套练习的材料路径）——面板上学生点一下就打开；'
      + 'material 还没给全就先留空，等他把网课目录丢过来再 append 补。'
      + '根据他丢来的教辅 / 讲义 / 网课目录画最准；还没给材料时，也可以先凭你自己对这个学科的理解画一版草稿，'
      + '拿到材料后再 set 覆盖或 append 补。别因为没材料就把图空着——没有地图，pointId 就不存在，掌握度一条都记不进去。'
      + '什么时候调：第一次画图、或整份推翻重画用 set；只想加一个模块用 append；学生看过草稿并认可后用 confirm 定稿。'
      + '规矩：set / append 出来的都是 draft，要把大类、模块、单元一层层念给学生过一遍，他认可了才 confirm——'
      + '地图错了后面全白做，没给他看过不许定稿，空地图也不给 confirm。'
      + '怎么填：action=set 用 modules 传整份模块数组；action=append 用 module 传一个模块对象；action=confirm 不带参数。'
      + '每个模块长这样：{id:"M1", group:"大类名", title:"模块名", summary:"这模块干嘛", '
      + 'points:[{id:"M1.1", title:"单元名", why:"为什么学", source:"网课第3讲", video:"F:\\\\课件\\\\01-第一节.mp4", practice:"F:\\\\教辅\\\\第2章 习题.pdf"}]}。'
      + 'video 和 practice 要写真实存在的路径，别自己拼一个；不知道就留空。'
      + 'set 和 append 之后地图都会退回 draft，要让学生重新过目再 confirm。'
      + '知识点 id 一旦用了就别改：掌握度挂在 id 上，改 id 等于把学生的进度丢了。',
    parameters: {
      action: str('set 整份覆盖 | append 追加一个模块 | confirm 定稿', true),
      modules: moduleInputItems('action=set 时的整份模块数组'),
      module: moduleInputSingle('action=append 时的单个模块'),
    },
    output: out(
      {
        status: { type: 'string', required: true, description: '覆盖后的地图状态 draft | confirmed' },
        moduleCount: num('模块数', true),
        pointCount: num('知识点数', true),
        summary: { type: 'string', required: true, description: '一句话概览' },
      },
      (v) => v.summary,
    ),
    execute: async (args, exec) => {
      exec.signal.throwIfAborted()
      const action = args.action
      if (action === 'confirm') {
        const next = store.update('map', (m) => {
          if ((m.modules ?? []).length === 0) throw new Error('地图还是空的，没什么可定稿的')
          m.status = 'confirmed'
          m.confirmedAt = new Date().toISOString()
          return m
        })
        const n = next.modules.reduce((sum, m) => sum + (m.points?.length ?? 0), 0)
        return { status: next.status, moduleCount: next.modules.length, pointCount: n, summary: `地图定稿：${next.modules.length} 个模块、${n} 个知识点。` }
      }
      if (action === 'set') {
        if (!Array.isArray(args.modules) || args.modules.length === 0) throw new Error('action=set 要带 modules，一个非空的模块数组')
        const modules = args.modules
        const next = store.update('map', (m) => {
          m.modules = modules.map((mod, i) => ({
            id: String(mod.id ?? `M${i + 1}`),
            title: String(mod.title ?? `模块${i + 1}`),
            summary: String(mod.summary ?? ''),
            group: String(mod.group ?? ''),
            points: Array.isArray(mod.points)
              ? mod.points.map((p, j) => ({
                  id: String(p.id ?? `M${i + 1}.${j + 1}`),
                  title: String(p.title ?? ''),
                  why: String(p.why ?? ''),
                  source: String(p.source ?? ''),
                  video: String(p.video ?? ''),
                  practice: String(p.practice ?? ''),
                }))
              : [],
          }))
          m.revision = (m.revision ?? 0) + 1
          m.status = 'draft'
          m.confirmedAt = null
          return m
        })
        const n = next.modules.reduce((sum, m) => sum + m.points.length, 0)
        return { status: next.status, moduleCount: next.modules.length, pointCount: n, summary: `地图草稿写好：${next.modules.length} 个模块、${n} 个知识点，等学生过目定稿。` }
      }
      if (action === 'append') {
        const mod = args.module
        if (typeof mod !== 'object' || mod === null || Array.isArray(mod)) throw new Error('action=append 要带 module，一个模块对象')
        const next = upsertModule(store.read('map'), {
          id: String(mod.id ?? `M${Date.now()}`),
          title: String(mod.title ?? ''),
          summary: String(mod.summary ?? ''),
          group: String(mod.group ?? ''),
          points: Array.isArray(mod.points)
            ? mod.points.map((p) => ({
                id: String(p.id ?? ''),
                title: String(p.title ?? ''),
                why: String(p.why ?? ''),
                source: String(p.source ?? ''),
                video: String(p.video ?? ''),
                practice: String(p.practice ?? ''),
              }))
            : [],
        })
        store.write('map', next)
        const n = next.modules.reduce((sum, m) => sum + (m.points?.length ?? 0), 0)
        return { status: next.status, moduleCount: next.modules.length, pointCount: n, summary: `追加了模块「${mod.title ?? mod.id}」。` }
      }
      throw new Error(`action 只能是 set / append / confirm，收到「${String(action)}」`)
    },
  }

  /**
   * 错题的字段。它不单独存一份，而是挂在某条掌握度证据上——错题本来就是
   * 「这次做题他错了」这件事的细节，分两处存迟早对不上。
   */
  function mistakeProps() {
    return {
      origin: str('原题出处：哪份材料的哪一题（「《1000 题》第一章第九组第 3 题」）。必填——不写出处，以后找不回来'),
      step: str('错在哪一步。要具体到那一步（「把 A≠∅ 时多出来的下界忘了加」），别写「粗心」'),
      cause: str('错因，要有依据：概念没分清、条件漏了、还是算错。标「已订正」以上就必须写'),
      fix: str('订正：正确的走法，写到他照着能重做一遍。标「已订正」以上就必须写'),
      redoAt: str('复做日期 YYYY-MM-DD。粗定：见到同类题能自己走通就隔 3—4 天'),
      status: str('待验证 还没订正完 | 已订正 错因和订正都写了 | 已复做对 隔几天重做同类题做对了。标后两个必须带 cause 和 fix'),
    }
  }

  /** 错题落盘之后的完整形状，比入参多 id / at / updatedAt 三个自己填的字段。 */
  function mistakeOutProps() {
    return {
      ...mistakeProps(),
      id: str('这条错题的 id，改状态时当 study_record 的 mistakeId 用'),
      at: str('什么时候做错的，ISO 时间'),
      updatedAt: str('最后一次改动的时间，ISO 时间'),
    }
  }

  const record = {
    name: 'study_record',
    description:
      '给一个知识点记一条掌握度证据，并推进它的档位。'
      + '什么时候调：学生自评了、做完题、拍来作业、上完课之后，看到证据就记；没证据别记。'
      + '怎么填：pointId 必须是地图里已有的 id（从 study_report 的 modules 里拿，地图里没有会被拒）；'
      + 'stage 只有「没接触过 / 见过 / 能跟做 / 能独立做 / 熟练稳定 / 能讲明白」六档，一次只推进一档、别跳，不传就只记证据、档位不动；'
      + 'kind 是 self 自评 / quiz 做题 / photo 作业照片 / lesson 上课 / review 复习；'
      + 'confidence 是「你对这条证据有多少把握」，不是学生的掌握度，证据弱就给低；'
      + 'note 写具体证据——哪天、哪份材料、什么表现，这是以后复查的依据，别写「学得不错」这种。'
      + '他做错了题就一并传 mistake：origin 必填，cause 和 fix 写清了才能标「已订正」，'
      + '标「已复做对」得是真重做过、不是订正完就算。以后要改错题状态，传 mistakeId + 新的 mistake，'
      + '那条就只改错题，不会再记一条证据、也不会动档位。'
      + '返回：stage 是记完后的档位，evidenceCount 是攒了多少条证据。'
      + '参数不对会直接抛中文错误，照提示改。',
    parameters: {
      pointId: str('知识点 id，比如 M1.2，必填。必须是地图里已有的，从 study_report 的 modules 里拿', true),
      stage: stageSchema('推进到哪一档。不传就只记证据、不动档位'),
      confidence: num('你有多确信，0 到 1 之间'),
      kind: str('证据类型：self 自评 / quiz 做题 / photo 作业照片 / lesson 上课 / review 复习'),
      note: str('具体证据：哪天、哪份材料、什么表现。以后要拿它复查，别写空话'),
      nextReview: str('下次该复习的日期，YYYY-MM-DD。粗定就行：见过隔 1 天、能跟做隔 2 天、能独立做隔 4 天、熟练稳定隔 7 天'),
      mistake: {
        type: 'object',
        additionalProperties: false,
        description: '这次做错的那道题。错题本上每一行就是它。不传就是这次没出错题',
        properties: mistakeProps(),
      },
      mistakeId: str('要更新哪条已有的错题（id 从 study_mistakes 拿）。传了它就只改这条错题，不新增证据、不动档位'),
    },
    output: out(
      {
        pointId: { type: 'string', required: true, description: '知识点 id' },
        title: { type: 'string', required: true, description: '知识点标题' },
        stage: { type: 'string', required: true, description: '现在的档位' },
        confidence: num('现在的置信度', true),
        evidenceCount: num('累计证据条数', true),
        nextReview: { type: 'string', required: true, description: '下次该复习的日期，还没排就是空串' },
        mistakeId: { type: 'string', required: true, description: '这次的错题 id，没记错题就是空串' },
        mistakeStatus: { type: 'string', required: true, description: '错题状态，没记错题就是空串' },
        summary: { type: 'string', required: true, description: '一句话概览' },
      },
      (v) => v.summary,
    ),
    execute: async (args, exec) => {
      exec.signal.throwIfAborted()
      if (typeof args.pointId !== 'string' || args.pointId.trim() === '') throw new Error('pointId 必填')
      const pointId = args.pointId.trim()
      const found = findPoint(store.read('map'), pointId)
      if (!found) throw new Error(`地图里没有知识点「${pointId}」，先看一眼 study_report 里的 id`)
      if (args.nextReview !== undefined && args.nextReview !== '' && !DATE_RE.test(args.nextReview)) {
        throw new Error(`nextReview 要写成 YYYY-MM-DD，收到「${args.nextReview}」`)
      }

      // 只改一条已有错题：不新增证据、不动档位——「订正完了」本身不是新的掌握度证据。
      if (typeof args.mistakeId === 'string' && args.mistakeId.trim() !== '') {
        const mistakeId = args.mistakeId.trim()
        const updated = store.update('mastery', (m) => {
          patchMistake(m, mistakeId, args.mistake || {})
          return m
        })
        const st = pointState(updated, pointId)
        const hit = findMistake(updated, mistakeId)
        // findMistake 给的是 { pointId, item }，错题挂在 item.mistake 上——别再写成 hit.mistake。
        const mt = hit ? hit.item.mistake : null
        return {
          pointId,
          title: found.point.title,
          stage: st.stage,
          confidence: st.confidence,
          evidenceCount: st.evidence.length,
          nextReview: String(st.nextReview ?? ''),
          mistakeId,
          mistakeStatus: String(mt?.status ?? ''),
          summary: `错题「${mt?.origin || mistakeId}」更新成「${mt?.status || ''}」。档位没动，还是「${st.stage}」。`,
        }
      }

      // 「一次只推进一档」——填跳档了就压回上一档，别让学生一步从没见过跳到能独立做。
      const before = pointState(store.read('mastery'), pointId).stage
      let wanted = args.stage
      let clamped = false
      if (STAGES.includes(wanted)) {
        const ceiling = Math.min(STAGES.indexOf(before) + 1, STAGES.length - 1)
        if (STAGES.indexOf(wanted) > ceiling) {
          wanted = STAGES[ceiling]
          clamped = true
        }
      }
      const next = store.update('mastery', (m) => {
        recordEvidence(m, {
          pointId,
          kind: args.kind,
          note: args.note,
          stage: wanted,
          confidence: args.confidence,
          nextReview: args.nextReview,
          mistake: args.mistake,
        })
        return m
      })
      const st = next.points[pointId]
      const known = found.point.title
      const last = st.evidence[st.evidence.length - 1]
      const told = last && last.mistake ? last.mistake : null
      const jump = clamped ? `（你填的「${args.stage}」跳档了，压回「${st.stage}」）` : ''
      const wrong = told ? ` 错题记下了：「${told.origin}」，状态「${told.status}」。` : ''
      return {
        pointId,
        title: known,
        stage: st.stage,
        confidence: st.confidence,
        evidenceCount: st.evidence.length,
        nextReview: String(st.nextReview ?? ''),
        mistakeId: told ? String(told.id) : '',
        mistakeStatus: told ? String(told.status) : '',
        summary: `「${known}」记到「${st.stage}」，置信度 ${st.confidence}，累计 ${st.evidence.length} 条证据。${jump}${wrong}`,
      }
    },
  }

  const mistakes = {
    name: 'study_mistakes',
    description:
      '读错题本：他做错过的题、错在哪一步、错因、订正、该哪天复做、现在到哪一步了。'
      + '什么时候调：复习日出题之前（先绕开他刚踩过的坑，或者干脆拿同类题再考一次）；'
      + '他说「上次那道题」的时候；以及 study_record 返回了 mistakeId、要把状态往前推之前先读一眼现状。'
      + '怎么用：不传参数就是全部，新的在前；status 只筛一档，pointId 只看一个单元。'
      + '要改状态不在这儿改——用 study_record 传 mistakeId。'
      + '返回：items 每行都带 id，那个 id 就是 study_record 的 mistakeId。'
      + '空的不代表他没出错，只代表你没记：记错题是 study_record 的活儿。',
    parameters: {
      status: str('只看一档：待验证 / 已订正 / 已复做对。不传就是全部'),
      pointId: str('只看一个知识点，比如 M1.4。不传就是全部'),
      limit: num('最多列几条，默认 40'),
    },
    output: out(
      {
        total: num('一共几条', true),
        pending: num('还没订正完的几条', true),
        byStatus: str('每一档各几条，一句话', true),
        items: listOf('错题清单，新的在前', {
          id: { type: 'string', required: true, description: '错题 id，改状态时当 study_record 的 mistakeId' },
          pointId: str('挂在哪个知识点上', true),
          pointTitle: str('知识点标题', true),
          group: str('哪个大类', true),
          origin: str('原题出处', true),
          step: str('错在哪一步', true),
          cause: str('错因', true),
          fix: str('订正', true),
          redoAt: str('该哪天复做', true),
          status: str('待验证 / 已订正 / 已复做对', true),
          at: str('什么时候做错的', true),
        }),
        summary: { type: 'string', required: true, description: '一句话概览' },
      },
      (v) => {
        if (!v.total) return '错题本是空的。他没记过错题，或者你还没用 study_record 的 mistake 记过。'
        const lines = [`错题本：${v.total} 条（${v.byStatus}）`]
        for (const m of v.items) {
          lines.push('')
          lines.push(`${lines.length ? '' : ''}[${m.status}] ${m.pointId} ${m.pointTitle}`)
          lines.push(`   出处：${m.origin}`)
          if (m.step) lines.push(`   错步：${m.step}`)
          if (m.cause) lines.push(`   错因：${m.cause}`)
          if (m.fix) lines.push(`   订正：${m.fix}`)
          if (m.redoAt) lines.push(`   复做：${m.redoAt}`)
          lines.push(`   id：${m.id}`)
        }
        if (v.total > v.items.length) {
          lines.push('', `（还有 ${v.total - v.items.length} 条没列出来，调大 limit）`)
        }
        return lines.join('\n')
      },
    ),
    execute: async (args, exec) => {
      exec.signal.throwIfAborted()
      const status = String(args.status ?? '').trim()
      if (status && !MISTAKE_STATUS.includes(status)) {
        throw new Error(`status 只能是 ${MISTAKE_STATUS.join(' / ')}，收到「${status}」`)
      }
      const rawLimit = Number(args.limit)
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 40
      const state = store.snapshot()
      const found = mistakesOf(state.map, state.mastery, { status, pointId: args.pointId, limit })
      const byStatus = MISTAKE_STATUS.map((s) => `${s} ${found.byStatus[s]}`).join(' / ')
      return {
        total: found.total,
        pending: found.byStatus['待验证'],
        byStatus,
        items: found.items,
        summary: found.total
          ? `错题本 ${found.total} 条：${byStatus}。`
          : `错题本是空的${status ? `（筛选「${status}」之后）` : ''}。`,
      }
    },
  }

  /* ── 工具栏目：番茄钟 + 清单 ─────────────────────────────────────────── */

  const focus = {
    name: 'study_focus',
    description:
      '番茄钟：他坐下去专注一段时间、到点休息。'
      + '什么时候调：他说「我要开始学了 / 定个番茄钟 / 我坐下了」，或者你排完今天的任务顺手给他起一轮。'
      + '怎么用：action=start 起一轮（minutes 默认 25，taskId 可以挂到清单某一条上，label 写清这一轮干什么）；'
      + 'action=stop 手动停（中途停下按实际分钟数记，但不算一个完整番茄）；不传 action 就是看状态。'
      + '**时间是绝对时刻，不是倒计时**：刷新页面、关面板、重启 DSH 都不影响，所以你起完就别管了，'
      + '别轮询等它——他回头自己会看到结果。一轮走完不会自动接下一轮，要接着背让他再说一句。'
      + '返回：running / left（还剩几秒）/ todayMinutes / todayRounds。',
    parameters: {
      action: str('start 起一轮 / stop 停掉 / status 只看状态（默认）'),
      minutes: num('这一轮多少分钟，1—180，默认用他设的 25'),
      kind: str('work 专注 / break 休息，默认 work'),
      taskId: str('挂到清单哪一条上，id 从 study_todo 的 items 里拿；挂上之后番茄钟会记进那条的 spent'),
      label: str('这一轮在干什么，写短一点，比如「背必修一单词」'),
    },
    output: out(
      {
        running: bool('现在在不在跑', true),
        phase: str('work 专注 / break 休息', true),
        phaseLabel: str('「专注」或「休息」，直接给他看', true),
        left: num('这一轮还剩几秒；没在跑就是 0', true),
        endsAt: str('这一轮什么时候结束，没在跑就是空串', true),
        roundMinutes: num('这一轮一共多少分钟', true),
        workMinutes: num('设定的专注时长', true),
        breakMinutes: num('设定的休息时长', true),
        todayMinutes: num('今天累计专注多少分钟', true),
        todayRounds: num('今天背了几个完整番茄', true),
        label: str('这一轮在干什么', true),
        taskId: str('挂在哪条清单上，没挂就是空串', true),
        summary: { type: 'string', required: true, description: '一句话概览' },
      },
      (v) => {
        if (v.running) {
          const mm = Math.floor(v.left / 60)
          const ss = v.left % 60
          return `${v.phaseLabel}中：还剩 ${mm} 分 ${ss} 秒`
            + (v.label ? `（${v.label}）` : '')
            + `。今天已经专注 ${v.todayMinutes} 分钟、${v.todayRounds} 个番茄。到点会自己停，不用你盯着。`
        }
        return `番茄钟没在跑。今天专注 ${v.todayMinutes} 分钟、${v.todayRounds} 个番茄。`
          + `下一轮默认 ${v.workMinutes} 分钟。`
      },
    ),
    execute: async (args, exec) => {
      exec.signal.throwIfAborted()
      const action = String(args.action ?? 'status').trim() || 'status'
      if (!['start', 'stop', 'status'].includes(action)) {
        throw new Error(`action 只能是 start / stop / status，收到「${action}」`)
      }
      const box = store.update('toolbox', (t) => {
        if (action === 'start') startFocus(t.focus, args)
        else if (action === 'stop') stopFocus(t.focus, args)
        else settleFocus(t.focus)
        /* 番茄钟挂到清单上：走完的分钟数记进那一条的 spent，好在清单上看到「这条我花了多久」 */
        if (action !== 'status' && t.focus.taskId) {
          const hit = ((t.todos && t.todos.items) || []).find((x) => x.id === t.focus.taskId)
          if (hit) hit.spent = (Number(hit.spent) || 0) + 0
        }
        return t
      })
      const st = focusStatus(box.focus)
      return { ...st, summary: st.running ? `${st.phaseLabel}中，还剩 ${Math.ceil(st.left / 60)} 分钟。` : '没在跑。' }
    },
  }

  const todo = {
    name: 'study_todo',
    description:
      '清单：他自己要办的事，跟今日任务不是一回事——任务是学习计划，清单是「今天想做的那几件」。'
      + '什么时候调：他说「帮我记一条 / 提醒我 / 今天要背 20 个单词」；或者你看他手上事多，帮他把待办列出来。'
      + '怎么用：action=add 加一条（text 必填，due 写 YYYY-MM-DD 就是「那天之前办」）；'
      + 'action=toggle 勾掉／取消勾选（带 id，done 不传就翻转）；action=patch 改文字或截止日；'
      + 'action=remove 删掉；不传 action 就是列出来（status 可以筛 open / done / today）。'
      + '规矩写在代码里：文字为空会被拒，due 写歪了会被拒。'
      + '返回：items 每行带 id，那就是 toggle / patch / remove 要传的 id。',
    parameters: {
      action: str('add 加一条 / toggle 勾掉 / patch 改 / remove 删 / list 列出来（默认）'),
      text: str('清单内容，一句话，比如「背 20 个单词」'),
      id: str('改哪一条，id 从 items 里拿'),
      done: bool('toggle 时指定勾上还是取消；不传就翻转'),
      due: str('哪天之前办完，YYYY-MM-DD；不填就没限期'),
      pointId: str('对着地图里哪个单元，比如 M1.4，可以不填'),
      status: str('list 时筛：open 没做完 / done 做完了 / today 今天到期；不传就是全部'),
      limit: num('最多列几条，默认 40'),
    },
    output: out(
      {
        total: num('一共几条', true),
        open: num('还没做完的几条', true),
        done: num('已经做完的几条', true),
        item: {
          type: 'object',
          description: '刚动过的那一条；action=list 时是空对象',
          additionalProperties: true,
        },
        items: listOf('清单，没做完的在前', {
          id: { type: 'string', required: true, description: '条目 id' },
          text: str('内容', true),
          done: bool('做完了没有', true),
          due: str('哪天之前办完', true),
          pointId: str('对着哪个单元', true),
          spent: num('挂在上面的番茄钟累计多少分钟', true),
          at: str('什么时候记的', true),
          doneAt: str('什么时候勾掉的', true),
        }),
        summary: { type: 'string', required: true, description: '一句话概览' },
      },
      (v) => {
        const lines = [`清单：${v.total} 条，没做完 ${v.open} 条。`]
        for (const t of v.items) {
          lines.push(`${t.done ? '[x]' : '[ ]'} ${t.text}`
            + (t.due ? `（${t.due} 前）` : '')
            + (t.spent ? `（花了 ${t.spent} 分钟）` : '')
            + `  id：${t.id}`)
        }
        if (!v.items.length) lines.push('（一条都没有）')
        return lines.join('\n')
      },
    ),
    execute: async (args, exec) => {
      exec.signal.throwIfAborted()
      const action = String(args.action ?? 'list').trim() || 'list'
      if (!['add', 'toggle', 'patch', 'remove', 'list'].includes(action)) {
        throw new Error(`action 只能是 add / toggle / patch / remove / list，收到「${action}」`)
      }
      let item = null
      const box = store.update('toolbox', (t) => {
        if (action === 'add') item = addTodo(t, args)
        else if (action === 'toggle') {
          if (!args.id) throw new Error('toggle 要带 id')
          const cur = ((t.todos && t.todos.items) || []).find((x) => x.id === args.id)
          if (!cur) throw new Error('没有这条清单：' + args.id)
          item = patchTodo(t, args.id, { done: args.done === undefined ? !cur.done : args.done })
        } else if (action === 'patch') {
          if (!args.id) throw new Error('patch 要带 id')
          item = patchTodo(t, args.id, args)
        } else if (action === 'remove') {
          if (!args.id) throw new Error('remove 要带 id')
          removeTodo(t, args.id)
        }
        return t
      })
      const rawLimit = Number(args.limit)
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 40
      const found = listTodos(box, { status: String(args.status ?? '').trim(), limit })
      const verb = { add: '记下了', toggle: '勾选变了', patch: '改好了', remove: '删掉了', list: '' }[action]
      return {
        total: found.total,
        open: found.open,
        done: found.done,
        item: item || {},
        items: found.items,
        summary: verb
          ? `${verb}${item ? `：「${item.text}」` : ''}。清单现在 ${found.total} 条，没做完 ${found.open} 条。`
          : `清单 ${found.total} 条，没做完 ${found.open} 条。`,
      }
    },
  }

  const plan = {
    name: 'study_plan',
    description:
      '排某一天的任务，或者改 / 删 / 勾掉已有的。任务是学生在面板上唯一能动手的东西，所以每条都要带得动他去做。'
      + '什么时候调：排今天的活儿、学生说做完了、计划要变的时候。'
      + '每天要成对：一条 watch 看课配一条 practice 练习，别只排看的或者只排做的——光看不练等于没学。'
      + '怎么填：action=add 要带 title，落到具体材料上（哪一讲、哪几页、哪几题），别写「复习一下」这种；'
      + 'target 写对着哪个知识点 id（从 study_report 的 modules 里拿），填了它返回的 links 就自动带上「看这节网课 / 做配套练习 / 做题」的按钮，学生点一下就到位；'
      + 'open 也可以自己指定一份东西（绝对路径或 http 链接），它会变成按钮「打开」。'
      + 'minutes 是预计分钟数，几条加起来别超过目标里的 minutesPerDay——工具不拦你，超没超自己算。'
      + 'action=toggle 带 taskId 和可选的 done；action=update 带 taskId 加上要改的字段；action=remove 带 taskId。'
      + 'taskId 都从 study_report 或上一次返回的 tasks 里拿。'
      + '同时学几门课的时候（study_library 里不止一份档案）加 profileId：给哪门课排活儿就写哪门的 id，'
      + '不用先切过去；不写就落在当前在用的那门。'
      + '返回：tasks 是那天改完后的完整清单（带 links），profileId 说这次动的是哪门课，summary 说改了什么。',
    parameters: {
      action: str('add 加一条 | toggle 翻转完成 | update 改一条 | remove 删一条，必填', true),
      date: str('哪一天，YYYY-MM-DD；不填就是 study_report 的 today 那一天'),
      title: str('任务内容，落到材料上，比如「看第 3 讲，做课后 1-5 题」'),
      kind: str('watch 看课 / read 读教辅 / practice 练习 / review 复习 / other 其他'),
      target: str('对着哪个知识点 id，从 study_report 的 modules 里拿，没有就留空'),
      minutes: num('预计多少分钟。几条加起来别超过目标里的 minutesPerDay'),
      open: str('另外要打开的那份东西的绝对路径或 http 链接。从材料的目录索引里挑，别自己拼一个可能不存在的路径'),
      taskId: str('toggle / update / remove 时的任务 id，从 study_report 的 tasks 里拿'),
      done: { type: 'boolean', description: 'action=toggle 时指定设成完成还是未完成，不填就翻转' },
      profileId: str('排给哪一门课（多档案时才有用）。从 study_library 的 profiles[].id 里拿；不填就是当前在用的那门'),
    },
    output: out(
      {
        date: { type: 'string', required: true, description: '哪一天' },
        profileId: { type: 'string', required: true, description: '这次动的是哪门课（没指定就是当前在用的那门）' },
        tasks: taskItems('那天改完之后的完整任务清单。要拿 taskId 就翻这里'),
        summary: { type: 'string', required: true, description: '一句话概览' },
      },
      (v) => v.summary,
    ),
    execute: async (args, exec) => {
      exec.signal.throwIfAborted()
      const date = parseDate(args.date)
      // 多科目：任务能排给别的课，不用先 study_library 切过去
      const book = bookFor(store, args.profileId)
      if (args.action === 'add') {
        if (typeof args.title !== 'string' || args.title.trim() === '') throw new Error('action=add 要带 title')
        if (args.minutes !== undefined && (!Number.isFinite(args.minutes) || args.minutes <= 0)) throw new Error('minutes 要是正数')
        const next = book.update('tasks', (t) => {
          t.days = t.days ?? {}
          const day = t.days[date] ?? (t.days[date] = [])
          day.push({
            id: `T${Date.now().toString(36)}${Math.floor(Math.random() * 100)}`,
            title: args.title.trim(),
            kind: args.kind ?? 'other',
            target: args.target ?? '',
            minutes: args.minutes ?? 0,
            open: String(args.open ?? ''),
            done: false,
            createdAt: new Date().toISOString(),
          })
          return t
        })
        const tasks = (next.days[date] ?? []).map((t) => taskView(book.read('map'), t))
        const total = tasks.reduce((sum, t) => sum + t.minutes, 0)
        return { date, profileId: bookId(args.profileId), tasks, summary: `${date} 加了「${args.title.trim()}」，那天共 ${tasks.length} 项、约 ${total} 分钟。` }
      }
      if (args.action === 'toggle') {
        if (typeof args.taskId !== 'string' || args.taskId.trim() === '') throw new Error('action=toggle 要带 taskId')
        const next = book.update('tasks', (t) => {
          const day = t.days?.[date] ?? []
          const hit = day.find((x) => x.id === args.taskId)
          if (!hit) throw new Error(`${date} 没有任务「${args.taskId}」`)
          hit.done = typeof args.done === 'boolean' ? args.done : !hit.done
          hit.doneAt = hit.done ? new Date().toISOString() : null
          return t
        })
        const tasks = (next.days[date] ?? []).map((t) => taskView(book.read('map'), t))
        const on = tasks.find((x) => x.id === args.taskId)
        return { date, profileId: bookId(args.profileId), tasks, summary: `${date}「${on.title}」现在${on.done ? '做完了' : '还没做完'}。` }
      }
      if (args.action === 'remove') {
        if (typeof args.taskId !== 'string' || args.taskId.trim() === '') throw new Error('action=remove 要带 taskId')
        const next = book.update('tasks', (t) => {
          const day = t.days?.[date] ?? []
          const hit = day.find((x) => x.id === args.taskId)
          if (!hit) throw new Error(`${date} 没有任务「${args.taskId}」`)
          t.days[date] = day.filter((x) => x.id !== args.taskId)
          return t
        })
        const tasks = (next.days[date] ?? []).map((t) => taskView(book.read('map'), t))
        return { date, profileId: bookId(args.profileId), tasks, summary: `${date} 删掉一条任务，那天还剩 ${tasks.length} 项。` }
      }
      if (args.action === 'update') {
        if (typeof args.taskId !== 'string' || args.taskId.trim() === '') throw new Error('action=update 要带 taskId')
        const next = book.update('tasks', (t) => {
          const day = t.days?.[date] ?? []
          const hit = day.find((x) => x.id === args.taskId)
          if (!hit) throw new Error(`${date} 没有任务「${args.taskId}」`)
          for (const key of ['title', 'kind', 'target', 'open']) {
            if (args[key] !== undefined) hit[key] = String(args[key])
          }
          if (args.minutes !== undefined) {
            if (!Number.isFinite(args.minutes) || args.minutes <= 0) throw new Error('minutes 要是正数')
            hit.minutes = args.minutes
          }
          return t
        })
        const tasks = (next.days[date] ?? []).map((t) => taskView(book.read('map'), t))
        const on = tasks.find((x) => x.id === args.taskId)
        return { date, profileId: bookId(args.profileId), tasks, summary: `${date}「${on.title}」改好了。` }
      }
      throw new Error(`action 只能是 add / toggle / update / remove，收到「${String(args.action)}」`)
    },
  }

  const material = {
    name: 'study_material',
    description:
      '登记或删掉学习材料：教辅、网课、讲义、真题。'
      + '什么时候调：学生丢来文件、文件夹、网课目录或者书名的时候。一次丢一堆就一条条登记，别合成一条。'
      + '怎么填：action=add 要带 title；kind 是 book 教辅 / video 网课 / notes 讲义 / past 真题 / other；'
      + 'path 写本地绝对路径，网课目录写文件夹；note 写解析出来的讲次、章节范围、注意事项——'
      + '网课目录只给得出文件名，讲次得你自己解出来放这儿。action=remove 要带 id（从 study_report 的 materials 里拿）。'
      + '返回：materials 是登记后的完整清单，每条带 analyzed（通读过没有）和 chapterCount（分析里记了几章）。'
      + '别登记完就完事——通读一遍、用 study_analysis 把结论写下来，之后排任务才有据可依。',
    parameters: {
      action: str('add 登记 | remove 删掉，必填', true),
      id: str('action=remove 时的材料 id，从 study_report 里拿'),
      kind: str('book 教辅 / video 网课 / notes 讲义 / past 真题 / other'),
      title: str('材料名字，用学生给的原名'),
      path: str('本地绝对路径；网课目录写文件夹路径。拿不到（比如只有附件、口述书名）就留空，别编一个'),
      note: str('解析出来的讲次、章节范围、注意事项'),
    },
    output: out(
      {
        materials: materialItems('登记后的材料清单。要拿材料 id 去删就翻这里'),
        count: num('材料数', true),
        summary: { type: 'string', required: true, description: '一句话概览' },
      },
      (v) => v.summary,
    ),
    execute: async (args, exec) => {
      exec.signal.throwIfAborted()
      if (args.action === 'add') {
        if (typeof args.title !== 'string' || args.title.trim() === '') throw new Error('action=add 要带 title')
        const next = store.update('profile', (p) => {
          p.materials.push({
            id: `MAT${Date.now().toString(36)}`,
            kind: args.kind ?? 'other',
            title: args.title.trim(),
            path: args.path ?? '',
            note: args.note ?? '',
            addedAt: new Date().toISOString(),
          })
          return p
        })
        const list = (next.materials ?? []).map((m) => pickMaterial(m, store.read('analysis')))
        return { materials: list, count: list.length, summary: `登记了「${args.title.trim()}」，现在共 ${list.length} 份材料。` }
      }
      if (args.action === 'remove') {
        if (typeof args.id !== 'string' || args.id.trim() === '') throw new Error('action=remove 要带 id')
        const next = store.update('profile', (p) => {
          const before = p.materials.length
          p.materials = p.materials.filter((m) => m.id !== args.id)
          if (p.materials.length === before) throw new Error(`没有材料「${args.id}」`)
          return p
        })
        store.update('analysis', (a) => dropAnalysis(a, args.id))
        const list = (next.materials ?? []).map((m) => pickMaterial(m, store.read('analysis')))
        return { materials: list, count: list.length, summary: `删掉一份材料，还剩 ${list.length} 份。` }
      }
      throw new Error(`action 只能是 add / remove，收到「${String(args.action)}」`)
    },
  }

  const analysis = {
    name: 'study_analysis',
    description:
      '写或读「材料分析」：一份教辅 / 题集 / 网课目录通读之后，它在教学上扮演什么角色、每章讲什么、例题习题有多少、什么难度。'
      + '什么时候调：登记完一份材料（study_material）之后，头一件事就是把它读一遍，然后用 action=save 把结论写下来——'
      + '没通读就排作业，排出来的页码题号多半对不上，学生一打开就发现是错的。'
      + '怎么读：文字版 PDF 用 python 的 pypdf 抽文本，扫描件用 read_image 一张张看图，'
      + '网课目录先把文件名列出来、从文件名解讲次；目录页、每章开头、习题页最值钱，整本逐字读没必要。'
      + '册子厚（三百页以上）就分批读，或者拉几个子 agent 并行读几个部分、回来在这里拼起来。'
      + '怎么写：chapters 可以一批一批喂，同 no 的章节会覆盖已存的，所以能一边读一边写。'
      + 'coverage 老实填：整本读完「整本通读」，只读了一部分「部分通读」，只翻了目录「只翻目录」——没读完不丢人，写清楚就行。'
      + 'role 是整份材料的教学定位（主线讲解？纯题库？速查手册？），pairing 写它跟别的材料怎么配。'
      + '返回：chapters 是这份材料现在记下的章节。排任务的 open 和题号全从这儿挑。',
    parameters: {
      action: str('save 写分析 | get 读回来（默认）', true),
      materialId: str('哪份材料。id 从 study_report 的 materials 里拿', true),
      coverage: str('save 时填：整本通读 / 部分通读 / 只翻目录'),
      role: str('save 时填：这份材料在教学上扮演什么角色'),
      pairing: str('save 时填：它跟别的材料怎么配'),
      notes: str('save 时填：别的注意事项'),
      chapters: chapterInputItems('save 时填：这一批章节。同 no 的会覆盖已存的，所以能分批喂'),
      chapterNo: str('get 时只看某一章，不填就是全部'),
      toc: listOf(
        'save 时填：这本书的目录（页码写物理页）。给了就整份换掉——目录分批喂一半没意义',
        tocProps(),
        false,
      ),
      pageCount: num('save 时填：这本书一共多少页。study_book 的 info 会直接写好，一般不用你填'),
      pageDir: str('save 时填：页图放哪个目录。study_book 的 build 会直接写好，一般不用你填'),
      dpi: num('save 时填：页图清晰度，默认 110'),
      spans: spanInputItems(
        'save 时填：这一批「第几条到第几条属于哪个单元」。**写区间就行**，盘上落的是逐页表。'
        + '同一页再写一次会覆盖旧的。一本书分几趟归完都行，一趟写十几行就够',
      ),
      resetPages: bool('save 时填：true 就把这本书的页级索引整个清空重来'),
    },
    output: out(
      {
        materialId: str('这份材料的 id', true),
        coverage: str('读到什么程度：整本通读 / 部分通读 / 只翻目录', true),
        role: str('整份材料的教学定位，可能是空串', true),
        pairing: str('跟别的材料怎么配，可能是空串', true),
        notes: str('别的注意事项，可能是空串', true),
        analyzedAt: str('最后一次写的时间，ISO 字符串；没分析过就是空串', true),
        chapterCount: num('这份材料一共记了几章', true),
        chapters: chapterItems('这份材料的章节清单'),
        pageCount: num('这本书一共多少页；还不知道就是 0', true),
        pageDir: str('页图放哪个目录；还没拆就是空串', true),
        dpi: num('页图清晰度', true),
        tocCount: num('目录记了几条', true),
        toc: listOf('书里记下的目录', tocProps()),
        indexed: num('已经归好类的页数', true),
        spans: spanItems('归好类的页，按区间合并回来'),
        gaps: str('还没归类的页码，逗号分隔；全归好了就是空串', true),
        summary: { type: 'string', required: true, description: '一句话概览' },
      },
      (v) => v.summary,
    ),
    execute: async (args, exec) => {
      exec.signal.throwIfAborted()
      const materialId = String(args.materialId ?? '').trim()
      if (!materialId) throw new Error('materialId 必填，从 study_report 的 materials 里拿')
      const found = (store.read('profile').materials ?? []).find((m) => String(m.id) === materialId)
      if (!found) {
        throw new Error(`档案里没有材料「${materialId}」。先 study_material 传 action=add 登记，或者从 study_report 的 materials 里挑一个真的 id`)
      }
      const title = String(found.title ?? '')
      const action = String(args.action ?? 'get').trim()
      if (action === 'save') {
        store.update('analysis', (a) => {
          upsertAnalysis(a, materialId, args)
          return a
        })
        const next = analysisOf(store.read('analysis'), materialId)
        const chapters = next.chapters.map(pickChapter)
        return {
          materialId,
          coverage: next.coverage,
          role: next.role,
          pairing: next.pairing,
          notes: next.notes,
          analyzedAt: String(next.analyzedAt ?? ''),
          chapterCount: chapters.length,
          chapters,
          ...pageView(next),
          summary: `《${title}》记为${next.coverage}，现在有 ${chapters.length} 章${next.role ? `；定位：${next.role}` : ''}。`,
        }
      }
      if (action !== 'get') throw new Error(`action 只能是 save / get，收到「${action}」`)
      const a = analysisOf(store.read('analysis'), materialId)
      const only = String(args.chapterNo ?? '').trim()
      let chapters = a.chapters.map(pickChapter)
      if (only) {
        chapters = chapters.filter((c) => c.no === only)
        if (!chapters.length) throw new Error(`《${title}》里没有第 ${only} 章。要么 no 写错了，要么还没读到它`)
      }
      return {
        materialId,
        coverage: a.coverage,
        role: a.role,
        pairing: a.pairing,
        notes: a.notes,
        analyzedAt: String(a.analyzedAt ?? ''),
        chapterCount: a.chapters.length,
        chapters,
        ...pageView(a),
        summary: a.analyzedAt
          ? `《${title}》${a.coverage}，记了 ${a.chapters.length} 章${only ? `；这次只回第 ${only} 章` : ''}。`
          : `《${title}》还没分析过。先通读一遍，再用 action=save 写下来。`,
      }
    },
  }

  const book = {
    name: 'study_book',
    description:
      '把一本教辅 / 讲义拆成「一页一张图 + 每一页属于哪个单元」的页级索引——'
      + '这东西做出来，学生就能「今天学了 M1.4，翻开教辅第 12—17 页」，点一下直达那一页。'
      + '什么时候调：学生丢来 PDF、或者你说「去教辅里找这一节的页」。三步，按顺序来——'
      + '①action=info：先问清楚这本多少页、是不是扫描件、有没有现成书签（**这些讲义多半既没文字层也没书签，'
      + '目录只能等你拆完图、自己 read_image 看**，所以 info 的 toc 是白捡的，别指望）；'
      + '②action=build：起拆图，几百页要跑几分钟，**这一步是后台跑，起完就回来**，'
      + '再调 action=info 看 rendered/rendering 知道拆到哪了；'
      + '③拆完（或者拆了一部分就够用）用 study_pages 把目录页 / 章节开头拿 read_image 看一遍，'
      + '再用 **study_analysis action=save** 把 toc 和 spans 写下来——'
      + 'spans 写区间（`12—15 页是 M1.4 的例题`），一本书一趟十几行就归完了，'
      + 'save 回来会告诉你 gaps（还有哪几页没归），照着补。'
      + 'action=pages：反过来查「M1.4 这件事，几本教辅里各在第几页」，'
      + '排作业时用它挑「今天做教辅 A 第 12—17 页，还是教辅 B 第 30—34 页」。'
      + '页码一律是**物理页**（从 1 起）。注意书上印的页码常常比物理页大 1，别直接抄。',
    parameters: {
      action: str('info 看这本什么情况（默认）| build 起拆图 | pages 查某个单元在各教辅的哪几页'),
      materialId: str('哪份材料。id 从 study_report 的 materials 里拿'),
      pdfPath: str('info / build 时也可以直接写 PDF 绝对路径，不用先登记'),
      pointId: str('action=pages 时填：查哪个单元，比如 M1.4'),
      dpi: num(`build 时的清晰度，默认 ${DEFAULT_DPI}，60–220`),
    },
    output: out(
      {
        ok: { type: 'boolean', required: true, description: '这一步成了没有' },
        error: str('没成的原因，成了就是空串', true),
        action: str('这次干的是哪件事', true),
        materialId: str('这份材料的 id，没登记就是空串', true),
        title: str('书名', true),
        pdfPath: str('拆的是哪一份 PDF', true),
        dir: str('页图落在哪个目录', true),
        total: num('这本书一共多少页，读不到就是 0', true),
        scanned: { type: 'boolean', required: true, description: '是不是扫描件（没有文字层，只能看图）' },
        rendered: num('已经拆出来多少页', true),
        rendering: { type: 'boolean', required: true, description: '现在还在拆吗' },
        pid: num('拆图那个后台进程的 pid，没起就是 0', true),
        tocCount: num('记下来的目录有几条', true),
        toc: listOf('目录。多半是空的——这些讲义没有书签，得你拆完图自己看', tocProps()),
        indexed: num('已经归好类的页数', true),
        spans: spanItems('归好类的页，按区间合并回来'),
        gaps: str('还没归类的页码，逗号分隔；全归好了就是空串', true),
        hits: listOf('action=pages 的结果：这个单元在各份教辅里各占哪几页', {
          materialId: str('材料 id', true),
          material: str('材料名', true),
          kind: str('材料类型', true),
          from: num('从第几页', true),
          to: num('到第几页', true),
          count: num('几页', true),
          pageKind: str('讲解 / 例题 / 习题 / 目录 / 答案 / 其他', true),
          note: str('备注', true),
          pages: listOf('这一段里的每一页，带能直接点开的地址', {
            page: num('第几页', true),
            url: str('面板上打开这一页的地址；那一页还没拆出来就是空串', true),
          }),
        }),
        summary: { type: 'string', required: true, description: '一句话概览' },
      },
      (v) => v.summary,
    ),
    execute: async (args, exec) => {
      exec.signal.throwIfAborted()
      const action = String(args.action ?? 'info').trim()
      const materialId = String(args.materialId ?? '').trim()
      const materials = store.read('profile').materials ?? []
      const found = materialId ? materials.find((m) => String(m.id) === materialId) : null
      if (materialId && !found) throw new Error(`档案里没有材料「${materialId}」，从 study_report 的 materials 里挑一个真的 id`)
      const title = found ? String(found.title ?? '') : ''
      const analysis = analysisOf(store.read('analysis'), materialId)

      if (action === 'pages') {
        const pointId = String(args.pointId ?? '').trim()
        if (!pointId) throw new Error('action=pages 要带 pointId，比如 M1.4')
        const hits = pagesForPoint(store.read('analysis'), materials, pointId).map((h) => ({
          materialId: h.materialId,
          material: h.material,
          kind: h.kind,
          from: Number(h.from),
          to: Number(h.to),
          count: h.count,
          pageKind: h.pageKind,
          note: h.note,
          pages: Array.from({ length: h.to - h.from + 1 }, (_, i) => Number(h.from) + i).map((page) => ({
            page,
            url: pageUrl(opts, pageFileOf(h.pageDir, page)),
          })),
        }))
        return {
          ok: true,
          error: '',
          action,
          materialId: '',
          title: '',
          pdfPath: '',
          dir: '',
          total: 0,
          scanned: false,
          rendered: 0,
          rendering: false,
          pid: 0,
          ...pageView(analysisOf(store.read('analysis'), '')),
          hits,
          summary: hits.length
            ? `${pointId} 在 ${new Set(hits.map((h) => h.material)).size} 份教辅里找得到，一共 ${hits.length} 段、`
              + `${hits.reduce((s, h) => s + h.count, 0)} 页：`
              + hits.map((h) => `${h.material} ${h.from}—${h.to} 页（${h.pageKind}）`).join('；')
            : `没有哪份教辅把 ${pointId} 归过页。要么这本还没拆/没归，要么这个单元还没进书里。`,
        }
      }

      // info / build 都要先拿到 PDF 在哪。
      const pdf = resolvePdf(materials, materialId, args.pdfPath)
      const pagesRoot = opts.pagesRoot || opts.scratchDir || join(homedir(), '.dsh', 'study-coach', 'pages')
      const dir = pagesDirFor(pagesRoot, pdf)

      if (action === 'build') {
        const dpi = Math.min(220, Math.max(60, Math.floor(Number(args.dpi) || DEFAULT_DPI)))
        const manifest = readManifest(dir)
        const fresh = manifest && manifest.rendering && Date.now() - Date.parse(manifest.at || 0) < 10 * 60 * 1000
        if (fresh) {
          return {
            ok: true,
            error: '',
            action,
            materialId,
            title,
            pdfPath: pdf,
            dir,
            total: Number(manifest.total) || 0,
            scanned: !!manifest.scanned,
            rendered: Number(manifest.rendered) || 0,
            rendering: true,
            pid: 0,
            ...pageView(analysis),
            hits: [],
            summary: `这本已经在拆了（${manifest.rendered}/${manifest.total} 页），没重复起进程。`,
          }
        }
        const script = join(dirname(fileURLToPath(import.meta.url)), 'build-pages.mjs')
        const launch = opts.spawnBuild || ((file, argv) => spawn(process.execPath, [file, ...argv], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        }))
        const child = launch(script, [pdf, pagesRoot, String(dpi)])
        if (typeof child?.unref === 'function') child.unref()
        return {
          ok: true,
          error: '',
          action,
          materialId,
          title,
          pdfPath: pdf,
          dir,
          total: Number(manifest && manifest.total) || 0,
          scanned: !!(manifest && manifest.scanned),
          rendered: Number(manifest && manifest.rendered) || 0,
          rendering: true,
          pid: child.pid ?? 0,
          ...pageView(analysis),
          hits: [],
          summary: `开始拆「${pdf.split(/[\\/]/).pop()}」，dpi ${dpi}，图落在 ${dir}。`
            + '这本几百页要跑几分钟，**别在这儿等**——过一会儿再 action=info 看 rendered/rendering。',
        }
      }

      if (action !== 'info') throw new Error(`action 只能是 info / build / pages，收到「${action}」`)

      const info = (opts.bookInfo || bookInfo)(pdf)
      if (!info.ok) {
        return {
          ok: false,
          error: info.error,
          action,
          materialId,
          title,
          pdfPath: pdf,
          dir,
          total: 0,
          scanned: false,
          rendered: 0,
          rendering: false,
          pid: 0,
          ...pageView(analysis),
          hits: [],
          summary: `读不出来：${info.error}`,
        }
      }
      if (materialId) {
        store.update('analysis', (a) => {
          upsertAnalysis(a, materialId, {
            pageCount: info.total,
            pageDir: dir,
            dpi: Number(analysis.dpi) || DEFAULT_DPI,
            toc: info.toc,
          })
          return a
        })
      }
      const manifest = readManifest(dir)
      const rendered = manifest && Number(manifest.rendered) > 0
        ? Number(manifest.rendered)
        : countRendered(analysis)
      const rendering = !!(manifest && manifest.rendering && Date.now() - Date.parse(manifest.at || 0) < 10 * 60 * 1000)
      const next = materialId ? analysisOf(store.read('analysis'), materialId) : analysis
      return {
        ok: true,
        error: '',
        action,
        materialId,
        title,
        pdfPath: pdf,
        dir,
        total: info.total,
        scanned: info.scanned,
        rendered,
        rendering,
        pid: 0,
        ...pageView(next),
        hits: [],
        summary:
          `《${title || pdf.split(/[\\/]/).pop()}》：${info.total} 页，${info.scanned ? '扫描件（没有文字层，只能看图）' : '有文字层（可以用 pypdf 抽）'}，`
          + `书签 ${info.toc.length} 条${info.toc.length ? '' : '（没有书签，目录得你拆完图自己看）'}，`
          + `已经拆出 ${rendered} 页${rendering ? '（还在拆）' : ''}，归好类 ${next.pages.length} 页。`
          + (next.pages.length ? '' : ' 下一步：action=build 起拆图。'),
      }
    },
  }

  const toolset = {
    name: 'study_tool_level',
    description:
      '登记「基本工具」的水平：运算、画图、查资料、调试、写证明这类横向能力。'
      + '它们不属于某一个知识点，却决定学习速度，所以单开一张表。'
      + '什么时候调：看出学生算得慢、不会查资料、画不出图这类迹象就顺手记一条，别让这张表一直空着。'
      + '怎么填：name 是工具名，同名就是更新不是新增；stage 同 study_record 的六档；note 写依据，一句话。'
      + '注意用词要固定：先看 study_report 里这张表已经有什么，同一个能力沿用原来的名字'
      + '（「手算」别再另写成「计算」），不然表会裂成好几条。',
    parameters: {
      name: str('工具名，比如「手算」「查资料」「画图」。同名就更新那条；前后空格会被去掉，但写法得一模一样才算同名', true),
      stage: stageSchema('推进到哪一档，不传就只更新依据'),
      confidence: num('0 到 1 之间'),
      note: str('依据，一句话：什么时候、什么事让你这么判断'),
    },
    output: out(
      {
        tools: toolItems('这张表现在的全部条目'),
        summary: { type: 'string', required: true, description: '一句话概览' },
      },
      (v) => v.summary,
    ),
    execute: async (args, exec) => {
      exec.signal.throwIfAborted()
      if (typeof args.name !== 'string' || args.name.trim() === '') throw new Error('name 必填')
      const name = args.name.trim()
      const next = store.update('profile', (p) => {
        const hit = p.tools.find((t) => t.name === name)
        if (hit) {
          if (args.stage !== undefined && args.stage !== '') hit.stage = args.stage
          if (args.confidence !== undefined) hit.confidence = args.confidence
          if (args.note !== undefined && args.note !== '') hit.note = args.note
          hit.updatedAt = new Date().toISOString()
        } else {
          p.tools.push({
            name,
            stage: args.stage ?? '没接触过',
            confidence: args.confidence ?? 0,
            note: args.note ?? '',
            updatedAt: new Date().toISOString(),
          })
        }
        return p
      })
      const hit = next.tools.find((t) => t.name === name)
      return { tools: (next.tools ?? []).map(pickTool), summary: `工具「${name}」记到「${hit.stage}」。` }
    },
  }

  const guide = {
    name: 'study_guide',
    description:
      '在图形面板顶上写一句话，告诉学生现在该回对话里干什么。'
      + '什么时候调：需要把他叫回对话时，比如「看完第 3 讲回来答三个问题」「自评完喊我一声」。'
      + '面板是给他看的，不是给你记笔记的地方；事情办完就清掉，别留一句过期的。'
      + '怎么填：text 是那句话，短一点，传空串就清空（清空就这一条路）；kind 是 ask 回来回答问题 / self 去面板自评 / plan 去看今天任务。'
      + '收尾：写完在对话里也说一遍，不然他不一定看面板。',
    parameters: {
      text: str('写在面板顶上的那句话，短一点；传空串清空'),
      kind: str('ask 回来回答问题 / self 去面板自评 / plan 去看今天任务'),
    },
    output: out(
      {
        text: { type: 'string', required: true, description: '现在面板顶上显示的内容' },
        summary: { type: 'string', required: true, description: '一句话概览' },
      },
      (v) => v.summary,
    ),
    execute: async (args, exec) => {
      exec.signal.throwIfAborted()
      const next = store.update('guide', (g) => setGuide(g, args.text ?? '', args.kind))
      return { text: next.text, summary: next.text ? `面板顶上写了：${next.text}` : '面板指引清掉了。' }
    },
  }

  const inbox = {
    name: 'study_inbox',
    description:
      '看学生在图形面板上留给你的话。'
      + '什么时候调：study_report 返回的 inboxItems 非空，说明有没处理的留言，先回应；处理完用 action=read 标记掉。'
      + '只想单独再看一遍没处理的，用 action=list（默认）。'
      + '学生在面板上说的话不会在对话里重复一遍，别漏。'
      + '返回：items 是留言，每条有 id / text / at，按时间排。'
      + '注意：read 不带 ids 会把所有没读的一次全标掉；只想标其中几条，就把 id 放进 ids。还有没处理完的，先别整批清。',
    parameters: {
      action: str('list 列没处理的（默认）| read 标记成已处理'),
      ids: {
        type: 'array',
        description: 'action=read 时只想标掉其中几条，就传这些 id（字符串数组）；不传就是所有没读的一起标',
        items: { type: 'string', description: '留言 id，从 study_report 的 inboxItems 或本工具返回的 items 里拿' },
      },
    },
    output: out(
      {
        items: inboxItemList('这次动完之后的留言列表，按时间排'),
        count: num('条数', true),
        summary: { type: 'string', required: true, description: '一句话概览' },
      },
      (v) => v.summary,
    ),
    execute: async (args, exec) => {
      exec.signal.throwIfAborted()
      const action = args.action ?? 'list'
      if (action === 'list') {
        const items = unreadInbox(store.read('inbox')).map(pickMessage)
        return {
          items,
          count: items.length,
          summary: items.length ? `${items.length} 条留言：${items.map((i) => i.text).join(' / ')}` : '面板上没有新留言。',
        }
      }
      if (action === 'read') {
        const before = unreadInbox(store.read('inbox')).map(pickMessage)
        const ids = Array.isArray(args.ids) ? args.ids.filter((x) => typeof x === 'string' && x !== '') : null
        store.update('inbox', (box) => markInboxRead(box, ids))
        const left = unreadInbox(store.read('inbox')).map(pickMessage)
        return {
          items: left,
          count: left.length,
          summary: before.length
            ? `处理掉 ${before.length - left.length} 条留言${left.length ? `，还剩 ${left.length} 条没处理` : ''}。`
            : '没有新留言要处理。',
        }
      }
      throw new Error(`action 只能是 list / read，收到「${String(action)}」`)
    },
  }

  /* ── 掌握档案 / 总体能力 / 档案库 / 材料文件 ───────────────────────────── */

  const archive = {
    name: 'study_archive',
    description:
      '看某一级的掌握档案：一个大类、一个模块、或者一个知识点，到现在为止表现怎么样。'
      + '什么时候调：要开口说「你这块学得怎么样」之前、要决定接下来补哪块之前、或者学生问「我那个现在什么水平」的时候。'
      + 'level=group 看一个大类（key 写大类名），level=module 看一个模块（key 写模块 id），level=point 看单个知识点（key 写知识点 id）。'
      + '返回里有：progress 百分比、六档各几个、每个单元一条摘要（档位 / 攒了几条证据 / 最后一次是什么时候什么表现 / 什么时候该复习）、最近的证据、该复习的清单。'
      + '面板上每一级那个小按键点开看到的是同一份东西，你可以照着自己的话说给他听。'
      + '要看整个人的水平别用这个，用 study_ability。',
    parameters: {
      level: str('group 大类 | module 模块 | point 知识点，必填', true),
      key: str('查谁：大类名 / 模块 id / 知识点 id。全都从 study_report 的 modules 里拿', true),
      limit: num('证据最多给几条，默认 12'),
    },
    output: out(
      {
        level: str('查的是哪一级', true),
        key: str('查的那个 key', true),
        title: str('这一级叫什么', true),
        group: str('属于哪个大类，可能是空串', true),
        moduleId: str('模块 id，查大类时是空串', true),
        moduleTitle: str('模块名，查大类时是空串', true),
        today: str('今天的日期', true),
        total: num('这一级一共几个知识点', true),
        touched: num('碰过的几个', true),
        untouched: num('还没碰的几个', true),
        progress: num('掌握度百分比，0 到 100', true),
        avgConfidence: num('平均置信度，0 到 1', true),
        byStage: {
          type: 'object',
          required: true,
          additionalProperties: false,
          description: '每个档位各有几个知识点',
          properties: Object.fromEntries(STAGES.map((stage) => [stage, num(`档位「${stage}」的知识点数`)])),
        },
        points: listOf('这一级下面每个知识点的表现', {
          pointId: str('知识点 id', true),
          title: str('知识点名', true),
          moduleId: str('模块 id', true),
          moduleTitle: str('模块名', true),
          group: str('大类', true),
          source: str('对应材料的哪一节，可能是空串', true),
          video: str('网课路径，可能是空串', true),
          practice: str('配套练习路径，可能是空串', true),
          stage: str('当前档位', true),
          confidence: num('置信度 0 到 1', true),
          evidenceCount: num('攒了几条证据', true),
          lastKind: str('最后一条证据是什么类型，没记录就是空串', true),
          lastNote: str('最后一条证据写了什么，没记录就是空串', true),
          lastAt: str('最后一条证据的时间，没记录就是空串', true),
          nextReview: str('下次该复习的日期，没排就是空串', true),
          updatedAt: str('最后一次更新的时间，没记录就是空串', true),
          due: { type: 'boolean', required: true, description: '是不是已经到复习时间了' },
        }),
        evidence: listOf('最近的证据，新的在前', {
          pointId: str('哪个知识点', true),
          pointTitle: str('知识点名', true),
          kind: str('self 自评 / quiz 做题 / photo 作业照片 / lesson 上课 / review 复习', true),
          note: str('当时写了什么', true),
          at: str('时间，ISO 字符串', true),
          /* 可选：只有这条证据上真挂着错题才有这个字段，别声明成 null 兜底 */
          mistake: {
            type: 'object',
            additionalProperties: false,
            description: '这条证据上挂着的错题；没记错题就没有这个字段',
            properties: mistakeOutProps(),
          },
        }),
        evidenceTotal: num('一共攒了几条证据', true),
        due: listOf('已经到复习时间的知识点', {
          pointId: str('知识点 id', true),
          title: str('知识点名', true),
          stage: str('当前档位', true),
          nextReview: str('该复习的日期', true),
        }),
        summary: { type: 'string', required: true, description: '一句话概览' },
      },
      (v) => v.summary,
    ),
    execute: async (args, exec) => {
      exec.signal.throwIfAborted()
      const level = String(args.level ?? '').trim()
      const key = String(args.key ?? '').trim()
      if (!['group', 'module', 'point'].includes(level)) throw new Error('level 只能是 group / module / point')
      if (!key) throw new Error('key 必填：查大类写大类名，查模块和知识点写 id')
      const s = store.snapshot()
      let data = null
      try {
        data = archiveFor(s.map, s.mastery, level, key, {
          limit: Number.isFinite(args.limit) && args.limit > 0 ? Math.floor(args.limit) : 12,
        })
      } catch (err) {
        throw new Error(String((err && err.message) || err))
      }
      if (!data) throw new Error(`地图里找不到这个${level === 'group' ? '大类' : level === 'module' ? '模块' : '知识点'}：${key}`)
      const weak = data.points.filter((p) => p.stage === '没接触过' || p.stage === '见过' || p.stage === '能跟做')
      return {
        ...data,
        summary:
          `${data.title}（${level}）：${data.total} 个知识点，掌握度 ${data.progress}%，碰过 ${data.touched} 个；`
          + `卡在「能跟做」及以下的 ${weak.length} 个，该复习的 ${data.due.length} 个，证据共 ${data.evidenceTotal} 条。`,
      }
    },
  }

  const ability = {
    name: 'study_ability',
    description:
      '学生的总体能力判断：横着看所有大类、所有知识点、所有基本工具，加上最近七天的完成节奏，摊成一份「这人现在什么水平」的依据。'
      + '什么时候调：会话开头摸完底、每周复盘、学生问「我现在怎么样」、或者要定下一步重点的时候。'
      + 'action=get（默认）只读；action=set 要带 text，把你自己写的那句判词落进档案——面板顶上显示的就是它，写空串就清掉。'
      + '返回里 weak 是卡在低档或档位到了但没底的，due 是该复习的，groups 是各大类的进度与薄弱数，pace 是最近七天排了多少、做完多少。'
      + '判词要写成给学生看的人话，先说什么水平、再说下一步动哪儿，别把字段名念一遍。'
      + '看单个大类或模块的细账用 study_archive。',
    parameters: {
      action: str('get 读（默认，不传就是它）| set 写判词'),
      text: str('action=set 时填：给学生看的那段判词。传空串就清掉'),
      level: str('action=set 时可选：你给的一个粗档位词，比如「刚起步」「能独立做中档题」，想不出就留空'),
    },
    output: out(
      {
        today: str('今天的日期', true),
        goal: {
          type: 'object',
          required: true,
          additionalProperties: false,
          description: '学习目标',
          properties: {
            subject: str('学什么'),
            outcome: str('要掌握到什么程度'),
            deadline: str('最晚哪天，没定就是空串'),
            minutesPerDay: num('每天多少分钟'),
            daysLeft: num('离 deadline 还有几天，没定就是 -1'),
          },
        },
        overall: num('整张图的掌握度百分比', true),
        total: num('知识点总数', true),
        touched: num('碰过的几个', true),
        untouched: num('还没碰的几个', true),
        byStage: {
          type: 'object',
          required: true,
          additionalProperties: false,
          description: '每个档位各有几个知识点',
          properties: Object.fromEntries(STAGES.map((stage) => [stage, num(`档位「${stage}」的知识点数`)])),
        },
        avgConfidence: num('平均置信度 0 到 1', true),
        groups: listOf('每个大类一行', {
          name: str('大类名', true),
          progress: num('这个大类掌握度百分比', true),
          modules: num('下面几个模块', true),
          points: num('下面几个知识点', true),
          touched: num('碰过几个', true),
          weak: num('薄弱的几个', true),
          due: num('该复习的几个', true),
        }),
        weak: listOf('薄弱清单，卡得越死越靠前', {
          pointId: str('知识点 id', true),
          title: str('知识点名', true),
          group: str('大类', true),
          moduleTitle: str('模块名', true),
          stage: str('当前档位', true),
          confidence: num('置信度 0 到 1', true),
          reason: str('为什么算薄弱', true),
        }),
        weakTotal: num('薄弱的一共几个', true),
        due: listOf('到复习时间的知识点', {
          pointId: str('知识点 id', true),
          title: str('知识点名', true),
          stage: str('当前档位', true),
          nextReview: str('该复习的日期', true),
        }),
        dueTotal: num('该复习的一共几个', true),
        tools: toolItems('基本工具表：运算、画图、查资料这类横向能力'),
        pace: {
          type: 'object',
          required: true,
          additionalProperties: false,
          description: '最近七天的完成节奏',
          properties: {
            window: num('看的是几天'),
            days: listOf('每一天一行', {
              date: str('哪一天', true),
              total: num('排了几条', true),
              done: num('做完几条', true),
              minutesTotal: num('计划多少分钟', true),
              minutesDone: num('实际完成多少分钟', true),
            }),
            total: num('七天一共排了几条', true),
            done: num('七天一共做完几条', true),
            minutesTotal: num('七天计划多少分钟', true),
            minutesDone: num('七天完成多少分钟', true),
            completion: num('完成率百分比', true),
            plannedDays: num('有任务的几天', true),
            finishedDays: num('任务全做完的几天', true),
          },
        },
        judgement: {
          type: 'object',
          required: true,
          additionalProperties: false,
          description: '你自己写的那句判词',
          properties: {
            text: str('判词内容，没写过就是空串'),
            level: str('粗档位词，没写过就是空串'),
            updatedAt: str('最后一次写的时间，没写过就是空串'),
          },
        },
        summary: { type: 'string', required: true, description: '一句话概览' },
      },
      (v) => v.summary,
    ),
    execute: async (args, exec) => {
      exec.signal.throwIfAborted()
      const action = String(args.action ?? 'get').trim()
      if (action === 'set') {
        if (args.text === undefined && args.level === undefined) throw new Error('action=set 至少要带 text 或 level')
        store.update('profile', (p) => {
          setAbility(p, { text: args.text, level: args.level })
          return p
        })
      } else if (action !== 'get') {
        throw new Error(`action 只能是 get / set，收到「${action}」`)
      }
      const s = store.snapshot()
      const data = s.ability
      return {
        ...data,
        summary:
          `总体掌握度 ${data.overall}%（碰过 ${data.touched}/${data.total}）；`
          + `薄弱 ${data.weakTotal} 个，该复习 ${data.dueTotal} 个；最近七天排了 ${data.pace.total} 条、做完 ${data.pace.done} 条。`
          + (data.judgement.text ? `已写判词。` : '还没写过总体判词——该给一句了。'),
      }
    },
  }

  const library = {
    name: 'study_library',
    description:
      '管学习档案本身：现在有哪几个学习目标、新建一个、切过去、改名、删掉。'
      + '什么时候调：学生要开一个新目标（换一门课、换一个考试）、要回到以前那个、要清掉不学的；一开口也可以先 list 看一眼库里有几个。'
      + 'action=list 看全部（默认，带每个档案的模块数、知识点数和进度）；'
      + 'action=create 要 title（还能带 subject / outcome / deadline / minutesPerDay），新档案建完直接切成当前档案；'
      + 'action=select 带 id 切过去；action=rename 带 id 和 title；action=remove 带 id 删掉——是挪进回收站不是真删，最后一个档案删不掉。'
      + 'id 全从返回的 profiles 里拿。切换之后 study_report 读到的就是那一份，别的工具跟着一起切。'
      + '一个学习目标一个档案，别把两门课塞进同一张地图。',
    parameters: {
      action: str('list 看全部 | create 新建 | select 切过去 | rename 改名 | remove 删掉，必填', true),
      id: str('select / rename / remove 时的档案 id，从 profiles 里拿'),
      title: str('create / rename 时的名字，用学生给的课名'),
      subject: str('create 时填：学什么'),
      outcome: str('create 时填：要掌握到什么程度，用学生自己的话'),
      deadline: str('create 时填：最晚哪天 YYYY-MM-DD'),
      minutesPerDay: num('create 时填：每天大概多少分钟'),
    },
    output: out(
      {
        supported: { type: 'boolean', required: true, description: '这个档案根支不支持多档案' },
        active: str('当前在用哪个档案 id', true),
        profiles: listOf('库里的档案清单', {
          id: str('档案 id。select / rename / remove 都用它', true),
          title: str('档案名', true),
          subject: str('学什么，可能是空串', true),
          outcome: str('要掌握到什么程度，可能是空串', true),
          minutesPerDay: num('每天多少分钟', true),
          modules: num('几个模块', true),
          points: num('几个知识点', true),
          progress: num('掌握度百分比', true),
          createdAt: str('什么时候建的', true),
          updatedAt: str('最后一次动的时间', true),
          active: { type: 'boolean', required: true, description: '是不是当前档案' },
        }),
        summary: { type: 'string', required: true, description: '一句话概览' },
      },
      (v) => v.summary,
    ),
    execute: async (args, exec) => {
      exec.signal.throwIfAborted()
      const action = String(args.action ?? 'list').trim()
      const multi = typeof store.list === 'function' && typeof store.create === 'function'
      if (!multi) {
        if (action === 'list') {
          return {
            supported: false,
            active: '',
            profiles: [],
            summary: '这个档案根只装得下一个学习目标，没有多档案可管。',
          }
        }
        throw new Error('这个档案根只装得下一个学习目标，不能新建 / 切换 / 删除档案')
      }
      let note = ''
      if (action === 'create') {
        if (typeof args.title !== 'string' || args.title.trim() === '') throw new Error('action=create 要带 title')
        const made = store.create({
          title: args.title.trim(),
          subject: args.subject,
          outcome: args.outcome,
          deadline: args.deadline,
          minutesPerDay: args.minutesPerDay,
        })
        note = `新建了「${made.title}」并切了过去。`
      } else if (action === 'select') {
        if (!args.id) throw new Error('action=select 要带 id')
        store.select(args.id)
        note = `切到 ${args.id} 了。`
      } else if (action === 'rename') {
        if (!args.id) throw new Error('action=rename 要带 id')
        const item = store.rename(args.id, { title: args.title })
        note = `改名叫「${item.title}」了。`
      } else if (action === 'remove') {
        if (!args.id) throw new Error('action=remove 要带 id')
        const gone = store.remove(args.id)
        note = `删掉 ${gone.id}（挪进回收站），还剩 ${gone.remaining} 个档案，现在用 ${gone.active}。`
      } else if (action !== 'list') {
        throw new Error(`action 只能是 list / create / select / rename / remove，收到「${action}」`)
      }
      const active = store.activeId()
      const profiles = store.list()
      return {
        supported: true,
        active,
        profiles,
        summary:
          note
          || `库里有 ${profiles.length} 个学习目标，现在用「${profiles.find((p) => p.active)?.title ?? active}」。`,
      }
    },
  }

  const files = {
    name: 'study_files',
    description:
      '看材料在硬盘上长什么样，以及怎么把它变成学生点得开的链接。'
      + '什么时候调：登记材料之前先列一遍目录（网课目录只给文件夹名，讲次得你自己解）；排任务写 open 之前先确认那份文件真在；'
      + '以及要回答「在哪儿点开」的时候——面板只放行登记过的材料范围内的路径，别给学生一个打不开的链接。'
      + 'action=list 列一个文件夹（带子项和大小），action=stat 看单个路径在不在、是文件还是文件夹，action=url 只把路径转成链接。'
      + 'url 是面板地址（/study/file?path=…），本地文件和文件夹都能开，文件夹会列成目录页；reachable 为 false 说明这份不在材料范围内，'
      + '得先用 study_material 把它登记（或登记它所在的文件夹）才点得开。'
      + '返回里 entries[].path 直接塞进 study_plan 的 open 就行。',
    parameters: {
      action: str('list 列目录 | stat 看一个路径 | url 转链接，必填', true),
      path: str('本地绝对路径，文件或文件夹都行', true),
      depth: num('list 时往下一层还是两层，默认 1，最多 3'),
    },
    output: out(
      {
        action: str('这次干的是哪件事', true),
        path: str('查的这个路径', true),
        exists: { type: 'boolean', required: true, description: '在不在' },
        kind: str('file 文件 / dir 文件夹 / missing 没有这个东西', true),
        size: num('文件字节数，文件夹或没有就是 0'),
        updatedAt: str('最后修改时间，拿不到就是空串', true),
        url: str('面板上能打开的地址，拿不到就是空串', true),
        reachable: { type: 'boolean', required: true, description: '这个地址在面板上点得开吗（在登记材料范围内才为 true）' },
        entries: listOf('list 时的子项', {
          name: str('名字', true),
          path: str('完整路径，可以直接当 study_plan 的 open', true),
          kind: str('file 文件 / dir 文件夹', true),
          size: num('文件字节数，文件夹是 0'),
        }),
        truncated: { type: 'boolean', required: true, description: '子项太多被截断了没有' },
        summary: { type: 'string', required: true, description: '一句话概览' },
      },
      (v) => v.summary,
    ),
    execute: async (args, exec) => {
      exec.signal.throwIfAborted()
      const action = String(args.action ?? '').trim()
      const target = String(args.path ?? '').trim()
      if (!target) throw new Error('path 必填，写本地绝对路径')
      if (!['list', 'stat', 'url'].includes(action)) throw new Error('action 只能是 list / stat / url')

      const profile = store.read('profile')
      const within = (p) => {
        const t = String(p ?? '')
        if (!t) return false
        for (const m of profile.materials ?? []) {
          const base = String(m.path ?? '').replace(/[\\/]+$/, '')
          if (!base) continue
          if (t === base || t.startsWith(base + sep) || t.startsWith(base + '/')) return true
        }
        return false
      }
      const urlOf = (p) => '/study/file?path=' + encodeURIComponent(p)
      const present = existsSync(target)
      const stat = present ? statSync(target) : null
      const isDir = Boolean(stat && stat.isDirectory())
      const kind = !present ? 'missing' : isDir ? 'dir' : 'file'
      const reachable = within(target)

      if (action === 'url') {
        return {
          action,
          path: target,
          exists: present,
          kind,
          size: stat && stat.isFile() ? stat.size : 0,
          updatedAt: stat ? new Date(stat.mtimeMs).toISOString() : '',
          url: present ? urlOf(target) : '',
          reachable,
          entries: [],
          truncated: false,
          summary: present
            ? `${reachable ? '' : '⚠ 不在登记材料范围内，面板打不开——先 study_material 登记它或它所在的文件夹。'}地址：${urlOf(target)}`
            : `找不到 ${target}`,
        }
      }

      if (!present) {
        return {
          action,
          path: target,
          exists: false,
          kind,
          size: 0,
          updatedAt: '',
          url: '',
          reachable: false,
          entries: [],
          truncated: false,
          summary: `找不到 ${target}——路径写错了，或者这份东西还没登记 / 还没下下来。`,
        }
      }

      if (action === 'stat' || !isDir) {
        return {
          action,
          path: target,
          exists: true,
          kind,
          size: stat.isFile() ? stat.size : 0,
          updatedAt: new Date(stat.mtimeMs).toISOString(),
          url: urlOf(target),
          reachable,
          entries: [],
          truncated: false,
          summary: `${target} 是${stat.isFile() ? '文件' : '文件夹'}，${new Date(stat.mtimeMs).toISOString().slice(0, 10)} 动过。`,
        }
      }

      const depth = Math.min(3, Math.max(1, Number.isFinite(args.depth) ? Math.floor(args.depth) : 1))
      const entries = []
      let truncated = false
      const walk = (dir, left) => {
        let names = []
        try {
          names = readdirSync(dir, { withFileTypes: true })
        } catch (err) {
          return
        }
        for (const entry of names) {
          if (entries.length >= 300) {
            truncated = true
            return
          }
          const full = join(dir, entry.name)
          let size = 0
          try {
            if (entry.isFile()) size = statSync(full).size
          } catch {
            /* 读不到就算了，别为一个大小的失败把整次列目录弄崩 */
          }
          entries.push({ name: entry.name, path: full, kind: entry.isDirectory() ? 'dir' : 'file', size })
          if (entry.isDirectory() && left > 1) walk(full, left - 1)
        }
      }
      walk(target, depth)
      const dirs = entries.filter((e) => e.kind === 'dir').length
      return {
        action,
        path: target,
        exists: true,
        kind: 'dir',
        size: 0,
        updatedAt: new Date(stat.mtimeMs).toISOString(),
        url: urlOf(target),
        reachable,
        entries,
        truncated,
        summary: `${target}：${entries.length} 项（${dirs} 个文件夹，${entries.length - dirs} 个文件）${truncated ? '，只列了前 300 项' : ''}。`,
      }
    },
  }

  const pages = {
    name: 'study_pages',
    description:
      '把一份 PDF 的某几页渲成编号 PNG，好让你用 read_image 真的看见那一页上写了什么。'
      + '什么时候调：讲义 / 教辅是**扫描件**的时候——pypdf 抽出来是空字符串，光看文件名只能知道「有哪几份、各多少页」，'
      + '给不出一句「这个知识点在第 6 页」。学生要的正是这一句：面板上「教辅里对应哪儿」能不能一键跳到那一页，'
      + '全靠 study_analysis 里那一章的 marks（知识点 → 页码），而 marks 只能靠把页面渲出来看过才写得出来。'
      + '怎么用：一次渲一小段（默认一次最多 40 页，超了会拒绝），拿到 pages[].file 之后逐张 read_image，'
      + '边看边记「这一页讲的是哪个知识点」，然后 study_analysis action=save 把 marks 写进对应章节。'
      + '渲过的页会缓存，同一个目录再渲不会重来。图片落在数据目录下的 scratch/pages/，不进工作区。'
      + '如果返回 ok=false，先看 error：缺 pymupdf 就 pip install pymupdf，页码越界就说明页数记错了。',
    parameters: {
      materialId: str('哪份材料。id 从 study_report 的 materials 里拿；给了它就不用手写 pdfPath'),
      pdfPath: str('或者直接写 PDF 的绝对路径（也可以是一份材料目录里某个文件的路径）'),
      from: num('从第几页开始，从 1 起，默认 1', true),
      to: num('渲到第几页（含），默认跟 from 一样，也就是只渲一页'),
      dpi: num(`清晰度，默认 ${DEFAULT_DPI}，60–220。太小看不清小字，太大读图变慢`),
    },
    output: out(
      {
        ok: { type: 'boolean', required: true, description: '渲成了没有' },
        error: str('没渲成的原因，成了就是空串', true),
        dir: str('这批 PNG 落在哪个目录', true),
        totalPages: num('这份 PDF 一共多少页，读不到就是 0', true),
        pdfPath: str('渲的是哪一份 PDF', true),
        pages: listOf('渲出来的页面，按页码排', {
          page: num('页码，从 1 起，跟 PDF 自己的页码一致', true),
          file: str('PNG 的绝对路径，直接拿去 read_image', true),
        }),
        summary: { type: 'string', required: true, description: '一句话概览' },
      },
      (v) => v.summary,
    ),
    execute: async (args, exec) => {
      exec.signal.throwIfAborted()
      const materialId = String(args.materialId ?? '').trim()
      const target = resolvePdf(store.read('profile').materials ?? [], materialId, args.pdfPath)

      const from = Math.max(1, Math.floor(Number(args.from) || 1))
      const to = Math.max(from, Math.floor(Number(args.to) || from))
      const outDir = pagesDirFor(opts.pagesRoot || opts.scratchDir || join(homedir(), '.dsh', 'study-coach', 'pages'), target)
      const result = renderPages(target, {
        outDir,
        from,
        to,
        dpi: Number(args.dpi) || DEFAULT_DPI,
        python: findPython(homedir()),
      })

      if (!result.ok) {
        return {
          ok: false,
          error: result.error,
          dir: outDir,
          totalPages: 0,
          pdfPath: target,
          pages: [],
          summary: `渲不出来：${result.error}`,
        }
      }
      const first = result.pages[0]
      const last = result.pages[result.pages.length - 1]
      return {
        ok: true,
        error: '',
        dir: result.dir,
        totalPages: result.total,
        pdfPath: target,
        pages: result.pages.map((p) => ({ page: p.page, file: p.file })),
        summary:
          `${target.split(/[\\/]/).pop()} 第 ${first.page}–${last.page} 页渲好了（共 ${result.total} 页），`
          + `图片在 ${result.dir}。现在逐张 read_image 看，边看边记页码，再用 study_analysis 的 marks 写下来`
          + `（label + page + pointId），做题页就能直接跳到那一页。`,
      }
    },
  }

  return [report, goal, map, record, mistakes, plan, material, analysis, book, archive, ability, library, files, pages, toolset, focus, todo, guide, inbox]
}

/**
 * 注册全部工具。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} store
 * @param {Function} defineTool 从 '@deepseek-ai/dsh-tools' 注入
 * @param {{ panelPath?: string }} [opts]
 * @returns {Array<() => void>} disposers
 */
/**
 * defineTool 的 schema 编译器要求**每个** object 节点都显式写 additionalProperties，
 * 漏一个就抛 UNSUPPORTED_SCHEMA（实测报过 schema.properties.goal.additionalProperties）。
 * 这里统一递归补上，省得每个工具手写。
 */
export function sealSchema(node) {
  if (node === null || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map(sealSchema)
  const out = { ...node }
  if (out.type === 'object' && out.additionalProperties === undefined) out.additionalProperties = false
  if (out.properties && typeof out.properties === 'object') {
    const props = {}
    for (const [key, value] of Object.entries(out.properties)) props[key] = sealSchema(value)
    out.properties = props
  }
  if (out.items !== undefined) out.items = sealSchema(out.items)
  return out
}

export function registerTools(ctx, store, defineTool, opts = {}) {
  return buildTools(store, opts).map((spec) => {
    const sealed =
      spec.output && spec.output.schema
        ? { ...spec, output: { ...spec.output, schema: sealSchema(spec.output.schema) } }
        : spec
    return ctx.tools.register(defineTool(sealed))
  })
}
