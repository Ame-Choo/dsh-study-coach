/**
 * 做题页。从知识图谱的最小单元点进来，或者从面板的任务点进来。
 *
 * 这页干三件事：
 *   1. 告诉你这一节对应教辅的哪几页、哪几题，点一下直接翻开；
 *   2. 不想做现成的，可以让我出几道新的（写进留言，回对话里给）；
 *   3. 做完自己评个档位，直接落到掌握度上。
 */
import { STAGE_COLOR, STAGES } from './stages.js'

const api = async (path, body) => {
  const res = await fetch(path, body
    ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
    : undefined)
  const data = await res.json().catch(() => null)
  if (!res.ok || !data || data.ok === false) {
    throw new Error((data && data.error && data.error.message) || `请求失败（${res.status}）`)
  }
  return data
}

const esc = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const KIND = { book: '教辅', video: '网课', notes: '讲义', past: '真题', other: '其他' }

function toast(text) {
  const box = document.querySelector('#toast')
  box.textContent = text
  box.classList.add('show')
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => { box.classList.remove('show') }, 2600)
}

/** 本地文件走 /study/file，http 链接直接开。给了页码就带 #page=N，PDF 阅读器会翻到那一页。 */
function openLink(target, page) {
  const t = String(target || '').trim()
  if (!t) return ''
  const base = /^https?:\/\//i.test(t) ? t : '/study/file?path=' + encodeURIComponent(t)
  const n = Number(String(page ?? '').replace(/\D/g, ''))
  return n > 0 ? base + '#page=' + n : base
}

let data = null
/* 「按页直达」那份：{ hits: [...] }；服务端是旧代码就是 null */
let pages = null
let ui = { note: '', busy: '', askText: '', selfTitle: '', selfMinutes: 30, wrongOrigin: '', wrongText: '' }

function materialPath(materialId) {
  const hit = (data.materials || []).find((m) => m.id === materialId)
  return hit ? hit.path : ''
}

/** 这一节能直接翻开的现成东西：自己的讲义、章级文件、真题材料。 */
function readyItems() {
  const out = []
  const seen = new Set()
  const add = (label, target, note) => {
    const value = String(target || '').trim()
    if (!value || seen.has(value)) return
    seen.add(value)
    out.push({ label, target: value, note: String(note || '') })
  }
  add('本节讲义', data.point.practice, baseName(data.point.practice))
  for (const ch of data.chapters || []) {
    if (ch.file) add((ch.no ? '第 ' + ch.no + ' 章' : '章节') + ' · ' + (ch.title || ''), ch.file, ch.exercises ? '习题 ' + ch.exercises : '')
  }
  for (const m of data.materials || []) {
    if (m.kind !== 'past') continue
    add(m.title || '真题', m.path, '整份材料')
  }
  return out
}

function baseName(target) {
  const parts = String(target || '').split(/[\\/]/)
  return parts[parts.length - 1] || ''
}

function chapterRow(ch) {
  const path = ch.file || materialPath(ch.materialId)
  const bits = []
  if (ch.pages) bits.push(`${esc(ch.pages)} 页`)
  if (ch.exercises) bits.push(`习题 ${esc(ch.exercises)}`)
  if (ch.examples) bits.push(`例题 ${esc(ch.examples)}`)
  if (ch.difficulty) bits.push(esc(ch.difficulty))
  const marks = (ch.marks || []).filter((m) => m.page)
  return `
    <div class="ch-row">
      <div class="ch-head">
        <span class="ch-no">${ch.no ? '第 ' + esc(ch.no) + ' 章' : '章节'}</span>
        <span class="ch-title">${esc(ch.title) || esc(ch.material)}</span>
        ${path ? `<a class="open-link" href="${esc(openLink(path))}" target="_blank" rel="noopener">打开</a>` : ''}
      </div>
      ${ch.topics ? `<div class="ch-topics">${esc(ch.topics)}</div>` : ''}
      ${bits.length ? `<div class="ch-meta">${bits.join(' · ')}</div>` : ''}
      ${marks.length
        ? `<div class="pg">${marks.map((m) => path
            ? `<a class="pg-btn" href="${esc(openLink(path, m.page))}" target="_blank" rel="noopener">${esc(m.label) || '本节'}<b>第 ${esc(m.page)} 页</b></a>`
            : `<span class="pg-btn">${esc(m.label) || '本节'}<b>第 ${esc(m.page)} 页</b></span>`).join('')}</div>`
        : (path ? '<div class="pg none">本章尚未按页拆解，仅能打开整份 PDF</div>' : '')}
      ${ch.role ? `<div class="ch-role">${esc(ch.role)}</div>` : ''}
    </div>`
}

/**
 * 页码是从哪儿来的：agent 把 PDF 拆成单页 PNG 一页页看出来的（study_pages + read_image），
 * 然后写进 analysis 的 marks。一份没拆过页的讲义，只能给「翻哪一份」，给不出「第几页」——
 * 这个差别要当面说清楚，别让学生以为坏了。
 */
function pageHint() {
  const total = (data.materials || []).reduce((n, m) => n + (m.pagedCount || 0), 0)
  if (total > 0) return ''
  return `<p class="dim">这几章现在只到「哪一份文件」，还没到「第几页」。
    将这份讲义逐页拆解后，即可按知识点直接跳转到页码。</p>`
}

/**
 * 「按页直达」：同一个单元，手上这几本教辅各占哪几页。
 *
 * 跟上面那张「教辅对应位置」不是一回事——那张是按**章**列的（这一章在哪份文件的第几页），
 * 这张是按**单元**列的（M1.4 在教辅 A 是第 12—17 页、在教辅 B 是第 30—34 页）。
 * 于是他手上有什么就能做什么，不用被绑死在一本书上。
 */
function hitsCard() {
  const hits = pages && Array.isArray(pages.hits) ? pages.hits : []
  if (!hits.length) {
    return `<section class="card">
      <h2>按页直达</h2>
      <p class="dim">还没有哪本教辅把这一节归过页。把教辅拆成页图、读一遍目录、把每一页归到单元上之后，
      这里就会列出各本各占哪几页，点一下直接翻过去。</p>
    </section>`
  }
  const rows = hits
    .map((h) => {
      const span = Number(h.from) === Number(h.to) ? `${h.from}` : `${h.from}—${h.to}`
      const pagesHtml = (h.pages || [])
        .map((p) =>
          p.url
            ? `<a class="pg-btn" href="${esc(p.url)}" target="_blank" rel="noopener"><b>第 ${esc(p.page)} 页</b></a>`
            : `<span class="pg-btn off">第 ${esc(p.page)} 页</span>`,
        )
        .join('')
      return `<div class="hit">
        <div class="hit-head">
          <span class="tag">${esc(KIND[h.kind] || '其他')}</span>
          <b>${esc(h.material)}</b>
          <span class="dim">${span} 页 · ${esc(h.pageKind || '其他')}</span>
        </div>
        ${h.note ? `<div class="dim">${esc(h.note)}</div>` : ''}
        <div class="pg">${pagesHtml}</div>
      </div>`
    })
    .join('')
  return `<section class="card">
    <h2>按页直达</h2>
    <p class="dim">同一个单元，各本教辅各占哪几页。想做哪本点哪本。</p>
    ${rows}
  </section>`
}

async function loadPointPages(pointId) {
  try {
    const out = await api('/study/api/point/pages?point=' + encodeURIComponent(pointId))
    return { hits: Array.isArray(out.hits) ? out.hits : [] }
  } catch {
    // 服务端是旧代码（没这条路由）就没这一块，别的照旧能用
    return null
  }
}

function pickBlock() {
  const ready = readyItems()
  const busy = (name) => (ui.busy === name ? 'disabled' : '')
  const label = (name, text) => (ui.busy === name ? text + '…' : text)

  return `
  <section class="card">
    <h2>选择练习方式</h2>
    <div class="pick">
      <div class="pick-block">
        <b>使用现有材料</b>
        ${ready.length
          ? `<div class="quick">${ready.map((r) => `
              <a class="btn alt" href="${esc(openLink(r.target))}" target="_blank" rel="noopener" title="${esc(r.target)}">
                ${esc(r.label)}${r.note ? `<span class="sub">${esc(r.note)}</span>` : ''}
              </a>`).join('')}</div>`
          : '<p class="dim">本节尚未关联现成材料。读完教辅后即可在此显示页码与题号。</p>'}
      </div>

      <div class="pick-block">
        <b>由教练出题</b>
        <p class="dim">我会依据本节另行出题。完成后在对话中告知，即可获取题目。</p>
        <textarea id="ask-text" rows="2" placeholder="想专挑哪种？比如「来三道这一类的」「基础题为主」">${esc(ui.askText)}</textarea>
        <button class="btn" data-act="ask-ai" ${busy('ai')}>${label('ai', '请教练出题')}</button>
      </div>

      <div class="pick-block">
        <b>自行安排</b>
        <p class="dim">重做错题、背诵公式或专项练习均可。写下需求，我会排入今日任务。</p>
        <div class="two">
          <input id="self-title" type="text" placeholder="今天练什么" value="${esc(ui.selfTitle)}">
          <input id="self-minutes" type="number" min="0" step="5" value="${esc(ui.selfMinutes)}">
        </div>
        <button class="btn" data-act="ask-self" ${busy('self')}>${label('self', '排入今日任务')}</button>
      </div>

      <div class="pick-block wrong">
        <b>这题做错了</b>
        <p class="dim">填上题号和错在哪。我会判断错因、给出订正，并把这道题记进错题本；过几天再让你重做一遍。</p>
        <input id="wrong-origin" type="text" placeholder="题号 / 出处，如「第九组 第 3 题」" value="${esc(ui.wrongOrigin)}">
        <textarea id="wrong-text" rows="2" placeholder="错在哪，比如「A 是空集那种情况我没管」">${esc(ui.wrongText)}</textarea>
        <button class="btn" data-act="ask-wrong" ${busy('wrong')}>${label('wrong', '交给教练判错因')}</button>
      </div>
    </div>
  </section>`
}

function render() {
  const app = document.querySelector('#app')
  if (!data) { app.className = 'loading'; app.textContent = '读取中…'; return }
  app.className = ''

  const p = data.point
  const crumbs = [data.module.group, data.module.title, p.title].filter(Boolean)
  const chapters = data.chapters || []
  const practiceLink = openLink(p.practice)
  const videoLink = openLink(p.video)

  app.innerHTML = `
  <header class="pr-head">
    <a class="back" href="/study">← 返回面板</a>
    <div class="crumb">${crumbs.map((c) => `<span>${esc(c)}</span>`).join('<i>›</i>')}</div>
    <div class="pr-stage" style="--c:${esc(STAGE_COLOR[data.stage] || 'var(--stage-1)')}">${esc(data.stage)}</div>
  </header>

  <section class="card">
    <h2>这一节</h2>
    ${p.why ? `<p class="why">${esc(p.why)}</p>` : ''}
    <div class="quick">
      ${videoLink ? `<a class="btn" href="${esc(videoLink)}" target="_blank" rel="noopener">观看本节网课</a>` : `<span class="btn ghost">本节尚未关联网课</span>`}
      ${practiceLink ? `<a class="btn" href="${esc(practiceLink)}" target="_blank" rel="noopener">打开配套练习</a>` : ''}
      ${p.source ? `<span class="src">${esc(p.source)}</span>` : ''}
    </div>
  </section>

  <section class="card">
    <h2>教辅对应位置</h2>
    ${chapters.length
      ? chapters.map(chapterRow).join('') + pageHint()
      : '<p class="dim">尚未通读教辅，或本节未匹配到章节。通读材料后即可在此显示页码与题号。</p>'}
  </section>

  ${pickBlock()}

  ${pages ? hitsCard() : ''}

  <section class="card">
    <h2>当前掌握程度</h2>
    <div class="stages">
      ${STAGES.map((s) => `
        <button class="stage-btn${s === data.stage ? ' on' : ''}" data-act="rate" data-stage="${esc(s)}"
          style="--c:${esc(STAGE_COLOR[s] || 'var(--stage-1)')}">${esc(s)}</button>`).join('')}
    </div>
    <div class="note-row">
      <input id="note" type="text" placeholder="凭什么这么判？比如「今天做了 5 道，3 道自己会的」" value="${esc(ui.note)}">
    </div>
    <p class="dim">点击档位即可记录。每次仅可前进一档，跳级会被驳回。</p>
  </section>
  `
}

async function load() {
  const pointId = new URLSearchParams(location.search).get('point') || ''
  if (!pointId) {
    document.querySelector('#app').className = 'loading'
    document.querySelector('#app').textContent = '未指定练习章节'
    return
  }
  try {
    data = await api('/study/api/practice?point=' + encodeURIComponent(pointId))
  } catch (error) {
    document.querySelector('#app').className = 'loading'
    document.querySelector('#app').textContent = String(error.message || error)
    return
  }
  // 这一条单独拉：服务端没有它照样能用，失败了也就是少一块，不该把整页打成报错
  pages = await loadPointPages(pointId)
  render()
}

document.addEventListener('click', async (event) => {
  const btn = event.target.closest('[data-act]')
  if (!btn) return
  const act = btn.dataset.act

  if (act === 'ask-ai' || act === 'ask-self' || act === 'ask-wrong') {
    // 重渲染会把输入框清空，先把学生写的收进 ui 再动手。
    ui.askText = (document.querySelector('#ask-text') || {}).value || ''
    ui.selfTitle = (document.querySelector('#self-title') || {}).value || ''
    ui.selfMinutes = (document.querySelector('#self-minutes') || {}).value || 30
    ui.wrongOrigin = (document.querySelector('#wrong-origin') || {}).value || ''
    ui.wrongText = (document.querySelector('#wrong-text') || {}).value || ''

    const which = act === 'ask-ai' ? 'ai' : act === 'ask-wrong' ? 'mistake' : 'self'
    if (ui.busy) return
    if (which === 'self' && !ui.selfTitle.trim()) {
      toast('请先填写今天打算练习的内容')
      return
    }
    if (which === 'mistake' && !ui.wrongOrigin.trim() && !ui.wrongText.trim()) {
      toast('写一句错在哪，或者填上题号')
      return
    }
    ui.busy = which
    render()
    try {
      const body = { pointId: data.pointId, mode: which }
      if (which === 'ai') body.text = ui.askText
      else if (which === 'mistake') {
        body.origin = ui.wrongOrigin
        body.text = ui.wrongText
      } else {
        body.text = ui.selfTitle
        body.minutes = Number(ui.selfMinutes) || 0
        body.open = data.point.practice
      }
      const out = await api('/study/api/practice/ask', body)
      ui.busy = ''
      if (which === 'self') {
        ui.selfTitle = ''
        render()
        toast('已排入今日任务，可在面板查看')
      } else if (which === 'mistake') {
        ui.wrongOrigin = ''
        ui.wrongText = ''
        render()
        // 记没记上是教练的活儿，这里只保证「这道题已经摆到他面前了」。
        toast(out.pushed
          ? '已交给教练：他会判错因、给订正，并记进错题本'
          : '已暂存（未送达对话：' + (out.pushError || '通道未通') + '），请回到对话中说明')
      } else {
        ui.askText = ''
        render()
        // 投递成没成是两回事：成了我立刻就被叫起来，没成他得回对话里说一声。
        toast(out.pushed ? '已提交，请在对话中等待出题' : '已暂存（未送达对话：' + (out.pushError || '通道未通') + '），请回到对话中说明')
      }
    } catch (error) {
      ui.busy = ''
      render()
      toast(String(error.message || error))
    }
    return
  }

  if (act === 'rate') {
    const stage = btn.dataset.stage
    const note = (document.querySelector('#note') || {}).value || ''
    try {
      await api('/study/api/mastery', { pointId: data.pointId, stage, note, kind: 'self' })
      data.stage = stage
      ui.note = ''
      render()
      toast('已记录')
    } catch (error) {
      toast(String(error.message || error))
    }
  }
})

load()
