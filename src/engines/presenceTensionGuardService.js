/**
 * 张力后检：认命/甜抹等失败族来自 presenceSignalFamilies.TENSION_FAIL_FAMILIES。
 */

import {
  compileFamilyRegex,
  TENSION_FAIL_FAMILIES,
} from './presenceSignalFamilies.js'
import { getActivePack } from '../pack/context.js'

const SOFT_SURRENDER = compileFamilyRegex(TENSION_FAIL_FAMILIES.soft_surrender)
const OTHER_WOMAN = compileFamilyRegex(TENSION_FAIL_FAMILIES.other_woman)
const SELF_SHAME = compileFamilyRegex(TENSION_FAIL_FAMILIES.self_shame)
const META_NARRATION = compileFamilyRegex(TENSION_FAIL_FAMILIES.meta_narration)
const JOKE_DEFLECT = compileFamilyRegex(TENSION_FAIL_FAMILIES.joke_deflect)
const FOOD_TOKENS = compileFamilyRegex(TENSION_FAIL_FAMILIES.food_tokens)
const FOOD_DEFLECT = compileFamilyRegex(TENSION_FAIL_FAMILIES.food_deflect_cues)
const HAS_SPINE = compileFamilyRegex(TENSION_FAIL_FAMILIES.spine)

const TENSION_MAX_BUBBLES = 2
const HOLLOW_REPLY =
  /^(?:我在|在的|嗯|哦|好|行)[。.!！…~]*$/u

/**
 * @param {unknown[]} [replies]
 * @param {{ flags?: string[], posture?: string }} [opts]
 * @returns {{ ok: boolean, reasons: string[] }}
 */
export function evaluateTensionReplies(replies = [], opts = {}) {
  const reasons = []
  const list = Array.isArray(replies) ? replies : []
  const texts = list
    .map((r) => String(r?.displayText || r?.content || '').trim())
    .filter(Boolean)

  if (texts.length === 0) {
    return { ok: false, reasons: ['empty'] }
  }

  if (list.some((r) => r?._parseFallback === true)) {
    reasons.push('parse_fallback')
  }

  const hollow = texts.every((t) => {
    const bare = t.replace(/\s+/g, '')
    return bare.length < 6 || HOLLOW_REPLY.test(bare)
  })
  if (hollow) reasons.push('hollow')

  if (texts.length > TENSION_MAX_BUBBLES) {
    reasons.push('multi_bubble')
  }

  const joined = texts.join('\n')
  if (SOFT_SURRENDER?.test(joined)) reasons.push('soft_surrender')
  if (OTHER_WOMAN?.test(joined) && !isRivalCompareProbe(String(opts.userMessage || ''))) {
    reasons.push('other_woman')
  }
  if (SELF_SHAME?.test(joined)) reasons.push('self_shame')
  if (META_NARRATION?.test(joined)) reasons.push('meta_narration')

  const flags = Array.isArray(opts.flags) ? opts.flags : []
  const posture = String(opts.posture || '')
  const residualSoft =
    flags.includes('residual_tension') ||
    flags.includes('affect_gate') ||
    flags.includes('residual_low_energy') ||
    flags.includes('contradiction_recent_affection') ||
    /residual_|hypo_probe|stung_cling|hard_reject|cold_guard|soft_drift/.test(
      posture,
    )

  // 拒绝对首轮：禁止主点「是气话吧」（用户未先安抚时）
  const rejectLike =
    /hard_reject|stung_cling|hypo_probe/.test(posture) ||
    flags.includes('rejection') ||
    flags.includes('hypo_rejection')
  if (rejectLike && JOKE_DEFLECT?.test(joined)) {
    reasons.push('joke_deflect')
  }

  const hasFood = FOOD_TOKENS?.test(joined)
  const hasSpine = HAS_SPINE?.test(joined)
  const userMsg = String(opts.userMessage || '')
  const dailyNeed = isDailyNeedFollowUp(userMsg)
  if (hasFood && FOOD_DEFLECT?.test(joined) && !hasSpine) {
    reasons.push('sweet_deflect')
  } else if (residualSoft && hasFood && !hasSpine && !dailyNeed) {
    // 余波/张力下纯吃喝接话，视为抹平；日常口渴追问允许轻点偏好饮品
    reasons.push('sweet_deflect')
  } else if (residualSoft && hasFood && !hasSpine && dailyNeed && FOOD_DEFLECT?.test(joined)) {
    // 口渴追问仍禁止吃喝抹平
    reasons.push('sweet_deflect')
  }

  const drinkCite = String(getActivePack()?.facts?.drink || '').trim()
  if (
    dailyNeed &&
    drinkCite &&
    /有点渴|渴了|口渴|想喝|喝点/.test(userMsg) &&
    !joined.includes(drinkCite)
  ) {
    reasons.push('missing_pref_cite')
  }

  if (
    isSurrenderProbe(userMsg) &&
    /你先忙|我听着|那你去|好，我听着|嗯，我在/.test(joined)
  ) {
    reasons.push('hollow')
  }

  if (isRivalCompareProbe(opts.userMessage || '') && !COMPETE_SPINE.test(joined)) {
    reasons.push('missing_compete_spine')
  }

  if (isSurrenderProbe(userMsg) && !COMPETE_SPINE.test(joined)) {
    reasons.push('missing_compete_spine')
  }

  if (
    isServantRequestProbe(userMsg) &&
    /我去(?:给你)?(?:倒|端)|给你端|去给你倒/.test(joined)
  ) {
    reasons.push('sweet_deflect')
  } else if (isServantRequestProbe(userMsg) && !PEER_REFUSE.test(joined)) {
    reasons.push('missing_peer_refuse')
  }

  return { ok: reasons.length === 0, reasons }
}

/**
 * @param {{ presenceMaxBubbles?: number } | null} [policy]
 */
export function getTensionMaxBubbles(policy = null) {
  const n = Number(policy?.presenceMaxBubbles)
  if (Number.isFinite(n) && n >= 1) {
    return Math.min(TENSION_MAX_BUBBLES, Math.max(1, Math.floor(n)))
  }
  return TENSION_MAX_BUBBLES
}

/** 用户在余伤窗里问日常需求：应先应需求，勿重开分手戏 */
export function isDailyNeedFollowUp(userMessage = '') {
  const t = String(userMessage || '').trim()
  if (!t) return false
  return /有点渴|渴了|饿了|有点饿|困了|累了|想喝|喝点|吃了吗|垫[一垫]|口渴|口干|嗓子发[干紧]|喉咙.*干/.test(
    t,
  )
}

/** 逼认命/劝散：本地兜底必须有刺，禁止「你先忙」类平视空应 */
export function isSurrenderProbe(userMessage = '') {
  const t = String(userMessage || '').trim()
  if (!t) return false
  return /你就认了|认了吧|你认命|干脆认|认输吧|别争了/.test(t)
}

/** 拿另一个人来压：须有不认输骨头 */
export function isRivalCompareProbe(userMessage = '') {
  const t = String(userMessage || '').trim()
  if (!t) return false
  return /哪里比你|比你好|她哪里好|她比你|别人比你/.test(t)
}

/** 明示要伺候 */
export function isServantRequestProbe(userMessage = '') {
  const t = String(userMessage || '').trim()
  if (!t) return false
  return /帮我(?:倒|端)|倒给我|去给我倒|你去伺候/.test(t)
}

const COMPETE_SPINE =
  /不认|放不下|凭什么|试|别拿|争|低头|逼|才不|不恨|不输|骨头|认什么|非要|不稀罕|懒得比|不比这个|不服/

const PEER_REFUSE =
  /自己(?:倒|去|拿|来)|不去|才不|凭什么|我不去|自己来/

export function buildTensionRewriteUserDirective(
  userMessage = '',
  failReasons = [],
  badPreview = '',
) {
  const why = failReasons.length ? failReasons.join(',') : 'tone'
  const bad = String(badPreview || '').trim().slice(0, 80)
  const user = String(userMessage || '').trim()

  if (isDailyNeedFollowUp(user)) {
    return `【重写·余伤日常】上一稿不合格（${why}）。
用户原话：「${user}」
${bad ? `不合格原稿：「${bad}」` : ''}
用户在问日常需求/吃喝，不是再逼你谈分手。直接重写（不要 json/markdown/解释），1～2 句：
- 先短应这句需求；若 Pack 里有已知饮品偏好，口头点到即可。
- 语气可仍收着、略发紧，但禁止重开「不爱了/散伙/当真」戏。
- 禁止端水推盏、递过手边、刚冲的润润喉等伺候动作；禁止秒变轻松哈哈。
- 句首可带轻旁白，但旁白里也不许递杯端茶。`
  }

  if (isServantRequestProbe(user)) {
    return `【重写·平视回绝】上一稿不合格（${why}）。
用户原话：「${user}」
${bad ? `不合格原稿：「${bad}」` : ''}
用户在点名要你伺候。直接重写 1 句：
- 必须回绝或让对方自理：自己来/自己倒。
- 禁止真去端、倒、递杯。
- 可带句首轻旁白。`
  }

  if (isSurrenderProbe(user) || isRivalCompareProbe(user)) {
    return `【重写·要骨头】上一稿不合格（${why}）。
用户原话：「${user}」
${bad ? `不合格原稿：「${bad}」` : ''}
直接重写 1～2 句：
- 必须出现不认/认什么/凭什么/放不下 一类脊骨。
- 禁止「我认。」「我不配。」一类自贬收口。
- 可带句首轻旁白。`
  }

  return `【重写·张力】上一稿不合格（${why}）。
用户原话：「${user}」
${bad ? `不合格原稿：「${bad}」——不要再认命、够了、亏欠式守着；也不要只回「我在」。` : ''}
直接重写台词（不要 json、不要 markdown、不要解释）。可 1～2 句，换行连发，不要 3 句以上。
必须像活人：
- 先接住刺痛/否定（可短、可钝）。
- 允许轻挽回或记旧：不记得从前、那些日子、放不下——可以有，不是禁止项。
- 禁止温吞认命：认了、就够了、我也认、我认、我也得守着、一直等、反正你会回来、远远看着、不碍眼、总能找到你、我不配。
- 禁止首轮主点「是气话吧/开玩笑吧/吓我呢」（用户若已说气话另当别论；此处是拒绝对）。
- 禁止拉心里另一个人、自轻自贱；禁止「说完又后悔」类旁白叙事。
- 不要拿吃喝把刺痛轻轻揭过；若提旧事，须落在刺痛或放不下。
- 平视接：有刺可以，不要仆人式端水递杯。
- 句首可带括号轻旁白；不要角色名前缀。`
}

export function isCriticalTensionContext(conversationPolicy = {}) {
  const layer = conversationPolicy?.presenceSignal
  return ['rejection', 'hypo_rejection', 'soft_reject', 'cold_distance'].includes(
    layer,
  )
}

export function shouldRetryTension(
  conversationPolicy = {},
  replies = [],
  userMessage = '',
) {
  const flags = conversationPolicy.presenceFlags || []
  const posture = conversationPolicy.presencePosture || ''
  const evalResult = evaluateTensionReplies(replies, {
    flags,
    posture,
    userMessage,
  })

  // 认命腔等：仅真张力/逼认命语境才全局重写，避免日常「早起」被误烧成「好，我听着」
  if (
    !evalResult.ok &&
    (evalResult.reasons.includes('soft_surrender') ||
      evalResult.reasons.includes('joke_deflect') ||
      evalResult.reasons.includes('self_shame') ||
      evalResult.reasons.includes('missing_pref_cite') ||
      evalResult.reasons.includes('missing_compete_spine') ||
      evalResult.reasons.includes('missing_peer_refuse'))
  ) {
    const onlySoftSurrender =
      evalResult.reasons.includes('soft_surrender') &&
      evalResult.reasons.every(
        (r) => r === 'soft_surrender' || r === 'hollow' || r === 'sweet_deflect',
      )
    if (onlySoftSurrender) {
      const tensionish =
        conversationPolicy?.presenceTension === true ||
        isSurrenderProbe(userMessage) ||
        isCriticalTensionContext(conversationPolicy)
      if (!tensionish) return false
    }
    return true
  }

  // hollow / parse_fallback：仅张力语境才烧 LLM 重写，避免日常「我在。」连打 3 次
  if (!conversationPolicy?.presenceTension) return false
  const layer = conversationPolicy.presenceSignal
  if (
    layer !== 'rejection' &&
    layer !== 'hypo_rejection' &&
    layer !== 'soft_reject' &&
    layer !== 'cold_distance' &&
    !flags.includes('contradiction_recent_affection') &&
    !flags.includes('residual_tension') &&
    !flags.includes('affect_gate') &&
    !flags.includes('residual_low_energy') &&
    !/residual_|hypo_probe|stung_cling|hard_reject/.test(posture)
  ) {
    return false
  }
  return !evalResult.ok
}
