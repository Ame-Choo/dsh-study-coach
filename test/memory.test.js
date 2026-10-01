import test from 'node:test'
import assert from 'node:assert/strict'

import { emptyMemory, CARD_STEPS } from '../lib/store.js'
import {
  addCard,
  cardState,
  cardStats,
  findCard,
  leftText,
  listCards,
  memoryBody,
  normalizeCard,
  patchCard,
  removeCard,
  reviewCard,
  scheduleFor,
} from '../lib/memory.js'

/** 一个固定的「现在」，别让断言跟着系统时钟漂。 */
const T0 = new Date('2026-10-01T09:00:00.000Z')
const at = (minutes) => new Date(T0.getTime() + minutes * 60 * 1000)

function fresh() {
  return emptyMemory()
}

test('排期阶梯：四档自评把「第几级」往哪儿推', () => {
  // 新卡（step 0）「记住」→ 进第一级，1 小时后再看。
  // 注意 10 分钟那一级（CARD_STEPS[0]）不是这么走出来的：新卡建出来就立刻到期，
  // 那一下就是「刚写下来先看一遍」；10 分钟是「忘了」之后的回来间隔。
  assert.deepEqual(scheduleFor(0, '记住'), { step: 1, minutes: CARD_STEPS[1], lapsed: false })
  // 「忘了」打回第 0 级，10 分钟后再来，记一次 lapse
  assert.deepEqual(scheduleFor(4, '忘了'), { step: 0, minutes: CARD_STEPS[0], lapsed: true })
  // 「模糊」退一级，不记 lapse
  assert.deepEqual(scheduleFor(3, '模糊'), { step: 2, minutes: CARD_STEPS[2], lapsed: false })
  // 已经在第 0 级还「模糊」就留在第 0 级，不会退到负数
  assert.deepEqual(scheduleFor(0, '模糊'), { step: 0, minutes: CARD_STEPS[0], lapsed: false })
  // 「秒答」进两级
  assert.deepEqual(scheduleFor(1, '秒答'), { step: 3, minutes: CARD_STEPS[3], lapsed: false })
  // 越过最后一级 → minutes 为 null，意思是「毕业」
  assert.equal(scheduleFor(CARD_STEPS.length - 1, '记住').minutes, null)
  assert.equal(scheduleFor(CARD_STEPS.length - 1, '秒答').minutes, null)
  // 乱七八糟的 step 夹回合法范围，不抛
  assert.equal(scheduleFor(-5, '记住').step, 1)
  assert.equal(scheduleFor(99, '记住').minutes, null)
})

test('建卡：正反面必填、类型有白名单、新卡立刻到期', () => {
  const memory = fresh()
  const card = addCard(memory, { front: '  contingency  ', back: ' 列联表 ', kind: '单词', pointId: 'M1.1' }, T0)
  assert.equal(card.front, 'contingency', '两头的空格要削掉')
  assert.equal(card.back, '列联表')
  assert.equal(card.kind, '单词')
  assert.equal(card.pointId, 'M1.1')
  assert.equal(card.step, 0)
  assert.equal(card.at, T0.toISOString())
  assert.equal(card.dueAt, T0.toISOString(), '刚写下来就该马上看一遍')
  assert.equal(cardState(card, T0), 'due')
  assert.equal(memory.cards.length, 1)

  // 类型不给就是「其他」
  assert.equal(addCard(memory, { front: 'a', back: 'b' }, T0).kind, '其他')

  // 正面 / 背面 / 类型都得拦
  assert.throws(() => addCard(memory, { front: '   ', back: 'b' }, T0), /卡片正面要写点东西/)
  assert.throws(() => addCard(memory, { front: 'a', back: '' }, T0), /卡片背面要写点东西/)
  assert.throws(() => addCard(memory, { front: 'a', back: 'b', kind: '单词卡' }, T0), /卡片类型只能是/)
  assert.throws(() => addCard(memory, { front: 'x'.repeat(201), back: 'b' }, T0), /超过 200 字/)
  assert.throws(() => normalizeCard(null), /card 要是一个对象/)
})

test('复习：一段一段往后走，「忘了」打回第一步并记 lapse', () => {
  const memory = fresh()
  const card = addCard(memory, { front: 'a', back: 'b' }, T0)

  // 第一次「记住」→ 1 小时后再看
  reviewCard(memory, card.id, '记住', T0)
  assert.equal(card.step, 1)
  assert.equal(card.dueAt, at(60).toISOString())
  assert.equal(cardState(card, at(59)), 'waiting')
  assert.equal(cardState(card, at(60)), 'due')
  assert.equal(card.lapses, 0)

  // 到点了「模糊」→ 退一级（第 1 级退到第 0 级 = 10 分钟）
  reviewCard(memory, card.id, '模糊', at(60))
  assert.equal(card.step, 0)
  assert.equal(card.dueAt, at(70).toISOString())
  assert.equal(card.lapses, 0)

  // 「忘了」→ 打回第 0 级 + 记一次 lapse
  reviewCard(memory, card.id, '忘了', at(70))
  assert.equal(card.step, 0)
  assert.equal(card.dueAt, at(80).toISOString())
  assert.equal(card.lapses, 1)

  // 复习记录一条条攒着
  assert.equal(card.reviews.length, 3)
  assert.deepEqual(card.reviews.map((r) => r.grade), ['记住', '模糊', '忘了'])
  assert.equal(card.reviews.at(-1).dueAt, at(80).toISOString())

  // 找不到那张卡要报错，错误里带上 id
  assert.throws(() => reviewCard(memory, 'c-nope', '记住', T0), /没有这张卡：c-nope/)
  assert.throws(() => reviewCard(memory, card.id, '还行', T0), /自评只能是/)
})

test('毕业：走完最后一级，或者连着三次「秒答」', () => {
  // ① 一级一级走完
  const memory = fresh()
  const card = addCard(memory, { front: 'F = ma', back: '牛顿第二定律' }, T0)
  let clock = T0
  for (let i = 0; i < CARD_STEPS.length; i += 1) {
    reviewCard(memory, card.id, '记住', clock)
    clock = at((i + 1) * 60)
  }
  assert.ok(card.graduatedAt, '走完所有级就该毕业')
  assert.equal(card.dueAt, null)
  assert.equal(cardState(card, at(99999)), 'graduated')
  assert.equal(cardLeftOf(card), 0)

  // ② 连着三次「秒答」（step 0 → 2 → 4 → 6=最后一级）
  const fast = fresh()
  const quick = addCard(fast, { front: 'a', back: 'b' }, T0)
  reviewCard(fast, quick.id, '秒答', T0)
  assert.equal(quick.streak, 1)
  reviewCard(fast, quick.id, '秒答', at(1))
  assert.equal(quick.streak, 2)
  assert.equal(quick.graduatedAt, null, '两次还不够')
  reviewCard(fast, quick.id, '秒答', at(2))
  assert.equal(quick.streak, 3)
  assert.ok(quick.graduatedAt, '连着三次秒答直接毕业')

  // 中间插一次「记住」，连续就断了
  const mix = fresh()
  const m = addCard(mix, { front: 'a', back: 'b' }, T0)
  reviewCard(mix, m.id, '秒答', T0)
  reviewCard(mix, m.id, '记住', at(1))
  reviewCard(mix, m.id, '秒答', at(2))
  assert.equal(m.streak, 1, '断过就得重新数')
  assert.equal(m.graduatedAt, null)
})

/** 顺手拿一个「还剩多久」的数，省得上面为了一个断言再 import 一次。 */
function cardLeftOf(card, now = T0) {
  const due = Date.parse(card.dueAt || '')
  if (!Number.isFinite(due)) return 0
  return Math.max(0, due - now.getTime())
}

test('清单：到期在前，按该看的先后排；能按状态 / 类型 / 单元筛', () => {
  const memory = fresh()
  const a = addCard(memory, { front: 'A', back: 'a', kind: '单词' }, T0)
  const b = addCard(memory, { front: 'B', back: 'b', kind: '公式', pointId: 'M1.1' }, at(1))
  const c = addCard(memory, { front: 'C', back: 'c', kind: '单词', pointId: 'M1.2' }, at(2))

  // 三条都是新卡 → 全部到期，按 dueAt 升序（也就是建卡先后）
  let out = listCards(memory, { now: at(5) })
  assert.deepEqual(out.items.map((x) => x.front), ['A', 'B', 'C'])
  assert.equal(out.due, 3)
  assert.equal(out.total, 3)
  // 「现在」回到 T0 的话 B、C 还没到点——到期与否是拿 dueAt 跟当下比的
  assert.equal(listCards(memory, { now: T0 }).due, 1)

  // 把 A 推到 1 天后再看，B 推到 10 分钟后 → 到期的只剩 C，B 是 waiting、A 更晚
  reviewCard(memory, a.id, '秒答', T0) // step 2 → 9 小时
  reviewCard(memory, b.id, '记住', at(1)) // step 1 → 10 分钟
  out = listCards(memory, { now: at(20) })
  assert.equal(out.due, 1)
  assert.equal(out.waiting, 2)
  assert.deepEqual(out.items.filter((x) => x.state === 'due').map((x) => x.front), ['C'])
  // waiting 里按原定时刻排：B（10 分钟）在 A（9 小时）前面
  assert.deepEqual(out.items.filter((x) => x.state === 'waiting').map((x) => x.front), ['B', 'A'])

  // 只看到期的
  out = listCards(memory, { status: 'due', now: at(20) })
  assert.equal(out.total, 1)
  assert.equal(out.due, 1, '筛过之后 due 仍是全库的计数，不是筛出来的条数')

  // 按类型、按单元。注意「到期在前」这条排序规则也管着这里：C 到期、A 还在等，
  // 所以筛出来是 C 在前——筛的是子集，排序规则不跟着变。
  assert.deepEqual(listCards(memory, { kind: '单词', now: at(5) }).items.map((x) => x.front), ['C', 'A'])
  assert.deepEqual(listCards(memory, { pointId: 'M1.1', now: at(5) }).items.map((x) => x.front), ['B'])

  // 毕业的不再出现在 due 里
  reviewCard(memory, c.id, '秒答', at(2))
  reviewCard(memory, c.id, '秒答', at(3))
  reviewCard(memory, c.id, '秒答', at(4))
  assert.equal(cardState(c, at(5)), 'graduated')
  out = listCards(memory, { status: 'due', now: at(5) })
  assert.deepEqual(out.items.map((x) => x.front), [], '毕业了就不该再催他')
  assert.equal(out.graduated, 1)

  // limit 只管切，total 还是全库
  assert.equal(listCards(memory, { limit: 1, now: at(5) }).items.length, 1)
  assert.equal(listCards(memory, { limit: 1, now: at(5) }).total, 3)
})

test('人话：还剩多久、概览数字、面板要的那一份', () => {
  assert.equal(leftText(0), '现在')
  assert.equal(leftText(-1), '现在')
  assert.equal(leftText(10 * 1000), '马上')
  assert.equal(leftText(8 * 60 * 1000), '还有 8 分钟')
  assert.equal(leftText(3 * 3600 * 1000), '还有 3 小时')
  assert.equal(leftText(2 * 24 * 3600 * 1000), '还有 2 天')
  assert.equal(leftText(60 * 24 * 3600 * 1000), '还有 2 个月')

  const memory = fresh()
  addCard(memory, { front: 'word', back: '单词', kind: '单词' }, T0)
  addCard(memory, { front: 'F=ma', back: '公式', kind: '公式' }, T0)
  const late = addCard(memory, { front: 'late', back: '十小时后', kind: '定义' }, T0)
  reviewCard(memory, late.id, '记住', T0) // step 1 → 10 分钟

  const stats = cardStats(memory, T0)
  assert.equal(stats.total, 3)
  assert.equal(stats.graduated, 0)
  assert.equal(stats.learning, 3)
  assert.equal(stats.byKind['单词'], 1)
  assert.equal(stats.byKind['公式'], 1)
  assert.equal(stats.byKind['定义'], 1)
  assert.equal(stats.byKind['其他'], 0, '类型表每一档都要在，哪怕是 0')

  const body = memoryBody(memory, T0)
  assert.equal(body.stats.total, 3)
  assert.equal(body.dueTotal, 2, '到期的两张')
  assert.equal(body.soon, 1, '十小时后到期那张算「今天晚点还有」')
  assert.deepEqual(body.dueItems.map((x) => x.front).sort(), ['F=ma', 'word'])
  assert.match(body.dueItems[0].leftText, /现在|分钟/)

  // 十小时后就不在「24 小时内」了
  assert.equal(memoryBody(memory, at(60 * 24)).soon, 0)
})

test('改内容和删：排期那几项不能被内容改动冲掉', () => {
  const memory = fresh()
  const card = addCard(memory, { front: 'a', back: 'b', pointId: 'M1.1' }, T0)
  reviewCard(memory, card.id, '记住', T0)
  reviewCard(memory, card.id, '记住', at(10))
  const before = { step: card.step, dueAt: card.dueAt, reviews: card.reviews.length }
  assert.equal(before.step, 2)

  // 只改背面：正面、类型、排期都留着
  const patched = patchCard(memory, card.id, { back: '新的答案' })
  assert.equal(patched.back, '新的答案')
  assert.equal(patched.front, 'a')
  assert.equal(patched.kind, '其他')
  assert.equal(patched.pointId, 'M1.1')
  assert.equal(patched.step, before.step)
  assert.equal(patched.dueAt, before.dueAt, '改内容不该把排期重置')
  assert.equal(patched.reviews.length, before.reviews)
  assert.equal(patched.at, T0.toISOString(), '建卡时刻不动')
  assert.equal(patched.id, card.id)

  // 排期乱填也不会被内容改动带过去
  patchCard(memory, card.id, { step: 99, dueAt: null, lapses: 7 })
  assert.equal(card.step, before.step)
  assert.equal(card.dueAt, before.dueAt)
  assert.equal(card.lapses, 0)

  // 改内容时的校验照旧
  assert.throws(() => patchCard(memory, card.id, { front: '  ' }), /卡片正面要写点东西/)
  assert.throws(() => patchCard(memory, 'c-nope', { back: 'x' }), /没有这张卡：c-nope/)

  // 删
  assert.equal(findCard(memory, card.id).id, card.id)
  removeCard(memory, card.id)
  assert.equal(findCard(memory, card.id), null)
  assert.equal(memory.cards.length, 0)
  assert.throws(() => removeCard(memory, card.id), /没有这张卡/)
  assert.equal(findCard(memory, ''), null)
})
