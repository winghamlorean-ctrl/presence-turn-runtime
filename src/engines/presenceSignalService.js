/**
 * 感情关系信号感知（规则层）。
 * 覆盖面来自 presenceSignalFamilies；难句 needsModelAssist 留给日后小模型。
 */

import {
  matchSignalFamilies,
  PRESENCE_SIGNAL_FAMILIES,
} from './presenceSignalFamilies.js'

export const PRESENCE_SIGNAL_LAYERS = [
  'affection',
  'rejection',
  'hypo_rejection',
  'soft_reject',
  'reassure',
  'cold_distance',
  'grievance',
  'low_energy',
  'general',
]

export { PRESENCE_SIGNAL_FAMILIES }

/**
 * @returns {{
 *   layer: string,
 *   confidence: number,
 *   reasons: string[],
 *   needsModelAssist: boolean,
 *   shortContinue?: boolean,
 *   familyId?: string,
 * }}
 */
export function detectPresenceSignal(userMessage = '') {
  const text = String(userMessage || '').trim()
  if (!text) {
    return {
      layer: 'general',
      confidence: 0.2,
      reasons: ['empty'],
      needsModelAssist: false,
    }
  }

  const hit = matchSignalFamilies(text)
  if (hit) {
    return {
      layer: hit.layer,
      confidence: hit.confidence,
      reasons: [hit.reason],
      needsModelAssist: hit.needsModelAssist,
      shortContinue: hit.shortContinue || false,
      familyId: hit.familyId,
    }
  }

  // 短句含感情词但未入族 → 明确交给日后模型，不再加散落正则
  const shortEmotional =
    text.length <= 20 &&
    /爱|喜欢|烦|讨厌|滚|分手|算了|走开|腻|烦你|委屈|懂我|没意思|没劲|郁闷|好丧/.test(
      text,
    )

  if (shortEmotional) {
    return {
      layer: 'general',
      confidence: 0.4,
      reasons: ['short_emotional_ambiguous'],
      needsModelAssist: true,
    }
  }

  return {
    layer: 'general',
    confidence: 0.55,
    reasons: ['no_strong_relation_signal'],
    needsModelAssist: false,
  }
}
