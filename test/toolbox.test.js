/**
 * 工具栏目（番茄钟 + 清单）。三块一起验：
 *   1. 纯函数——时间是**绝对时刻**不是倒计时；走完不自动接下一轮；
 *      中途停按实际分钟记半截，**不算一个完整番茄**（不然「开了就算完成」就是刷数据的口子）；
 *   2. 工具层（study_focus / study_todo）——agent 也能起钟、加条目；
 *   3. 路由层（GET /study/api/toolbox、POST /study/api/focus|todo）。
 *
 * 用法：node --test test/toolbox.test.js
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Store, FOCUS_MIN, FOCUS_MAX, emptyToolbox } from '../lib/store.js'
import {
  addTodo,
  focusStatus,
  listTodos,
  normalizeTodo,
  patchTodo,
  removeTodo,
  settleFocus,
  startFocus,
  stopFocus,
} from '../lib/toolbox.js'
import { buildTools } from '../lib/tools.js'
import { createRouter } from '../lib/routes.js'

const EXEC = { signal: { throwIfAborted() {} } }
const AT = (iso) => new Date(iso)

function fresh() {
  const root = mkdtempSync(join(tmpdir(), 'study-toolbox-'))
  const store = new Store(root)
  store.ensure()
  const specs = buildTools(store, { panelPath: '/study' })
  const byName = new Map(specs.map((s) => [s.name, s]))
  return {
    root,
    store,
    call: (name, args = {}) => byName.get(name).execute(args, EXEC),
    done: () => rmSync(root, { recursive: true, force: true }),
  }
}

test('番茄钟只存绝对时刻：刷新、换页面、重启都不影响它算得对不对', () => {
  const box = emptyToolbox()
  const t0 = AT('2026-10-01T09:00:00.000Z')
  startFocus(box.focus, { minutes: 25, label: '看例题' }, t0)
  assert.equal(box.focus.endsAt, '2026-10-01T09:25:00.000Z', '存的是时刻，不是「还剩多少秒」')

  // 十五分钟以后看一眼，剩十分钟——这段没有任何定时器在跑，纯粹是算出来的
  const mid = focusStatus(box.focus, AT('2026-10-01T09:15:00.000Z'))
  assert.equal(mid.running, true)
  assert.equal(mid.left, 600)
  assert.equal(mid.label, '看例题')

  // 同一份数据，过一点再看就是走完了
  const done = focusStatus(box.focus, AT('2026-10-01T09:26:00.000Z'))
  assert.equal(done.left, 0)
})

test('走完一轮：记日志、累今天、phase 翻到下一轮，但**不自动接着跑**', () => {
  const box = emptyToolbox()
  startFocus(box.focus, { minutes: 25 }, AT('2026-10-01T09:00:00.000Z'))
  settleFocus(box.focus, AT('2026-10-01T09:25:00.000Z'))

  assert.equal(box.focus.running, false, '走完就得停下——学生走开半小时回来，不该看到「你正在第 4 个」')
  assert.equal(box.focus.endsAt, null)
  assert.equal(box.focus.todayMinutes, 25)
  assert.equal(box.focus.todayRounds, 1)
  assert.equal(box.focus.phase, 'break', '下一轮该休息了')
  assert.equal(box.focus.log.length, 1)
  assert.equal(box.focus.log[0].partial, undefined, '走完的算一整轮')
})

test('中途停：按实际坐了几分钟记，标成半截，不算一个完整番茄', () => {
  const box = emptyToolbox()
  startFocus(box.focus, { minutes: 25 }, AT('2026-10-01T09:00:00.000Z'))
  stopFocus(box.focus, {}, AT('2026-10-01T09:08:00.000Z'))

  assert.equal(box.focus.running, false)
  assert.equal(box.focus.log[0].minutes, 8)
  assert.equal(box.focus.log[0].partial, true)
  assert.equal(box.focus.todayMinutes, 8, '坐了 8 分钟就记 8 分钟')
  assert.equal(box.focus.todayRounds, 0, '半截不算一个番茄')
  assert.throws(() => stopFocus(box.focus, {}, AT('2026-10-01T09:09:00.000Z')), /没在跑/)
})

test('同时只能跑一个钟；没在跑就报错；时长有上下限', () => {
  const box = emptyToolbox()
  startFocus(box.focus, { minutes: 25 }, AT('2026-10-01T09:00:00.000Z'))
  assert.throws(() => startFocus(box.focus, { minutes: 30 }, AT('2026-10-01T09:05:00.000Z')), /还在跑/)

  for (const bad of [0, -3, 999, 25.5, 'abc']) {
    assert.throws(() => startFocus(emptyToolbox().focus, { minutes: bad }, AT('2026-10-01T09:00:00.000Z')), /专注时长/)
  }
  // 档案里那个数被改坏了（手改 JSON、跨版本），读的时候得拉回合法区间，别让它算出一个荒唐的剩余时间
  const broken = emptyToolbox()
  broken.focus.workMinutes = 999
  broken.focus.breakMinutes = -5
  const sane = focusStatus(broken.focus, AT('2026-10-01T09:00:00.000Z'))
  assert.equal(sane.workMinutes, FOCUS_MAX)
  assert.equal(sane.breakMinutes, FOCUS_MIN)
})

test('跨天：今天那两栏清零，日志留着', () => {
  const box = emptyToolbox()
  startFocus(box.focus, { minutes: 25 }, AT('2026-10-01T09:00:00.000Z'))
  settleFocus(box.focus, AT('2026-10-01T09:25:00.000Z'))
  assert.equal(box.focus.todayMinutes, 25)

  const next = focusStatus(box.focus, AT('2026-10-02T09:00:00.000Z'))
  assert.equal(next.todayMinutes, 0, '新的一天，今天的账重新算')
  assert.equal(next.todayRounds, 0)
  assert.equal(next.today, '2026-10-02')
})

test('清单：文字必填、超长与坏日期拦下、改一条不留空档', () => {
  assert.throws(() => normalizeTodo({ text: '  ' }), /写一句话/)
  assert.throws(() => normalizeTodo({ text: 'x'.repeat(121) }), /120/)
  assert.throws(() => normalizeTodo({ text: '背单词', due: '2026/10/02' }), /YYYY-MM-DD/)

  const box = emptyToolbox()
  const a = addTodo(box, { text: '背 20 个单词', due: '2026-10-02' })
  const b = addTodo(box, { text: '整理错题' })
  assert.notEqual(a.id, b.id)
  assert.equal(box.todos.items.length, 2)

  patchTodo(box, a.id, { done: true })
  assert.equal(listTodos(box, { status: 'done' }).items[0].id, a.id)
  assert.equal(listTodos(box, { status: 'open' }).items[0].id, b.id)
  assert.equal(listTodos(box, {}).total, 2)
  assert.throws(() => patchTodo(box, 'nope', { done: true }), /没有这条清单/)
  removeTodo(box, a.id)
  assert.equal(box.todos.items.length, 1)
})

test('清单排序：没做完的在前，各自按记下来的时刻倒序', () => {
  const box = emptyToolbox()
  const a = addTodo(box, { text: '甲' })
  const b = addTodo(box, { text: '乙' })
  const c = addTodo(box, { text: '丙' })
  // 工具层写的是「现在」，测不了先后，只好把 at 定死
  box.todos.items.find((x) => x.id === a.id).at = '2026-10-01T08:00:00.000Z'
  box.todos.items.find((x) => x.id === b.id).at = '2026-10-01T10:00:00.000Z'
  box.todos.items.find((x) => x.id === c.id).at = '2026-10-01T09:00:00.000Z'
  patchTodo(box, a.id, { done: true })

  const open = listTodos(box, { status: 'open' }).items.map((x) => x.text)
  assert.deepEqual(open, ['乙', '丙'], '新的在前')
  const all = listTodos(box, {}).items.map((x) => x.text)
  assert.deepEqual(all, ['乙', '丙', '甲'], '做完的压到最后')
})

test('工具层：agent 也能起钟、停钟、加条目、勾条目', async () => {
  const env = fresh()
  try {
    const started = await env.call('study_focus', { action: 'start', minutes: 25, label: '看例题' })
    assert.equal(started.running, true)
    assert.match(started.summary, /25 分钟/)

    // 时间是绝对时刻：起完就别管了，别轮询等它
    const status = await env.call('study_focus', { action: 'status' })
    assert.equal(status.running, true)
    assert.match(status.endsAt, /^\d{4}-\d{2}-\d{2}T/)

    const added = await env.call('study_todo', { action: 'add', text: '背 20 个单词', due: '2026-10-02' })
    assert.equal(added.open, 1)
    assert.match(added.summary, /背 20 个单词/)

    const listed = await env.call('study_todo', { action: 'list', status: 'open' })
    assert.equal(listed.total, 1)
    assert.match(listed.items[0].text, /背 20 个单词/)

    const toggled = await env.call('study_todo', { action: 'toggle', id: added.item.id })
    assert.equal(toggled.open, 0)
    assert.equal(toggled.done, 1)

    const stopped = await env.call('study_focus', { action: 'stop' })
    assert.equal(stopped.running, false)

    // 空条目在工具层就被拦下，别写进档案
    await assert.rejects(() => env.call('study_todo', { action: 'add', text: '   ' }), /写一句话/)
  } finally {
    env.done()
  }
})

test('路由层：三条接口走得通，中文报错原样回 400', async () => {
  const env = fresh()
  try {
    const handle = createRouter(env.store, {})
    const call = (method, pathname, body) => handle({ method, pathname, query: {}, body })

    let res = await call('GET', '/study/api/toolbox')
    assert.equal(res.code, 200)
    assert.equal(res.body.ok, true)
    assert.equal(res.body.focus.running, false)
    assert.equal(res.body.focus.workMinutes, 25)
    assert.equal(res.body.focus.breakMinutes, 5)
    assert.deepEqual(res.body.todos.items, [])

    res = await call('POST', '/study/api/focus', { action: 'start', minutes: 45, breakMinutes: 10, label: '做套卷' })
    assert.equal(res.code, 200)
    assert.equal(res.body.focus.running, true)
    assert.equal(res.body.focus.roundMinutes, 45)
    assert.equal(res.body.focus.label, '做套卷')
    assert.equal(res.body.focus.breakMinutes, 10, '两格一起存，休息多久也得记住')

    res = await call('POST', '/study/api/focus', { action: 'start', minutes: 30 })
    assert.equal(res.code, 400)
    assert.match(res.body.error.message, /还在跑/)

    res = await call('POST', '/study/api/focus', { action: 'stop' })
    assert.equal(res.code, 200)
    assert.equal(res.body.focus.running, false)

    res = await call('POST', '/study/api/focus', { action: 'banana' })
    assert.equal(res.code, 400)
    assert.match(res.body.error.message, /action 只能是 start 或 stop/)

    res = await call('POST', '/study/api/todo', { action: 'add', text: '背 20 个单词' })
    assert.equal(res.code, 200)
    const id = res.body.item.id
    assert.equal(res.body.todos.open, 1)

    res = await call('POST', '/study/api/todo', { action: 'toggle', id })
    assert.equal(res.code, 200)
    assert.equal(res.body.item.done, true)

    res = await call('POST', '/study/api/todo', { action: 'toggle' })
    assert.equal(res.code, 400)
    assert.match(res.body.error.message, /要带 id/)

    res = await call('POST', '/study/api/todo', { action: 'remove', id })
    assert.equal(res.code, 200)
    assert.equal(res.body.todos.total, 0)

    // 写进去的东西真落盘了（换一个 Store 读同一份目录）
    const again = createRouter(new Store(env.root), {})
    res = await again({ method: 'GET', pathname: '/study/api/toolbox', query: {}, body: null })
    assert.equal(res.code, 200)
    assert.equal(res.body.todos.total, 0)
    assert.equal(res.body.focus.workMinutes, 45)
  } finally {
    env.done()
  }
})
