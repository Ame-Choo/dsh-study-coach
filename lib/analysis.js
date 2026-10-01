/**
 * dsh-study-coach — 材料分析 + 页级索引。
 *
 * 通读一份教辅之后写下来的结论（这份材料怎么用、每章讲什么、哪几页讲哪个知识点），
 * 加上给 PDF 拆页那条链用的页级索引。两者是一件事的两半：结论给人看，
 * 逐页归类给「一键跳到第 N 页」用，都存在 analysis.json 里。
 *
 * 纯函数，只读不写盘；掌握度那一头在 map.js 里。
 */
import { join } from 'node:path'
import { COVERAGE, DIFFICULTY, PAGE_KINDS, nowIso } from './schema.js'

/* ── 材料分析（通读教辅之后写下来的东西） ────────────────────────────────── */

/** 取一份材料的分析。没分析过就返回空壳，不抛。 */
export function analysisOf(analysis, materialId) {
  const by = analysis && analysis.byMaterial ? analysis.byMaterial : {}
  const a = by[materialId]
  if (!a || typeof a !== 'object') {
    return {
      materialId: '',
      coverage: '只翻目录',
      role: '',
      pairing: '',
      notes: '',
      chapters: [],
      analyzedAt: null,
      /* 下面这几项是「拆书」那条链的产物：整本拆成页图、读出目录、每一页归到哪个单元。 */
      pageCount: 0,
      pageDir: '',
      dpi: 0,
      toc: [],
      pages: [],
    }
  }
  const pageDir = String(a.pageDir ?? '')
  return {
    materialId: a.materialId ?? materialId,
    coverage: COVERAGE.includes(a.coverage) ? a.coverage : '只翻目录',
    role: String(a.role ?? ''),
    pairing: String(a.pairing ?? ''),
    notes: String(a.notes ?? ''),
    chapters: Array.isArray(a.chapters) ? a.chapters : [],
    analyzedAt: a.analyzedAt ?? null,
    pageCount: Number(a.pageCount) > 0 ? Number(a.pageCount) : 0,
    pageDir,
    dpi: Number(a.dpi) > 0 ? Number(a.dpi) : 0,
    toc: Array.isArray(a.toc) ? a.toc : [],
    // 每行都带上「这一页的图在哪」，省得下游各自拿 pageDir 拼一遍文件路径。
    pages: (Array.isArray(a.pages) ? a.pages : []).map((row) => ({ ...row, file: pageFileOf(pageDir, row && row.page) })),
  }
}

/**
 * 知识点 / 题型 → 页码。这一条是「一键跳到那一页」的全部依据。
 * 形状 { label, page, pointId }：label 是人看的（「这一页讲什么」），
 * pointId 是机器对的（M1.4），page 是这一份 PDF 自己的页码。
 */
export function marksOf(incoming, previous) {
  const rows = Array.isArray(incoming) && incoming.length ? incoming : previous
  if (!Array.isArray(rows)) return []
  const out = []
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue
    const label = String(raw.label ?? '').trim()
    const page = String(raw.page ?? '').replace(/[^0-9]/g, '')
    if (!label && !page) continue
    if (!label || !page) continue
    out.push({
      label,
      page,
      pointId: String(raw.pointId ?? '').trim(),
    })
  }
  return out
}

/* ── 页级索引：整本书的每一页归到哪个单元 ───────────────────────────────── */

/** 页图目录里第 N 页叫什么。文件名带页码，就是 `p0007.png`。 */
export function pageFileOf(pageDir, page) {
  const n = Number(String(page ?? '').replace(/[^0-9]/g, ''))
  if (!pageDir || !Number.isFinite(n) || n < 1) return ''
  return join(String(pageDir), 'p' + String(n).padStart(4, '0') + '.png')
}

/** 书目条目规整。level 1 是章、2 是节，page 是这一份 PDF 的物理页。 */
export function tocOf(rows) {
  const out = []
  for (const raw of Array.isArray(rows) ? rows : []) {
    if (!raw || typeof raw !== 'object') continue
    const title = String(raw.title ?? '').trim()
    const page = String(raw.page ?? '').replace(/[^0-9]/g, '')
    if (!title) continue
    const level = Number(String(raw.level ?? '1').replace(/[^0-9]/g, '')) || 1
    out.push({ level, title, page, pointId: String(raw.pointId ?? '').trim() })
  }
  return out
}

/** 逐页行规整：`{page, pointId, kind, note}`，分不清的归「其他」。 */
export function pageRowsOf(rows) {
  const seen = new Map()
  for (const raw of Array.isArray(rows) ? rows : []) {
    if (!raw || typeof raw !== 'object') continue
    const n = Number(String(raw.page ?? '').replace(/[^0-9]/g, ''))
    if (!Number.isFinite(n) || n < 1) continue
    seen.set(String(n), {
      page: String(n),
      pointId: String(raw.pointId ?? '').trim(),
      kind: PAGE_KINDS.includes(raw.kind) ? raw.kind : '其他',
      note: String(raw.note ?? '').trim(),
    })
  }
  return [...seen.values()].sort((a, b) => Number(a.page) - Number(b.page))
}

/**
 * 逐页压成区间。盘上存的是「第几页 → 哪个单元」的完整表，给人看、给面板画条带的是区间——
 * 一本 300 页的书，这两样说的是同一件事，逐页表能查、区间能读。
 */
export function spansOf(rows) {
  const sorted = pageRowsOf(rows)
  const out = []
  for (const row of sorted) {
    const n = Number(row.page)
    const last = out[out.length - 1]
    if (last && last.pointId === row.pointId && last.kind === row.kind && Number(last.to) + 1 === n) {
      last.to = row.page
      last.count += 1
      if (!last.note && row.note) last.note = row.note
      continue
    }
    out.push({ from: row.page, to: row.page, pointId: row.pointId, kind: row.kind, note: row.note, count: 1 })
  }
  return out
}

/**
 * 区间摊回逐页 —— 这是「每一页都归类」和「agent 写起来不吐血」两头都要的关键：
 * 工具入参让人写 `{from:12,to:15,pointId:'M1.4',kind:'例题'}`，盘上落成第 12/13/14/15 四行。
 * 一行里给了 pages 就按 pages 逐页来（单页、跳页用这种），否则按 from/to 铺开。
 * 覆盖不到的页返回在 result.gaps 里，好让 agent 知道还剩哪儿没归。
 */
export function expandSpans(spans, { pageCount = 0 } = {}) {
  const rows = new Map()
  for (const raw of Array.isArray(spans) ? spans : []) {
    if (!raw || typeof raw !== 'object') continue
    const kind = PAGE_KINDS.includes(raw.kind) ? raw.kind : '其他'
    const pointId = String(raw.pointId ?? '').trim()
    const note = String(raw.note ?? '').trim()
    let list = Array.isArray(raw.pages) && raw.pages.length
      ? raw.pages.map((p) => Number(String(p).replace(/[^0-9]/g, '')))
      : null
    if (!list) {
      const from = Number(String(raw.from ?? raw.page ?? '').replace(/[^0-9]/g, ''))
      const to = Number(String(raw.to ?? '').replace(/[^0-9]/g, '')) || from
      if (!Number.isFinite(from) || from < 1) continue
      list = []
      for (let n = from; n <= Math.max(from, to); n += 1) list.push(n)
    }
    for (const n of list) {
      if (!Number.isFinite(n) || n < 1) continue
      rows.set(String(n), { page: String(n), pointId, kind, note })
    }
  }
  const out = [...rows.values()].sort((a, b) => Number(a.page) - Number(b.page))
  const gaps = []
  if (pageCount > 0) {
    for (let n = 1; n <= pageCount; n += 1) if (!rows.has(String(n))) gaps.push(n)
  }
  return { rows: out, gaps }
}

/** 逐页表里超出这本书页数的行，挑出来让工具报错，别悄悄留下不存在的页。 */
export function outOfRange(rows, pageCount) {
  if (!(pageCount > 0)) return []
  return pageRowsOf(rows).filter((r) => Number(r.page) > pageCount)
}

/**
 * 一个单元在各份教辅里对应哪几页。做题页的「教辅 A / 教辅 B，你想做哪本」、
 * 排任务时往 task 上挂 `{materialId, from, to}`，都从这儿取。
 */
export function pagesForPoint(analysis, materials, pointId) {
  const want = String(pointId ?? '').trim()
  if (!want) return []
  const out = []
  for (const mat of Array.isArray(materials) ? materials : []) {
    if (!mat) continue
    const a = analysisOf(analysis, String(mat.id))
    const rows = a.pages.filter((r) => r.pointId === want)
    if (!rows.length) continue
    for (const span of spansOf(rows)) {
      out.push({
        materialId: String(mat.id),
        material: String(mat.title || ''),
        kind: String(mat.kind || ''),
        path: String(mat.path || ''),
        pageDir: a.pageDir,
        from: span.from,
        to: span.to,
        count: span.count,
        pageKind: span.kind,
        note: span.note,
      })
    }
  }
  // 顺序就是材料登记的顺序、每份材料内部按页码排——面板要按「教辅 A / 教辅 B」成组显示，
  // 全局按页数重排会把同一本书的几段打散。
  return out
}

/**
 * 写一份材料的分析。整份的元信息（role / pairing / notes / coverage）覆盖，
 * 章节按 no 合并——所以可以分批喂，也可以只改其中一章。
 */
export function upsertAnalysis(analysis, materialId, patch) {
  if (!materialId) throw new Error('materialId required')
  if (!analysis.byMaterial || typeof analysis.byMaterial !== 'object') analysis.byMaterial = {}
  const prev = analysisOf(analysis, materialId)
  const num = (value, fallback) => (Number(value) > 0 ? Number(value) : fallback)
  const next = {
    materialId,
    coverage: COVERAGE.includes(patch.coverage) ? patch.coverage : prev.coverage,
    role: typeof patch.role === 'string' ? patch.role.trim() : prev.role,
    pairing: typeof patch.pairing === 'string' ? patch.pairing.trim() : prev.pairing,
    notes: typeof patch.notes === 'string' ? patch.notes.trim() : prev.notes,
    chapters: prev.chapters.slice(),
    analyzedAt: nowIso(),
    pageCount: num(patch.pageCount, prev.pageCount),
    pageDir: typeof patch.pageDir === 'string' && patch.pageDir.trim() ? patch.pageDir.trim() : prev.pageDir,
    dpi: num(patch.dpi, prev.dpi),
    // 目录是整本书自己的骨架，一次读完一次写；分批喂一半没有意义，所以给了就整份换。
    toc: Array.isArray(patch.toc) ? tocOf(patch.toc) : prev.toc.slice(),
    pages: prev.pages.slice(),
  }
  const incoming = Array.isArray(patch.chapters) ? patch.chapters : []
  for (const raw of incoming) {
    if (!raw || typeof raw !== 'object') continue
    const no = String(raw.no ?? '').trim()
    if (!no) continue
    // 字段级合并：这一批没写的字段留着上一批的。想清空某一项就别指望传空串——
    // 分批读的场合下「忘了写」比「想清空」常见得多，宁可保守。
    const idx = next.chapters.findIndex((c) => String(c?.no ?? '') === no)
    const prevChapter = idx >= 0 ? next.chapters[idx] : null
    const keep = (value, fallback) =>
      typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
    const chapter = {
      no,
      title: keep(raw.title, prevChapter?.title ?? ''),
      pages: keep(raw.pages, prevChapter?.pages ?? ''),
      topics: keep(raw.topics, prevChapter?.topics ?? ''),
      examples: keep(raw.examples, prevChapter?.examples ?? ''),
      exercises: keep(raw.exercises, prevChapter?.exercises ?? ''),
      difficulty: DIFFICULTY.includes(raw.difficulty) ? raw.difficulty : (prevChapter?.difficulty ?? '中等'),
      role: keep(raw.role, prevChapter?.role ?? ''),
      // 讲义是一章一份 PDF 的，章节条目得自己记住是哪一份，否则做题页只能开到上一级目录。
      file: keep(raw.file, prevChapter?.file ?? ''),
      // 光有整章页码给不出「这个知识点在第 6 页」，那一句得靠逐页看图才写得出来。
      marks: marksOf(raw.marks, prevChapter?.marks),
    }
    if (idx >= 0) next.chapters[idx] = chapter
    else next.chapters.push(chapter)
  }

  /*
   * 页级索引按「页」合并，新写的盖旧的——这样 agent 可以一章一章地归，
   * 也可以回头把某一页改判到别的单元。想整本重来就传 resetPages。
   */
  if (patch.resetPages === true) next.pages = []
  const incomingSpans = [
    ...(Array.isArray(patch.spans) ? patch.spans : []),
    ...(Array.isArray(patch.pages) ? patch.pages : []),
  ]
  if (incomingSpans.length) {
    const byPage = new Map(next.pages.map((r) => [String(r.page), r]))
    for (const row of expandSpans(incomingSpans, { pageCount: next.pageCount }).rows) byPage.set(row.page, row)
    next.pages = [...byPage.values()].sort((a, b) => Number(a.page) - Number(b.page))
  }

  analysis.byMaterial[materialId] = next
  return next
}

/** 材料删了，它的分析也一起走，省得以后重新登记时撞上旧结论。 */
export function dropAnalysis(analysis, materialId) {
  if (analysis && analysis.byMaterial) delete analysis.byMaterial[materialId]
  return analysis
}
