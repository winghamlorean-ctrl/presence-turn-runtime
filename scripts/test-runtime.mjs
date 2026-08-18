import assert from 'node:assert/strict'
import { setActivePack } from '../src/pack/context.js'
import { mergePack } from '../src/pack/blank.js'
import { resolveUserTurnPolicy } from '../src/runtime/userTurnPolicy.js'
import {
  evaluateSalvageNeed,
  shouldAdoptSalvageResult,
} from '../src/runtime/salvage.js'
import {
  stripForbidFamilies,
  spokenContentCharCount,
  textHitsForbidFamilies,
} from '../src/engines/replyForbidFamilies.js'

setActivePack(
  mergePack({
    facts: { name: '小周', drink: '热茶' },
  }),
)

assert.equal(resolveUserTurnPolicy('在吗').turnKind, 'greeting')
assert.equal(resolveUserTurnPolicy('嗯').turnKind, 'short_ack')
assert.equal(resolveUserTurnPolicy('我先走了').turnKind, 'leaving')
assert.equal(resolveUserTurnPolicy('有点渴').turnKind, 'thirst')
assert.equal(resolveUserTurnPolicy('有点渴').cite, 'drink')
assert.equal(resolveUserTurnPolicy('我叫什么').cite, 'name')
assert.equal(resolveUserTurnPolicy('今天风好大').turnKind, 'default')

const servant = '我去给你倒杯水，先喝口水。'
assert.equal(textHitsForbidFamilies(servant, ['servant']), true)
assert.equal(
  spokenContentCharCount(stripForbidFamilies(servant, ['servant'])) <
    spokenContentCharCount(servant),
  true,
)
assert.equal(textHitsForbidFamilies('药还温着。', ['servant']), false)

const dodge = evaluateSalvageNeed(
  [{ displayText: '你先忙。我不吵你。' }],
  '你今天做什么了',
)
assert.equal(dodge.need, true)
assert.ok(dodge.reasons.includes('off_topic') || dodge.reasons.includes('forbid_hit'))

const empty = evaluateSalvageNeed([{ displayText: '（顿了顿）' }], '在吗')
assert.equal(empty.need, true)
assert.ok(empty.reasons.includes('empty_spoken'))

assert.equal(
  shouldAdoptSalvageResult({
    beforeSpoken: 0,
    afterSpoken: 6,
    beforeReasons: ['empty_spoken'],
    afterReasons: [],
  }),
  true,
)
assert.equal(
  shouldAdoptSalvageResult({
    beforeSpoken: 8,
    afterSpoken: 0,
    beforeReasons: ['forbid_hit'],
    afterReasons: ['empty_spoken'],
  }),
  false,
)

console.log('ok')
