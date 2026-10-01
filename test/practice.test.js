/**
 * 做题页那一套：/study/api/practice 给出这一节对应的教辅章节、进度百分比、档位。
 *
 * 单独一个文件（node:test 同一文件里的用例会并发跑，共用一份档案会互相踩），
 * 而且全塞进一个 test 里——这些断言前后有依赖，分开了顺序就不保证。
 */
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'study-practice-'))
process.env.DSH_STUDY_ROOT = root

const routes = []
const disposers = []
const ctx = {
  effect(fn) {
    const d = fn()
    if (typeof d === 'function') disposers.push(d)
    return () => {}
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

test('做题页：材料、章节、进度、自评一条线', async () => {
  // ① 材料
  const mat = await post('/study/api/materials', {
    kind: 'book',
    title: '线性代数讲义',
    path: 'F:\\示例资料\\线性代数讲义.pdf',
  })
  assert.equal(mat.status, 200)
  const materialId = (await mat.json()).material.id

  // ② 教辅分析。真实路径是 agent 用 study_analysis 工具写，这里直接落到文件上，验读那一侧
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
            { no: '2', title: '行列式的定义', pages: '45-47', exercises: '1-5', examples: '例3', difficulty: '中等' },
            { no: '9', title: '矩阵的运算', pages: '180', exercises: '2', difficulty: '难' },
          ],
        },
      },
    }),
  )

  // ③ 地图：带大类，source 指向第 2 章
  const g1 = await post('/study/api/map/module', {
    module: {
      id: 'g1',
      group: '行列式',
      title: '性质与展开',
      points: [{ id: 'g1.p1', title: '定义', why: '打底', source: '第2章' }],
    },
  })
  assert.equal(g1.status, 200)
  assert.equal((await g1.json()).module.group, '行列式', 'map/module 得存得住大类')

  // ④ 参数不全 / 认不出来
  assert.equal((await get('/study/api/practice')).status, 400)
  assert.equal((await get('/study/api/practice?point=nope')).status, 404)

  // ⑤ 正常出题页数据
  const res = await get('/study/api/practice?point=g1.p1')
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(data.pointId, 'g1.p1')
  assert.equal(data.point.title, '定义')
  assert.equal(data.module.group, '行列式')
  assert.equal(data.module.title, '性质与展开')
  assert.equal(data.stage, '没接触过')
  assert.equal(data.stageAll.length, 6)
  assert.equal(typeof data.progress, 'number')

  // source 写了「第2章」，就只该给第 2 章，别把矩阵的运算也塞进来
  assert.equal(data.chapters.length, 1, 'source 指了第 2 章就不该把第 9 章也端出来')
  assert.equal(data.chapters[0].no, '2')
  assert.equal(data.chapters[0].pages, '45-47')
  assert.equal(data.chapters[0].exercises, '1-5')
  assert.equal(data.chapters[0].materialId, materialId)
  assert.equal(data.materials[0].path, 'F:\\示例资料\\线性代数讲义.pdf')

  // ⑥ source 一个都对不上时，整份教辅都给
  await post('/study/api/map/module', {
    module: {
      id: 'g2',
      group: '行列式',
      title: '计算技巧',
      points: [{ id: 'g2.p1', title: '定义', source: '不知道哪一章' }],
    },
  })
  const loose = await (await get('/study/api/practice?point=g2.p1')).json()
  assert.equal(loose.chapters.length, 2, '对不上就把整份教辅摆出来')

  // ⑦ 自评之后档位和进度都跟着动。门跟教练那条是同一个（一次只前进一档），
  //    所以从「没接触过」走到「能独立做」是三步，不是一步。
  for (const stage of ['见过', '能跟做', '能独立做']) {
    const step = await post('/study/api/mastery', {
      pointId: 'g1.p1',
      stage,
      kind: 'quiz',
      note: '做了 5 道，4 道对',
    })
    assert.equal(step.status, 200)
  }

  const after2 = await (await get('/study/api/practice?point=g1.p1')).json()
  assert.equal(after2.stage, '能独立做')
  assert.equal(after2.progress, 60, '性质与展开这一个点到了「能独立做」，这模块就是 60%')

  // ⑧ 大类那一层的百分比也算得出
  const state = await (await get('/study/api/state')).json()
  assert.equal(state.state.progress.groups['行列式'], 30, '行列式底下两个点，一个 60%、一个 0%，平均 30%')
})
