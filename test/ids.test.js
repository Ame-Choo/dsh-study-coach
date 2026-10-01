/**
 * 发号器（`lib/ids.js`）：同一毫秒里连发两个 id 也不能撞。
 *
 * 这条不是洁癖：材料是按 id 删的，两份撞了之后删一份会把另一份一起删掉。
 * CI 上就真撞过——node 24 比 node 22 快一点，连着两次 POST 落在同一毫秒里。
 *
 * 用法：node --test test/ids.test.js
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { uniqueId } from '../lib/ids.js'

test('uniqueId：没撞就给时间戳那版', () => {
  const ms = 1767225600000
  const base = 'mat-' + ms.toString(36)
  assert.equal(uniqueId('mat-', [], ms), base)
  assert.equal(uniqueId('mat-', [{ id: 'mat-别的' }], ms), base, '别人占的是别的号，不影响')
})

test('uniqueId：同一毫秒里连发不撞，撞上就往后挪', () => {
  const ms = 1767225600000
  const base = 'mat-' + ms.toString(36)
  assert.equal(uniqueId('mat-', [{ id: base }], ms), `${base}-2`)
  assert.equal(uniqueId('mat-', [{ id: base }, { id: `${base}-2` }], ms), `${base}-3`)
  assert.equal(uniqueId('mat-', [{ id: `${base}-2` }], ms), base, '-2 被占了不等于 base 也没了')
})

test('uniqueId：连着发一百个也是各是各的', () => {
  const ms = 1767225600000
  const taken = []
  for (let i = 0; i < 100; i += 1) taken.push({ id: uniqueId('MAT', taken, ms) })
  assert.equal(new Set(taken.map((t) => t.id)).size, 100)
})

test('uniqueId：taken 不是数组（档案里那份材料列表坏了）也不炸', () => {
  const ms = 1767225600000
  assert.equal(uniqueId('mat-', undefined, ms), 'mat-' + ms.toString(36))
  assert.equal(uniqueId('mat-', [null, {}], ms), 'mat-' + ms.toString(36), '没有 id 的条目当不存在')
})
