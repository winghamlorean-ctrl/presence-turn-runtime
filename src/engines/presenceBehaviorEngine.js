/**
 * Presence Behavior Engine
 * 感知 → 检索近窗 → 对话加权评判 → 姿态映射 → 短约束+回复方向进 prompt
 */

import {
  applyAffectDelta,
  loadAffectState,
  pushAffectEvent,
  retrieveRecentEvents,
  saveAffectState,
} from './presenceAffectStateService.js'
import { detectPresenceSignal } from './presenceSignalService.js'
import {
  computeDialogueWeights,
  judgeAndMap,
  scaleDelta,
} from './presenceStrategyMap.js'
import { getActivePack } from '../pack/context.js'

/** 短窗矛盾：近 6 小时内的对立感情事件 */
const CONTRADICTION_WINDOW_MS = 6 * 60 * 60 * 1000
/** 余温/余伤：近窗更短，服务「上一句还烫、下一句别秒凉」 */
const INERTIA_WINDOW_MS = 90 * 60 * 1000

function summarizeUserLine(text = '') {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 36)
}

/**
 * 近窗是否存在与当前层对立的事件。
 */
function findContradiction(state, layer) {
  if (
    layer === 'rejection' ||
    layer === 'hypo_rejection' ||
    layer === 'soft_reject' ||
    layer === 'cold_distance'
  ) {
    const prior = retrieveRecentEvents(state, {
      types: ['affection', 'reassure'],
      windowMs: CONTRADICTION_WINDOW_MS,
      limit: 3,
    })
    if (prior.length) {
      return {
        kind: 'affection_then_reject',
        boost: prior[0].effectiveWeight,
        prior: prior[0],
      }
    }
  }
  if (layer === 'affection' || layer === 'reassure') {
    const prior = retrieveRecentEvents(state, {
      types: ['rejection', 'soft_reject', 'cold_distance', 'hypo_rejection'],
      windowMs: CONTRADICTION_WINDOW_MS,
      limit: 3,
    })
    if (prior.length) {
      return {
        kind: 'reject_then_affection',
        boost: prior[0].effectiveWeight * 0.7,
        prior: prior[0],
      }
    }
  }
  return null
}

const BASE_DELTAS = {
  affection: { attachment: 0.1, trust: 0.08, hurt: -0.06, guard: -0.04 },
  reassure: { trust: 0.06, hurt: -0.1, guard: -0.05, attachment: 0.04 },
  rejection: { hurt: 0.22, trust: -0.12, attachment: -0.04, guard: 0.14 },
  hypo_rejection: { hurt: 0.14, guard: 0.12, trust: -0.04 },
  soft_reject: { hurt: 0.1, guard: 0.08, trust: -0.05 },
  cold_distance: { guard: 0.12, hurt: 0.08, trust: -0.06 },
  /** 诉苦：轻抬伤与依恋牵动，不当强否定 */
  grievance: { hurt: 0.08, attachment: 0.03, trust: -0.03, guard: 0.02 },
  /** 低落：略收、略伤，不当分手 */
  low_energy: { guard: 0.05, hurt: 0.04, trust: -0.02 },
  general: { hurt: -0.015, guard: -0.01 },
}

/**
 * 近窗否定质量高时，减慢伤/收的自然愈合与安抚清创（情绪惯性）。
 */
function dampHealDelta(delta = {}, state, layer) {
  const rejectHits = retrieveRecentEvents(state, {
    types: ['rejection', 'hypo_rejection', 'soft_reject', 'cold_distance'],
    windowMs: INERTIA_WINDOW_MS,
    limit: 6,
  })
  const rejectMass = rejectHits.reduce(
    (n, e) => n + (Number(e.effectiveWeight) || 0),
    0,
  )
  if (rejectMass < 0.35) return delta

  const healFactor =
    layer === 'general'
      ? 0.15
      : layer === 'reassure'
        ? 0.45
        : layer === 'affection'
          ? 0.55
          : 1

  const out = { ...delta }
  if ((out.hurt || 0) < 0) out.hurt *= healFactor
  if ((out.guard || 0) < 0) out.guard *= healFactor
  return out
}

function updateStateForSignal(state, signal, userMessage) {
  const summary = summarizeUserLine(userMessage)
  let next = { ...state, affect: { ...state.affect }, events: [...(state.events || [])] }
  let contradiction = findContradiction(next, signal.layer)
  const flags = []
  const weights = computeDialogueWeights(next, signal, contradiction)
  const scale = weights.deltaScale
  const eventWeight = weights.nextEventWeight

  const base = BASE_DELTAS[signal.layer] || BASE_DELTAS.general
  const damped = dampHealDelta(base, next, signal.layer)
  next = applyAffectDelta(next, scaleDelta(damped, scale))

  switch (signal.layer) {
    case 'affection':
      next = pushAffectEvent(next, {
        type: 'affection',
        summary,
        weight: Math.max(0.75, eventWeight),
        at: Date.now(),
      })
      break
    case 'reassure':
      next = pushAffectEvent(next, {
        type: 'reassure',
        summary,
        weight: Math.max(0.65, eventWeight * 0.9),
        at: Date.now(),
      })
      break
    case 'rejection':
      if (contradiction?.kind === 'affection_then_reject') {
        next = applyAffectDelta(
          next,
          scaleDelta(
            {
              hurt: 0.18 * Math.max(0.5, contradiction.boost),
              guard: 0.08,
              attachment: -0.02,
            },
            scale,
          ),
        )
        next = {
          ...next,
          contradictionCount: (next.contradictionCount || 0) + 1,
        }
        flags.push('contradiction_recent_affection')
      }
      next = pushAffectEvent(next, {
        type: 'rejection',
        summary,
        weight: Math.max(contradiction ? 0.9 : 0.8, eventWeight),
        at: Date.now(),
      })
      break
    case 'hypo_rejection':
      if (contradiction?.kind === 'affection_then_reject') {
        next = applyAffectDelta(
          next,
          scaleDelta(
            {
              hurt: 0.1 * Math.max(0.4, contradiction.boost),
              guard: 0.06,
            },
            scale,
          ),
        )
        flags.push('contradiction_recent_affection')
        flags.push('hypo_against_affection')
      } else {
        flags.push('hypo_rejection_tension')
      }
      next = pushAffectEvent(next, {
        type: 'hypo_rejection',
        summary,
        weight: Math.max(0.65, eventWeight * 0.85),
        at: Date.now(),
      })
      break
    case 'soft_reject':
      if (contradiction?.kind === 'affection_then_reject') {
        next = applyAffectDelta(next, scaleDelta({ hurt: 0.08, guard: 0.04 }, scale))
        flags.push('contradiction_recent_affection')
      }
      next = pushAffectEvent(next, {
        type: 'soft_reject',
        summary,
        weight: Math.max(0.5, eventWeight * 0.7),
        at: Date.now(),
      })
      break
    case 'cold_distance':
      next = pushAffectEvent(next, {
        type: 'cold_distance',
        summary,
        weight: Math.max(0.6, eventWeight * 0.8),
        at: Date.now(),
      })
      break
    case 'grievance':
      next = pushAffectEvent(next, {
        type: 'grievance',
        summary,
        weight: Math.max(0.55, eventWeight * 0.75),
        at: Date.now(),
      })
      break
    case 'low_energy':
      next = pushAffectEvent(next, {
        type: 'low_energy',
        summary,
        weight: Math.max(0.5, eventWeight * 0.7),
        at: Date.now(),
      })
      break
    default:
      break
  }

  return { state: next, contradiction, flags, weights }
}

function formatPromptBlock(strategy, channel = 'chat') {
  const title =
    channel === 'proactive' ? '【在场行为·主动续聊】' : '【在场行为·本轮】'
  const lines = [title]
  if (strategy.region || strategy.posture) {
    lines.push(`反应区：${strategy.region || strategy.posture}`)
  }
  for (const t of strategy.toneBits || []) lines.push(t)
  if (strategy.must?.length) lines.push(`必做：${strategy.must.join('；')}`)
  if (strategy.forbid?.length) lines.push(`禁止：${strategy.forbid.join('；')}`)
  if (strategy.allow?.length) lines.push(`允许：${strategy.allow.join('；')}`)
  if (strategy.replyHints?.length) {
    lines.push(`回复方向：${strategy.replyHints.join('；')}`)
  }
  if (
    strategy.must?.length ||
    strategy.forbid?.length ||
    strategy.allow?.length ||
    strategy.replyHints?.length
  ) {
    lines.push(
      `语气：生活化。${getActivePack().voiceHint || ''}日常先接住用户说法再表态，禁止无故唱反调、句句否定；张力/被否/逼认命时才要有骨头顶回去。平视接话接情绪，不是端水递杯的仆人，也不是一味低声服侍。display 宜带句首括号轻旁白（顿了顿/看了你一眼之类），不要只剩干巴台词；spoken 只要纯台词。`,
    )
  }
  return lines.join('\n')
}

let _lastDebug = null
/** LLM 成功前暂存的 affect；失败则丢弃，避免「说了狠话却没回复」已落盘 */
let _pendingAffectCommit = null

export function getLastPresenceBehaviorDebug() {
  return _lastDebug
}

export function commitPendingAffectState() {
  if (!_pendingAffectCommit) return false
  saveAffectState(_pendingAffectCommit)
  _pendingAffectCommit = null
  return true
}

export function discardPendingAffectState() {
  _pendingAffectCommit = null
}

function stashOrPersistAffect(state, persist) {
  if (persist) {
    _pendingAffectCommit = null
    return saveAffectState(state)
  }
  _pendingAffectCommit = state
  return state
}

/**
 * 近窗情绪惯性：余伤优先，其次低落，再其次亲近余温。
 * 亲近余温只在无近窗否定时生效，避免「被否了还甜」。
 */
function detectResidualMood(state) {
  const recentReject = retrieveRecentEvents(state, {
    types: ['rejection', 'hypo_rejection', 'soft_reject', 'cold_distance'],
    windowMs: INERTIA_WINDOW_MS,
    limit: 4,
  })
  if (recentReject.length) {
    const top = recentReject[0]
    const layer =
      top.type === 'hypo_rejection'
        ? 'hypo_rejection'
        : top.type === 'soft_reject'
          ? 'soft_reject'
          : top.type === 'cold_distance'
            ? 'cold_distance'
            : 'rejection'
    return {
      active: true,
      kind: 'hurt',
      signal: {
        layer,
        confidence: 0.72,
        reasons: ['residual_event', top.type],
        needsModelAssist: false,
      },
      flags: ['residual_tension'],
      priorSummary: top.summary || '',
    }
  }

  // 更长窗的否定：伤值仍高时继续带着走
  const olderReject = retrieveRecentEvents(state, {
    types: ['rejection', 'hypo_rejection', 'soft_reject', 'cold_distance'],
    windowMs: CONTRADICTION_WINDOW_MS,
    limit: 3,
  })
  if (
    olderReject.length &&
    state.affect.hurt >= 0.38 &&
    state.affect.attachment >= 0.5
  ) {
    return {
      active: true,
      kind: 'hurt',
      signal: {
        layer: 'general',
        confidence: 0.6,
        reasons: ['residual_affect'],
        needsModelAssist: false,
      },
      flags: ['residual_tension', 'carry_hurt_attachment'],
      priorSummary: olderReject[0].summary || '',
    }
  }
  if (state.affect.hurt >= 0.48 && state.affect.attachment >= 0.5) {
    return {
      active: true,
      kind: 'hurt',
      signal: {
        layer: 'general',
        confidence: 0.6,
        reasons: ['residual_affect'],
        needsModelAssist: false,
      },
      flags: ['residual_tension', 'carry_hurt_attachment'],
      priorSummary: '',
    }
  }

  const lowHits = retrieveRecentEvents(state, {
    types: ['low_energy', 'grievance'],
    windowMs: INERTIA_WINDOW_MS,
    limit: 3,
  })
  if (lowHits.length) {
    return {
      active: true,
      kind: 'low',
      signal: {
        layer: lowHits[0].type === 'grievance' ? 'grievance' : 'low_energy',
        confidence: 0.55,
        reasons: ['residual_low_energy'],
        needsModelAssist: false,
      },
      flags: ['residual_low_energy'],
      priorSummary: lowHits[0].summary || '',
    }
  }

  const warmHits = retrieveRecentEvents(state, {
    types: ['affection', 'reassure'],
    windowMs: INERTIA_WINDOW_MS,
    limit: 4,
  })
  const warmMass = warmHits.reduce(
    (n, e) => n + (Number(e.effectiveWeight) || 0),
    0,
  )
  if (warmMass >= 0.55 && (state.affect.attachment || 0) >= 0.5) {
    return {
      active: true,
      kind: 'warm',
      signal: {
        layer: 'general',
        confidence: 0.58,
        reasons: ['residual_warmth', warmHits[0]?.type || 'affection'],
        needsModelAssist: false,
      },
      flags: ['residual_warmth'],
      priorSummary: warmHits[0]?.summary || '',
    }
  }

  return { active: false, kind: 'none', signal: null, flags: [], priorSummary: '' }
}

/** 闲聊/空信号层：可被叠态门闩挂上近窗张力，不再洗成纯日常 */
const AFFECT_GATE_LAYERS = new Set(['general'])

/**
 * 高伤/近窗拒类/亲近余温仍在时，给 general 打 residual flags（不改写本轮 delta）。
 */
function applyAffectGate(state, signal, flags = []) {
  if (!AFFECT_GATE_LAYERS.has(signal?.layer || 'general')) {
    return { flags, contradictionBoost: null }
  }
  if (
    flags.includes('residual_tension') ||
    flags.includes('carry_hurt_attachment') ||
    flags.includes('residual_warmth') ||
    flags.includes('residual_low_energy')
  ) {
    return { flags, contradictionBoost: null }
  }
  const residual = detectResidualMood(state)
  if (!residual.active) return { flags, contradictionBoost: null }

  // 惯性：有近窗事件本身就算「还热」，不再被 hurt 阈值掐断
  const hurt = Number(state?.affect?.hurt) || 0
  const guard = Number(state?.affect?.guard) || 0
  const stillHot =
    residual.kind === 'hurt' ||
    residual.kind === 'low' ||
    residual.kind === 'warm' ||
    hurt >= 0.28 ||
    guard >= 0.4
  if (!stillHot) return { flags, contradictionBoost: null }

  let nextFlags = [...flags, ...residual.flags, 'affect_gate']
  const contradiction = findContradiction(state, residual.signal?.layer || 'general')
  if (contradiction?.kind === 'affection_then_reject') {
    nextFlags = [...nextFlags, 'contradiction_recent_affection']
  }
  return { flags: nextFlags, contradictionBoost: contradiction }
}

/**
 * @param {{ userMessage?: string, persist?: boolean, snapshotOnly?: boolean, channel?: 'chat'|'proactive' }} options
 */
export function runPresenceBehaviorEngine(options = {}) {
  const userMessage = String(options.userMessage || '').trim()
  const persist = options.persist !== false
  const snapshotOnly = options.snapshotOnly === true
  const channel = options.channel === 'proactive' ? 'proactive' : 'chat'

  let state = loadAffectState()
  let signal = {
    layer: 'general',
    confidence: 1,
    reasons: ['snapshot'],
    needsModelAssist: false,
  }
  let contradiction = null
  let flags = []
  let turnWeights = null

  if (!snapshotOnly) {
    signal = detectPresenceSignal(userMessage)
    if (signal.shortContinue) {
      const residual = detectResidualMood(state)
      if (residual.active) {
        signal = {
          ...residual.signal,
          reasons: [...(residual.signal.reasons || []), 'short_continue'],
        }
        flags = [...residual.flags, 'short_continue']
        contradiction = findContradiction(state, signal.layer)
        if (contradiction?.kind === 'affection_then_reject') {
          flags = [...flags, 'contradiction_recent_affection']
        }
        turnWeights = computeDialogueWeights(state, signal, contradiction)
        // 短应：余伤略加深；余温略贴紧；低落略收——不要一律加伤
        const shortDelta =
          residual.kind === 'warm'
            ? { attachment: 0.02, hurt: -0.01 }
            : residual.kind === 'low'
              ? { guard: 0.02, hurt: 0.02 }
              : { hurt: 0.04, guard: 0.03 }
        state = applyAffectDelta(
          state,
          scaleDelta(shortDelta, turnWeights.deltaScale),
        )
        state = stashOrPersistAffect(state, persist)
      } else {
        const updated = updateStateForSignal(state, signal, userMessage)
        contradiction = updated.contradiction
        flags = updated.flags
        turnWeights = updated.weights
        state = stashOrPersistAffect(updated.state, persist)
      }
    } else {
      const updated = updateStateForSignal(state, signal, userMessage)
      contradiction = updated.contradiction
      flags = updated.flags
      turnWeights = updated.weights
      state = stashOrPersistAffect(updated.state, persist)
    }

    // 叠态门闩：伤/拒/余温还在时，闲聊不得直接当无事日常
    const gated = applyAffectGate(state, signal, flags)
    flags = gated.flags
    if (!contradiction && gated.contradictionBoost) {
      contradiction = gated.contradictionBoost
    }
  } else {
    // snapshot：只读，不挂起 pending
    discardPendingAffectState()
    const residual = detectResidualMood(state)
    if (residual.active) {
      signal = residual.signal
      flags = residual.flags
      contradiction = findContradiction(state, signal.layer)
      if (contradiction?.kind === 'affection_then_reject') {
        flags = [...flags, 'contradiction_recent_affection']
      }
    }
  }

  let strategy = judgeAndMap({
    state,
    affect: state.affect,
    signal,
    contradiction,
    flags,
    channel,
  })
  if (turnWeights) {
    strategy = {
      ...strategy,
      weights: turnWeights,
    }
  }

  const promptText = formatPromptBlock(strategy, channel)
  const tensionActive =
    flags.includes('residual_tension') ||
    flags.includes('residual_low_energy') ||
    flags.includes('residual_warmth') ||
    flags.includes('contradiction_recent_affection') ||
    flags.includes('affect_gate') ||
    ['rejection', 'hypo_rejection', 'soft_reject', 'cold_distance'].includes(
      signal.layer,
    ) ||
    [
      'stung_cling',
      'hypo_probe',
      'hypo_probe_heavy',
      'hard_reject',
      'residual_stung',
      'residual_guard',
      'warm_afterglow',
      'low_hold',
      'soft_drift',
      'cold_guard',
    ].includes(strategy.posture)

  _lastDebug = {
    signal,
    affect: state.affect,
    flags,
    posture: strategy.posture,
    region: strategy.region || strategy.posture,
    forces: strategy.forces || null,
    weights: strategy.weights || turnWeights,
    contradiction: contradiction
      ? {
          kind: contradiction.kind,
          boost: contradiction.boost,
          priorSummary: contradiction.prior?.summary || '',
        }
      : null,
    contradictionCount: state.contradictionCount,
    promptChars: promptText.length,
    needsModelAssist: signal.needsModelAssist === true,
    snapshotOnly,
    channel,
    tensionActive,
  }

  return {
    promptText,
    signal,
    affect: state.affect,
    flags,
    contradiction,
    posture: strategy.posture,
    region: strategy.region || strategy.posture,
    forces: strategy.forces || null,
    weights: strategy.weights || turnWeights,
    maxBubbles: strategy.maxBubbles,
    tensionActive,
    debug: _lastDebug,
  }
}
