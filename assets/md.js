/* ══ 一份小 markdown 渲染器 ═════════════════════════════════════════════════
 * 只认教练写卷子用得上的那些写法。**不是**通用 markdown 实现，也别拿它当通用实现用：
 * 遇到不认的东西它就老老实实当普通文字画出来，不猜、不报错、不吐源码。
 *
 * 认的：
 *   ``` 代码块 / `#`…`######` 标题 / `---` 分隔线 / `|` 表格 / `>` 引用
 *   `-`、`*`、`+` 与 `N.`、`N、` 列表（一层，缩进的项画成下一级）
 *   **粗** / *斜* / `码` / ~~删~~ / [文字](链接)
 *   数学：`$…$`、`\(…\)` 行内，`$$…$$`、`\[…\]` 独立成行 —— 排给 KaTeX（`assets/vendor/katex/`，
 *   页面用 `<script>` 装成 `window.katex`）。**没装上 KaTeX 也不吐源码**：退回一段等宽的
 *   `<code class="md-math">`，宁可难看，不能半路抛。
 *   段落里的单个换行也断行（题面一行一句，软换行会把选项挤成一坨）
 * 不认：嵌套列表、脚注、HTML —— HTML 一律转义成字面量，不会漏进 DOM。
 *
 * 额外干两件事，这两件才是它存在的理由：
 *   1. **给每一题钉锚点** `id="qN"`（`第 3 题`、`3.`、`3、`、`**3.**` 都认，
 *      同一个题号只钉一次），做题页那排「第 3 题」按钮就落在它上面；
 *   2. **把答案折起来**：「答案 / 参考答案 / 解答 / 解析」那一节外面套
 *      `<details class="md-answer">`，学生先做，做完自己掀答案。
 * ═════════════════════════════════════════════════════════════════════════ */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/** 转义成字面量。所有往里塞文字的路径都得先过这一道。 */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch])
}

/** 链接只放行这几种：站内、锚点、http(s)。别的（`javascript:`、`data:`…）降级成纯文字。 */
function safeHref(raw) {
  const href = String(raw ?? '').trim()
  if (/^https?:\/\//i.test(href)) return escapeHtml(href)
  if (href.startsWith('/study/') || href.startsWith('#')) return escapeHtml(href)
  return ''
}

/* ── 数学 ─────────────────────────────────────────────────────────────────
 * 排版交给 KaTeX（`assets/vendor/katex/katex.min.js`，页面用 <script> 装成 `window.katex`），
 * 这里**现取现用**：装上就排，没装就退回一段等宽源码。渲染器本身不依赖它，
 * `node --test` 里也就用不着假装有个 KaTeX。
 */

/* 行内公式三种写法。`$…$` 前后都不许贴着数字（「花了 $5 到 $8」不是公式），`\$` 转义过的也不算；
   跨行的公式一律走独立成行那一种，所以这里不含换行。 */
const INLINE_MATH_RE = /\$\$([^$\n]{1,600}?)\$\$|(?<![\\\d])\$(?!\s)([^$\n]{1,300}?)(?<!\s)\$(?!\d)|\\\(([^\n]{1,600}?)\\\)/g

/** 独立成行的公式块：同一行里写完，或者 `$$` 单独一行起、`$$` 单独一行收。 */
const BLOCK_MATH_ONE_LINE_RE = /^\s*(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])\s*$/
const BLOCK_MATH_OPEN_RE = /^\s*(?:\$\$|\\\[)\s*$/
const BLOCK_MATH_CLOSE_RE = /^\s*(?:\$\$|\\\])\s*$/

function katexLib() {
  const katex = globalThis.katex
  return katex && typeof katex.renderToString === 'function' ? katex : null
}

/** 一段 TeX → HTML。KaTeX 不在、或者这条公式它不认，都退回等宽源码，绝不抛。 */
export function renderMath(tex, display = false) {
  const source = String(tex ?? '').trim()
  if (!source) return ''
  const katex = katexLib()
  if (katex) {
    try {
      return katex.renderToString(source, {
        displayMode: Boolean(display),
        throwOnError: false,
        strict: 'ignore',
        trust: false,
      })
    } catch {
      /* 掉到下面那条去 */
    }
  }
  return '<code class="md-math" title="这一版没装上 KaTeX，先按源码看">' + escapeHtml(source) + '</code>'
}

/** 调用方塞进来的记号。`re` 没带 `g` 就替它补一个，免得只换掉第一处。 */
function replaceExtra(text, extra, keep) {
  const re = extra && extra.re
  if (!re || typeof extra.html !== 'function') return text
  const global = re.global ? re : new RegExp(re.source, re.flags + 'g')
  return text.replace(global, (...args) => keep(extra.html(...args)))
}

/** 这一行是不是独立公式块的开头（`startsBlock` 与主循环共用，判据必须一样）。 */
function isBlockMathLine(line) {
  if (BLOCK_MATH_OPEN_RE.test(line)) return true
  const one = BLOCK_MATH_ONE_LINE_RE.exec(line)
  return Boolean(one && (one[1] !== undefined || one[2] !== undefined))
}

/** 收一整块公式。收不到收尾那一行就回 null（调用方当普通文字走，别把后面全吃进去）。 */
function takeBlockMath(lines, start) {
  const one = BLOCK_MATH_ONE_LINE_RE.exec(lines[start])
  if (one && (one[1] !== undefined || one[2] !== undefined)) {
    return { html: blockMathHtml(one[1] !== undefined ? one[1] : one[2]), next: start + 1 }
  }
  if (!BLOCK_MATH_OPEN_RE.test(lines[start])) return null
  const body = []
  let i = start + 1
  while (i < lines.length && !BLOCK_MATH_CLOSE_RE.test(lines[i])) {
    body.push(lines[i])
    i += 1
  }
  if (i >= lines.length) return null
  return { html: blockMathHtml(body.join('\n')), next: i + 1 }
}

function blockMathHtml(tex) {
  return '<div class="md-block-math">' + renderMath(tex, true) + '</div>'
}

/**
 * 行内标记。**先转义、再替换** —— 顺序反过来就是给自己开了个注入口子。
 * 代码段与公式先抽走（占位符是一个 NUL 包着的序号），免得里面的 `*`、`_` 被后面几步动到。
 *
 * `extras` 是调用方自己的记号：数组，每一项 `{ re, html }`（面板拿它把 `[表情: …]` 换成 `<img>`）。
 * `html(...)` 拿到的是正则的捕获组，**自己负责转义** —— 它的产物进的是插槽，不再过转义。
 */
export function inline(raw, extras = []) {
  const slots = []
  const keep = (html) => '\u0000' + (slots.push(html) - 1) + '\u0000'
  let text = String(raw ?? '').replace(/`([^`]+)`/g, (_, code) => keep('<code>' + escapeHtml(code) + '</code>'))
  /* 公式要赶在转义之前抠出来：`\frac` 里的反斜杠是给 KaTeX 的，不是给 HTML 的。 */
  text = text.replace(INLINE_MATH_RE, (whole, block, dollar, paren) =>
    keep(renderMath(block !== undefined ? block : dollar !== undefined ? dollar : paren, false)))
  for (const extra of extras) text = replaceExtra(text, extra, keep)
  text = escapeHtml(text)
  text = text.replace(/\[([^\]]*)\]\(([^()\s]*(?:\([^()\s]*\)[^()\s]*)*)\)/g, (whole, label, href) => {
    const safe = safeHref(href)
    if (!safe) return label || escapeHtml(href)
    return '<a href="' + safe + '" target="_blank" rel="noopener">' + (label || safe) + '</a>'
  })
  text = text.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
  text = text.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<i>$2</i>')
  text = text.replace(/~~([^~]+)~~/g, '<s>$1</s>')
  text = text.replace(/\u0000(\d+)\u0000/g, (_, idx) => slots[Number(idx)])
  return text
}

/** 一段文字里的题号。认不出来就是 0。
 *  认这几种：`第 3 题`、`3.`、`3、`、`3)`、`**3.**`、`**3**.` —— 生成的卷子这几种都会用。 */
export function questionNumber(raw) {
  const text = String(raw ?? '').trim()
  let hit = /^第\s*(\d{1,3})\s*题/.exec(text)
  if (hit) return Number(hit[1])
  hit = /^\*{0,2}(\d{1,3})\*{0,2}\s*[.、．)）]\s*\*{0,2}\s*/.exec(text)
  if (hit) return Number(hit[1])
  return 0
}

/** 「答案」「参考答案」「解析」这种标题 —— 见到就折起来。 */
function isAnswerHeading(text) {
  return /^(?:参考)?(?:答案|解答|解析|答案与解析|参考答案与解析)/.test(String(text ?? '').trim())
}

/** 目录用的干净文字：把标记符号抹掉。 */
function plainText(text) {
  return String(text ?? '').replace(/[*_~`]/g, '').trim()
}

/* 列表项。西文那两种（`. ` / `) `）要求后面有空格，否则 `2023.5.1 是个日期` 会被当成第 202 项；
   中文顿号那种（`3、题面`）本来就不带空格，所以放行 —— 生成的卷子两种都会用。 */
const LIST_ITEM_RE = /^(\s*)(?:([-*+])\s+|(\d{1,3})(?:[、．]\s*|[.)]\s+))(.*)$/
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/

/** 这一行是不是某个块的开头。主循环和段落收集共用它 —— 两处判据不一样就会死循环。 */
function startsBlock(line) {
  return (
    /^\s*```/.test(line) ||
    /^#{1,6}\s+/.test(line) ||
    /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line) ||
    /^\s*>/.test(line) ||
    LIST_ITEM_RE.test(line) ||
    isBlockMathLine(line)
  )
}

function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
}

/** 从第 start 行起认一张表。认不出来回 null（调用方自己往下走）。 */
function takeTable(lines, start) {
  const head = lines[start]
  const sep = lines[start + 1]
  if (!head.includes('|') || sep === undefined || !sep.includes('|') || !TABLE_SEP_RE.test(sep)) return null
  const cells = [splitRow(head)]
  let i = start + 2
  while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
    cells.push(splitRow(lines[i]))
    i += 1
  }
  return { head: cells[0], body: cells.slice(1), next: i }
}

function renderTable(head, body, inl) {
  const th = head.map((cell) => '<th>' + inl(cell) + '</th>').join('')
  const tr = body
    .map((row) => '<tr>' + row.map((cell) => '<td>' + inl(cell) + '</td>').join('') + '</tr>')
    .join('')
  return (
    '<div class="md-table-wrap"><table class="md-table"><thead><tr>' +
    th + '</tr></thead><tbody>' + tr + '</tbody></table></div>'
  )
}

function renderList(items, anchorFor, inl) {
  const parts = []
  let kind = ''
  for (const item of items) {
    const tag = item.marker ? 'ol' : 'ul'
    if (tag !== kind) {
      if (kind) parts.push(kind === 'ol' ? '</ol>' : '</ul>')
      if (tag === 'ol') parts.push(item.marker !== 1 ? '<ol start="' + item.marker + '">' : '<ol>')
      else parts.push('<ul>')
      kind = tag
    }
    const q = item.marker || questionNumber(item.text)
    const anchor = q ? anchorFor(q) : ''
    const cls = item.indent > 0 ? ' class="md-sub"' : ''
    const id = anchor ? ' id="' + anchor + '"' : ''
    parts.push('<li' + cls + id + '>' + inl(item.text) + '</li>')
  }
  if (kind) parts.push(kind === 'ol' ? '</ol>' : '</ul>')
  return '<div class="md-list">' + parts.join('') + '</div>'
}

/**
 * markdown → HTML。
 *
 * @param {string} source
 * @param {{ extras?: Array<{re: RegExp, html: Function}> }} [options]
 *   `extras` 是调用方自己的记号（面板拿它把 `[表情: …]` 换成图），每一处行内文本都会过一遍。
 * @returns {{ html: string, toc: Array<{level:number,id:string,text:string,q:number}>, questions: number[] }}
 *   `html` 直接塞进 `innerHTML`（里面每一个字都过了转义）；
 *   `toc` 是章节（`id` 可用作锚点）；`questions` 是钉过的题号，按正文顺序。
 */
export function renderMarkdown(source, options = {}) {
  const extras = Array.isArray(options.extras) ? options.extras : []
  const inl = (text) => inline(text, extras)
  const lines = String(source ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '    ')
    .split('\n')
    // `**3.** 求导` / `**3**. 求导` 也是题 —— 先归一成有序列表项，题号才钉得住锚点。
    // 只认「行首 + 一个纯数字」，正文里嵌的 `**重点**` 不受影响。
    .map((line) => line
      .replace(/^(\s*)\*\*(\d{1,3})[.、．]\*\*\s*/, '$1$2. ')
      .replace(/^(\s*)\*\*(\d{1,3})\*\*[.、．]\s*/, '$1$2. '))
  const out = []
  const toc = []
  const questions = []
  const seen = new Set()
  let openAnswer = 0
  let sectionNo = 0

  const anchorFor = (n) => {
    if (!n || seen.has(n)) return ''
    seen.add(n)
    questions.push(n)
    return 'q' + n
  }
  const closeAnswerAbove = (level) => {
    if (openAnswer && level <= openAnswer) {
      out.push('</details>')
      openAnswer = 0
    }
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    if (line.trim() === '') {
      i += 1
      continue
    }

    const fence = /^\s*```\s*([A-Za-z0-9+#-]*)\s*$/.exec(line)
    if (fence) {
      const body = []
      i += 1
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        body.push(lines[i])
        i += 1
      }
      if (i < lines.length) i += 1
      const lang = fence[1] ? ' data-lang="' + escapeHtml(fence[1]) + '"' : ''
      out.push('<pre class="md-code"' + lang + '><code>' + escapeHtml(body.join('\n')) + '</code></pre>')
      continue
    }

    /* 独立成行的公式块。放在标题、列表前面认 —— `$$` 开头那行不该被当成段落。 */
    const math = isBlockMathLine(line) ? takeBlockMath(lines, i) : null
    if (math) {
      out.push(math.html)
      i = math.next
      continue
    }

    const head = /^(#{1,6})\s+(.*)$/.exec(line)
    if (head) {
      const level = head[1].length
      const text = head[2].trim()
      closeAnswerAbove(level)
      const label = plainText(text)
      const q = questionNumber(text)
      const anchor = q ? anchorFor(q) : ''
      const id = anchor || 'sec' + (sectionNo += 1)
      toc.push({ level, id, text: label, q })
      const shown = inl(text)
      i += 1
      if (isAnswerHeading(label)) {
        out.push('<details class="md-answer"><summary>' + shown + '</summary>')
        openAnswer = level
        continue
      }
      out.push('<h' + level + ' id="' + id + '">' + shown + '</h' + level + '>')
      continue
    }

    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push('<hr class="md-hr">')
      i += 1
      continue
    }

    const table = takeTable(lines, i)
    if (table) {
      out.push(renderTable(table.head, table.body, inl))
      i = table.next
      continue
    }

    if (/^\s*>/.test(line)) {
      const body = []
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ''))
        i += 1
      }
      out.push(
        '<blockquote class="md-quote">' +
          body.map((one) => (one.trim() === '' ? '<br>' : inl(one))).join('<br>') +
          '</blockquote>',
      )
      continue
    }

    const item = LIST_ITEM_RE.exec(line)
    if (item) {
      const baseIndent = item[1].length
      const items = []
      while (i < lines.length) {
        const hit = LIST_ITEM_RE.exec(lines[i])
        if (hit) {
          items.push({ indent: hit[1].length, marker: hit[3] ? Number(hit[3]) : 0, text: hit[4] })
          i += 1
          continue
        }
        // 空行后面还是同级的项 → 算同一个列表（生成的卷子常在题与题之间空一行）
        const next = i + 1 < lines.length ? LIST_ITEM_RE.exec(lines[i + 1]) : null
        if (lines[i].trim() === '' && next && next[1].length === baseIndent) {
          i += 1
          continue
        }
        break
      }
      out.push(renderList(items, anchorFor, inl))
      continue
    }

    const para = []
    while (i < lines.length && lines[i].trim() !== '' && !startsBlock(lines[i])) {
      para.push(lines[i].trim())
      i += 1
    }
    if (!para.length) {
      // 兜底：走到这儿说明上面漏了一种块首，吞一行也比死循环强。
      i += 1
      continue
    }
    out.push('<p class="md-p">' + para.map((one) => inl(one)).join('<br>') + '</p>')
  }

  if (openAnswer) out.push('</details>')

  return { html: out.join('\n'), toc, questions }
}
