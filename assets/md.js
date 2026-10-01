/* ══ 一份小 markdown 渲染器 ═════════════════════════════════════════════════
 * 只认教练写卷子用得上的那些写法。**不是**通用 markdown 实现，也别拿它当通用实现用：
 * 遇到不认的东西它就老老实实当普通文字画出来，不猜、不报错、不吐源码。
 *
 * 认的：
 *   ``` 代码块 / `#`…`######` 标题 / `---` 分隔线 / `|` 表格 / `>` 引用
 *   `-`、`*`、`+` 与 `N.`、`N、` 列表（一层，缩进的项画成下一级）
 *   **粗** / *斜* / `码` / ~~删~~ / [文字](链接)
 *   段落里的单个换行也断行（题面一行一句，软换行会把选项挤成一坨）
 * 不认：嵌套列表、LaTeX、脚注、HTML —— HTML 一律转义成字面量，不会漏进 DOM。
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

/**
 * 行内标记。**先转义、再替换** —— 顺序反过来就是给自己开了个注入口子。
 * 代码段先抽走（占位符是一个 NUL 包着的序号），免得里面的 `*` 被当成粗体。
 */
export function inline(raw) {
  let text = escapeHtml(raw)
  const codes = []
  text = text.replace(/`([^`]+)`/g, (_, code) => {
    codes.push(code)
    return '\u0000' + (codes.length - 1) + '\u0000'
  })
  text = text.replace(/\[([^\]]*)\]\(([^()\s]*(?:\([^()\s]*\)[^()\s]*)*)\)/g, (whole, label, href) => {
    const safe = safeHref(href)
    if (!safe) return label || escapeHtml(href)
    return '<a href="' + safe + '" target="_blank" rel="noopener">' + (label || safe) + '</a>'
  })
  text = text.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
  text = text.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<i>$2</i>')
  text = text.replace(/~~([^~]+)~~/g, '<s>$1</s>')
  text = text.replace(/\u0000(\d+)\u0000/g, (_, idx) => '<code>' + codes[Number(idx)] + '</code>')
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
    LIST_ITEM_RE.test(line)
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

function renderTable(head, body) {
  const th = head.map((cell) => '<th>' + inline(cell) + '</th>').join('')
  const tr = body
    .map((row) => '<tr>' + row.map((cell) => '<td>' + inline(cell) + '</td>').join('') + '</tr>')
    .join('')
  return (
    '<div class="md-table-wrap"><table class="md-table"><thead><tr>' +
    th + '</tr></thead><tbody>' + tr + '</tbody></table></div>'
  )
}

function renderList(items, anchorFor) {
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
    parts.push('<li' + cls + id + '>' + inline(item.text) + '</li>')
  }
  if (kind) parts.push(kind === 'ol' ? '</ol>' : '</ul>')
  return '<div class="md-list">' + parts.join('') + '</div>'
}

/**
 * markdown → HTML。
 *
 * @param {string} source
 * @returns {{ html: string, toc: Array<{level:number,id:string,text:string,q:number}>, questions: number[] }}
 *   `html` 直接塞进 `innerHTML`（里面每一个字都过了转义）；
 *   `toc` 是章节（`id` 可用作锚点）；`questions` 是钉过的题号，按正文顺序。
 */
export function renderMarkdown(source) {
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
      const shown = inline(text)
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
      out.push(renderTable(table.head, table.body))
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
          body.map((one) => (one.trim() === '' ? '<br>' : inline(one))).join('<br>') +
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
      out.push(renderList(items, anchorFor))
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
    out.push('<p class="md-p">' + para.map((one) => inline(one)).join('<br>') + '</p>')
  }

  if (openAnswer) out.push('</details>')

  return { html: out.join('\n'), toc, questions }
}
