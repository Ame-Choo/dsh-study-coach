/**
 * 读卷页。AI 出的卷子（还有讲义）是 .md 落在数据目录里，直接从 /study/file 打开的话，
 * 浏览器只会把 markdown 源码倒给他看 —— 这一页把它按面板的版式摊开。
 *
 * 三件事：
 *   1. 正文渲染成面板的排版（assets/md.js 干这个，题号锚点也在那边钉）；
 *   2. 顶上一排能跳的地方：题号 + 章节。URL 里带 #q3 就直接落到第 3 题；
 *   3. 「参考答案」在正文里就是折起来的，先做，做完自己掀。
 */
import { renderMarkdown } from './md.js'

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

const KIND = { book: '教辅', video: '网课', notes: '讲义', past: '真题', ai: 'AI 出题', other: '其他' }

let state = { loading: true, error: '', doc: null, view: null, point: '' }

function query(name) {
  return new URLSearchParams(location.search).get(name) || ''
}

/** #q3 / #sec2 直接落过去。正文是渲染完才有的，浏览器自己那一下落空，得我们来。 */
function jumpToHash() {
  const id = String(location.hash || '').replace(/^#/, '')
  if (!id) return
  const hit = document.getElementById(id)
  if (hit) hit.scrollIntoView({ block: 'start' })
}

function head() {
  const backHref = state.point
    ? '/study/practice?point=' + encodeURIComponent(state.point)
    : '/study/materials'
  const backLabel = state.point ? '← 回到这一节' : '← 回到资料'
  const material = state.doc && state.doc.material
  const kind = material ? (KIND[material.kind] || '其他') : '文件'
  const title = (material && material.title) || (state.doc ? state.doc.name : '')
  return `<header class="rd-head">
    <a class="back" href="${esc(backHref)}">${esc(backLabel)}</a>
    <div class="crumb"><span>${esc(title)}</span></div>
    <span class="rd-kind">${esc(kind)}</span>
  </header>`
}

function nav() {
  const view = state.view
  const rows = []
  if (view.questions.length) {
    rows.push(`<div class="rd-row"><b>题目</b>${view.questions
      .map((n) => `<a href="#q${n}">第 ${n} 题</a>`).join('')}</div>`)
  }
  const secs = view.toc.filter((one) => one.level >= 2 && one.level <= 4 && !one.q)
  if (secs.length > 1) {
    rows.push(`<div class="rd-row"><b>章节</b>${secs
      .map((one) => `<a class="sec" href="#${esc(one.id)}">${esc(one.text)}</a>`).join('')}</div>`)
  }
  return rows.length ? `<nav class="card rd-nav">${rows.join('')}</nav>` : ''
}

function foot() {
  const doc = state.doc
  const material = doc.material
  const point = state.point || (material && material.pointId) || ''
  const back = point
    ? `<a class="btn primary" href="/study/practice?point=${encodeURIComponent(point)}">去记这一节的掌握度</a>`
    : `<a class="btn primary" href="/study/materials">回资料页</a>`
  return `<section class="card rd-foot">
    <h2>做完了</h2>
    <p>答案就在上面折着的那一条里 —— 先自己做完，再点开对。对完之后回做题页记一档，我才知道这一节你过没过。</p>
    <div class="quick">
      ${back}
      <a class="btn ghost" href="/study/file?path=${encodeURIComponent(doc.path)}">看原文（markdown 源码）</a>
    </div>
  </section>`
}

function render() {
  const app = document.querySelector('#app')
  if (state.loading) {
    app.className = 'loading'
    app.textContent = '读取中…'
    return
  }
  app.className = ''
  if (state.error) {
    app.innerHTML = `<section class="card"><h2>打不开这份</h2>
      <p class="dim">${esc(state.error)}</p>
      <div class="quick"><a class="btn" href="/study/materials">回资料页</a></div>
    </section>`
    return
  }
  const doc = state.doc
  const cut = doc.truncated
    ? `<div class="rd-cut"><b>这份很长，只读进来前面一部分。</b>后面还有内容没画出来 —— 完整的一份在
       <a href="/study/file?path=${encodeURIComponent(doc.path)}">原文</a>里。</div>`
    : ''
  const note = state.point
    ? `<div class="rd-cut">从「这一节的练习」跳过来的：上面折着的答案先别掀，做完回
       <a href="/study/practice?point=${encodeURIComponent(state.point)}">做题页</a>记一档。</div>`
    : ''
  app.innerHTML = head() + nav() + cut + note +
    `<article class="card rd-doc">${state.view.html}</article>` +
    foot()
  document.title = doc.name + ' · 学习教练'
  jumpToHash()
}

async function load() {
  const target = query('path')
  state.point = query('point')
  if (!target) {
    state.loading = false
    state.error = '地址里没说要读哪一份（少了 ?path=）。'
    render()
    return
  }
  try {
    const data = await api('/study/api/doc?path=' + encodeURIComponent(target))
    state.doc = data.doc
    state.view = renderMarkdown(data.doc.text)
    state.loading = false
  } catch (err) {
    state.loading = false
    state.error = err.message
  }
  render()
}

window.addEventListener('hashchange', jumpToHash)
load()
