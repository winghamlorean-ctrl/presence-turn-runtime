/**
 * 抢救式第二遍 LLM：空壳 / 禁语漏网 / must 未满足 / 问句答偏 时触发，每轮最多 1 次。
 * 不做「感觉虚就重写」的质量重打。Cite 词来自当前 Pack。
 */

import {
  spokenContentCharCount,
  textHitsForbidFamilies,
} from '../engines/replyForbidFamilies.js'
import { resolveUserTurnPolicy } from './userTurnPolicy.js'
import { isOffTopicReply } from './offTopic.js'
import { getActivePack } from '../pack/context.js'

function replyJoinedText(replies = []) {
  return (replies || [])
    .map((r) => String(r?.displayText || r?.content || '').trim())
    .filter(Boolean)
    .join(' / ')
}

function citeNeedles() {
  const pack = getActivePack()
  const name = String(pack?.facts?.name || '').trim()
  const drink = String(pack?.facts?.drink || '').trim()
  return { name, drink }
}

export function evaluateSalvageNeed(
  replies = [],
  userMessage = '',
  userTurnPolicy = null,
) {
  const policy = userTurnPolicy || resolveUserTurnPolicy(userMessage, {})
  const preview = replyJoinedText(replies)
  const reasons = []
  const { name, drink } = citeNeedles()

  if (!preview || spokenContentCharCount(preview) < 1) {
    reasons.push('empty_spoken')
  }

  const families = policy.forbidFamilies || [
    'servant',
    'order_scold',
    'peer_dodge',
  ]
  if (preview && textHitsForbidFamilies(preview, families)) {
    reasons.push('forbid_hit')
  }

  if (policy.cite === 'name' && preview && name && !preview.includes(name)) {
    reasons.push('missing_name_cite')
  }
  if (policy.cite === 'drink' && preview && drink && !preview.includes(drink)) {
    reasons.push('missing_drink_cite')
  }

  if (
    (policy.must || []).includes('spoken_line') &&
    spokenContentCharCount(preview) < 1
  ) {
    if (!reasons.includes('empty_spoken')) reasons.push('empty_spoken')
  }

  if (
    preview &&
    spokenContentCharCount(preview) >= 1 &&
    isOffTopicReply(userMessage, preview)
  ) {
    reasons.push('off_topic')
  }

  return {
    need: reasons.length > 0,
    reasons,
    preview: preview.slice(0, 120),
    policy,
  }
}

export function buildSalvageRewriteUserDirective(
  userMessage = '',
  reasons = [],
  badPreview = '',
  policy = null,
) {
  const why = (reasons || []).join(',') || 'salvage'
  const bad = String(badPreview || '').trim().slice(0, 100)
  const user = String(userMessage || '').trim()
  const turnKind = policy?.turnKind || 'default'
  const cite = policy?.cite
  const offTopic = (reasons || []).includes('off_topic')
  const { name, drink } = citeNeedles()

  const lines = [
    `【抢救重写·${turnKind}】上一稿不合格（${why}）。`,
    `用户原话：「${user}」`,
  ]
  if (bad) {
    lines.push(`不合格原稿：「${bad}」——可保留其中干净语义，禁止原样复读禁语。`)
  }
  lines.push(
    '直接重写 1 句说出口的人话（可带一句轻旁白）。不要 json、不要 markdown、不要解释。',
    '硬约束：',
    '- 必须有人话，禁止只写括号旁白。',
    '- 禁止仆人伺候：递杯推盏、端水揉腿、先喝口水、我去弄/冲。',
    '- 禁止训斥使唤：别光应声、坐好、嗯什么。',
  )
  if (offTopic) {
    lines.push(
      '- 【答偏】必须先直接回答用户这一句的意思，禁止岔开、搪塞、拿上一轮话题硬套。',
      '- 禁止「你先忙/去吧我不吵/随你/我听着」打发问句。',
    )
  } else if (!['leaving'].includes(turnKind)) {
    lines.push('- 用户没说要走时，禁止「你先忙/去吧我不吵/随你」搪塞。')
  } else {
    lines.push('- 本轮暂离：用「去吧/睡吧/你去」一类完整短句应即可。')
  }
  if (cite === 'name' && name) {
    lines.push(`- 必须点到称呼「${name}」。`)
  }
  if (cite === 'drink' && drink) {
    lines.push(`- 必须口头点到「${drink}」。`)
  }
  if (turnKind === 'body_hold') {
    lines.push('- 身体不适：口头接住即可，不要伺候动作。')
  }
  if (turnKind === 'short_ack') {
    lines.push('- 短附和：顺着近话题轻轻接半步，禁止训斥催话。')
  }
  lines.push('不要新编无关剧情，不要客服腔。')
  return lines.join('\n')
}

export function shouldAdoptSalvageResult({
  beforeSpoken = 0,
  afterSpoken = 0,
  beforeReasons = [],
  afterReasons = [],
} = {}) {
  if (afterSpoken < 1) return false
  if (beforeSpoken < 1) return true
  if (afterSpoken > beforeSpoken) return true
  if (!afterReasons?.length) return true
  if (
    beforeReasons.includes('off_topic') &&
    !afterReasons.includes('off_topic')
  ) {
    return true
  }
  if (
    beforeReasons.includes('forbid_hit') &&
    !afterReasons.includes('forbid_hit')
  ) {
    return true
  }
  if (
    (beforeReasons.includes('missing_name_cite') ||
      beforeReasons.includes('missing_drink_cite')) &&
    !afterReasons.includes('missing_name_cite') &&
    !afterReasons.includes('missing_drink_cite')
  ) {
    return true
  }
  return false
}
