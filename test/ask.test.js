/**
 * 面板 → 对话 那条线的接口侧：学生在做题页按下按钮之后，服务端到底做了什么。
 *
 * 一个假的 sessionController 挂进 ctx.get()，就能看清「投给谁、投了什么」；
 * 投递失败那条分支也在这一份里验（把假件换成会抛的）。
 *
 * 全塞进一个 test：同一文件里的用例会并发跑，共用一份档案会互相踩。
 */
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'study-ask-'))
process.env.DSH_STUDY_ROOT = root

const prompts = []
let failNext = false
const sessionController = {
  async list() {
    return { items: [{ sessionId: 'live-1', updatedAt: Date.now() }] }
  },
  async prompt(request) {
    if (failNext) throw new Error('session is gone')
    prompts.push(request)
    return { accepted: true }
  },
}

const routes = []
const disposers = []
const ctx = {
  effect(fn) {
    const d = fn()
    if (typeof d === 'function') disposers.push(d)
    return () => {}
  },
  get(name) {
    return name === 'sessionController' ? sessionController : undefined
  },
  webServer: {
    register(route) {
      routes.push(route)
      return () => {}
    },
  },
  tools: { register: () => () => {} },
  agentPresets: { register: async () => () => {} },
}

const mod = await import('../index.js')
mod.apply(ctx)

const server = createServer((req, res) => routes[0].handler(req, res))
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

const get = (path) => fetch(base + path)
const post = (path, body) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
const json = async (res) => ({ status: res.status, data: await res.json() })

after(async () => {
  for (const dispose of disposers) {
    try {
      dispose()
    } catch {
      /* 清理失败不影响结论 */
    }
  }
  await new Promise((resolve) => server.close(resolve))
  rmSync(root, { recursive: true, force: true })
})

const LECTURE = 'F:\\示例资料\\线性代数讲义\\1.1 行列式的定义.pdf'

test('做题页：按钮按下去，话真进了对话', async () => {
  // ① 挂一个模块：M1.1 有讲义和网课，M1.2 什么都没有
  const made = await post('/study/api/map/module', {
    module: {
      id: 'M1',
      group: '线性代数',
      title: '行列式',
      points: [
        {
          id: 'M1.1',
          title: '行列式的定义与几何意义',
          why: '打底',
          source: '讲义 1.1 行列式的定义 / 课程 02.行列式',
          video: 'F:\\示例资料\\网课\\02.行列式',
          practice: LECTURE,
        },
        { id: 'M1.2', title: '行列式的性质' },
        {
          id: 'M1.3',
          title: '矩阵的运算',
          source: '讲义 11.1 矩阵的运算 / 课程 25',
          practice: 'F:\\示例资料\\线性代数讲义\\11.1 矩阵的运算.pdf',
        },
      ],
    },
  })
  assert.equal(made.status, 200)

  // ② 「教辅里对应哪儿」：没分析过材料也不能空着，得把这一节自己的讲义摆出来
  const page = await json(await get('/study/api/practice?point=M1.1'))
  assert.equal(page.status, 200)
  assert.equal(page.data.chapters.length, 1, '没分析过材料也得给一条，不能空着')
  assert.equal(page.data.chapters[0].file, LECTURE, '条目要带上是哪一份文件')
  assert.equal(page.data.chapters[0].no, '1.1')
  assert.equal(page.data.chapters[0].title, '1.1 行列式的定义')
  assert.equal(page.data.chapters[0].material, '这一节的讲义')

  // 完全没有讲义的点，别硬造一条假的
  const bare = await json(await get('/study/api/practice?point=M1.2'))
  assert.equal(bare.data.chapters.length, 0)

  // ③ 让 AI 出题：投进对话
  prompts.length = 0
  const asked = await json(await post('/study/api/practice/ask', { pointId: 'M1.1', mode: 'ai', text: '来三道带参数的题' }))
  assert.equal(asked.status, 200)
  assert.equal(asked.data.mode, 'ai')
  assert.equal(asked.data.pushed, true)
  assert.equal(prompts.length, 1, '话得真的投出去')
  assert.equal(prompts[0].sessionId, 'live-1')
  assert.equal(prompts[0].mode, 'queue')
  const text = prompts[0].content[0].text
  assert.match(text, /M1\.1/)
  assert.match(text, /行列式的定义与几何意义/)
  assert.match(text, /1\.1 行列式的定义\.pdf/, '出题得知道配的是哪份讲义')
  assert.match(text, /来三道带参数的题/, '学生补的话要带上')
  assert.match(text, /出几道题/)

  // 同一句话也留了底，投递断了我在对话里翻留言照样看得见
  const state = await json(await get('/study/api/state'))
  assert.ok(state.data.state.inbox.items.length >= 1)

  // ④ 面板留言走同一条线
  prompts.length = 0
  const note = await json(await post('/study/api/inbox', { text: '这一节我想慢点学' }))
  assert.equal(note.status, 200)
  assert.equal(note.data.pushed, true)
  assert.equal(prompts[0].content[0].text, '【面板留言】这一节我想慢点学')

  // ⑤ 通道断了：话照样存下来，只是告诉面板没递到
  failNext = true
  const broken = await json(await post('/study/api/inbox', { text: '通道断了也要留下来' }))
  failNext = false
  assert.equal(broken.status, 200)
  assert.equal(broken.data.pushed, false)
  assert.match(broken.data.pushError, /session is gone/)
  const after2 = await json(await get('/study/api/state'))
  assert.ok(
    after2.data.state.inbox.items.some((i) => i.text.includes('通道断了也要留下来')),
    '投不出去也不能把学生的话丢了',
  )

  // ⑥ 自己安排：直接落成今天的任务，不占对话
  prompts.length = 0
  const self = await json(await post('/study/api/practice/ask', { pointId: 'M1.1', mode: 'self', text: '刷讲义习题 10 页', minutes: 40 }))
  assert.equal(self.status, 200)
  assert.equal(self.data.mode, 'self')
  assert.equal(self.data.task.title, '刷讲义习题 10 页')
  assert.equal(self.data.task.kind, 'practice')
  assert.equal(self.data.task.minutes, 40)
  assert.equal(self.data.task.done, false)
  assert.equal(prompts.length, 0, '自己安排的不用打扰对话')

  const tasks = await json(await get('/study/api/tasks'))
  assert.equal(tasks.data.day.length, 1)
  assert.equal(tasks.data.day[0].title, '刷讲义习题 10 页')
  assert.equal(tasks.data.day[0].pointId, 'M1.1', '任务得挂在知识点上才带得出跳转按钮')
  const kinds = tasks.data.day[0].links.map((l) => l.kind)
  assert.ok(kinds.includes('video'))
  assert.ok(kinds.includes('practice'))

  // ⑦ 看课任务：主线是先看完这一讲，练习排在它后面
  const watch = await json(await post('/study/api/task', { kind: 'watch', title: '看第 1 讲', target: 'M1.1', minutes: 30 }))
  assert.equal(watch.data.task.links[0].kind, 'video', '看课任务得把「看这节网课」摆在最前')
  assert.equal(watch.data.task.links.at(-1).kind, 'point')
  assert.equal(watch.data.task.links.at(-1).label, '看完去做练习')
  assert.match(watch.data.task.links.at(-1).url, /\/study\/practice\?point=M1\.1/)

  // ⑧ 参数不对就挡回去
  assert.equal((await post('/study/api/practice/ask', { mode: 'ai' })).status, 400, '得说练哪一节')
  assert.equal((await post('/study/api/practice/ask', { pointId: 'M1.1', mode: 'foo' })).status, 400, '只认 ai / self')
  assert.equal((await post('/study/api/practice/ask', { pointId: 'nope', mode: 'ai' })).status, 404)
  assert.equal((await post('/study/api/practice/ask', { pointId: 'M1.1', mode: 'self' })).status, 400, '自己安排得写一句')

  // ⑨ 真分析过材料之后：章节条目顶上，章号对得上就把这一节的讲义挂上去，
  //    别因为分析结果里没写 file 就退回去开一整个目录
  const folder = 'F:\\示例资料\\线性代数讲义'
  const mat = await json(await post('/study/api/materials', { kind: 'notes', title: '线性代数讲义', path: folder }))
  const materialId = mat.data.material.id
  writeFileSync(
    join(root, 'profiles', 'default', 'analysis.json'),
    JSON.stringify({
      version: 1,
      byMaterial: {
        [materialId]: {
          materialId,
          title: '线性代数讲义',
          coverage: '整本通读',
          chapters: [
            { no: '1.1', title: '行列式', pages: '1-16', exercises: '例1-例8', difficulty: '基础' },
            { no: '11.1', title: '矩阵的运算', pages: '1-12', difficulty: '中等' },
          ],
        },
      },
    }),
  )

  const real = await json(await get('/study/api/practice?point=M1.1'))
  assert.equal(real.data.chapters.length, 1, 'source 指了 1.1，就不该把 11.1 也端出来')
  assert.equal(real.data.chapters[0].no, '1.1')
  assert.equal(real.data.chapters[0].material, '线性代数讲义')
  assert.equal(real.data.chapters[0].pages, '1-16')
  assert.equal(real.data.chapters[0].file, LECTURE, '章号对上了就把这一节的讲义挂上，不用再点进目录找')

  // 11.1 那一章不能被 1.1 的 source 误伤——按子串比对上就会出这个错
  const line = await json(await get('/study/api/practice?point=M1.3'))
  assert.equal(line.data.chapters.length, 1, '11.1 不该把 1.1 也带出来')
  assert.equal(line.data.chapters[0].no, '11.1')
  assert.equal(line.data.chapters[0].file, 'F:\\示例资料\\线性代数讲义\\11.1 矩阵的运算.pdf')

  // 这一节既没 source 也没讲义时，至少把整份材料摆出来，但别去借别人的文件
  const other = await json(await get('/study/api/practice?point=M1.2'))
  assert.equal(other.data.chapters.length, 2, '对不上就把整份材料摆出来')
  assert.ok(other.data.chapters.every((c) => !c.file), '没讲义的点不该借用别的章节的文件')
})
