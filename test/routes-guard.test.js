/**
 * 路由表自检：同一个方法 + 同一个 pattern 不许登记两遍。
 *
 * 匹配是按登记顺序来的，先登的那条会把后面那条整个盖住——两条都还在表里，光看代码看不出来，
 * 表现是「新加的那条永远轮不到」。所以登记时就炸（来由：DeepTutor 的 `api/contracts/export.py`
 * 拿 operationId 当键，撞了 `raise RuntimeError`，不把缺陷藏进产物）。这一份钉住那两条：
 * ①自检函数本身认得出重复；②真表（createRouter 现在会跑的那一整份）是干净的。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertUniqueRoutes, createRouter, routeKey } from '../lib/routes.js'
import { Store } from '../lib/store.js'

test('同一个方法 + 同一个 pattern 登记两遍要报错，别的都不算重复', () => {
  const ok = [
    { method: 'GET', pattern: '/study/api/a' },
    { method: 'POST', pattern: '/study/api/a' }, // 方法不同：不算重复
    { method: 'GET', pattern: '/study/api/b' },
  ]
  assert.equal(assertUniqueRoutes(ok), ok)

  const dup = [...ok, { method: 'GET', pattern: '/study/api/a' }]
  assert.throws(() => assertUniqueRoutes(dup), /路由重复登记：GET \/study\/api\/a/)

  /* 正则 pattern 也按它的字符串形式比：两条字面一样就是重复。 */
  assert.throws(
    () => assertUniqueRoutes([{ method: 'GET', pattern: /^\/x$/ }, { method: 'GET', pattern: /^\/x$/ }]),
    /路由重复登记/,
  )
  assert.equal(routeKey({ method: 'GET', pattern: /^\/y$/ }), 'GET /^\\/y$/')
  /* 空表、不是数组的输入都不炸。 */
  assert.deepEqual(assertUniqueRoutes([]), [])
  assert.deepEqual(assertUniqueRoutes(null), [])
})

test('真实那张路由表建得起来（一条重复都没有）', () => {
  const root = mkdtempSync(join(tmpdir(), 'study-routes-'))
  try {
    const store = new Store(root)
    /* createRouter 内部每登记一条就自检一次：这里不抛就说明整张表是干净的。 */
    const handle = createRouter(store, {})
    assert.equal(typeof handle, 'function')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
