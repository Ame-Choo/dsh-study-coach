/**
 * 今日复盘图：把一天摊成一张 2048×1180 的一页纸。
 *
 * 版式搬的是 good-learning-skill（MIT，yoli-mi/good-learning-skill）的
 * render_summary_map.py —— 中间一块深色的核心，左右各挂 1—3 张卡，
 * 一张卡一个颜色，一种颜色一个「今天动过的大类」。
 *
 * 两处故意跟它不一样：
 *   1. 服务端直接拼 SVG 字符串，不引 Python / Pillow。面板嵌进去当场看，另给一颗下载。
 *      一个「装完就能用」的插件不该因为想画张图就要求对方机器上有 Python。
 *   2. 校验松一档：那边要求恰好 4—6 个分支，这里 1—6 都收 —— 一天只碰了一个单元也该
 *      有复盘图，不该因为「不够热闹」就不给画。但「错题数必须等于带错题的分支数」
 *      这条照抄：业务规矩写成数据自校验，比再写十条提示词都管用。
 *
 * 这张图没有文本测量、不会自动换行，文案长了直接压出卡片——所以每段字都按字号裁过。
 */

import { STAGES, briefOf, mistakesOf, pointState } from './store.js'

export const REVIEW_WIDTH = 2048
export const REVIEW_HEIGHT = 1180

const CARD_W = 596
const CARD_H = 252
/* 每侧 1—3 张卡时各自的纵向起点；0 张就什么都不画。 */
const ROWS = { 0: [], 1: [494], 2: [270, 718], 3: [196, 494, 792] }
const LEFT_X = 74
const RIGHT_X = 1378
const PALETTE = [
  ['#607D6B', '#E7EFE9'],
  ['#6D8794', '#E8F0F3'],
  ['#A17C60', '#F4EDE5'],
  ['#8D7793', '#F0EAF1'],
  ['#A57976', '#F3E9E7'],
  ['#748C78', '#E9F0E9'],
]

const XML = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => XML[c])
}

function text(x, y, value, css, extra = '') {
  return `<text x="${x}" y="${y}" class="${css}"${extra}>${esc(value)}</text>`
}

/** 半角按 0.55 个字宽算，够用了——只是为了让 CJK 不被 ASCII 挤爆。 */
function unitsOf(value) {
  let n = 0
  for (const ch of String(value ?? '')) n += /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(ch) ? 1 : 0.55
  return n
}

/** 按「还能放几个字」截断，留一个省略号的位置。 */
function clip(value, budget) {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (unitsOf(s) <= budget) return s
  let out = ''
  let used = 0
  for (const ch of s) {
    const w = unitsOf(ch)
    if (used + w > budget - 1) break
    out += ch
    used += w
  }
  return out.replace(/[\s，。、；：,.;:]+$/, '') + '…'
}

function kindWord(kinds) {
  const seen = []
  for (const k of kinds) {
    const word = { lesson: '看了课', quiz: '做了题', photo: '交了作业', review: '复习了', self: '自评了' }[k] || '记了一笔'
    if (!seen.includes(word)) seen.push(word)
  }
  return seen.join(' + ') || '记了一笔'
}

function weekdayOf(date) {
  const t = Date.parse(String(date) + 'T00:00:00Z')
  if (!Number.isFinite(t)) return ''
  return '周' + '日一二三四五六'[new Date(t).getUTCDay()]
}

function shortDate(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date))
  if (!m) return String(date)
  return `${Number(m[2])} 月 ${Number(m[3])} 日`
}

/**
 * 把 snapshot() 里的一天摊成复盘图的数据。没动过任何单元就返回 null——空白的一天
 * 不该硬凑一张图出来。
 */
export function buildReview(state, options = {}) {
  const date = String(options.date || '').slice(0, 10)
  const map = state?.map || {}
  const modules = Array.isArray(map.modules) ? map.modules : []
  const mastery = state?.mastery || {}
  const tasks = state?.tasks || {}
  const day = tasks.days && Array.isArray(tasks.days[date]) ? tasks.days[date] : []

  /* 今天动过的单元：当天记过证据的、当天错过的、当天排了任务的，三路合起来去重。 */
  const touched = new Map()
  const bump = (pointId) => {
    if (!touched.has(pointId)) touched.set(pointId, { pointId, evidence: [], tasks: [] })
    return touched.get(pointId)
  }
  for (const [pointId, point] of Object.entries(mastery.points || {})) {
    const mine = (Array.isArray(point?.evidence) ? point.evidence : [])
      .filter((e) => String(e?.at || '').slice(0, 10) === date)
    if (mine.length) bump(pointId).evidence = mine
  }
  const dayMistakes = mistakesOf(map, mastery).items
    .filter((m) => String(m.at || '').slice(0, 10) === date)
  for (const m of dayMistakes) {
    const row = bump(m.pointId)
    /* 一个单元一天错好几道也只挑最新那道，卡片上就一行位置。 */
    if (!row.mistake || String(m.at) > String(row.mistake.at)) row.mistake = m
  }
  for (const t of day) {
    const id = String(t?.target || '')
    if (!id || !briefOf(modules, id).moduleId) continue
    bump(id).tasks.push(t)
  }

  const picked = [...touched.values()]
    .sort((a, b) => {
      const score = (r) => (r.mistake ? 100 : 0) + r.evidence.length * 10 + r.tasks.length
      return score(b) - score(a) || String(a.pointId).localeCompare(String(b.pointId))
    })
    .slice(0, 6)
  if (!picked.length) return null

  const half = Math.ceil(picked.length / 2)
  let wrongNo = 0
  const branches = picked.map((row, i) => {
    const brief = briefOf(modules, row.pointId)
    const st = pointState(mastery, row.pointId)
    const rule = row.tasks.length
      ? row.tasks.map((t) => String(t?.title || '')).join('；')
      : row.evidence.length
        ? kindWord(row.evidence.map((e) => e.kind))
        : '当天没有留下记录'
    const base = {
      side: i < half ? 'left' : 'right',
      category: brief.group || '未分类',
      title: clip(brief.title, 17),
      rule: clip(rule, 24),
      detail: clip(`到「${st.stage}」`, 26),
    }
    if (row.mistake) {
      wrongNo += 1
      return {
        ...base,
        error: {
          number: wrongNo,
          label: '错题',
          mistake: clip(row.mistake.step || row.mistake.cause || '记了一道错题', 19),
          fix: clip(row.mistake.fix || row.mistake.cause || '还没写订正', 28),
        },
      }
    }
    const later = (row.evidence.map((e) => e.nextReview).filter(Boolean).sort()[0]) || st.nextReview
    return {
      ...base,
      check: clip(st.stage === STAGES[0] ? '还没起步' : `当前「${st.stage}」`, 19),
      check_fix: clip(later ? `下次复习：${later}` : '还没排复习', 28),
    }
  })

  const errorCount = branches.filter((b) => b.error).length
  const pending = dayMistakes.filter((m) => m.status === '待验证').length
  const records = [...touched.values()].reduce((n, r) => n + r.evidence.length, 0)
  const minutes = day.filter((t) => t?.done).reduce((n, t) => n + (Number(t?.minutes) || 0), 0)
  const workload = [`${branches.length} 个单元`, `${records} 条记录`]
    .concat(minutes ? [`${minutes} 分钟`] : [])
    .join(' · ')

  const ability = state?.ability || null
  const judgement = String(ability?.judgement?.text || '').trim()
  const undone = day.filter((t) => t && !t.done)
  const nextUp = undone.length
    ? `下一步：${String(undone[0].title || '')}`
    : (() => {
        const later = picked
          .map((r) => pointState(mastery, r.pointId).nextReview)
          .filter(Boolean)
          .sort()[0]
        return later ? `下一步：${later} 回来复习` : '下一步：明天接着来'
      })()
  const groups = [...new Set(branches.map((b) => b.category))]

  return {
    date,
    eyebrow: 'DAY REVIEW · 今日复盘',
    title: '今日复盘',
    subtitle: `${date} · ${weekdayOf(date)}`,
    status: pending
      ? `待验证 ${pending} 道错题`
      : errorCount
        ? `${errorCount} 道错题已订正`
        : '今天没有记错题',
    description: `${shortDate(date)}，动了 ${branches.length} 个单元，${records} 条记录${
      errorCount ? `，${errorCount} 道错题` : ''
    }。${judgement}`.trim(),
    core_label: 'DAY REVIEW · 今日复盘',
    core_title: shortDate(date),
    /* 中间那块只有 504 宽，竖排三行字全是短句：长句子塞进来会压出色块。
       教练的判词放 core_foot，也只留一句的头。 */
    core_subtitle: groups.length > 1 ? `${groups.length} 个大类 · ${branches.length} 个单元` : `${branches.length} 个单元`,
    workload,
    core_foot: clip(judgement || nextUp.replace(/^下一步：/, '下一步 '), 20),
    error_count: errorCount,
    legend: '彩色分支：今天动过的单元',
    note_legend: errorCount ? '红点：当天记下的错题' : '没有错题，一整天都干净',
    footer: clip(`下一步：${undone.length ? String(undone[0].title || '') : '接着往下走'}`, 30),
    branches,
  }
}

/** 一沓卡片，顺序是阅读序：左列从上到下，然后右列。 */
function card(item, x, y, index, colors) {
  const [accent, tint] = colors[item.category] || PALETTE[0]
  const error = item.error || null
  const label = error ? `${error.label || '错题'} ${String(error.number).padStart(2, '0')}` : '档位'
  const note = error ? error.mistake : item.check
  const fix = error ? error.fix : item.check_fix
  /* 分类药丸原来是固定 62 宽，装不下「集合与常用逻辑用语」这种大类名，按字宽撑开。 */
  const pillW = Math.max(62, Math.round(unitsOf(item.category) * 16) + 24)
  const pillX = x + CARD_W - 31 - pillW
  return [
    `<g aria-label="${esc(item.title)}">`,
    `<rect x="${x}" y="${y}" width="${CARD_W}" height="${CARD_H}" rx="21" fill="#FFFFFF" stroke="#DDE3DD" stroke-width="1.5" filter="url(#soft-shadow)"/>`,
    `<rect x="${x}" y="${y + 26}" width="5" height="54" rx="2.5" fill="${accent}"/>`,
    text(x + 31, y + 46, String(index).padStart(2, '0'), 'number'),
    `<rect x="${pillX}" y="${y + 25}" width="${pillW}" height="31" rx="15.5" fill="${tint}"/>`,
    `<text x="${pillX + pillW / 2}" y="${y + 46}" text-anchor="middle" class="category" fill="${accent}">${esc(item.category)}</text>`,
    text(x + 31, y + 88, item.title, 'card-title'),
    text(x + 31, y + 126, item.rule, 'card-rule'),
    text(x + 31, y + 157, item.detail, 'card-detail'),
    `<line x1="${x + 30}" y1="${y + 177}" x2="${x + CARD_W - 30}" y2="${y + 177}" stroke="#E6E8E3" stroke-width="1"/>`,
    `<circle cx="${x + 39}" cy="${y + 198}" r="4" fill="${error ? '#B4775D' : accent}"/>`,
    text(x + 53, y + 204, label, error ? 'note-label error' : 'note-label'),
    text(x + 198, y + 204, note, 'note-text'),
    text(x + 31, y + 229, fix, 'fix-text'),
    '</g>',
  ].join('\n')
}

/** 拼 SVG。数据不合法就抛——抛出来的都是给教练看的实话，别让它画出一张残缺的图。 */
export function reviewSvg(data) {
  if (!data || !Array.isArray(data.branches)) throw new Error('复盘图没有 branches，画不出来')
  const branches = data.branches
  if (branches.length < 1 || branches.length > 6) {
    throw new Error(`复盘图要 1—6 个分支，收到 ${branches.length} 个`)
  }
  const sides = { left: [], right: [] }
  for (const item of branches) {
    if (item.side !== 'left' && item.side !== 'right') {
      throw new Error(`复盘图的分支 side 只能是 left 或 right，收到「${item.side}」`)
    }
    sides[item.side].push(item)
  }
  for (const side of ['left', 'right']) {
    if (!ROWS[sides[side].length]) throw new Error(`${side} 侧最多挂 3 个分支，收到 ${sides[side].length} 个`)
  }
  /* 这条是从 good-learning-skill 抄的，也是整套版式里最值钱的一条：
     错题数必须等于带错题的分支数。于是「演示数据不能算真实表现」这种规矩
     在代码里真有实现，不只是提示词里的一句口号。 */
  const marked = branches.filter((b) => b.error).length
  if (marked !== data.error_count) {
    throw new Error(`error_count 是 ${data.error_count}，但带错题的分支有 ${marked} 个`)
  }

  const categories = [...new Set(branches.map((b) => b.category))]
  const colors = {}
  categories.forEach((name, i) => {
    colors[name] = PALETTE[i % PALETTE.length]
  })

  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${REVIEW_WIDTH} ${REVIEW_HEIGHT}" width="${REVIEW_WIDTH}" height="${REVIEW_HEIGHT}" role="img" aria-labelledby="map-title map-desc">`,
    `<title id="map-title">${esc(data.title)}</title>`,
    `<desc id="map-desc">${esc(data.description)}</desc>`,
    `<defs>
  <filter id="soft-shadow" x="-20%" y="-20%" width="140%" height="150%">
    <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#4D6253" flood-opacity=".065"/>
  </filter>
  <style>
    text { font-family: "Noto Sans CJK SC", "Noto Sans SC", "Microsoft YaHei", "PingFang SC", sans-serif; fill: #27332D; }
    .eyebrow { font-size: 17px; font-weight: 700; letter-spacing: 2px; fill: #65746B; }
    .main-title { font-size: 50px; font-weight: 700; letter-spacing: 1px; }
    .subtitle { font-size: 22px; fill: #69776E; }
    .status { font-size: 18px; font-weight: 700; fill: #805A48; }
    .number { font-size: 19px; font-weight: 700; fill: #8B9890; }
    .category { font-size: 16px; font-weight: 700; }
    .card-title { font-size: 30px; font-weight: 700; }
    .card-rule { font-size: 22px; font-weight: 500; }
    .card-detail { font-size: 20px; fill: #67746B; }
    .note-label { font-size: 18px; font-weight: 700; fill: #607D6B; }
    .note-label.error { fill: #A36A52; }
    .note-text { font-size: 19px; fill: #5E6961; }
    .fix-text { font-size: 19px; font-weight: 600; fill: #4C6755; }
    .core-small { font-size: 18px; font-weight: 700; letter-spacing: 2px; fill: #BDD0C2; }
    .core-title { font-size: 48px; font-weight: 700; fill: #FFFFFF; }
    .core-subtitle { font-size: 25px; fill: #E0E8E0; }
    .core-count { font-size: 23px; font-weight: 600; fill: #FFFFFF; }
    .core-foot { font-size: 18px; fill: #C0CFC2; }
    .footer { font-size: 19px; fill: #66756A; }
    .footer-strong { font-size: 19px; font-weight: 700; fill: #344338; }
  </style>
</defs>`,
    `<rect width="${REVIEW_WIDTH}" height="${REVIEW_HEIGHT}" fill="#F6F5F0"/>`,
    '<circle cx="1024" cy="630" r="297" fill="#EDEFE9" opacity=".55"/>',
    text(76, 76, data.eyebrow, 'eyebrow'),
    text(76, 137, data.title, 'main-title'),
    text(78, 170, data.subtitle, 'subtitle'),
    '<rect x="1553" y="87" width="414" height="45" rx="22.5" fill="#F3E7DF"/>',
    text(1581, 117, data.status, 'status'),
    '<line x1="76" y1="183" x2="1972" y2="183" stroke="#D8DFD7" stroke-width="1.5"/>',
  ]

  /* 连线在卡片之前，不然会压住卡片。 */
  for (const side of ['left', 'right']) {
    const items = sides[side]
    items.forEach((item, j) => {
      const y = ROWS[items.length][j]
      const targetY = y + CARD_H / 2
      const n = items.length
      const sourceY = n === 3 ? [572, 630, 688][j] : n === 2 ? [590, 670][j] : 630
      const path =
        side === 'left'
          ? `M 772 ${sourceY} C 704 ${sourceY}, 726 ${targetY}, 670 ${targetY}`
          : `M 1276 ${sourceY} C 1344 ${sourceY}, 1322 ${targetY}, 1378 ${targetY}`
      const accent = (colors[item.category] || PALETTE[0])[0]
      out.push(`<path d="${path}" fill="none" stroke="${accent}" stroke-width="3.4" stroke-linecap="round" opacity=".8"/>`)
      out.push(`<circle cx="${side === 'left' ? 670 : 1378}" cy="${targetY}" r="5.5" fill="${accent}"/>`)
    })
  }

  out.push(
    '<rect x="772" y="473" width="504" height="314" rx="34" fill="#293A30" filter="url(#soft-shadow)"/>',
    '<circle cx="1024" cy="509" r="4" fill="#91B49B"/>',
    text(1024, 520, data.core_label, 'core-small', ' text-anchor="middle"'),
    text(1024, 601, data.core_title, 'core-title', ' text-anchor="middle"'),
    text(1024, 646, data.core_subtitle, 'core-subtitle', ' text-anchor="middle"'),
    '<line x1="846" y1="682" x2="1202" y2="682" stroke="#799183" stroke-width="1.5"/>',
    text(1024, 724, data.workload, 'core-count', ' text-anchor="middle"'),
    text(1024, 755, data.core_foot, 'core-foot', ' text-anchor="middle"'),
  )

  for (const [side, x] of [['left', LEFT_X], ['right', RIGHT_X]]) {
    sides[side].forEach((item, j) => {
      const index = side === 'left' ? j + 1 : sides.left.length + j + 1
      out.push(card(item, x, ROWS[sides[side].length][j], index, colors))
    })
  }

  out.push(
    '<line x1="76" y1="1095" x2="1972" y2="1095" stroke="#D8DFD7" stroke-width="1.5"/>',
    text(76, 1130, data.legend, 'footer-strong'),
    text(488, 1130, data.note_legend, 'footer'),
    text(1972, 1130, data.footer, 'footer', ' text-anchor="end"'),
    '</svg>',
  )
  return out.join('\n') + '\n'
}
