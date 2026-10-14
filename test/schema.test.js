/**
 * schema 护栏。
 *
 * 踩过的坑：`study_report` 一开始把 goal / masterySummary 只写成 `{ type: 'object' }`，
 * 宿主加载时抛 `additionalProperties must be explicitly true or false`，
 * 就算侥幸注册进去，返回值也会被判 `"value.goal.subject" is not a declared property`。
 * 这里静态扫一遍所有工具的 output schema，堵住同一个坑。
 *
 * 后面那个用例是加菜：能解析到宿主的 @deepseek-ai/dsh-tools 时，就用宿主自己的
 * defineTool + validateJsonSchemaValue 真跑一遍 9 个工具（写进临时档案），
 * 算是把「stub defineTool 测不出宿主校验」这个盲区补上。解析不到就跳过。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { Library } from '../lib/library.js'
import { buildTools } from '../lib/tools.js'

const PANEL = { path: '/study', url: 'http://127.0.0.1:19388/study' }

function makeStore() {
  const root = mkdtempSync(join(tmpdir(), 'study-schema-'))
  const store = new Library(root)
  store.ensure()
  return { store, root }
}

/**
 * 找宿主的 @deepseek-ai/dsh-tools。
 * 插件是 link 进 profile 的、真实路径在工作区，裸包名从这儿解析不到，
 * 所以先试裸名，再拿 profile 目录当解析基准。
 */
async function loadHostTools() {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  const bases = [import.meta.url, join(dshHome, 'profiles', 'desktop', 'package.json')]
  for (const base of bases) {
    try {
      const require = createRequire(base)
      const resolved = require.resolve('@deepseek-ai/dsh-tools')
      return await import(pathToFileURL(resolved).href)
    } catch {
      /* 换下一个基准 */
    }
  }
  return null
}

function walkSchema(node, at, problems) {
  if (!node || typeof node !== 'object') return
  if (node.type === 'object') {
    if (typeof node.additionalProperties !== 'boolean') {
      problems.push(`${at}：对象节点必须显式写 additionalProperties: true 或 false`)
    }
    for (const [key, child] of Object.entries(node.properties ?? {})) {
      walkSchema(child, `${at}.${key}`, problems)
    }
  } else if (node.type === 'array') {
    if (node.items) walkSchema(node.items, `${at}[]`, problems)
  }
  if (Array.isArray(node.oneOf)) {
    node.oneOf.forEach((branch, i) => walkSchema(branch, `${at}<oneOf#${i}>`, problems))
  }
}

test('输出 schema 合规：对象节点都显式声明了 additionalProperties', () => {
  const { store, root } = makeStore()
  try {
    const problems = []
    for (const spec of buildTools(store, { panel: PANEL })) {
      walkSchema(spec.output.schema, `output(${spec.name})`, problems)
    }
    assert.equal(problems.length, 0, problems.join('\n'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('宿主的校验器接受每个工具的返回值', async (t) => {
  const dshTools = await loadHostTools()
  if (!dshTools) {
    t.skip('这台机器上解析不到 @deepseek-ai/dsh-tools，跳过')
    return
  }
  const { defineTool, validateJsonSchemaValue } = dshTools
  const { store, root } = makeStore()
  try {
    const tools = {}
    // 页级索引那一支要用到 pymupdf 才能真读 PDF，这里换成桩，只验返回值的形状。
    const spec = buildTools(store, {
      panel: PANEL,
      bookInfo: () => ({ ok: true, total: 123, scanned: true, toc: [{ level: 1, title: '第一章', page: 1, pointId: 'M1.1' }] }),
    })
    for (const s of spec) tools[s.name] = defineTool(s)
    const exec = { signal: { throwIfAborted() {} } }
    const problems = []

    const call = async (name, args) => {
      const tool = tools[name]
      assert.ok(tool, `没有 ${name} 这个工具`)
      const value = await tool.execute(args, exec)
      for (const violation of validateJsonSchemaValue(tool.output.schema, value, '')) {
        problems.push(`${name}: ${violation}`)
      }
      return value
    }

    await call('study_goal', {
      subject: '线性代数',
      outcome: '考研数一能独立做中档题',
      deadline: '2027-01-15',
      minutesPerDay: 60,
    })
    const mat = await call('study_material', { action: 'add', kind: 'book', title: '线性代数辅导讲义', note: '第 1-3 章' })
    await call('study_map', {
      action: 'set',
      modules: [
        {
          id: 'M1',
          group: '行列式',
          title: '行列式',
          summary: '先搞清定义，再练性质',
          points: [
            {
              id: 'M1.1',
              title: '行列式的定义',
              why: '后面全建在它上面',
              source: '讲义 第1章',
              video: 'F:\\课件\\01-行列式的定义.mp4',
              practice: 'F:\\课件\\第1章 习题.pdf',
            },
            { id: 'M1.2', title: '行列式的性质', why: '化简就靠它', source: '讲义 第1章' },
          ],
        },
      ],
    })
    await call('study_record', {
      pointId: 'M1.1',
      stage: '见过',
      kind: 'self',
      note: '2026-10-01 翻了教材第一页，认得定义了',
      confidence: 0.4,
      nextReview: '2026-10-03',
    })
    const plan = await call('study_plan', { action: 'add', title: '看第 1 讲 行列式定义，做课后 1-5 题', kind: 'watch', minutes: 40 })
    await call('study_plan', { action: 'toggle', taskId: plan.tasks[0].id })
    await call('study_analysis', {
      action: 'save',
      materialId: mat.materials[0].id,
      coverage: '部分通读',
      role: '主线讲解，例题够用',
      pairing: '配第 1-3 讲网课一起看',
      chapters: [
        {
          no: '1',
          title: '行列式',
          pages: '1-24',
          topics: '定义、性质、按行展开',
          examples: '例1-例8',
          exercises: '习题1.1 第1-12题',
          difficulty: '基础',
          role: '打地基，必须精读',
        },
      ],
    })
    await call('study_analysis', { action: 'get', materialId: mat.materials[0].id })
    await call('study_analysis', { action: 'get', materialId: mat.materials[0].id, chapterNo: '1' })
    await call('study_tool_level', { name: '行列式手算', stage: '能跟做', note: '照着例题能算三阶', confidence: 0.5 })

    // 每级掌握档案
    await call('study_archive', { level: 'group', key: '行列式' })
    await call('study_archive', { level: 'module', key: 'M1' })
    await call('study_archive', { level: 'point', key: 'M1.1', limit: 3 })

    // 总体能力：先读，再写判词，再读回
    await call('study_ability', {})
    await call('study_ability', { action: 'set', text: '定义认得了，性质还没上手；下一步把性质过一遍。', level: '刚起步' })
    await call('study_ability', { action: 'get' })

    // 材料文件：登记一个真目录，再列它、看它、转链接
    const course = join(root, 'course')
    mkdirSync(join(course, '01.第一讲'), { recursive: true })
    writeFileSync(join(course, '01.第一讲', '01.观看指南.mp4'), 'x')
    writeFileSync(join(course, '02.第二讲.mp4'), 'x')
    const courseMat = await call('study_material', { action: 'add', kind: 'video', title: '网课目录', path: course })
    const courseId = courseMat.materials.find((m) => m.title === '网课目录').id
    await call('study_files', { action: 'list', path: course, depth: 2 })
    await call('study_files', { action: 'stat', path: join(course, '02.第二讲.mp4') })
    await call('study_files', { action: 'url', path: join(course, '02.第二讲.mp4') })
    await call('study_files', { action: 'stat', path: join(course, '并不存在.mp4') })

    await call('study_material', { action: 'remove', id: mat.materials[0].id })
    await call('study_material', { action: 'remove', id: courseId })
    await call('study_guide', { text: '看完第 1 讲回来答三个问题', kind: 'ask' })
    store.write('inbox', { version: 1, items: [{ id: 'msg-test', text: '第 2 讲看完了', read: false, at: Date.now() }] })
    await call('study_inbox', { action: 'list' })
    await call('study_report', { date: '2026-10-01' })
    await call('study_map', { action: 'confirm' })
    await call('study_inbox', { action: 'read' })
    await call('study_plan', { action: 'update', taskId: plan.tasks[0].id, title: '改成看第 2 讲', minutes: 30 })
    await call('study_plan', { action: 'remove', taskId: plan.tasks[0].id })
    await call('study_plan', { action: 'add', title: '临时任务，一会儿删掉', kind: 'review', minutes: 10 })

    // 档案库：列 / 新建 / 切换 / 改名 / 删掉（放最后，因为它会换当前档案）
    await call('study_library', { action: 'list' })
    const made = await call('study_library', { action: 'create', title: '第二门课', subject: '概率论', minutesPerDay: 45 })
    const madeId = made.profiles.find((p) => p.title === '第二门课').id
    await call('study_library', { action: 'rename', id: madeId, title: '概率论（改过名）' })
    await call('study_library', { action: 'select', id: 'default' })
    await call('study_library', { action: 'remove', id: madeId })
    await call('study_library', { action: 'list' })

    // 学生画像 / 错题本 / 页级索引 / 记忆卡 / 清单 / 番茄钟：
    // 这几个以前没进这份清单，于是「返回里带了 schema 没声明的字段」这种坑一直没被测出来
    // （study_book 的 pageCount/pageDir、study_student 的 updatedAt 与证据上的 mistake 都栽过）。
    const arc = await call('study_archive', { level: 'point', key: 'M1.1', limit: 5 })
    const evId = arc.evidence[0].id
    await call('study_student', { action: 'list' })
    await call('study_student', { action: 'add', kind: '习惯', text: '换元之后容易忘记回代', evidence: [evId], note: '两次都这样' })
    // 再记一条带错题的证据：第二条判断引的证据上会挂 mistake，那条分支也要过校验
    const missed = await call('study_record', {
      pointId: 'M1.2',
      kind: 'quiz',
      note: '2026-10-02 做第 3 题，符号写反',
      confidence: 0.8,
      mistake: {
        origin: '《线性代数辅导讲义》第 1 章第 3 题',
        step: '两边同乘 −1 之后忘了翻不等号',
        cause: '等价变形里没盯符号',
        fix: '先把不等号方向单独写一行再乘',
        status: '已订正',
        redoAt: '2026-10-05',
      },
    })
    await call('study_student', { action: 'add', kind: '弱项', text: '等价变形里容易丢符号', evidence: [(await call('study_archive', { level: 'point', key: 'M1.2' })).evidence[0].id] })
    await call('study_student', { action: 'list', pointId: 'M1.1' })
    await call('study_student', { action: 'list', limit: 1 })
    await call('study_mistakes', {})
    await call('study_mistakes', { pointId: 'M1.2', status: '已订正' })
    // 页级索引：纸质书一律是扫描件，真拆要几分钟又要 pymupdf，
    // 所以这里把 bookInfo 换成桩、再喂一个「名字像 PDF」的真文件——
    // 要验的是返回值形状（pageCount/pageDir/toc/tree 这几个字段曾经没在 schema 里声明）。
    const bookPath = join(root, '假教材.pdf')
    writeFileSync(bookPath, 'x')
    const bookMat = await call('study_material', { action: 'add', kind: 'book', title: '假教材', path: bookPath, note: '只为验形状' })
    const bookId = bookMat.materials.find((m) => m.title === '假教材').id
    await call('study_book', { action: 'info', materialId: bookId })
    await call('study_book', { action: 'pages', pointId: 'M1.1' })
    await call('study_card', { action: 'add', front: 'contingency', back: '列联表', kind: '单词', pointId: 'M1.1' })
    await call('study_card', { action: 'list' })
    await call('study_card', { action: 'due' })
    await call('study_todo', { action: 'add', text: '背 20 个单词', due: '2026-10-04', pointId: 'M1.1' })
    const todo = await call('study_todo', {})
    await call('study_todo', { action: 'toggle', id: todo.items[0].id })
    await call('study_todo', { action: 'patch', id: todo.items[0].id, text: '背 30 个单词' })
    await call('study_todo', { action: 'remove', id: todo.items[0].id })
    await call('study_todo', { status: 'today' })
    await call('study_focus', { action: 'start', minutes: 20, label: '背单词' })
    await call('study_focus', {})
    await call('study_focus', { action: 'stop' })

    assert.equal(problems.length, 0, problems.join('\n'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
