/**
 * 「能力」页那张薄弱清单的判定。
 *
 * 这次改动加的两条是冲着「账是断的」去的：教练只给被推进的那个单元记账，
 * 旁支单元（前置，比如集合题里的绝对值不等式）一条证据都不落，
 * 于是 `weak` 里既看不到它、图形上也没有它——塌了才知道。
 *
 * 所以这里钉两件事：
 *   ① 一条证据都没有的单元，照旧进不了 weak（没碰过不算薄弱，`没接触过` 在第 528 行就被跳过了）；
 *   ② 档位撑不起证据数的单元要报出来：只有自评/上课的，和「当天一条做题冲上去的」。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { abilityReport } from '../lib/map.js'

const MAP = {
  modules: [
    {
      id: 'M1',
      title: '集合与常用逻辑用语',
      group: '一 集合、逻辑与不等式',
      points: [{ id: 'M1.1', title: '集合的概念与基本关系' }],
    },
    {
      id: 'M2',
      title: '不等式',
      group: '一 集合、逻辑与不等式',
      points: [{ id: 'M2.1', title: '不等式基础' }],
    },
  ],
}

/** 造一份只有 M1.1 / M2.1 的掌握度。 */
function masteryOf(m1, m2) {
  return { points: { 'M1.1': m1, 'M2.1': m2 } }
}

function weakOf(mastery) {
  const report = abilityReport({ tools: [] }, MAP, mastery, null, { today: '2026-10-02' })
  return { report, weak: report.weak, byId: Object.fromEntries(report.weak.map((w) => [w.pointId, w])) }
}

test('一条证据都没有的单元不进薄弱清单', () => {
  const { weak } = weakOf(masteryOf({ stage: '没接触过', confidence: 0, evidence: [] }, undefined))
  assert.equal(weak.length, 0)
})

test('只有自评和上课的单元：报「撑不起」，并带出做题条数 0', () => {
  const { byId } = weakOf(
    masteryOf(
      {
        stage: '熟练稳定',
        confidence: 0.9,
        evidence: [
          { id: 'e1', kind: 'self', note: '他说他会' },
          { id: 'e2', kind: 'lesson', note: '看完第 04 讲' },
        ],
      },
      undefined,
    ),
  )
  const row = byId['M1.1']
  assert.ok(row, 'M1.1 该进薄弱清单')
  assert.equal(row.work, 0)
  assert.match(row.reason, /没有一条做题\/作业照片/)
})

test('一条做题证据撑起「熟练稳定」：报「当天冲上去的」', () => {
  const { byId } = weakOf(
    masteryOf(
      { stage: '熟练稳定', confidence: 0.9, evidence: [{ id: 'e1', kind: 'quiz', note: '习题册 p5 第 1-8 题' }] },
      undefined,
    ),
  )
  const row = byId['M1.1']
  assert.ok(row, 'M1.1 该进薄弱清单')
  assert.equal(row.work, 1)
  assert.match(row.reason, /只有 1 条做题证据/)
})

test('两条做题证据的「熟练稳定」不再报薄弱（有底）', () => {
  const { byId } = weakOf(
    masteryOf(
      {
        stage: '熟练稳定',
        confidence: 0.9,
        evidence: [
          { id: 'e1', kind: 'quiz', note: '习题册 p5 第 1-8 题' },
          { id: 'e2', kind: 'photo', note: '拍来的重做' },
        ],
      },
      undefined,
    ),
  )
  assert.equal(byId['M1.1'], undefined, '有两条做题证据就不该再挂「撑不起」')
})

test('基本工具走的是另一张表，不进知识点薄弱清单', () => {
  // 只挂一条 tool：knowledge 单元没有任何证据，weak 必须空。
  const { weak } = weakOf(masteryOf(undefined, undefined))
  assert.equal(weak.length, 0)
})
