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
let ui = { note: '', busy: '', askText: '', selfTitle: '', selfMinutes: 30 }

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
  add('这一节的讲义', data.point.practice, baseName(data.point.practice))
  for (const ch of data.chapters || []) {
    if (ch.file) add((ch.no ? '第 ' + ch.no + ' 章' : '章节') + ' · ' + (ch.title || ''), ch.file, ch.exercises ? '习题 ' + ch.exercises : '')
  }
  for (const m of data.materials || []) {
    if (m.kind !== 'past') continue
    add(m.title || '真题', m.path, '整份都在里面')
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
        ${path ? `<a class="open-link" href="${esc(openLink(path))}" target="_blank" rel="noopener">翻开</a>` : ''}
      </div>
      ${ch.topics ? `<div class="ch-topics">${esc(ch.topics)}</div>` : ''}
      ${bits.length ? `<div class="ch-meta">${bits.join(' · ')}</div>` : ''}
      ${marks.length
        ? `<div class="pg">${marks.map((m) => path
            ? `<a class="pg-btn" href="${esc(openLink(path, m.page))}" target="_blank" rel="noopener">${esc(m.label) || '这一节'}<b>第 ${esc(m.page)} 页</b></a>`
            : `<span class="pg-btn">${esc(m.label) || '这一节'}<b>第 ${esc(m.page)} 页</b></span>`).join('')}</div>`
        : (path ? '<div class="pg none">这一章还没拆到页，现在只能翻开整份 PDF</div>' : '')}
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
    让我把这份讲义拆成一页一页看一遍，就能按知识点直接跳到页码。</p>`
}

function pickBlock() {
  const ready = readyItems()
  const busy = (name) => (ui.busy === name ? 'disabled' : '')
  const label = (name, text) => (ui.busy === name ? text + '…' : text)

  return `
  <section class="card">
    <h2>练什么，你定</h2>
    <div class="pick">
      <div class="pick-block">
        <b>刷现成的</b>
        ${ready.length
          ? `<div class="quick">${ready.map((r) => `
              <a class="btn alt" href="${esc(openLink(r.target))}" target="_blank" rel="noopener" title="${esc(r.target)}">
                ${esc(r.label)}${r.note ? `<span class="sub">${esc(r.note)}</span>` : ''}
              </a>`).join('')}</div>`
          : '<p class="dim">这一节还没挂上现成的材料。翻完教辅我就能把页码题号摆在这儿。</p>'}
      </div>

      <div class="pick-block">
        <b>让 AI 出题</b>
        <p class="dim">我照着这一节另出几道。写完回对话里找我，题就给你。</p>
        <textarea id="ask-text" rows="2" placeholder="想专挑哪种？比如「来三道这一类的」「基础题为主」">${esc(ui.askText)}</textarea>
        <button class="btn" data-act="ask-ai" ${busy('ai')}>${label('ai', '让 AI 出几道')}</button>
      </div>

      <div class="pick-block">
        <b>自己安排</b>
        <p class="dim">想重做错题、想背公式、想专练某一类，都行——写一句，我排进今天的任务。</p>
        <div class="two">
          <input id="self-title" type="text" placeholder="今天练什么" value="${esc(ui.selfTitle)}">
          <input id="self-minutes" type="number" min="0" step="5" value="${esc(ui.selfMinutes)}">
        </div>
        <button class="btn" data-act="ask-self" ${busy('self')}>${label('self', '排进今天的任务')}</button>
      </div>
    </div>
  </section>`
}

function render() {
  const app = document.querySelector('#app')
  if (!data) { app.className = 'loading'; app.textContent = '正在读这一节…'; return }
  app.className = ''

  const p = data.point
  const crumbs = [data.module.group, data.module.title, p.title].filter(Boolean)
  const chapters = data.chapters || []
  const practiceLink = openLink(p.practice)
  const videoLink = openLink(p.video)

  app.innerHTML = `
  <header class="pr-head">
    <a class="back" href="/study">← 回面板</a>
    <div class="crumb">${crumbs.map((c) => `<span>${esc(c)}</span>`).join('<i>›</i>')}</div>
    <div class="pr-stage" style="--c:${esc(STAGE_COLOR[data.stage] || 'var(--stage-1)')}">${esc(data.stage)}</div>
  </header>

  <section class="card">
    <h2>这一节</h2>
    ${p.why ? `<p class="why">${esc(p.why)}</p>` : ''}
    <div class="quick">
      ${videoLink ? `<a class="btn" href="${esc(videoLink)}" target="_blank" rel="noopener">看这一节网课</a>` : `<span class="btn ghost">这一节还没挂网课</span>`}
      ${practiceLink ? `<a class="btn" href="${esc(practiceLink)}" target="_blank" rel="noopener">打开配套练习</a>` : ''}
      ${p.source ? `<span class="src">${esc(p.source)}</span>` : ''}
    </div>
  </section>

  <section class="card">
    <h2>教辅里对应哪儿</h2>
    ${chapters.length
      ? chapters.map(chapterRow).join('') + pageHint()
      : '<p class="dim">还没读过教辅，或者这一节还没对上哪一章。翻完材料我就能把页码题号摆在这儿。</p>'}
  </section>

  ${pickBlock()}

  <section class="card">
    <h2>我现在到哪一档了</h2>
    <div class="stages">
      ${STAGES.map((s) => `
        <button class="stage-btn${s === data.stage ? ' on' : ''}" data-act="rate" data-stage="${esc(s)}"
          style="--c:${esc(STAGE_COLOR[s] || 'var(--stage-1)')}">${esc(s)}</button>`).join('')}
    </div>
    <div class="note-row">
      <input id="note" type="text" placeholder="凭什么这么判？比如「今天做了 5 道，3 道自己会的」" value="${esc(ui.note)}">
    </div>
    <p class="dim">点档位就记下了。一次只往前走一档，跳级我会给你压回来。</p>
  </section>
  `
}

async function load() {
  const pointId = new URLSearchParams(location.search).get('point') || ''
  if (!pointId) {
    document.querySelector('#app').className = 'loading'
    document.querySelector('#app').textContent = '没说要练哪一节'
    return
  }
  try {
    data = await api('/study/api/practice?point=' + encodeURIComponent(pointId))
    render()
  } catch (error) {
    document.querySelector('#app').className = 'loading'
    document.querySelector('#app').textContent = String(error.message || error)
  }
}

document.addEventListener('click', async (event) => {
  const btn = event.target.closest('[data-act]')
  if (!btn) return
  const act = btn.dataset.act

  if (act === 'ask-ai' || act === 'ask-self') {
    // 重渲染会把输入框清空，先把学生写的收进 ui 再动手。
    ui.askText = (document.querySelector('#ask-text') || {}).value || ''
    ui.selfTitle = (document.querySelector('#self-title') || {}).value || ''
    ui.selfMinutes = (document.querySelector('#self-minutes') || {}).value || 30

    const which = act === 'ask-ai' ? 'ai' : 'self'
    if (ui.busy) return
    if (which === 'self' && !ui.selfTitle.trim()) {
      toast('先写一句今天打算练什么')
      return
    }
    ui.busy = which
    render()
    try {
      const body = { pointId: data.pointId, mode: which }
      if (which === 'ai') body.text = ui.askText
      else {
        body.text = ui.selfTitle
        body.minutes = Number(ui.selfMinutes) || 0
        body.open = data.point.practice
      }
      const out = await api('/study/api/practice/ask', body)
      ui.busy = ''
      if (which === 'self') {
        ui.selfTitle = ''
        render()
        toast('排进今天的任务了，面板上能看到')
      } else {
        ui.askText = ''
        render()
        // 投递成没成是两回事：成了我立刻就被叫起来，没成他得回对话里说一声。
        toast(out.pushed ? '递过去了，回对话里等我出题' : '先存下了（没递进对话：' + (out.pushError || '通道没通') + '），回对话里跟我说一声')
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
      toast('记下了')
    } catch (error) {
      toast(String(error.message || error))
    }
  }
})

load()
