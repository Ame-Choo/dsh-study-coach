/* ══ 资料图谱的骨架：一份材料**自己**的目录（或文件夹）摊成三层 ═══════════
 *
 * 面板上的「资料图谱」不再拿知识地图当骨架，而是照这份材料自己的目录来：
 *
 *   大类 → 模块 → 最小单元，每一条都带链接。
 *
 * · PDF / 教辅：大类 = 目录 level 1（「专题一 …」），模块 = level 2（「1.1 集合」），
 *   最小单元 = 页级索引里落在这段里的每一段（讲解 / 例题 / 习题 / 答案），带页码 +
 *   PDF 页码链接 + 页图链接；目录里 level 3 有的话它当最小单元。目录压根没读过的，
 *   退成「一份材料 + 一段一段的页级索引」。
 * · 文件夹（网课、讲义夹）：有子目录就以子目录当模块，没有就切目录名——
 *   「02.模块一 基础知识 集合」→ 大类「模块一 基础知识」+ 模块「集合」，最小单元 =
 *   里面的每一个文件（视频 / 讲义 / 图片）；同名的合并成一个板块。
 *
 * 这里只负责「摊成什么形状」，不管怎么画——面板渲染，测试也钉这个形状。
 * ═════════════════════════════════════════════════════════════════════════ */

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pageFileOf } from './analysis.js'
import { openPath } from './urls.js'

/* 一份材料摊多细：超过这些数就截断，别让一个几百集的网盘目录把响应撑爆。 */
export const MAX_MODULES = 400
export const MAX_UNITS = 1200
export const MAX_PAGES_PER_UNIT = 12

const DIR_EXTS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.flv', '.ts', '.m4v', '.webm'])

/** 目录名里的开头编号：「02.」「3、」「第4讲 」都剥掉。 */
export function stripIndex(raw) {
  return String(raw ?? '')
    .trim()
    .replace(/^第?\s*\d+\s*[讲节.、,．:：)\-]\s*/, '')
    .trim()
}

/**
 * 目录名 → 大类 / 模块 两截。
 *   「02.模块一 基础知识 集合」→ { group: '模块一 基础知识', module: '集合' }
 *   「01.试听课」            → { group: '试听课', module: '' }
 * 切不出三截来就只给大类（模块留空，文件直接挂在大类下面）——**别硬凑**。
 */
export function splitFolderName(raw) {
  const name = stripIndex(raw)
  if (!name) return { group: '', module: '' }
  const parts = name.split(/[\s·]+/).filter(Boolean)
  if (parts.length < 3) return { group: name, module: '' }
  return { group: parts.slice(0, -1).join(' '), module: parts[parts.length - 1] }
}

/** 这个文件在面板上算哪一类（只看扩展名，认不出就是 other）。 */
export function fileKind(name) {
  const ext = String(name ?? '').toLowerCase().replace(/^.*(\.[^.]+)$/, '$1')
  if (DIR_EXTS.has(ext)) return 'video'
  if (ext === '.pdf') return 'book'
  if (ext === '.md' || ext === '.markdown' || ext === '.txt') return 'notes'
  if (ext === '.docx' || ext === '.doc' || ext === '.pptx' || ext === '.ppt') return 'notes'
  return 'other'
}

/** 默认的目录读法。测试里塞自己的 list 就行，不必造真目录。 */
export function listDir(dir) {
  let entries = []
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((e) => !e.name.startsWith('.'))
    .map((e) => ({ name: e.name, dir: e.isDirectory(), path: join(dir, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
}

function unitFromFolder(entry) {
  return {
    title: entry.name,
    kind: entry.dir ? 'folder' : fileKind(entry.name),
    pointId: '',
    from: 0,
    to: 0,
    url: openPath(entry.path),
    note: '',
    pages: [],
  }
}

/* ── 文件夹那一半 ───────────────────────────────────────────────────────── */

/**
 * 一个文件夹 → 三层。有子目录就一层套一层（最多再往里走一层），
 * 没有子目录就拿目录名切两截（见 `splitFolderName`），同名的大类合并。
 */
export function folderTree(root, { list = listDir } = {}) {
  const groups = new Map()
  let truncated = false
  const groupOf = (title) => {
    const key = title || '（根目录）'
    if (!groups.has(key)) groups.set(key, { title: key, modules: [], units: [] })
    return groups.get(key)
  }
  const moduleOf = (group, title) => {
    if (!title) return null
    let mod = group.modules.find((m) => m.title === title)
    if (!mod) {
      mod = { title, units: [] }
      group.modules.push(mod)
    }
    return mod
  }
  const put = (group, module, units) => {
    for (const u of units) {
      if (group.modules.reduce((n, m) => n + m.units.length, group.units.length) >= MAX_UNITS) {
        truncated = true
        return
      }
      if (module) module.units.push(u)
      else group.units.push(u)
    }
  }

  let top = []
  try {
    top = list(root)
  } catch {
    top = []
  }

  for (const entry of top) {
    if (!entry.dir) {
      put(groupOf('（根目录）'), null, [unitFromFolder(entry)])
      continue
    }
    let kids = []
    try {
      kids = list(entry.path)
    } catch {
      kids = []
    }
    const subdirs = kids.filter((k) => k.dir)
    if (subdirs.length) {
      const group = groupOf(stripIndex(entry.name))
      const filesHere = kids.filter((k) => !k.dir)
      if (filesHere.length) put(group, null, filesHere.map(unitFromFolder))
      for (const sub of subdirs) {
        let inner = []
        try {
          inner = list(sub.path)
        } catch {
          inner = []
        }
        const own = inner.filter((k) => !k.dir)
        const deeper = inner.filter((k) => k.dir)
        const units = [...own, ...deeper].map(unitFromFolder)
        put(group, moduleOf(group, stripIndex(sub.name)), units)
        for (const d of deeper) {
          let leaf = []
          try {
            leaf = list(d.path)
          } catch {
            leaf = []
          }
          if (leaf.length) put(group, moduleOf(group, `${stripIndex(sub.name)} / ${stripIndex(d.name)}`), leaf.map(unitFromFolder))
        }
      }
      continue
    }
    const { group: gname, module: mname } = splitFolderName(entry.name)
    const group = groupOf(gname)
    put(group, moduleOf(group, mname), kids.filter((k) => !k.dir).map(unitFromFolder))
  }

  const out = [...groups.values()]
    .map((g) => ({ ...g, modules: g.modules.filter((m) => m.units.length) }))
    .filter((g) => g.modules.length || g.units.length)
  for (const g of out) {
    g.count = g.units.length + g.modules.reduce((n, m) => n + m.units.length, 0)
  }
  return { basis: 'folder', groups: out, loose: [], truncated }
}

/* ── 书那一半 ───────────────────────────────────────────────────────────── */

/** 页级区间 → 一条最小单元。页码、PDF 链接、页图链接都在这儿配齐。 */
function bookUnit(span, { path, pageDir, moduleTitle }) {
  const from = Number(span.from) || 0
  const to = Math.max(from, Number(span.to) || from)
  const pages = []
  for (let n = from; n <= to && pages.length < MAX_PAGES_PER_UNIT; n += 1) {
    const file = pageFileOf(pageDir, n)
    pages.push({ page: n, url: file && existsSync(file) ? '/study/page?path=' + encodeURIComponent(file) : '' })
  }
  const pointId = String(span.pointId || '')
  return {
    title: pointId || (moduleTitle || String(span.kind || '其他')),
    kind: String(span.kind || '其他'),
    pointId,
    from,
    to,
    url: openPath(path, from),
    note: String(span.note || ''),
    pages,
  }
}

/**
 * 一本 PDF → 三层。
 * `spans` 是页级索引压出来的区间（lib/analysis.js 的 `spansOf`）。
 */
export function bookTree({ material, shelf, spans = [], total = 0 }) {
  const path = String(material.path || '')
  const pageDir = shelf && shelf.pageDir ? String(shelf.pageDir) : ''
  const rows = (Array.isArray(spans) ? spans : []).map((s) => ({
    from: Number(s.from) || 0,
    to: Math.max(Number(s.from) || 0, Number(s.to) || 0),
    pointId: String(s.pointId || ''),
    kind: String(s.kind || '其他'),
    note: String(s.note || ''),
  }))
  const toc = (Array.isArray(shelf && shelf.toc) ? shelf.toc : [])
    .map((t) => ({ level: Number(t.level) || 1, title: String(t.title || ''), page: Number(String(t.page || '').replace(/\D/g, '')) || 0, pointId: String(t.pointId || '') }))
    .filter((t) => t.title)

  const lastPage = Number(total) || (rows.length ? Math.max(...rows.map((r) => r.to)) : 0) || (toc.length ? Math.max(...toc.map((t) => t.page)) : 0)

  if (!toc.length) {
    // 目录还没读：最少也给一层「这份材料 + 一段一段的页级索引」。
    const units = rows.map((s) => bookUnit(s, { path, pageDir, moduleTitle: '' }))
    const groups = [{
      title: String(material.title || '这份材料'),
      modules: units.length ? [{ title: '全部', units }] : [],
      units: [],
      count: units.length,
    }]
    return { basis: rows.length ? 'spans' : 'none', groups, loose: [], truncated: false }
  }

  const groups = []
  const top = toc.filter((t) => t.level <= 1)
  // 目录里没有一级条目（只写了节）：整体当一个板块，别让整页空着。
  const shells = top.length ? top : [{ level: 1, title: String(material.title || '这份材料'), page: 0, pointId: '' }]

  for (let i = 0; i < shells.length; i += 1) {
    const shell = shells[i]
    const nextShell = shells.slice(i + 1).find((t) => t.page > shell.page)
    const shellEnd = nextShell ? nextShell.page - 1 : lastPage
    const shellStart = shell.page || (toc[0] && toc[0].page) || 1
    const inner = toc.filter((t) => t.level >= 2 && t.page >= shellStart && t.page <= shellEnd)
    const modules = []
    const mid = inner.filter((t) => t.level <= 2)
    const list = mid.length ? mid : [{ level: 2, title: shell.title, page: shellStart, pointId: shell.pointId }]

    for (let j = 0; j < list.length; j += 1) {
      const item = list[j]
      const next = list.slice(j + 1).find((t) => t.page > item.page)
      const from = item.page || shellStart
      const to = next ? next.page - 1 : shellEnd
      const kids = toc.filter((t) => t.level >= 3 && t.page >= from && t.page <= to)
      let units = []
      if (kids.length) {
        for (let k = 0; k < kids.length; k += 1) {
          const kid = kids[k]
          const kidNext = kids.slice(k + 1).find((t) => t.page > kid.page)
          units.push(bookUnit(
            { from: kid.page, to: kidNext ? kidNext.page - 1 : to, pointId: kid.pointId, kind: '讲解', note: '' },
            { path, pageDir, moduleTitle: item.title },
          ))
        }
      } else {
        const inside = rows
          .filter((s) => s.to >= from && s.from <= to)
          .map((s) => ({ ...s, from: Math.max(s.from, from), to: Math.min(s.to, to) }))
        units = inside.map((s) => bookUnit(s, { path, pageDir, moduleTitle: item.title }))
      }
      modules.push({
        title: item.title,
        page: from,
        to,
        pointId: item.pointId,
        units: units.length ? units : [bookUnit({ from, to, pointId: item.pointId, kind: '讲解', note: '' }, { path, pageDir, moduleTitle: item.title })],
      })
    }

    const insideAny = (s) => modules.some((m) => s.to >= m.page && s.from <= m.to)
    const looseHere = rows.filter((s) => s.to >= shellStart && s.from <= shellEnd && !insideAny(s))
    groups.push({
      title: shell.title,
      page: shellStart,
      to: shellEnd,
      url: openPath(path, shellStart),
      pointId: shell.pointId,
      modules,
      units: [],
      count: modules.reduce((n, m) => n + m.units.length, 0),
    })
  }

  // 谁都没归到的页（封面、目录、答案…）：单开一块，免得看起来像丢了。
  // 标题退回「内容类型」而不是写「其余」——行里写着「目录 / 答案」才有信息量。
  const allCovered = (s) => groups.some((g) => (g.modules || []).some((m) => s.to >= m.page && s.from <= m.to))
  const looseSpans = rows.filter((s) => !allCovered(s))
  const loose = looseSpans.map((s) => bookUnit(s, { path, pageDir, moduleTitle: '' }))

  return { basis: 'toc', groups, loose, truncated: false }
}

/* ── 入口 ───────────────────────────────────────────────────────────────── */

/** 这份材料的路径是文件夹吗。 */
export function isDirPath(target) {
  try {
    return statSync(String(target || '')).isDirectory()
  } catch {
    return false
  }
}

/**
 * 一份材料 → 资料图谱的形状。
 *
 * @param {{ material: object, shelf: object, spans?: object[], list?: function }} input
 * @returns {{ basis: string, groups: object[], loose: object[], truncated: boolean }}
 */
export function materialTree({ material, shelf, spans = [], list } = {}) {
  const path = String((material && material.path) || '')
  const total = Number(shelf && shelf.total) || 0
  if (path && isDirPath(path)) return folderTree(path, { list })
  return bookTree({ material: material || {}, shelf: shelf || {}, spans, total })
}
