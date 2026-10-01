/**
 * dsh-study-coach — API 路由。
 *
 * 故意不碰 ctx：输入是 { method, pathname, query, body }，输出是 { code, body }，
 * 所以能脱开 DSH 直接跑测试。index.js 只负责把 HTTP 请求翻译成这个形状。
 */
import {
  STAGES,
  FILES,
  pointState,
  recordEvidence,
  masterySummary,
  upsertModule,
  confirmMap,
  listPointIds,
  addInboxItem,
  unreadInbox,
  analysisOf,
  archiveFor,
  abilityReport,
  setAbility,
  taskView,
  mistakesOf,
} from './store.js'
import { buildReview, reviewSvg } from './review.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function today() {
  return new Date().toISOString().slice(0, 10)
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
    const material = {
      id: 'mat-' + Date.now().toString(36),
      kind: item.kind || 'other',
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

  /* ── 掌握度 ───────────────────────────────────────────────────────────── */

  on('POST', /^\/study\/api\/mastery$/, ({ body }) => {
    const pointId = body && body.pointId
    if (!pointId) return bad('pointId required')
    const known = listPointIds(store.read('map'))
    if (known.length && !known.includes(pointId)) return bad('unknown pointId: ' + pointId, 404)
    if (body.stage && !STAGES.includes(body.stage)) return bad('stage must be one of ' + STAGES.join('/'))
    const mastery = store.update('mastery', (m) => {
      recordEvidence(m, {
        pointId,
        kind: body.kind,
        note: body.note,
        stage: body.stage,
        confidence: body.confidence,
        nextReview: body.nextReview,
        mistake: body.mistake,
      })
      return m
    })
    return { code: 200, body: { ok: true, point: pointState(mastery, pointId) } }
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
    lines.push('给我出几道题。')
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
