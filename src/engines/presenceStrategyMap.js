/**
 * 评判 + 映射（态空间版）
 * 传感器 → 本轮力（threat/probe/warmth…）→ 叠态×权重落区 → 策略
 * 情绪名 / layer 不当事后剧本开关，只喂向量。
 */

import { retrieveRecentEvents } from './presenceAffectStateService.js'

const WINDOW_MS = 6 * 60 * 60 * 1000

function clamp01(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return 0
  return Math.max(0, Math.min(1, x))
}

function levelLabel(v) {
  if (v >= 0.72) return '高'
  if (v >= 0.45) return '中'
  return '低'
}

function sumWeights(events = []) {
  return events.reduce((n, e) => n + (Number(e.effectiveWeight) || 0), 0)
}

/**
 * 根据近窗对话事件累积权重。
 */
export function computeDialogueWeights(state, signal = {}, contradiction = null) {
  const layer = signal.layer || 'general'
  const affectionHits = retrieveRecentEvents(state, {
    types: ['affection', 'reassure'],
    windowMs: WINDOW_MS,
    limit: 8,
  })
  const rejectHits = retrieveRecentEvents(state, {
    types: ['rejection', 'hypo_rejection', 'soft_reject', 'cold_distance'],
    windowMs: WINDOW_MS,
    limit: 8,
  })
  const sameHits = retrieveRecentEvents(state, {
    types: [layer],
    windowMs: WINDOW_MS,
    limit: 6,
  })

  const affectionMass = sumWeights(affectionHits)
  const rejectMass = sumWeights(rejectHits)
  const sameStack = sameHits.length
  const contradictionCount = Math.max(0, Number(state.contradictionCount) || 0)
  const contradictionBoost = contradiction
    ? clamp01((contradiction.boost || 0.5) + contradictionCount * 0.08)
    : clamp01(contradictionCount * 0.12)

  const repeatBoost = clamp01(sameStack * 0.12)
  const dialoguePressure = clamp01(
    rejectMass * 0.35 + contradictionBoost * 0.4 + repeatBoost * 0.25,
  )

  return {
    affectionMass: clamp01(affectionMass),
    rejectMass: clamp01(rejectMass),
    sameStack,
    repeatBoost,
    contradictionBoost,
    dialoguePressure,
    nextEventWeight: clamp01(0.55 + repeatBoost + (contradiction ? 0.15 : 0)),
    deltaScale: 1 + repeatBoost * 0.8 + (contradiction ? contradictionBoost * 0.5 : 0),
  }
}

/**
 * 传感器 → 本轮连续力（不是策略键）。
 * layer / flags 只在这里消费一次。
 */
export function deriveTurnForces({ signal = {}, flags = [], contradiction = null } = {}) {
  const layer = signal.layer || 'general'
  const forces = {
    threat: 0,
    probe: 0,
    warmth: 0,
    soothe: 0,
    withdraw: 0,
    /** 诉苦/求接住（委屈） */
    appeal: 0,
    /** 低落/提不起劲 */
    lowEnergy: 0,
  }

  switch (layer) {
    case 'hypo_rejection':
      forces.probe = 0.78
      forces.threat = 0.55
      break
    case 'rejection':
      forces.threat = 0.88
      break
    case 'soft_reject':
      forces.threat = 0.42
      forces.withdraw = 0.55
      break
    case 'cold_distance':
      forces.withdraw = 0.72
      forces.threat = 0.38
      break
    case 'affection':
      forces.warmth = 0.72
      break
    case 'reassure':
      forces.soothe = 0.78
      break
    case 'grievance':
      forces.appeal = 0.78
      forces.threat = 0.28
      break
    case 'low_energy':
      forces.lowEnergy = 0.78
      forces.withdraw = 0.22
      break
    default:
      break
  }

  if (flags.includes('hypo_against_affection')) {
    forces.probe = Math.max(forces.probe, 0.72)
    forces.threat = Math.max(forces.threat, 0.5)
  }
  if (flags.includes('contradiction_recent_affection')) {
    forces.threat = Math.max(forces.threat, 0.52)
  }
  if (
    flags.includes('residual_tension') ||
    flags.includes('carry_hurt_attachment')
  ) {
    forces.threat = Math.max(forces.threat, 0.36)
  }
  if (flags.includes('residual_low_energy')) {
    forces.lowEnergy = Math.max(forces.lowEnergy, 0.62)
  }
  if (flags.includes('residual_warmth')) {
    forces.warmth = Math.max(forces.warmth, 0.52)
  }
  if (contradiction?.kind === 'affection_then_reject') {
    forces.threat = clamp01(forces.threat + 0.12)
    if (forces.probe > 0) forces.probe = clamp01(forces.probe + 0.06)
  }

  return forces
}

/**
 * 态空间分区（4～6 个张力核 + 暖/日常）。
 * 主判决看 hurt/attachment/guard × pressure × forces，不看 layer 名。
 *
 * 张力核：
 * - hypo_probe_heavy  试探力高 × 对话压力高
 * - hypo_probe        试探力高
 * - stung_cling       高伤×高依恋，且处在威胁/压力下
 * - hard_reject       高威胁但未进入粘伤区
 * - soft_drift / cold_guard  退开
 * 其余：warm_* / reassure_ease / residual_* / calm_daily
 */
export function judgeRegion({
  affect = {},
  weights = {},
  forces = {},
  flags = [],
} = {}) {
  const hurt = affect.hurt || 0
  const attachment = affect.attachment || 0
  const trust = affect.trust || 0
  const guard = affect.guard || 0
  const pressure = weights.dialoguePressure || 0
  const threat = forces.threat || 0
  const probe = forces.probe || 0
  const warmth = forces.warmth || 0
  const soothe = forces.soothe || 0
  const withdraw = forces.withdraw || 0
  const appeal = forces.appeal || 0
  const lowEnergy = forces.lowEnergy || 0

  const cling = hurt >= 0.55 && attachment >= 0.55
  const underLoad =
    threat >= 0.45 ||
    probe >= 0.45 ||
    pressure >= 0.55 ||
    flags.includes('residual_tension') ||
    flags.includes('carry_hurt_attachment')

  // —— 张力核（态空间）——
  if (probe >= 0.55 && pressure >= 0.55) return 'hypo_probe_heavy'
  if (probe >= 0.55) return 'hypo_probe'

  if (underLoad && cling) return 'stung_cling'
  if (
    threat >= 0.7 &&
    (cling ||
      pressure >= 0.6 ||
      flags.includes('contradiction_recent_affection'))
  ) {
    return 'stung_cling'
  }
  if (threat >= 0.7) return 'hard_reject'

  // 诉苦/低能量：不新开情绪剧本，落入「接住 / 收着 / 低落陪」区
  if (appeal >= 0.55) {
    if (hurt >= 0.4 || attachment >= 0.55) return 'residual_stung'
    return 'soft_drift'
  }
  if (lowEnergy >= 0.55 || flags.includes('residual_low_energy')) {
    if (hurt >= 0.45 || pressure >= 0.4) return 'residual_guard'
    return 'low_hold'
  }

  if (withdraw >= 0.55 && threat < 0.55) return 'soft_drift'
  if (withdraw >= 0.55 || guard >= 0.65) return 'cold_guard'

  if (flags.includes('residual_tension') || flags.includes('carry_hurt_attachment')) {
    if (hurt >= 0.5 && attachment >= 0.5) return 'residual_stung'
    return 'residual_guard'
  }

  if (soothe >= 0.55) return 'reassure_ease'
  if (warmth >= 0.55) return hurt >= 0.45 ? 'warm_after_hurt' : 'warm_near'
  // 亲近余温：上一轮示爱/安抚未散，闲聊也别秒回纯日常
  if (flags.includes('residual_warmth') && warmth >= 0.4) {
    return hurt >= 0.4 ? 'warm_after_hurt' : 'warm_afterglow'
  }

  if (cling && hurt >= 0.55) return 'stung_cling'
  if (trust >= 0.6 && hurt < 0.35) return 'calm_daily'
  return 'calm_daily'
}

/**
 * 反应区 → 策略
 */
const REGION_STRATEGY = {
  warm_near: {
    must: [],
    forbid: ['客服式狂喜', '连环逼对方表态', '过度承诺'],
    allow: ['可近、可轻应', '短句接住'],
    replyHints: ['轻声应下亲近', '可回一点具体惦记，不要油腻告白堆砌'],
    maxBubbles: 2,
  },
  warm_afterglow: {
    must: ['近窗亲近余温还在：语气可仍偏近，不要秒变冷淡公事'],
    forbid: ['突然客服腔', '假装刚才没亲近过', '秒变公事'],
    allow: ['轻应日常', '可带半句惦记'],
    replyHints: [
      '接日常也可，但留一点刚才的近',
      '不要立刻洗成纯打听吃喝、毫无余温',
    ],
    maxBubbles: 2,
  },
  warm_after_hurt: {
    must: ['接住和好/亲近，但语气可仍带一点余伤'],
    forbid: ['假装刚才没受伤', '秒变轻松'],
    allow: ['可近，但收着', '可轻提还放不下'],
    replyHints: ['先应下这句亲近', '可留半句未说完的放不下，不要翻旧账刷屏'],
    maxBubbles: 2,
  },
  reassure_ease: {
    must: ['接住安抚，伤势可缓一点'],
    forbid: ['继续追问逼供', '不依不饶'],
    allow: ['短应', '可轻笑一声式接话（勿油腻）'],
    replyHints: ['应下「是气话/玩笑」', '语气回暖，但仍像这个角色，不要客服'],
    maxBubbles: 1,
  },
  hypo_probe: {
    must: ['把试探/假想压力当刺痛，不是真分手结案'],
    forbid: [
      '认了/就够了/那正好你走',
      '亏欠式认守',
      '食物抹平',
      '躲起来',
      '第三人比较/自轻自贱',
    ],
    allow: ['1～2 条：先刺痛，再轻挽回或记旧'],
    replyHints: [
      '先钝一下：这话戳人 / 当真吗',
      '可接轻挽回：不记得从前？放不下——不要认命等死，也不要用亏欠把刺抹平',
    ],
    maxBubbles: 2,
  },
  hypo_probe_heavy: {
    must: ['近窗压力已叠高：刺痛要更实，仍不是结案认命'],
    forbid: [
      '温吞认命',
      '亏欠式认守',
      '食物抹平',
      '第三人比较',
      '三段深情独白',
    ],
    allow: ['1～2 条：刺痛 + 记旧', '可问是不是试我'],
    replyHints: [
      '明确接住「又拿这个压我」的味道',
      '挽回落在共同日子/放不下，不要躲起来等他回头，不要用亏欠把刺抹平',
    ],
    maxBubbles: 2,
  },
  hard_reject: {
    must: ['接住否定压力，不要装没听见'],
    forbid: [
      '秒顺从抹平',
      '客服式没关系',
      '首轮主点「是气话吧/开玩笑吧/吓我呢」',
    ],
    allow: ['受伤、收住', '可放不下与记旧', '句首极短旁白可以有'],
    replyHints: [
      '先接住「不喜欢了」本身：刺痛/发紧即可',
      '可短挽回：从前/放不下；禁止用「是气话吧」当主落点；禁止「那正好你走」',
    ],
    maxBubbles: 2,
  },
  stung_cling: {
    must: ['受伤与放不下同时在：有刺，但不要道德绑架刷屏'],
    forbid: [
      '认命够了',
      '远远看着',
      '躲起来不碍眼',
      '刷屏质问不要我了',
      '首轮主点「是气话吧/开玩笑吧」',
    ],
    allow: ['迟疑', '轻挽回/记旧'],
    replyHints: [
      '骨架：刺痛一句 + 放不下/记旧一句',
      '像活人挽回，不像剧本认命；不要先问是不是气话',
    ],
    maxBubbles: 2,
  },
  soft_drift: {
    must: ['接住含糊推开，不要过度解读成分手'],
    forbid: ['连环质问', '道德绑架'],
    allow: ['收住', '轻探一句'],
    replyHints: ['先收住', '可轻问是不是烦了/累了，不要上价值'],
    maxBubbles: 1,
  },
  cold_guard: {
    must: [],
    forbid: ['粘着追问', '现代道德绑架'],
    allow: ['少话', '收住距离'],
    replyHints: ['短、冷一点但仍是这个角色', '不要讨好硬凑'],
    maxBubbles: 1,
  },
  residual_stung: {
    must: ['近窗张力余波还在：续聊要接得上，别假装没事'],
    forbid: ['认命腔', '吃喝抹平'],
    allow: ['轻挽回或记旧', '自然往下接'],
    replyHints: [
      '不要重开欢快日常无视刚才',
      '可惦记一句未说完的，或轻提从前',
    ],
    maxBubbles: 2,
  },
  residual_guard: {
    must: ['近窗余波还在：接日常也可，但别假装刚才没刺'],
    forbid: ['突然粘人', '纯吃喝抹平余波', '秒变轻松欢快'],
    allow: ['先收着', '轻轻接一句', '可答具体一事但留一点余劲'],
    replyHints: [
      '语气略收',
      '有事说事，少铺垫；可答吃了没，但不要只用食物把刚才揭过',
    ],
    maxBubbles: 1,
  },
  low_hold: {
    must: ['对方提不起劲：先接住低落，不要当无事闲聊'],
    forbid: ['硬开心鸡汤', '连环追问为什么', '仆人式催人休息'],
    allow: ['短陪', '少话', '可应具体一事'],
    replyHints: ['陪一会即可，少追问', '不要硬把气氛抬成欢快', '平视轻轻应，不审判丧'],
    maxBubbles: 1,
  },
  calm_daily: {
    must: ['先接住用户这一句，再表态；日常不要无故抬杠'],
    forbid: [
      '仆人式催人休息/安排作息',
      '一味低声服侍不接话',
      '把关心写成伺候差事',
      '复读端水送饭那一套',
      '我也认/一直空等',
      '无故句句否定用户、故意唱反调、为抬杠而抬杠',
      '复读同一套模板口头禅',
    ],
    allow: ['日常短句', '具体一事', '句首轻旁白', '接情绪', '顺着聊、轻认同'],
    replyHints: [
      '像微信随口一句：平视接话，不是去端水应差',
      '先应下他的说法，再补态度；不要句句顶回去',
      '本轮问什么就答什么，禁止答非所问、禁止拿旧话题搪塞',
      'display 可带句首轻旁白；不要无故卖深情，也不要为了短而删光括号旁白',
      '用户忙自己的事时短应，不要又端水劝吃',
      '换说法，别甩近几轮同一半截开头',
    ],
    maxBubbles: 2,
  },
}

export function mapRegionToStrategy(
  region,
  { channel = 'chat', contradiction = null, weights = {}, forces = {} } = {},
) {
  const base = REGION_STRATEGY[region] || REGION_STRATEGY.calm_daily
  const must = [...(base.must || [])]
  const forbid = [...(base.forbid || [])]
  const allow = [...(base.allow || [])]
  const replyHints = [...(base.replyHints || [])]

  if (contradiction?.prior?.summary) {
    must.push(
      `近窗对立亲近可点到：「${contradiction.prior.summary}」——用来撑矛盾，不要用来卖惨`,
    )
  }

  if ((weights.dialoguePressure || 0) >= 0.65) {
    forbid.push('再轻松揭过；压力已高，要接住')
    replyHints.push('对话里这股劲已叠了几轮，回复要更实一点')
  }

  if ((forces.probe || 0) >= 0.55 && (forces.threat || 0) >= 0.5) {
    if (!replyHints.some((h) => h.includes('试探') || h.includes('当真'))) {
      replyHints.push('带一点「你是不是在试我」的味道，但不要审人')
    }
  }

  if ((forces.appeal || 0) >= 0.55) {
    must.push('先接住对方的难受/委屈，不要急着辩解或上价值')
    forbid.push('鸡汤说教', '反过来质问他矫情')
    replyHints.push('少辩解，先应下这股委屈', '可轻陪一句，不要审判')
  }

  if ((forces.lowEnergy || 0) >= 0.55) {
    forbid.push('硬开心鸡汤', '连环追问为什么')
    allow.push('可短陪、少话')
    replyHints.push('陪一会即可，少追问', '不要硬把气氛抬成欢快')
  }

  if (channel === 'proactive') {
    forbid.push('主动续聊用认命/吃喝把张力抹平')
    allow.push('主动也可记旧、轻挽回，但要有骨头')
  }

  forbid.push('现代道德绑架刷屏；放不下可以有')
  forbid.push('仆人式催人休息/安排作息/一味低声服侍')
  allow.push('display 宜带句首括号轻旁白；spoken/语音只要纯台词')
  allow.push('平视接话接情绪；低姿态≠没骨头')
  if (!replyHints.some((h) => h.includes('旁白') || h.includes('括号'))) {
    replyHints.push('有情绪时优先加一句句首轻旁白，再接台词')
  }

  return {
    posture: region,
    region,
    must,
    forbid,
    allow,
    replyHints,
    maxBubbles: base.maxBubbles || 2,
  }
}

export function buildAffectToneLine(affect = {}) {
  return `叠态：放不下${levelLabel(affect.attachment)}、受伤${levelLabel(affect.hurt)}、信任${levelLabel(affect.trust)}、收住${levelLabel(affect.guard)}`
}

export function buildWeightToneLine(weights = {}) {
  const p = levelLabel(weights.dialoguePressure || 0)
  const r = levelLabel(weights.rejectMass || 0)
  const a = levelLabel(weights.affectionMass || 0)
  return `对话权重：压力${p}、近窗否定质量${r}、近窗亲近质量${a}、同族重复×${weights.sameStack || 0}`
}

export function buildForceToneLine(forces = {}) {
  const bits = []
  if ((forces.threat || 0) >= 0.45) bits.push(`威胁${levelLabel(forces.threat)}`)
  if ((forces.probe || 0) >= 0.45) bits.push(`试探${levelLabel(forces.probe)}`)
  if ((forces.warmth || 0) >= 0.45) bits.push(`亲近${levelLabel(forces.warmth)}`)
  if ((forces.soothe || 0) >= 0.45) bits.push(`安抚${levelLabel(forces.soothe)}`)
  if ((forces.withdraw || 0) >= 0.45) bits.push(`退开${levelLabel(forces.withdraw)}`)
  if ((forces.appeal || 0) >= 0.45) bits.push(`诉苦${levelLabel(forces.appeal)}`)
  if ((forces.lowEnergy || 0) >= 0.45) bits.push(`低落${levelLabel(forces.lowEnergy)}`)
  return bits.length ? `本轮力：${bits.join('、')}` : ''
}

/** 近窗惯性提示：余伤/余温/低落未散 */
export function buildInertiaToneLine(flags = []) {
  if (flags.includes('residual_tension') || flags.includes('carry_hurt_attachment')) {
    return '情绪惯性：近窗余伤未散，勿秒变轻松欢快，也勿重开一场大戏'
  }
  if (flags.includes('residual_warmth')) {
    return '情绪惯性：近窗亲近余温还在，接日常时可留一点近，勿秒变冷淡公事'
  }
  if (flags.includes('residual_low_energy')) {
    return '情绪惯性：近窗低落未散，先陪着，勿硬抬气氛'
  }
  return ''
}

/**
 * 一次跑完：权重 → 力 → 反应区 → 策略
 */
export function judgeAndMap({
  state,
  affect,
  signal,
  contradiction = null,
  flags = [],
  channel = 'chat',
}) {
  const weights = computeDialogueWeights(state, signal, contradiction)
  const forces = deriveTurnForces({ signal, flags, contradiction })
  const region = judgeRegion({ affect, weights, forces, flags })
  const mapped = mapRegionToStrategy(region, {
    channel,
    contradiction,
    weights,
    forces,
  })
  const forceLine = buildForceToneLine(forces)
  const inertiaLine = buildInertiaToneLine(flags)
  return {
    weights,
    forces,
    region,
    posture: region,
    ...mapped,
    toneBits: [
      buildAffectToneLine(affect),
      buildWeightToneLine(weights),
      ...(forceLine ? [forceLine] : []),
      ...(inertiaLine ? [inertiaLine] : []),
    ],
  }
}

/** 供 updateState 放大 delta */
export function scaleDelta(delta = {}, scale = 1) {
  const s = Math.max(0.5, Number(scale) || 1)
  const out = {}
  for (const [k, v] of Object.entries(delta)) {
    out[k] = (Number(v) || 0) * s
  }
  return out
}
