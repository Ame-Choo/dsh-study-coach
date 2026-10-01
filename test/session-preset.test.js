/**
 * 「这个会话是不是学习模式的」这条判据自己的一层。
 *
 * 它决定面板那一页列哪些会话、面板说出去的话投给谁；走偏了就是「学生一打开对话，
 * 看见的是别人（或者我）的编程会话」。这里把三种宿主形态钉住：
 * 发会话投影的 / 不发投影的老宿主 / 投影里明确写 null（没选预设）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { PRESET_ID } from '../lib/preset.js'
import {
  hasPresetChannel,
  isFresh,
  learningSessions,
  newSessionRequest,
  presetOf,
  rememberFresh,
} from '../lib/session-preset.js'

const withPreset = (id, agentPreset, extra = {}) => ({
  sessionId: id,
  ...extra,
  projections: { kind: 'cached', asOfSeq: 3, values: { agentPreset } },
})
const bare = (id, extra = {}) => ({ sessionId: id, ...extra })

test('判据用的是预设定义里那个 id', () => {
  assert.equal(PRESET_ID, 'study-coach')
})

test('presetOf：取投影里的 agentPreset，取不到一律回空串', () => {
  assert.equal(presetOf(withPreset('a', 'study-coach')), 'study-coach')
  assert.equal(presetOf(withPreset('b', 'coder')), 'coder')
  assert.equal(presetOf(bare('c')), '', '老宿主整份清单都没 projections')
  assert.equal(presetOf(withPreset('d', null)), '', '宿主写 null 就是「没选预设」，不是学习模式')
  assert.equal(presetOf({ sessionId: 'e', projections: { values: { agentPreset: 7 } } }), '', '不是字符串的一律不算')
  assert.equal(presetOf({ sessionId: 'f', projections: { values: null } }), '')
  assert.equal(presetOf(null), '')
  assert.equal(presetOf(undefined), '')
})

test('learningSessions：发投影的宿主只留学习模式，子会话一律不列', () => {
  const items = [
    withPreset('sub-1', PRESET_ID, { parentSessionId: 'live-1', origin: 'subagent' }),
    withPreset('live-1', PRESET_ID),
    withPreset('code-1', 'coder'),
    withPreset('plain-1', null),
    bare('old-1'),
  ]
  const out = learningSessions(items)
  assert.equal(out.filtered, true)
  assert.deepEqual(out.items.map((s) => s.sessionId), ['live-1'], '编程会话、没选预设的、子代理都不算学习模式')
})

test('learningSessions：不发投影的老宿主原样放行，不许筛成一片空白', () => {
  const items = [bare('a'), bare('b'), bare('sub-1', { parentSessionId: 'a', origin: 'subagent' })]
  const out = learningSessions(items)
  assert.equal(out.filtered, false, 'filtered=false 说的是「这次没敢筛」，不是「筛完正好没有」')
  assert.deepEqual(out.items.map((s) => s.sessionId), ['a', 'b'])
  assert.equal(hasPresetChannel(items), false)
  assert.equal(hasPresetChannel([bare('x', { projections: { kind: 'cached', asOfSeq: 0, values: {} } })]), true, '只要有投影这一层，就说明宿主会发')
})

test('learningSessions：清单不是数组也不炸', () => {
  assert.deepEqual(learningSessions(null), { items: [], filtered: false })
  assert.deepEqual(learningSessions(undefined), { items: [], filtered: false })
  assert.deepEqual(learningSessions('nope'), { items: [], filtered: false })
})

test('learningSessions：面板自己刚开的那个先放行（会话投影还没落地）', () => {
  assert.equal(isFresh('fresh-1'), false, '没记过的不算')
  assert.equal(rememberFresh('fresh-1'), 'fresh-1')
  assert.equal(isFresh('fresh-1'), true)
  assert.equal(isFresh(''), false, '空 id 不算')
  assert.equal(rememberFresh(''), '', '拿不到 id 就回空串，调用方当失败处理')

  const items = [withPreset('code-1', 'coder'), bare('fresh-1'), withPreset('live-1', PRESET_ID)]
  const out = learningSessions(items)
  assert.equal(out.filtered, true, '这台宿主发投影，该筛还是得筛')
  assert.deepEqual(out.items.map((s) => s.sessionId), ['fresh-1', 'live-1'], '刚建出来的那个不能被自己的筛子筛掉')
})

test('newSessionRequest：新建会话时报的预设号跟判据同一个', () => {
  assert.deepEqual(newSessionRequest(), { agentPreset: PRESET_ID })
})
