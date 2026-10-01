/**
 * 读卷页那个 markdown 渲染器。它不追求「通用」—— 只认教练写卷子会用到的那些写法，
 * 但有两件事必须钉死：
 *   1. 不认的东西一律当字面量，绝不漏进 DOM（卷子里的 `<` 是小于号，不是标签）；
 *   2. 题号锚点和答案折叠得稳 —— 做题页那排「第 N 题」靠前者，学生先做后对靠后者。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { escapeHtml, inline, questionNumber, renderMarkdown } from '../assets/md.js'

test('转义：卷子里的尖括号是数学符号，不是标签', () => {
  assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;')
  const { html } = renderMarkdown('当 x < 3 且 a > b 时，<img src=x onerror=alert(1)>')
  assert.match(html, /x &lt; 3/)
  assert.match(html, /a &gt; b/)
  assert.doesNotMatch(html, /<img/)
  // 那一段作为**文字**留着没问题（尖括号已经是实体），要紧的是它不成标签
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
})

test('行内标记：粗体、斜体、行内码、删除线', () => {
  assert.equal(inline('**8 道**，由易到难'), '<b>8 道</b>，由易到难')
  assert.equal(inline('求 *lim* 的值'), '求 <i>lim</i> 的值')
  assert.equal(inline('用 `|2A|` 这个式子'), '用 <code>|2A|</code> 这个式子')
  assert.equal(inline('~~这一版~~ 作废'), '<s>这一版</s> 作废')
  // 代码段里的星号不该被当成粗体
  assert.equal(inline('`a**b**c`'), '<code>a**b**c</code>')
})

test('链接：只放行 http(s)、站内和锚点，别的降级成纯文字', () => {
  assert.equal(inline('[看课](https://example.com/a.mp4)'), '<a href="https://example.com/a.mp4" target="_blank" rel="noopener">看课</a>')
  assert.equal(inline('[这一节](/study/practice?point=M1.4)'), '<a href="/study/practice?point=M1.4" target="_blank" rel="noopener">这一节</a>')
  assert.equal(inline('[跳到第 3 题](#q3)'), '<a href="#q3" target="_blank" rel="noopener">跳到第 3 题</a>')
  const bad = inline('[点我](javascript:alert(1))')
  assert.equal(bad, '点我')
  assert.doesNotMatch(bad, /javascript:/)
})

test('认题号：第 N 题、N.、N、N)、**N.**', () => {
  assert.equal(questionNumber('第 3 题'), 3)
  assert.equal(questionNumber('第12题 已知'), 12)
  assert.equal(questionNumber('3. 求行列式'), 3)
  assert.equal(questionNumber('3、求行列式'), 3)
  assert.equal(questionNumber('3) 求行列式'), 3)
  assert.equal(questionNumber('**3.** 求行列式'), 3)
  assert.equal(questionNumber('求行列式'), 0)
})

test('标题：目录能对上，题号那一条钉出 #qN', () => {
  const { html, toc, questions } = renderMarkdown([
    '# 随堂小测 · M1.4',
    '',
    '## 第 1 题',
    '已知 A 是 3 阶方阵。',
    '',
    '## 第 2 题',
    '求 |2A|。',
    '',
  ].join('\n'))
  assert.match(html, /<h1 id="sec1">随堂小测 · M1\.4<\/h1>/)
  assert.match(html, /<h2 id="q1">第 1 题<\/h2>/)
  assert.match(html, /<h2 id="q2">第 2 题<\/h2>/)
  assert.deepEqual(questions, [1, 2])
  assert.deepEqual(toc.map((one) => [one.level, one.id, one.q]), [[1, 'sec1', 0], [2, 'q1', 1], [2, 'q2', 2]])
})

test('列表：有序号的题也能跳；题号只钉一次，重复的不重复给 id', () => {
  const { html, questions } = renderMarkdown([
    '1. 第一题',
    '2. 第二题',
    '',
    '3、第三题',
    '',
    '**4.** 第四题',
    '',
    '## 第 1 题',
    '重复说一遍第一题。',
    '',
  ].join('\n'))
  assert.match(html, /<ol><li id="q1">第一题<\/li>/)
  assert.match(html, /<li id="q2">第二题<\/li>/)
  assert.match(html, /<li id="q3">第三题<\/li>/)
  assert.match(html, /<li id="q4">第四题<\/li>/)
  // 第 1 题已经在列表里钉过了，标题那一条不重复给 id（否则文档里两个 id="q1"）
  assert.match(html, /<h2 id="sec1">第 1 题<\/h2>/)
  assert.deepEqual(questions, [1, 2, 3, 4])
  assert.equal((html.match(/id="q1"/g) || []).length, 1)
})

test('空行隔开的列表算同一个列表（生成的卷子题与题之间常空一行）', () => {
  const { html } = renderMarkdown('1. 第一题\n\n2. 第二题\n\n3. 第三题\n')
  assert.equal((html.match(/<ol/g) || []).length, 1)
  assert.equal((html.match(/<li/g) || []).length, 3)
})

test('参考答案折起来：点开之前看不到，遇到下一个同级标题就关', () => {
  const { html } = renderMarkdown([
    '## 第 1 题',
    '求 |2A|。',
    '',
    '## 参考答案',
    '8|A|。',
    '',
    '## 第 2 题',
    '求 A⁻¹。',
    '',
  ].join('\n'))
  assert.match(html, /<details class="md-answer"><summary>参考答案<\/summary>/)
  assert.match(html, /<\/details>/)
  const inside = html.slice(html.indexOf('<details'), html.indexOf('</details>'))
  assert.match(inside, /8\|A\|。/)
  const after = html.slice(html.indexOf('</details>'))
  assert.doesNotMatch(after, /8\|A\|。/, '后面的题不该还在答案那一节里')
  assert.match(after, /<h2 id="q2">第 2 题<\/h2>/)
})

test('答案写在文末：那一节到文件结束才关', () => {
  const { html } = renderMarkdown('## 第 1 题\n做题。\n\n### 解析\n因为所以。\n')
  assert.match(html, /<details class="md-answer"><summary>解析<\/summary>/)
  assert.match(html, /因为所以。/)
  assert.equal(html.trimEnd().endsWith('</details>'), true)
})

test('表格、引用、代码块、分隔线都画得出来', () => {
  const { html } = renderMarkdown([
    '| 题号 | 答案 |',
    '| --- | --- |',
    '| 1 | A |',
    '',
    '> 先自己做。',
    '',
    '```',
    '|2A| = 8|A|',
    '```',
    '',
    '---',
    '',
  ].join('\n'))
  assert.match(html, /<table class="md-table">/)
  assert.match(html, /<th>题号<\/th>/)
  assert.match(html, /<td>A<\/td>/)
  assert.match(html, /<blockquote class="md-quote">先自己做。<\/blockquote>/)
  assert.match(html, /<pre class="md-code"><code>\|2A\| = 8\|A\|<\/code><\/pre>/)
  assert.match(html, /<hr class="md-hr">/)
})

test('段落里的单个换行也断行 —— 题面一行一句，挤成一坨就读串了', () => {
  const { html } = renderMarkdown('A. 第一项\nB. 第二项\nC. 第三项\n')
  assert.match(html, /A\. 第一项<br>B\. 第二项<br>C\. 第三项/)
  assert.equal((html.match(/<p /g) || []).length, 1)
})

test('认不出来的写法当字面量往下走，别卡住也别吞内容', () => {
  const { html } = renderMarkdown([
    '- 嵌套：',
    '  - 里层一项',
    '',
    '脚注[^1]这种写法不认',
    '',
    '|只有一个竖线',
    '',
    '结尾一句。',
    '',
  ].join('\n'))
  assert.match(html, /里层一项/)
  assert.match(html, /脚注\[\^1\]这种写法不认/)
  assert.match(html, /\|只有一个竖线/)
  assert.match(html, /结尾一句。/)
})

test('数学：没装 KaTeX 也认得出来，退回等宽源码而不是原样的美元号', () => {
  const { html } = renderMarkdown('当 $x^2 + y^2 = 1$ 时，最小值是 1。\n')
  assert.match(html, /<code class="md-math"[^>]*>x\^2 \+ y\^2 = 1<\/code>/)
  assert.doesNotMatch(html, /\$/, '美元号被吃掉了，没留在正文里')
  // `\$` 转义过的不是公式；贴着数字的也不是（「花了 $5 到 $8」）
  assert.match(inline('价格 \\$5 起步'), /\\\$5/, '转义过的美元号按字面量留着')
  assert.equal(inline('花了 $5 到 $8'), '花了 $5 到 $8')
  // Windows 路径里的反斜杠不会被当公式或转义吃掉
  assert.equal(inline('看 C:\\Users\\someone\\.dsh\\study-coach'), '看 C:\\Users\\someone\\.dsh\\study-coach')
  // 公式源码也要转义：认不出来的是数学，不是标签
  assert.doesNotMatch(inline('$<img src=x onerror=alert(1)>$'), /<img/)
})

test('数学：KaTeX 在场就交给它排；行内的归行内，独立成行的归块', () => {
  const calls = []
  globalThis.katex = {
    renderToString: (tex, options) => {
      calls.push({ tex, display: options.displayMode })
      return '<span class="katex">' + tex + '</span>'
    },
  }
  try {
    const { html } = renderMarkdown([
      '先说一句 $a+b$ 再解释。',
      '',
      '$$',
      '\\frac{1}{2}',
      '$$',
      '',
      '还有 $$c+d$$ 和 \\(e\\) 这两种行内写法。',
      '',
    ].join('\n'))
    assert.deepEqual(calls[0], { tex: 'a+b', display: false })
    assert.deepEqual(calls[1], { tex: '\\frac{1}{2}', display: true }, '独立成行的按行间排')
    assert.deepEqual(calls[2], { tex: 'c+d', display: false })
    assert.deepEqual(calls[3], { tex: 'e', display: false })
    assert.equal(calls.length, 4)
    assert.match(html, /<div class="md-block-math"><span class="katex">/) 
    assert.match(html, /先说一句 <span class="katex">a\+b<\/span> 再解释。/)
    assert.match(html, /<p class="md-p">还有 <span class="katex">c\+d<\/span> 和 <span class="katex">e<\/span> 这两种行内写法。<\/p>/)
  } finally {
    delete globalThis.katex
  }
})

test('extras：调用方自己的记号（面板的 `[表情: …]`）也过一遍，产物不进转义', () => {
  const meme = {
    re: /\[表情:\s*([^\]\n]{1,200})\]/g,
    html: (whole, desc) => '<img class="chat-meme" alt="' + escapeHtml(desc) + '">',
  }
  assert.equal(
    inline('<b>[表情: 得意 拳头]</b>', [meme]),
    '&lt;b&gt;<img class="chat-meme" alt="得意 拳头">&lt;/b&gt;',
    '记号本身不转义，可别的字照样转义',
  )
  const { html } = renderMarkdown('好耶 [表情: 得意] 就这样\n', { extras: [meme] })
  assert.match(html, /<p class="md-p">好耶 <img class="chat-meme" alt="得意"> 就这样<\/p>/)
  assert.doesNotMatch(html, /\[表情:/)
})
