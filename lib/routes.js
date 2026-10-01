/**
 * dsh-study-coach — API 路由。
 *
 * 故意不碰 ctx：输入是 { method, pathname, query, body }，输出是 { code, body }，
 * 所以能脱开 DSH 直接跑测试。index.js 只负责把 HTTP 请求翻译成这个形状。
 */
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STAGES, FILES, MATERIAL_KINDS } from './store.js'
import {
  pointState,
  gateStage,
  recordEvidence,
  masterySummary,
  upsertModule,
  confirmMap,
  listPointIds,
  archiveFor,
  abilityReport,
  setAbility,
  taskView,
  mistakesOf,
} from './map.js'
import { analysisOf, spansOf, pagesForPoint, pageFileOf } from './analysis.js'
import { addInboxItem, unreadInbox } from './notice.js'
import { buildReview, reviewSvg } from './review.js'
import { pagesRootOf } from './paths.js'
import { DEFAULT_DPI, pagesDirFor, readManifest } from './pages.js'
import { settleFocus, focusStatus, startFocus, stopFocus, addTodo, patchTodo, removeTodo, listTodos } from './toolbox.js'
import { memoryBody, addCard, reviewCard, patchCard, removeCard, listCards } from './memory.js'
import { addFact, patchFact, removeFact, listFacts, studentBody, renderFact } from './student.js'

const HERE_DIR = dirname(fileURLToPath(import.meta.url))

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function today() {
  return new Date().toISOString().slice(0, 10)
}

/** 工具栏目那一页要的全部数据。 */
function toolboxBody(box) {
  return { ok: true, focus: focusStatus(box.focus), todos: listTodos(box, { limit: 200 }) }
}

function todoBody(box) {
  return { todos: listTodos(box, { limit: 200 }) }
}

/** 记忆卡那一页要的全部数据：总览 + 筛出来的那一档 + 现在该背的那几张。 */
function memoryView(memory, options = {}) {
  const body = memoryBody(memory)
  const listed = listCards(memory, {
    status: String(options.status || ''),
    kind: String(options.kind || ''),
    pointId: String(options.pointId || ''),
    limit: Number(options.limit) || 200,
  })
  return {
    ok: true,
    stats: body.stats,
    soon: body.soon,
    dueTotal: body.dueTotal,
    dueItems: body.dueItems,
    items: listed.items,
    total: listed.total,
  }
}

function bad(message, code = 400) {
  return { code, body: { ok: false, error: { code: 'bad-request', message } } }
}

/** 只收白名单字段，别的东西一律丢。 */
function pick(source, keys) {
  const out = {}
  if (!source || typeof source !== 'object') return out
  for (const k of keys) if (source[k] !== undefined) out[k] = source[k]
  return out
}

/** 在地图里按 id 找知识点，连它所在的模块一起端出来。 */
function findPoint(map, pointId) {
  for (const mod of map && Array.isArray(map.modules) ? map.modules : []) {
    if (!mod) continue
    for (const p of Array.isArray(mod.points) ? mod.points : []) {
      if (p && String(p.id) === pointId) return { module: mod, point: p }
    }
  }
  return null
}

/** 从「1.1 某某.pdf」里抠出章号 1.1；抠不到就是空串。 */
function chapterNoOf(text) {
  const hit = String(text ?? '').match(/\d{1,2}(?:[.-]\d{1,2})+/)
  return hit ? hit[0].replace('-', '.') : ''
}

function escapeRe(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 章号在不在这段话里。必须整段相等，不能拿子串比——
 * 「讲义 11.1」里当然含 1.1，那不算这一节。
 */
function mentionsNo(text, no) {
  const needle = String(no || '').trim()
  if (!needle) return false
  return new RegExp('(^|[^0-9.])' + escapeRe(needle) + '(?![0-9])').test(String(text ?? ''))
}

function baseName(target) {
  const parts = String(target ?? '').split(/[\\/]/)
  return parts[parts.length - 1] || ''
}

function chapterRow(mat, ch) {
  return {
    materialId: String(mat.id),
    material: String(mat.title || ''),
    // 面板要按类别打标签：AI 出的卷子跟教辅混在同一张「材料对应位置」里，
    // 不写清楚类别，学生会以为那也是一本教辅。
    kind: String(mat.kind || ''),
    no: String(ch.no || ''),
    title: String(ch.title || ''),
    pages: String(ch.pages || ''),
    topics: String(ch.topics || ''),
    examples: String(ch.examples || ''),
    exercises: String(ch.exercises || ''),
    difficulty: String(ch.difficulty || '中等'),
    role: String(ch.role || ''),
    file: String(ch.file || ''),
    marks: (Array.isArray(ch.marks) ? ch.marks : []).map((m) => ({
      label: String(m?.label || ''),
      page: String(m?.page || ''),
      pointId: String(m?.pointId || ''),
    })),
  }
}

/**
 * 这一页讲的是不是就是这个单元。优先认 pointId（agent 亲手绑的最准），
 * 没有就退回标题互含——「第三组 参数讨论」对得上「参数讨论与反求范围」这种。
 * 要求至少 3 个字，免得「例题」这种短标签把整章都算到同一个单元头上。
 */
function marksFor(marks, point) {
  const id = String(point?.id || '')
  const title = String(point?.title || '')
  return (Array.isArray(marks) ? marks : []).filter((m) => {
    if (m.pointId) return m.pointId === id
    const label = String(m.label || '')
    if (label.length < 3) return false
    return title.includes(label) || label.includes(title)
  })
}

/**
 * 这一节该翻教辅的哪儿。
 *
 * 分析过材料就按章号/标题去对；一个都对不上，就把这一节自己挂的那份讲义摆出来——
 * 空着等于告诉学生「没有」，而实际上他手边就是有。
 */
function chaptersFor(analysis, profile, point) {
  const rows = []
  for (const mat of Array.isArray(profile.materials) ? profile.materials : []) {
    if (!mat) continue
    for (const ch of analysisOf(analysis, String(mat.id)).chapters) rows.push(chapterRow(mat, ch))
  }

  const src = String(point.source || '')
  const own = String(point.practice || '')
  const ownNo = chapterNoOf(own) || chapterNoOf(src)

  /**
   * 章节条目自己带 file 最好；没带就让这一节的 practice 顶上——
   * 讲义是一章一份 PDF，判据就是章号对得上，别因为 old 数据里少个字段就退回去开目录。
   */
  const withFile = (list) =>
    list.map((c) => (c.file || !own || (ownNo && c.no && c.no !== ownNo) ? c : { ...c, file: own }))

  const hit = rows.filter((c) => (c.title && src.includes(c.title)) || mentionsNo(src, c.no))
  if (hit.length) return withFile(hit)

  // 章号对不上可能只是写法不同（1.1 与 1.1 某某），松一点再试一次
  if (ownNo) {
    const loose = rows.filter((c) => mentionsNo(c.no, ownNo) || mentionsNo(ownNo, c.no))
    if (loose.length) return withFile(loose)
  }

  if (!own) return rows
  return [
    {
      materialId: '',
      material: '这一节的讲义',
      no: chapterNoOf(own),
      title: baseName(own).replace(/\.pdf$/i, ''),
      pages: '',
      topics: String(point.source || ''),
      examples: '',
      exercises: '',
      difficulty: '中等',
      role: '这一节直接对应的讲义',
      file: own,
    },
  ]
}

export function createRouter(store, deps = {}) {
  const routes = []
  const on = (method, pattern, fn) => routes.push({ method, pattern, fn })
  /** 面板 → 对话 的投递通道。没有也能跑，只是话得先存着。 */
  const bridge = deps.bridge || null
  const push = (text, options) => (bridge ? bridge.send(text, options) : Promise.resolve({ ok: false, error: '没有投递通道' }))

  /* ── 读 ───────────────────────────────────────────────────────────────── */

  /**
   * 面板要一眼看出「哪份材料还只到章、没拆到页」——拆到页才有一键跳页码。
   * 所以状态里给每份材料带上 chapterCount / pagedCount，别让面板自己去拼。
   */
  on('GET', /^\/study\/api\/state$/, () => {
    const state = store.snapshot()
    const materials = (Array.isArray(state.profile.materials) ? state.profile.materials : []).map((m) => {
      const a = analysisOf(state.analysis, String(m.id))
      return {
        ...m,
        analyzed: a.chapters.length > 0,
        chapterCount: a.chapters.length,
        pagedCount: a.chapters.filter((c) => Array.isArray(c.marks) && c.marks.length).length,
        coverage: a.coverage,
      }
    })
    return { code: 200, body: { ok: true, state: { ...state, profile: { ...state.profile, materials } } } }
  })

  on('GET', /^\/study\/api\/summary$/, () => {
    const map = store.read('map')
    const mastery = store.read('mastery')
    return { code: 200, body: { ok: true, summary: masterySummary(map, mastery), stage: STAGES } }
  })

  /* ── 档案 ─────────────────────────────────────────────────────────────── */

  on('POST', /^\/study\/api\/goal$/, ({ body }) => {
    const goal = pick(body, ['subject', 'outcome', 'deadline', 'minutesPerDay'])
    if (typeof goal.minutesPerDay === 'string') goal.minutesPerDay = Number(goal.minutesPerDay) || 0
    if (goal.minutesPerDay !== undefined && (typeof goal.minutesPerDay !== 'number' || goal.minutesPerDay < 0)) {
      return bad('minutesPerDay must be a non-negative number')
    }
    if (goal.deadline && !DATE_RE.test(String(goal.deadline))) return bad('deadline must be YYYY-MM-DD')
    const profile = store.update('profile', (p) => {
      p.goal = { ...(p.goal || {}), ...goal }
      return p
    })
    return { code: 200, body: { ok: true, goal: profile.goal } }
  })

  on('POST', /^\/study\/api\/materials$/, ({ body }) => {
    const item = pick(body, ['kind', 'title', 'path', 'note'])
    if (!item.title) return bad('title required')
    const kind = item.kind ? String(item.kind) : 'other'
    if (!MATERIAL_KINDS.includes(kind)) {
      return bad(`材料类别只能是 ${MATERIAL_KINDS.join(' / ')}，收到「${kind}」`)
    }
    const material = {
      id: 'mat-' + Date.now().toString(36),
      kind,
      title: String(item.title),
      path: item.path ? String(item.path) : '',
      note: item.note ? String(item.note) : '',
      addedAt: new Date().toISOString(),
    }
    const profile = store.update('profile', (p) => {
      if (!Array.isArray(p.materials)) p.materials = []
      p.materials.push(material)
      return p
    })
    return { code: 200, body: { ok: true, material, materials: profile.materials } }
  })

  on('POST', /^\/study\/api\/materials\/remove$/, ({ body }) => {
    const id = body && body.id
    if (!id) return bad('id required')
    const profile = store.update('profile', (p) => {
      p.materials = (Array.isArray(p.materials) ? p.materials : []).filter((m) => m && m.id !== id)
      return p
    })
    return { code: 200, body: { ok: true, materials: profile.materials } }
  })

  /* ── 书架：登记、上传、拆图、翻页 ─────────────────────────────────────── */

  /**
   * 拆好的书落哪儿。deps.pagesRoot 优先，没给就按 store.root 推——
   * 两条路都走 lib/paths.js 的同一个函数，测试里直接 new Library(tmp) 也跑得通。
   */
  const pagesRoot = pagesRootOf(store, deps.pagesRoot)

  /**
   * 一份材料现在拆到哪一步了。清单文件是唯一真源：拆图在别的进程里跑，
   * 进度只能靠它回传（rendered 每批更新一次，rendering 落回 false 才算拆完）。
   */
  function shelfOf(material, analysis) {
    const a = analysis || analysisOf(store.read('analysis'), String(material.id))
    // 书放在哪只认目录算法——analysis 里那个 pageDir 只是它的缓存，真源是 pagesDirFor。
    const dir = material.path ? pagesDirFor(pagesRoot, material.path) : a.pageDir
    const manifest = dir ? readManifest(dir) : null
    const rendered = manifest && Number(manifest.rendered) > 0
      ? Number(manifest.rendered)
      : a.pages.filter((p) => p.file && existsSync(p.file)).length
    // 清单是 pymupdf 真打开 PDF 数出来的，比 analysis 里 agent 手写的页数可信。
    const total = Number(manifest && manifest.total) || Number(a.pageCount) || 0
    // 进程被 kill 掉时 rendering 会永远停在 true，所以超过十分钟没动过就当它没在跑了。
    const stale = !manifest || Date.now() - Date.parse(String(manifest.at || 0)) > 10 * 60 * 1000
    return {
      materialId: String(material.id),
      title: String(material.title || ''),
      kind: String(material.kind || 'other'),
      path: String(material.path || ''),
      file: Boolean(material.path) && existsSync(String(material.path)),
      pageDir: dir,
      total,
      rendered,
      rendering: Boolean(manifest && manifest.rendering) && !stale,
      scanned: Boolean((manifest && manifest.scanned) || a.scanned),
      dpi: Number(a.dpi) || Number(manifest && manifest.dpi) || 0,
      toc: a.toc.length ? a.toc : (manifest && Array.isArray(manifest.toc) ? manifest.toc : []),
      indexed: a.pages.length,
      chapters: a.chapters.length,
      points: [...new Set(a.pages.map((p) => String(p.pointId || '')).filter(Boolean))],
      kinds: [...new Set(a.pages.map((p) => String(p.kind || '其他')))],
      coverage: a.coverage,
    }
  }

  /** 书架上所有材料。面板「资料」页读这一条。 */
  on('GET', /^\/study\/api\/materials$/, () => {
    const state = store.snapshot()
    const list = (Array.isArray(state.profile.materials) ? state.profile.materials : []).map((m) => shelfOf(m, analysisOf(state.analysis, String(m.id))))
    return { code: 200, body: { ok: true, materials: list, pagesRoot } }
  })

  /**
   * 粘贴一个本机路径。是文件就直接登记；是文件夹就把里头的书列出来，
   * 要整夹一起登记得显式给 all: true（免得手一抖把整个网盘目录塞进档案）。
   */
  on('POST', /^\/study\/api\/materials\/import$/, ({ body }) => {
    const raw = String((body && body.path) || '').trim().replace(/^"|"$/g, '')
    if (!raw) return bad('path required')
    const all = Boolean(body && body.all)
    let st
    try {
      st = statSync(raw)
    } catch {
      return bad(`找不到这个路径：${raw}`)
    }
    const kindOf = (p) => (/\.pdf$/i.test(p) ? 'book' : /\.(mp4|mkv|avi|mov|flv|ts)$/i.test(p) ? 'video' : /\.(docx?|pptx?|md)$/i.test(p) ? 'notes' : 'other')
    const profile = store.read('profile')
    const known = new Set((Array.isArray(profile.materials) ? profile.materials : []).map((m) => String(m.path || '').toLowerCase()))

    if (st.isDirectory()) {
      let entries = []
      try {
        entries = readdirSync(raw, { withFileTypes: true })
      } catch (error) {
        return bad(`这个文件夹读不了：${error.message}`)
      }
      const files = entries
        .filter((e) => e.isFile() && !e.name.startsWith('.'))
        .map((e) => ({ name: e.name, path: join(raw, e.name), kind: kindOf(e.name) }))
        .filter((f) => f.kind !== 'other')
      const dirs = entries.filter((e) => e.isDirectory()).map((e) => ({ name: e.name, path: join(raw, e.name) }))
      if (!all) {
        return {
          code: 200,
          body: { ok: true, dir: true, path: raw, files: files.map((f) => ({ ...f, known: known.has(f.path.toLowerCase()) })), dirs },
        }
      }
      if (!files.length) return bad('这个文件夹里没有能登记的东西（PDF / 视频 / 讲义）')
      const added = []
      store.update('profile', (p) => {
        if (!Array.isArray(p.materials)) p.materials = []
        for (const f of files) {
          if (known.has(f.path.toLowerCase())) continue
          const item = {
            id: 'mat-' + Date.now().toString(36) + '-' + added.length,
            kind: f.kind,
            title: f.name.replace(/\.[^.]+$/, ''),
            path: f.path,
            note: '',
            addedAt: new Date().toISOString(),
          }
          p.materials.push(item)
          added.push(item)
        }
        return p
      })
      return { code: 200, body: { ok: true, dir: true, path: raw, added, skipped: files.length - added.length, materials: store.read('profile').materials } }
    }

    const title = String((body && body.title) || '').trim() || raw.split(/[\\/]/).pop().replace(/\.[^.]+$/, '')
    const item = {
      id: 'mat-' + Date.now().toString(36),
      kind: String((body && body.kind) || kindOf(raw)),
      title,
      path: raw,
      note: String((body && body.note) || ''),
      addedAt: new Date().toISOString(),
    }
    const after = store.update('profile', (p) => {
      if (!Array.isArray(p.materials)) p.materials = []
      p.materials.push(item)
      return p
    })
    return { code: 200, body: { ok: true, dir: false, added: [item], materials: after.materials } }
  })

  /** 网页上传：原件已经由 handler 落盘了，这里只负责登记。 */
  on('POST', /^\/study\/api\/material\/upload$/, ({ body }) => {
    const saved = String((body && body.savedPath) || '')
    if (!saved) return bad('没收到落盘路径')
    const name = String((body && body.name) || saved.split(/[\\/]/).pop())
    const item = {
      id: 'mat-' + Date.now().toString(36),
      kind: /\.pdf$/i.test(name) ? 'book' : 'other',
      title: name.replace(/\.[^.]+$/, ''),
      path: saved,
      note: '网页上传',
      addedAt: new Date().toISOString(),
    }
    const after = store.update('profile', (p) => {
      if (!Array.isArray(p.materials)) p.materials = []
      p.materials.push(item)
      return p
    })
    return { code: 200, body: { ok: true, added: [item], size: Number(body && body.size) || 0, materials: after.materials } }
  })

  /**
   * 把一本书整本拆成带页码的图。
   *
   * 拆图是同步的（execFileSync 调 python），一本三百页的书要跑一分多钟——
   * 留在面板进程里会把整个 HTTP 服务冻住。所以甩到子进程里去，进度看清单文件。
   */
  on('POST', /^\/study\/api\/materials\/build$/, ({ body }) => {
    const id = String((body && body.materialId) || '')
    if (!id) return bad('materialId required')
    const profile = store.read('profile')
    const material = (Array.isArray(profile.materials) ? profile.materials : []).find((m) => m && String(m.id) === id)
    if (!material) return bad(`没有这份材料：${id}`)
    const pdf = String(material.path || '')
    if (!pdf) return bad('这份材料没有路径，拆不了')
    if (!existsSync(pdf)) return bad(`文件不在那个位置了：${pdf}`)
    if (!/\.pdf$/i.test(pdf)) return bad(`只拆 PDF，这份是：${pdf}`)
    if (!pagesRoot) return bad('没有拆图目录')
    const dir = pagesDirFor(pagesRoot, pdf)
    const existing = readManifest(dir)
    if (existing && existing.rendering && Date.now() - Date.parse(String(existing.at || 0)) < 10 * 60 * 1000) {
      return { code: 200, body: { ok: true, started: false, running: true, dir, rendered: Number(existing.rendered) || 0, total: Number(existing.total) || 0 } }
    }
    const dpi = String(Math.min(220, Math.max(60, Number(body && body.dpi) || DEFAULT_DPI)))
    // 测试里塞一个假的进来，免得真的去起 python；生产就是 detached 子进程。
    const run = deps.spawnBuild || ((script, args) => {
      const child = spawn(process.execPath, [script, ...args], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      })
      child.unref()
      return child
    })
    let child
    try {
      child = run(join(HERE_DIR, 'build-pages.mjs'), [pdf, pagesRoot, dpi])
    } catch (error) {
      return bad(`起不了拆图进程：${error.message}`)
    }
    return {
      code: 200,
      body: { ok: true, started: true, pid: child.pid, dir, dpi: Number(dpi), total: Number((existing && existing.total) || 0) },
    }
  })

  /** 一本书拆出来的页，连同每一页归到哪个单元。 */
  on('GET', /^\/study\/api\/material$/, ({ query }) => {
    const id = String(query.materialId || '')
    if (!id) return bad('materialId required')
    const state = store.snapshot()
    const material = (Array.isArray(state.profile.materials) ? state.profile.materials : []).find((m) => m && String(m.id) === id)
    if (!material) return bad(`没有这份材料：${id}`)
    const a = analysisOf(state.analysis, id)
    const shelf = shelfOf(material, a)
    const rows = a.pages.map((p) => ({
      page: p.page,
      pointId: String(p.pointId || ''),
      kind: String(p.kind || '其他'),
      note: String(p.note || ''),
      file: p.file,
      url: p.file && existsSync(p.file) ? '/study/page?path=' + encodeURIComponent(p.file) : '',
    }))
    return {
      code: 200,
      body: {
        ok: true,
        shelf,
        analysis: { coverage: a.coverage, role: a.role, pairing: a.pairing, chapters: a.chapters.length, analyzedAt: a.analyzedAt },
        toc: a.toc,
        spans: spansOf(a.pages).map((s) => ({
          ...s,
          from: Number(s.from),
          to: Number(s.to),
        })),
        pages: rows,
      },
    }
  })

  /** 某个单元在各份教辅里各占哪几页——做题页那个「教辅 A / 教辅 B」就是它。 */
  on('GET', /^\/study\/api\/point\/pages$/, ({ query }) => {
    const pointId = String(query.point || '')
    if (!pointId) return bad('point required')
    const state = store.snapshot()
    const hits = pagesForPoint(state.analysis, Array.isArray(state.profile.materials) ? state.profile.materials : [], pointId)
    return {
      code: 200,
      body: {
        ok: true,
        pointId,
        hits: hits.map((h) => ({
          ...h,
          pages: Array.from({ length: h.to - h.from + 1 }, (_, i) => Number(h.from) + i).map((page) => ({
            page,
            url: (() => {
              const file = pageFileOf(h.pageDir, page)
              return existsSync(file) ? '/study/page?path=' + encodeURIComponent(file) : ''
            })(),
          })),
        })),
      },
    }
  })

  /* ── 学生在面板上留给教练的话 ─────────────────────────────────────────── */

  on('POST', /^\/study\/api\/inbox$/, async ({ body }) => {
    const text = body && body.text
    if (typeof text !== 'string' || text.trim() === '') return bad('text required')
    const said = text.trim()
    let item = null
    const inbox = store.update('inbox', (box) => {
      item = addInboxItem(box, said)
      return box
    })
    // 存下来是底线，投进对话才算真的递到了。投不出去也不回滚——他下回开口我照样能看见。
    const pushed = await push('【面板留言】' + said)
    store.write('inbox', store.read('inbox'))
    return {
      code: 200,
      body: { ok: true, item, unread: unreadInbox(inbox).length, pushed: Boolean(pushed.ok), pushError: pushed.ok ? '' : String(pushed.error || '') },
    }
  })

  /* ── 基本工具（不属于任何知识点，但决定学得多快） ──────────────────────── */

  on('POST', /^\/study\/api\/tools$/, ({ body }) => {
    const name = body && body.name
    if (!name) return bad('name required')
    const stage = STAGES.includes(body.stage) ? body.stage : '没接触过'
    const profile = store.update('profile', (p) => {
      if (!Array.isArray(p.tools)) p.tools = []
      const idx = p.tools.findIndex((t) => t && t.name === name)
      const entry = {
        name: String(name),
        stage,
        confidence: typeof body.confidence === 'number' ? Math.min(1, Math.max(0, body.confidence)) : 0,
        note: body.note ? String(body.note) : '',
        updatedAt: new Date().toISOString(),
      }
      if (idx >= 0) p.tools[idx] = { ...p.tools[idx], ...entry }
      else p.tools.push(entry)
      return p
    })
    return { code: 200, body: { ok: true, tools: profile.tools } }
  })

  /* ── 知识地图 ─────────────────────────────────────────────────────────── */

  on('POST', /^\/study\/api\/map\/module$/, ({ body }) => {
    const src = body && body.module && typeof body.module === 'object' ? body.module : body
    if (!src || !src.id) return bad('module.id required')
    const module = {
      id: String(src.id),
      group: src.group ? String(src.group) : '',
      title: src.title ? String(src.title) : String(src.id),
      summary: src.summary ? String(src.summary) : '',
      points: Array.isArray(src.points) ? src.points : [],
    }
    const map = store.update('map', (m) => upsertModule(m, module))
    return { code: 200, body: { ok: true, module, revision: map.revision } }
  })

  on('POST', /^\/study\/api\/map\/replace$/, ({ body }) => {
    const modules = body && body.modules
    if (!Array.isArray(modules)) return bad('modules must be an array')
    const map = store.update('map', (m) => {
      m.modules = modules
      m.status = 'draft'
      m.confirmedAt = null
      m.revision = (m.revision || 0) + 1
      return m
    })
    return { code: 200, body: { ok: true, revision: map.revision, count: modules.length } }
  })

  on('POST', /^\/study\/api\/map\/confirm$/, () => {
    const map = store.update('map', (m) => confirmMap(m))
    return { code: 200, body: { ok: true, status: map.status, revision: map.revision } }
  })

  /* ── 工具栏目：番茄钟 + 清单 ─────────────────────────────────────────────
     番茄钟的状态存在档案里，不是存在页面里——刷新、关页面、重启 DSH 都不影响。
     每次读之前先结算（settleFocus），所以「这一轮是不是早走完了」是从数据算出来的，
     不靠任何一直活着的定时器。 */

  on('GET', /^\/study\/api\/toolbox$/, () => {
    const box = store.update('toolbox', (t) => {
      settleFocus(t.focus)
      return t
    })
    return { code: 200, body: toolboxBody(box) }
  })

  on('POST', /^\/study\/api\/focus$/, ({ body }) => {
    const action = String((body && body.action) || 'start')
    let box
    try {
      box = store.update('toolbox', (t) => {
        if (action === 'start') startFocus(t.focus, body || {})
        else if (action === 'stop') stopFocus(t.focus, body || {})
        else throw new Error('action 只能是 start 或 stop，收到「' + action + '」')
        return t
      })
    } catch (err) {
      return bad(err.message)
    }
    return { code: 200, body: { ...toolboxBody(box), action } }
  })

  on('POST', /^\/study\/api\/todo$/, ({ body }) => {
    const action = String((body && body.action) || 'add')
    let box = null
    let item = null
    try {
      box = store.update('toolbox', (t) => {
        if (action === 'add') item = addTodo(t, body || {})
        else if (action === 'toggle') {
          const id = String((body && body.id) || '')
          if (!id) throw new Error('toggle 要带 id')
          const cur = ((t.todos && t.todos.items) || []).find((x) => x.id === id)
          if (!cur) throw new Error('没有这条清单：' + id)
          item = patchTodo(t, id, { done: body && body.done !== undefined ? body.done : !cur.done })
        } else if (action === 'patch') {
          const id = String((body && body.id) || '')
          if (!id) throw new Error('patch 要带 id')
          item = patchTodo(t, id, body || {})
        } else if (action === 'remove') {
          const id = String((body && body.id) || '')
          if (!id) throw new Error('remove 要带 id')
          removeTodo(t, id)
        } else {
          throw new Error('action 只能是 add / toggle / patch / remove，收到「' + action + '」')
        }
        return t
      })
    } catch (err) {
      return bad(err.message)
    }
    return { code: 200, body: { ok: true, action, item, ...todoBody(box) } }
  })

  /* ── 记忆卡：艾宾浩斯那一串间隔 ─────────────────────────────────────────
     `dueAt` 存的是绝对时刻，所以「现在该背哪几张」是读的时候拿它跟当下比出来的，
     跟番茄钟一样不需要任何常驻定时器。 */

  on('GET', /^\/study\/api\/memory$/, ({ query }) => {
    const memory = store.read('memory')
    return {
      code: 200,
      body: memoryView(memory, {
        status: (query && query.status) || '',
        kind: (query && query.kind) || '',
        pointId: (query && query.point) || '',
        limit: Number((query && query.limit) || 0) || 200,
      }),
    }
  })

  on('POST', /^\/study\/api\/memory$/, ({ body }) => {
    const action = String((body && body.action) || 'add')
    let card = null
    let memory
    try {
      memory = store.update('memory', (m) => {
        if (action === 'add') card = addCard(m, body || {})
        else if (action === 'review') {
          const id = String((body && body.id) || '')
          if (!id) throw new Error('review 要带 id')
          card = reviewCard(m, id, body && body.grade)
        } else if (action === 'patch') {
          const id = String((body && body.id) || '')
          if (!id) throw new Error('patch 要带 id')
          card = patchCard(m, id, body || {})
        } else if (action === 'remove') {
          const id = String((body && body.id) || '')
          if (!id) throw new Error('remove 要带 id')
          card = removeCard(m, id)
        } else {
          throw new Error('action 只能是 add / review / patch / remove，收到「' + action + '」')
        }
        return m
      })
    } catch (err) {
      return bad(err.message)
    }
    return { code: 200, body: { ...memoryView(memory), action, card } }
  })

  /* ── 掌握度 ───────────────────────────────────────────────────────────── */

  on('POST', /^\/study\/api\/mastery$/, ({ body }) => {
    const pointId = body && body.pointId
    if (!pointId) return bad('pointId required')
    const known = listPointIds(store.read('map'))
    if (known.length && !known.includes(pointId)) return bad('unknown pointId: ' + pointId, 404)
    if (body.stage && !STAGES.includes(body.stage)) return bad('stage must be one of ' + STAGES.join('/'))
    // 面板上那颗档位按钮走这里——是学生自己点的，但档位只有一份账，
    // 所以门也得是同一条（lib/map.js 的 gateStage，跟 study_record 共用一个规则）。
    // 升不动的时候**记他说的话、不动档位**，并把差几条告诉他。
    const plan = gateStage(store.read('mastery'), pointId, body.stage, body.kind)
    const mastery = store.update('mastery', (m) => {
      recordEvidence(m, {
        pointId,
        kind: body.kind,
        note: body.note,
        stage: plan.blocked ? undefined : plan.stage,
        confidence: body.confidence,
        nextReview: body.nextReview,
        mistake: body.mistake,
      })
      return m
    })
    const point = pointState(mastery, pointId)
    const note = plan.blocked
      ? `记下了：你说「${pointId}」到「${plan.stage === plan.before ? point.stage : plan.stage}」了。` +
        `档位还停在「${point.stage}」——要升到「${plan.stage}」得先有 ${plan.need} 条做题或作业照片的证据（现在 ${plan.made} 条）。` +
        '做几道题、把题号说出来，我就给你记上去。'
      : plan.clamped
        ? `记下了。你点的「${body.stage}」跳档了，先落在「${point.stage}」。`
        : ''
    return { code: 200, body: { ok: true, point, advanced: !plan.blocked, clamped: plan.clamped, need: plan.need, made: plan.made, note } }
  })

  on('GET', /^\/study\/api\/mistakes$/, ({ query }) => {
    const state = store.snapshot()
    const rawLimit = Number((query && query.limit) || 60)
    return {
      code: 200,
      body: {
        ok: true,
        ...mistakesOf(state.map, state.mastery, {
          status: String((query && query.status) || ''),
          pointId: String((query && query.point) || ''),
          limit: Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 60,
        }),
      },
    }
  })

  /* 今日复盘图：数据 + 拼好的 SVG 一起给。面板嵌 SVG，另给一颗下载。
     没动过任何单元的那天返回 data: null —— 空白的一天不该硬凑一张图。 */
  on('GET', /^\/study\/api\/review$/, ({ query }) => {
    const date = String((query && query.date) || '') || today()
    if (!DATE_RE.test(date)) return bad('date 要写成 YYYY-MM-DD，收到「' + date + '」')
    const data = buildReview(store.snapshot(), { date })
    return { code: 200, body: { ok: true, date, data, svg: data ? reviewSvg(data) : '' } }
  })

  on('GET', /^\/study\/api\/point\/(.+)$/, ({ params }) => {
    const pointId = decodeURIComponent(params[0])
    const mastery = store.read('mastery')
    return { code: 200, body: { ok: true, pointId, point: pointState(mastery, pointId) } }
  })

  /* ── 做题页 ───────────────────────────────────────────────────────────── */

  on('GET', /^\/study\/api\/practice$/, ({ query }) => {
    const pointId = String((query && query.point) || '')
    if (!pointId) return bad('point required')
    const state = store.snapshot()
    const found = findPoint(state.map, pointId)
    if (!found) return bad('unknown pointId: ' + pointId, 404)
    const { module: mod, point } = found
    const chapters = chaptersFor(state.analysis, state.profile, point)
    const pageHits = chapters
      .flatMap((c) =>
        marksFor(c.marks, point).map((m) => ({
          label: String(m.label || ''),
          page: String(m.page || ''),
          file: String(c.file || ''),
          materialId: String(c.materialId || ''),
          material: String(c.material || ''),
          no: String(c.no || ''),
          title: String(c.title || ''),
        })),
      )
      // 按页码从小到大 —— 学生按顺序翻，别让第一条是第 11 页。
      .sort((a, b) => (Number(a.page) || 0) - (Number(b.page) || 0))
    return {
      code: 200,
      body: {
        ok: true,
        pointId,
        point: {
          id: String(point.id),
          title: String(point.title || ''),
          why: String(point.why || ''),
          source: String(point.source || ''),
          video: String(point.video || ''),
          practice: String(point.practice || ''),
        },
        module: {
          id: String(mod.id),
          title: String(mod.title || ''),
          group: String(mod.group || ''),
        },
        stage: pointState(state.mastery, pointId).stage,
        stageAll: STAGES,
        progress: state.progress.modules[String(mod.id)] ?? 0,
        chapters,
        // 已经拆到页的那几条：学生要的「这个知识点在第 6 页」就是这个。
        // 空数组的意思是这份讲义还没人逐页看过，不是「这一节没有讲义」。
        pageHits,
        materials: (Array.isArray(state.profile.materials) ? state.profile.materials : []).map((m) => {
          const a = analysisOf(state.analysis, String(m.id))
          return {
            id: String(m.id),
            title: String(m.title || ''),
            kind: String(m.kind || ''),
            path: String(m.path || ''),
            chapterCount: a.chapters.length,
            pagedCount: a.chapters.filter((c) => Array.isArray(c.marks) && c.marks.length).length,
          }
        }),
      },
    }
  })

  /**
   * 学生在做题页按了按钮。练习练什么由他当场定：
   *   ai   → 把这句话投进对话，我接着出题
   *   self → 他自己安排，直接落成今天的一条任务
   * 两样都要立刻见效，所以投递结果原样回给面板，投不出去要说清楚。
   */
  on('POST', /^\/study\/api\/practice\/ask$/, async ({ body }) => {
    const pointId = String((body && body.pointId) || '')
    if (!pointId) return bad('pointId required')
    const mode = String((body && body.mode) || 'ai')
    if (!['ai', 'self', 'mistake'].includes(mode)) return bad('mode must be ai / self / mistake')

    const state = store.snapshot()
    const found = findPoint(state.map, pointId)
    if (!found) return bad('unknown pointId: ' + pointId, 404)
    const point = found.point
    const label = (pointId + ' ' + String(point.title || '')).trim()
    const said = String((body && body.text) || '').trim()

    if (mode === 'self') {
      if (!said) return bad('自我安排得写一句要做什么')
      const rawMinutes = Number(body && body.minutes)
      const date = String((body && body.date) || today())
      const target = storeFor(body && body.profileId)
      if (!target) return bad('unknown profileId: ' + body.profileId, 404)
      const { task } = addTask(target, date, {
        kind: 'practice',
        title: said,
        target: pointId,
        minutes: Number.isFinite(rawMinutes) && rawMinutes > 0 ? Math.round(rawMinutes) : 0,
        open: String((body && body.open) || point.practice || ''),
      })
      const map = store.read('map')
      return { code: 200, body: { ok: true, mode, task: taskView(map, task), day: dayOf(target, date) } }
    }

    // 「这题做错了」——只报现象，错因和订正交给教练去问、去判，然后就记在 mistake 上。
    if (mode === 'mistake') {
      const origin = String((body && body.origin) || '').trim()
      if (!origin && !said) return bad('写一句错在哪，或者填清题号')
      const lines = ['【面板·错题】他在「' + label + '」上做错了一道题。']
      if (origin) lines.push('题号/出处：' + origin)
      const sheet = String(point.practice || '')
      if (sheet) lines.push('这一节的讲义：' + baseName(sheet) + '（' + sheet + '）')
      if (said) lines.push('他的原话：' + said)
      lines.push(
        '请按这个顺序处理：',
        '1. 先判断他错在哪一步、错因是什么。他说的多半是现象，别把现象当错因。',
        '2. 给完整订正，把该走的那一步写出来。',
        '3. 用 study_record 把这条错题记下来：pointId 用 ' + pointId + '，'
          + 'mistake.origin 写清是哪份材料的哪一题，cause 和 fix 都写清了才把 status 标成「已订正」；'
          + '只是订正完、没隔几天重做对，就别标「已复做对」。',
        '4. 再出一道同类变式让他当场做一遍，做对了才是真会了。',
        '他要是说不清错在哪，先问他，别替他编一个错因。',
      )
      const prompt = lines.join('\n')
      const inbox = store.update('inbox', (box) => {
        addInboxItem(box, '（面板·错题）' + (said || origin || label))
        return box
      })
      const pushed = await push(prompt)
      return {
        code: 200,
        body: {
          ok: true,
          mode,
          prompt,
          pushed: Boolean(pushed.ok),
          pushError: pushed.ok ? '' : String(pushed.error || ''),
          unread: unreadInbox(inbox).length,
        },
      }
    }

    const lines = ['【面板·做题】我想练「' + label + '」。']
    const file = String(point.practice || '')
    if (file) lines.push('这一节的讲义：' + baseName(file) + '（' + file + '）')
    if (said) lines.push('他补了一句：' + said)
    // 出题的三种来路。不管哪种，出来的东西都要落成一份 kind=ai 的材料，
    // 才能出现在书架上、做题页才按单元列得出来——别只在对话里贴一遍就完事。
    const WANT = {
      quiz: '出一份随堂小测：6—8 道，由易到难，覆盖这一节的主要题型，最后附答案与关键步骤。',
      recite: '出一份背诵清单：把这一节要背的定义、公式、结论逐条列出来，每条后面跟一句「怎么想起来」。',
      variant: '出一份错题变式：拿他这一节最近的错题，改数字、改条件各出 1—2 道同构题，最后附答案。',
    }
    const want = WANT[String((body && body.want) || '')] || '出几道题，由易到难，最后附答案与关键步骤。'
    lines.push(
      want,
      '出来之后按这个顺序收尾，别只在对话里贴一遍：',
      '1. 把卷子写成一份 .md，放进插件数据目录的 ai/ 里，文件名带上单元和日期。',
      '2. 用 study_material {action:"add", kind:"ai", title:"…", path:"<那份 md 的绝对路径>", note:"…"} 登记它'
        + '——标题写清「哪一天 · 哪一节 · 什么卷」，note 写题量和难度。',
      '3. 用 study_analysis 给这份材料写 chapters（一份卷一条）和 spans：'
        + 'spans 的 from/to 写**题号**不是页码，pointId 填 ' + pointId + '，kind 用「习题」。'
        + '这样这一节在书架和做题页上就能一眼找到这份卷。',
      '4. 告诉他去「资料」页的书架上打开，或者直接在做题页点这一节的「AI 出题」。',
    )
    const prompt = lines.join('\n')

    const inbox = store.update('inbox', (box) => {
      addInboxItem(box, said ? '（面板·出题）' + said : '（面板·出题）练 ' + label)
      return box
    })
    const pushed = await push(prompt)
    return {
      code: 200,
      body: {
        ok: true,
        mode,
        prompt,
        pushed: Boolean(pushed.ok),
        pushError: pushed.ok ? '' : String(pushed.error || ''),
        unread: unreadInbox(inbox).length,
      },
    }
  })

  /* ── 每级掌握档案 / 总体能力 / 档案库 ────────────────────────────────── */

  on('GET', /^\/study\/api\/archive$/, ({ query }) => {
    const level = String((query && query.level) || 'module')
    const key = String((query && query.key) || '')
    if (!key) return bad('key required')
    if (!['group', 'module', 'point'].includes(level)) return bad('level must be group / module / point')
    const state = store.snapshot()
    let archive = null
    try {
      archive = archiveFor(state.map, state.mastery, level, key)
    } catch (err) {
      return bad(String((err && err.message) || err))
    }
    if (!archive) return bad('unknown ' + level + ': ' + key, 404)
    return { code: 200, body: { ok: true, archive } }
  })

  on('GET', /^\/study\/api\/ability$/, () => {
    const state = store.snapshot()
    return { code: 200, body: { ok: true, ability: state.ability } }
  })

  on('POST', /^\/study\/api\/ability$/, ({ body }) => {
    const src = pick(body, ['text', 'level'])
    if (src.text === undefined && src.level === undefined) return bad('text or level required')
    store.update('profile', (p) => {
      setAbility(p, src)
      return p
    })
    return { code: 200, body: { ok: true, ability: store.snapshot().ability } }
  })

  /**
   * 关于这个学生的判断（L2）。
   *
   * 读的时候一定带上 `orphans`：判断不会过期，但它引的那次可能没了。
   * 把兑不上的显式列出来，面板上才看得见要修的东西——
   * 这是这一层跟「一个谁也看不见的向量库」的区别。
   */
  const studentView = (options = {}) => {
    const state = store.snapshot()
    const body = studentBody(state.student, state.map, state.mastery, {
      kind: String(options.kind || ''),
      pointId: String(options.pointId || ''),
      limit: Number(options.limit) || 200,
    })
    return { ok: true, ...body }
  }

  on('GET', /^\/study\/api\/student$/, ({ query }) =>
    ({ code: 200, body: studentView({ kind: query.kind, pointId: query.point, limit: query.limit }) }))

  on('POST', /^\/study\/api\/student$/, ({ body }) => {
    const action = String(body.action || 'add')
    if (!['add', 'patch', 'remove'].includes(action)) {
      return bad(`action 只能是 add / patch / remove，收到「${action}」`)
    }
    try {
      let fact = null
      store.update('student', (s) => {
        const state = store.snapshot()
        const ctx = { map: state.map, mastery: state.mastery }
        if (action === 'add') fact = addFact(s, body, ctx)
        else if (action === 'remove') {
          removeFact(s, body.id)
        } else {
          if (!body.id) throw new Error('patch 要带 id')
          fact = patchFact(s, body.id, body, ctx)
        }
        return s
      })
      const state = store.snapshot()
      return {
        code: 200,
        body: {
          ...studentView(),
          action,
          fact: fact ? renderFact(fact, state.map, state.mastery) : null,
        },
      }
    } catch (err) {
      return bad(err.message)
    }
  })

  const hasLibrary = typeof store.list === 'function' && typeof store.create === 'function'
  /**
   * 多科目时，任务不一定落在当前档案上——A、B、C 三门并行，
   * 在「今天」那一栏里就能给任意一门排活儿，不必先切过去。
   * 没给 profileId（或这份档案根只装得下一个）就用当前的。
   */
  const profileOf = (id) => {
    const list = hasLibrary ? store.list() : []
    return list.find((p) => p.id === id) || null
  }

  const storeFor = (profileId) => {
    const id = String(profileId || '')
    if (!id || !hasLibrary) return store
    /* Library.store() 对没见过的 id 会顺手造一个新档案，所以必须先查名册。 */
    return profileOf(id) ? store.store(id) : null
  }

  /** 回收站：路径层可能拿到的是老的 Store（没有 trash），那种就当空回收站。 */
  const libraryTrash = () => {
    if (!hasLibrary || typeof store.trash !== 'function') return []
    try {
      const rows = store.trash()
      return Array.isArray(rows) ? rows : []
    } catch {
      return []
    }
  }

  const libraryState = (extra = {}) => ({
    code: 200,
    body: {
      ok: true,
      supported: hasLibrary,
      active: hasLibrary ? store.activeId() : '',
      profiles: hasLibrary ? store.list() : [],
      trash: libraryTrash(),
      ...extra,
    },
  })

  on('GET', /^\/study\/api\/library$/, () => libraryState())

  on('POST', /^\/study\/api\/library$/, ({ body }) => {
    if (!hasLibrary) return bad('这个档案根只装得下一个档案，换不了')
    const action = String((body && body.action) || '')
    try {
      if (action === 'create') return libraryState({ created: store.create(pick(body, ['title', 'subject', 'outcome', 'deadline', 'minutesPerDay'])) })
      if (action === 'select') return libraryState({ selected: store.select(body && body.id) })
      if (action === 'rename') return libraryState({ renamed: store.rename(body && body.id, pick(body, ['title'])) })
      if (action === 'remove') return libraryState({ removed: store.remove(body && body.id, { hard: Boolean(body && body.hard) }) })
    } catch (err) {
      return bad(String((err && err.message) || err))
    }
    return bad('action must be create / select / rename / remove')
  })

  /** 误删之后唯一的回头路：把回收站里的一条挪回日常名册。 */
  on('POST', /^\/study\/api\/library\/restore$/, ({ body }) => {
    if (!hasLibrary) return bad('这个档案根只装得下一个档案，没有回收站')
    if (typeof store.restore !== 'function') return bad('这个档案根不支持恢复')
    const entry = String((body && body.entry) || '').trim()
    if (!entry) return bad('entry required')
    try {
      return libraryState({ restored: store.restore(entry, { id: body && body.id }).profile })
    } catch (err) {
      return bad(String((err && err.message) || err))
    }
  })

  /* ── 每日任务 ─────────────────────────────────────────────────────────── */

  const addTask = (target, date, fields) => {
    const task = {
      id: 'task-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e4).toString(36),
      kind: fields.kind || 'practice',
      title: String(fields.title || ''),
      target: fields.target ? String(fields.target) : '',
      minutes: typeof fields.minutes === 'number' ? fields.minutes : 0,
      open: fields.open ? String(fields.open) : '',
      done: false,
      note: '',
    }
    const tasks = target.update('tasks', (t) => {
      if (!t.days || typeof t.days !== 'object') t.days = {}
      if (!Array.isArray(t.days[date])) t.days[date] = []
      t.days[date].push(task)
      return t
    })
    return { task, tasks }
  }

  /** 一门课里某一天的任务清单（带跳转按钮）。 */
  const dayOf = (target, date) => {
    const tasks = target.read('tasks')
    const day = Array.isArray(tasks.days && tasks.days[date]) ? tasks.days[date] : []
    const map = target.read('map')
    return day.map((t) => taskView(map, t))
  }

  on('POST', /^\/study\/api\/task$/, ({ body }) => {
    const date = (body && body.date) || today()
    if (!DATE_RE.test(date)) return bad('date must be YYYY-MM-DD')
    if (!body || !body.title) return bad('title required')
    const profileId = String((body && body.profileId) || '')
    const target = storeFor(profileId)
    if (!target) return bad('unknown profileId: ' + profileId, 404)
    const { task } = addTask(target, date, body)
    const map = target.read('map')
    const day = dayOf(target, date)
    return { code: 200, body: { ok: true, date, profileId: profileId || (hasLibrary ? store.activeId() : ''), task: taskView(map, task), day } }
  })

  on('GET', /^\/study\/api\/tasks$/, ({ query }) => {
    const date = String((query && query.date) || today())
    if (!DATE_RE.test(date)) return bad('date must be YYYY-MM-DD')
    /* all=1：三门课一起看。每门各带自己的地图，跳转按钮才不会指错科目。 */
    if (String((query && query.all) || '') === '1' && hasLibrary) {
      return {
        code: 200,
        body: {
          ok: true,
          date,
          all: true,
          profiles: store.list().map((p) => ({
            id: p.id,
            title: p.title,
            subject: p.subject,
            active: p.active,
            progress: p.progress,
            points: p.points,
            modules: p.modules,
            day: dayOf(store.store(p.id), date),
          })),
        },
      }
    }
    const profileId = String((query && query.profileId) || '')
    const target = storeFor(profileId)
    if (!target) return bad('unknown profileId: ' + profileId, 404)
    return { code: 200, body: { ok: true, date, profileId: profileId || (hasLibrary ? store.activeId() : ''), day: dayOf(target, date) } }
  })

  on('POST', /^\/study\/api\/task\/update$/, ({ body }) => {
    const date = (body && body.date) || today()
    const id = body && body.id
    if (!id) return bad('id required')
    const target = storeFor(body && body.profileId)
    if (!target) return bad('unknown profileId: ' + body.profileId, 404)
    const tasks = target.read('tasks')
    const day = tasks.days && tasks.days[date]
    if (!Array.isArray(day)) return bad('no tasks on ' + date, 404)
    const task = day.find((t) => t && t.id === id)
    if (!task) return bad('unknown task id: ' + id, 404)
    for (const key of ['title', 'kind', 'target', 'open', 'note']) {
      if (body[key] !== undefined) task[key] = String(body[key])
    }
    if (body.minutes !== undefined) {
      const minutes = Number(body.minutes)
      if (!Number.isFinite(minutes) || minutes < 0) return bad('minutes must be a non-negative number')
      task.minutes = minutes
    }
    target.write('tasks', tasks)
    const map = target.read('map')
    return { code: 200, body: { ok: true, date, task: taskView(map, task) } }
  })

  on('POST', /^\/study\/api\/task\/remove$/, ({ body }) => {
    const date = (body && body.date) || today()
    const id = body && body.id
    if (!id) return bad('id required')
    const target = storeFor(body && body.profileId)
    if (!target) return bad('unknown profileId: ' + body.profileId, 404)
    const tasks = target.read('tasks')
    const day = tasks.days && tasks.days[date]
    if (!Array.isArray(day)) return bad('no tasks on ' + date, 404)
    if (!day.some((t) => t && t.id === id)) return bad('unknown task id: ' + id, 404)
    tasks.days[date] = day.filter((t) => t && t.id !== id)
    target.write('tasks', tasks)
    return { code: 200, body: { ok: true, date, day: dayOf(target, date) } }
  })

  on('POST', /^\/study\/api\/task\/toggle$/, ({ body }) => {
    const date = (body && body.date) || today()
    const id = body && body.id
    if (!id) return bad('id required')
    const target = storeFor(body && body.profileId)
    if (!target) return bad('unknown profileId: ' + body.profileId, 404)
    const tasks = target.read('tasks')
    const day = tasks.days && tasks.days[date]
    if (!Array.isArray(day)) return bad('no tasks on ' + date, 404)
    const task = day.find((t) => t && t.id === id)
    if (!task) return bad('unknown task id: ' + id, 404)
    task.done = body.done === undefined ? !task.done : !!body.done
    if (body.note !== undefined) task.note = String(body.note)
    target.write('tasks', tasks)
    const map = target.read('map')
    return {
      code: 200,
      body: {
        ok: true,
        date,
        task: taskView(map, task),
        day: dayOf(target, date),
      },
    }
  })

  /* ── 对话 ─────────────────────────────────────────────────────────────── */

  /**
   * 面板上那页「与教练对话」读的是 DSH 真正的会话日志，不是另起一套。
   * 三条路由都是只读 + 投递，缺 sessionController 时统一回 available:false，
   * 面板看到就退回「留言」那套，不会白屏。
   */
  const chatOf = () => deps.chat || null

  on('GET', /^\/study\/api\/chat\/sessions$/, async () => {
    const chat = chatOf()
    if (!chat) return { code: 200, body: { ok: false, available: false, error: '没有会话通道', sessions: [] } }
    const out = await chat.sessions()
    return { code: 200, body: out }
  })

  /**
   * 面板上那颗「＋ 新建」：开一个新的学习教练会话。
   *
   * 为什么要这条：会话清单按预设筛，学生刚装插件时一个学习会话都没有，那页就是空态；
   * 让他自己去 DSH 新建对话、还记得挑对预设，太绕。这里替他开一个，开完直接把 id 回给面板。
   */
  on('POST', /^\/study\/api\/chat\/new$/, async () => {
    const chat = chatOf()
    if (!chat) return bad('对话通道没接通 —— 重启一次 DSH 再试', 503)
    if (typeof chat.create !== 'function') return bad('这个版本的对话通道不能新建会话', 501)
    const made = await chat.create()
    if (!made.ok) return bad(made.error || '没能开出会话', 500)
    return { code: 200, body: { ok: true, sessionId: made.sessionId, agentPreset: made.agentPreset || '' } }
  })

  on('GET', /^\/study\/api\/chat$/, async ({ query }) => {
    const chat = chatOf()
    if (!chat) return { code: 200, body: { ok: false, available: false, error: '没有会话通道', messages: [] } }
    const raw = Number((query && query.max) || 0)
    const out = await chat.history({
      sessionId: String((query && query.sessionId) || ''),
      maxMessages: Number.isFinite(raw) && raw > 0 ? raw : undefined,
    })
    if (query && query.sessions) {
      const listed = await chat.sessions()
      out.sessions = listed.sessions
      out.filtered = listed.filtered
    }
    return { code: 200, body: out }
  })

  on('POST', /^\/study\/api\/chat\/send$/, async ({ body }) => {
    const text = String((body && body.text) || '').trim()
    if (!text) return bad('text required')
    const mode = String((body && body.mode) || 'queue')
    if (!['queue', 'steer'].includes(mode)) return bad('mode must be queue / steer')
    const sessionId = String((body && body.sessionId) || '')
    const sent = await push(text, sessionId ? { sessionId, mode } : { mode })
    return {
      code: 200,
      body: { ok: Boolean(sent.ok), mode, sessionId, pushError: sent.ok ? '' : String(sent.error || '') },
    }
  })

  /* ── 汇总 ─────────────────────────────────────────────────────────────── */

  on('POST', /^\/study\/api\/reset$/, ({ body }) => {
    if (!body || body.confirm !== 'reset') return bad('send {"confirm":"reset"} to wipe the archive')
    for (const key of Object.keys(FILES)) store.write(key, store.default(key))
    return { code: 200, body: { ok: true, state: store.snapshot() } }
  })

  /* ── 面板服务 ─────────────────────────────────────────────────────────── */

  /**
   * 面板上的「启动键」和设置页都打这儿。这里有两层，别混：
   *   · 同源那条（DSH 自己 webServer 上的 /study）插件一加载就一直在，关不掉也不用关；
   *   · 独立端口那条是给 DSH 内嵌浏览器用的（内嵌浏览器不许开 DSH 自身的 origin），
   *     可以关、可以换端口，所以得能问状态、能开关。
   *
   * deps.panel 缺席时（测试里直接 createRouter 的那些）不该让面板页炸：一律回
   * supported:false 并把原因说清，前端照着把按钮灰掉。
   */
  const PANEL_ACTIONS = ['start', 'stop', 'restart']

  /** GET 与 POST 回同一个形状，前端只解析一种。 */
  function panelBody() {
    const panel = deps.panel || null
    if (!panel) {
      return {
        supported: false,
        running: false,
        port: null,
        url: '',
        preferred: null,
        hintUrl: '',
        error: '',
        settings: null,
        note: '这个进程里没接面板服务控制器：看得见状态，但开不了也关不了。',
      }
    }
    const info = panel.info()
    return {
      supported: true,
      running: Boolean(info.running),
      port: info.port == null ? null : info.port,
      url: String(info.url || ''),
      preferred: info.preferred == null ? null : info.preferred,
      hintUrl: String(info.hintUrl || ''),
      error: String(info.error || ''),
      settings: panel.settings(),
      note: '',
    }
  }

  on('GET', /^\/study\/api\/panel$/, () => ({ code: 200, body: { ok: true, ...panelBody() } }))

  on('POST', /^\/study\/api\/panel$/, async ({ body }) => {
    const panel = deps.panel || null
    if (!panel) return bad('这个进程里没有面板服务控制器')
    const action = String((body && body.action) || '').trim()
    /* 存设置两种写法都收：{panel:{autoStart,port}} 和扁平的 {autoStart,port}（面板上就俩控件，扁平更好写）。 */
    const src = (body && body.panel) || body || {}
    const wantsSave = Boolean(body && (body.panel || body.autoStart !== undefined || body.port !== undefined))
    const before = panel.info().preferred
    let saved = null
    if (wantsSave) {
      const patch = {}
      if (src.autoStart !== undefined) patch.autoStart = src.autoStart
      if (src.port !== undefined) patch.port = src.port
      try {
        saved = panel.save({ panel: patch })
      } catch (error) {
        return bad(String((error && error.message) ?? error))
      }
    }
    if (action) {
      if (!PANEL_ACTIONS.includes(action)) return bad('action 只能是 start / stop / restart')
      /*
       * 起 / 重启都听**设置里那个端口**，不是「这次请求里顺手存的那个」：
       * 面板上先改端口再点重启是两次请求，只在这次请求里找端口，重启就会回到旧端口上，
       * 而界面上写着新端口——最难查的那种。设置读不到才退回 undefined（用控制器自己的首选）。
       */
      const current = saved ? saved.panel.port : panel.settings?.()?.panel?.port
      await panel[action](current)
    }
    const out = panelBody()
    /* 改了端口却没重启：说清「现在听的还是旧端口」，别让人对着新端口一直刷。 */
    if (saved && saved.panel.port !== before && out.running && action !== 'restart' && action !== 'start') {
      out.note = `端口存成 ${saved.panel.port} 了，但面板服务现在还在 ${out.port} 上——点一下「重启」才会听新端口。`
    }
    return { code: 200, body: { ok: true, saved: Boolean(saved), ...out } }
  })

  return function handle(request) {
    const method = (request && request.method) || 'GET'
    const pathname = (request && request.pathname) || '/'
    for (const route of routes) {
      if (route.method !== method) continue
      const match = route.pattern.exec(pathname)
      if (!match) continue
      const failure = (error) => ({
        code: 500,
        body: { ok: false, error: { code: 'internal', message: String((error && error.message) ?? error) } },
      })
      try {
        const out = route.fn({ body: request.body, query: request.query, params: match.slice(1) })
        // 同步路由照旧直接返回；异步的（投递、读对话那几条）把 rejection 也收成响应，别让它飘出去。
        return out && typeof out.then === 'function' ? out.catch(failure) : out
      } catch (error) {
        return failure(error)
      }
    }
    return { code: 404, body: { ok: false, error: { code: 'not-found', message: 'unknown study route' } } }
  }
}
