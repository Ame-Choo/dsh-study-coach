/**
 * 多科目任务：同时学 A、B、C 的时候，任务得落在对的门里。
 *
 * 这一层最容易出的错不是「排不进去」，是排串门——在「今天」那一栏给
 * 线性代数加一条，结果写进了高数。所以除了正常路径，这里专门盯着
 * 「没带 profileId 时不许碰别人的任务」和「不存在的 profileId 必须报错」。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Library } from '../lib/library.js'
import { createRouter } from '../lib/routes.js'

const DATE = '2026-10-02'

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'study-tasks-'))
  const store = new Library(root)
  store.ensure()
  store.create({ title: '线性代数', subject: '线性代数', minutesPerDay: 30 })
  const second = store.list().find((p) => p.id !== 'default')
  store.select('default') // 第一门课才是「在用」的
  const handle = createRouter(store)
  return { root, store, second: second.id, handle }
}

const call = (handle, method, pathname, body) => handle({ method, pathname, query: {}, body })
const get = (handle, query) => handle({ method: 'GET', pathname: '/study/api/tasks', query: { date: DATE, ...query } })

test('给不存在的档案排任务要报错，不能顺手造一个新档案出来', () => {
  const { root, store, handle } = setup()
  try {
    const before = store.list().length
    const res = call(handle, 'POST', '/study/api/task', { date: DATE, profileId: '不存在的课', title: '看第一节' })
    assert.equal(res.code, 404)
    assert.match(res.body.error.message, /unknown profileId/)
    assert.equal(store.list().length, before, '名册不能因为一次打错的请求多出一门课')
    assert.ok(!existsSync(join(root, 'profiles', '不存在的课')), '也不能真在磁盘上建目录')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('带 profileId 的任务落到那一门，不带就落到当前在用的那门', () => {
  const { root, store, second, handle } = setup()
  try {
    const a = call(handle, 'POST', '/study/api/task', { date: DATE, profileId: second, title: '线代：行列式', minutes: 20 })
    assert.equal(a.code, 200)
    assert.equal(a.body.profileId, second)

    const b = call(handle, 'POST', '/study/api/task', { date: DATE, title: '高数：看第 3 讲', kind: 'watch' })
    assert.equal(b.code, 200)
    assert.equal(b.body.profileId, 'default')

    // 各回各家
    const mine = get(handle, {}).body
    assert.deepEqual(mine.day.map((t) => t.title), ['高数：看第 3 讲'])

    const other = get(handle, { profileId: second })
    assert.deepEqual(other.body.day.map((t) => t.title), ['线代：行列式'])
    assert.equal(other.body.profileId, second)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('all=1 把每门课各自的今天并列给出来，各带各的跳转按钮', () => {
  const { root, second, handle } = setup()
  try {
    const first = get(handle, {}).body.day[0]
    void first
    call(handle, 'POST', '/study/api/task', { date: DATE, profileId: second, title: '线代：行列式' })
    call(handle, 'POST', '/study/api/task', { date: DATE, title: '高数：看第 3 讲' })

    const res = handle({ method: 'GET', pathname: '/study/api/tasks', query: { all: '1', date: DATE } })
    assert.equal(res.code, 200)
    assert.equal(res.body.all, true)
    assert.equal(res.body.profiles.length, 2)
    assert.equal(res.body.profiles.filter((p) => p.active).length, 1)
    const byId = Object.fromEntries(res.body.profiles.map((p) => [p.id, p]))
    assert.deepEqual(byId.default.day.map((t) => t.title), ['高数：看第 3 讲'])
    assert.deepEqual(byId[second].day.map((t) => t.title), ['线代：行列式'])
    for (const p of res.body.profiles) {
      assert.equal(typeof p.progress, 'number')
      assert.ok(Array.isArray(p.day[0].links))
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('勾掉、改、删都要认准是哪一门', () => {
  const { root, second, handle } = setup()
  try {
    const mine = call(handle, 'POST', '/study/api/task', { date: DATE, title: '高数：看第 3 讲' }).body.task
    const theirs = call(handle, 'POST', '/study/api/task', { date: DATE, profileId: second, title: '线代：行列式' }).body.task
    assert.notEqual(mine.id, theirs.id)

    // 拿 id 但不带 profileId：只该动当前这门
    const flipped = call(handle, 'POST', '/study/api/task/toggle', { date: DATE, id: mine.id, done: true })
    assert.equal(flipped.code, 200)
    assert.equal(flipped.body.task.done, true)

    // 别人的 id 配别人的门，够不着
    const wrongDoor = call(handle, 'POST', '/study/api/task/toggle', { date: DATE, id: theirs.id, done: true })
    assert.equal(wrongDoor.code, 404)

    // 认准门就够得着
    const rightDoor = call(handle, 'POST', '/study/api/task/toggle', { date: DATE, profileId: second, id: theirs.id, done: true })
    assert.equal(rightDoor.code, 200)
    assert.equal(rightDoor.body.task.done, true)

    // 改名
    const renamed = call(handle, 'POST', '/study/api/task/update', { date: DATE, profileId: second, id: theirs.id, title: '线代：矩阵' })
    assert.equal(renamed.code, 200)
    assert.equal(renamed.body.task.title, '线代：矩阵')

    // 删掉别人的那条，当前这门的一条不许少
    const removed = call(handle, 'POST', '/study/api/task/remove', { date: DATE, profileId: second, id: theirs.id })
    assert.equal(removed.code, 200)
    assert.equal(removed.body.day.length, 0)
    const mineNow = get(handle, {}).body.day
    assert.equal(mineNow.length, 1)
    assert.equal(mineNow[0].title, '高数：看第 3 讲')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
