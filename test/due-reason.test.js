/**
 * 复习理由（`dueReason`）：到期日是个日期，学生看到「2026-10-07」不知道今天该不该动它，
 * 所以每一行都配一句人话——几时记的证据、现在哪一档、逾期几天、底下还挂着几道没复做对的错题。
 *
 * 来由：DeepTutor 的排期器（`learning/scheduler.py:362`）每条都带一句人话 reason；它那套
 * FSRS 式权重是拍的、没有校准闭环，但「把理由说出来」这一条值得抄。这里只讲事实，
 * 要不要现在复习、复习哪一段，仍由教练用 `study_plan` 决定。
 *
 * 用法：node --test test/due-reason.test.js
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { dueReason } from '../lib/map.js'

/** 一份最小的掌握度状态：只放 dueReason 会读的那几个字段。 */
function state(over = {}) {
  return { stage: '能独立做', confidence: 0.6, evidence: [], nextReview: null, ...over }
}

test('复习理由把「几时记的、哪一档、逾期几天、几道错题」都说了', () => {
  const st = state({
    nextReview: '2026-10-01',
    evidence: [
      { id: 'e1', kind: 'quiz', at: '2026-09-27T09:00:00Z', note: '第九组第 3 题', stage: '能跟做' },
      { id: 'e2', kind: 'photo', at: '2026-09-28T09:00:00Z', note: '作业照片', stage: '能独立做' },
      /* 作废的那条不算数：它底下的错题也跟着不算。 */
      { id: 'e3', kind: 'quiz', at: '2026-09-28T09:30:00Z', stage: '能独立做', voidedAt: '2026-09-29T00:00:00Z', voidReason: '记错单元了', mistake: { status: '待验证', origin: '记错的那道' } },
      /* 最后一条活着的是 09-28 做的题，底下挂着一道没复做对的错题。 */
      { id: 'e4', kind: 'quiz', at: '2026-09-28T11:00:00Z', stage: '能独立做', mistake: { status: '待验证', origin: '《1000 题》第一章第九组第 3 题' } },
      { id: 'e5', kind: 'quiz', at: '2026-09-29T11:00:00Z', stage: '能独立做', mistake: { status: '已复做对', origin: '复做过了' } },
    ],
  })
  const why = dueReason(st, '2026-10-03')
  assert.match(why, /4 天前做过题/)
  assert.match(why, /现在是「能独立做」/)
  assert.match(why, /排在 2026-10-01，逾期 2 天/)
  assert.match(why, /底下有 1 道错题没复做对/)
})

test('还没记过证据、还没排复习，也说得出来是什么情况', () => {
  const why = dueReason(state({ stage: '见过' }), '2026-10-03')
  assert.match(why, /这一条还没记过证据/)
  assert.match(why, /现在是「见过」/)
  assert.match(why, /还没排下次复习/)
  assert.ok(!/道错题/.test(why))
})

test('今天刚记的写「今天」，没到期的只报排期不喊逾期', () => {
  const st = state({
    nextReview: '2026-10-09',
    evidence: [{ id: 'e1', kind: 'lesson', at: '2026-10-03T08:00:00Z', stage: '能独立做' }],
  })
  const why = dueReason(st, '2026-10-03')
  assert.match(why, /今天上过课/)
  assert.match(why, /排在 2026-10-09/)
  assert.ok(!/逾期/.test(why))
})
