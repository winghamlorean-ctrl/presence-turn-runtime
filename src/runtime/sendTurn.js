import { BLANK_PACK } from '../pack/blank.js'
import { setActivePack } from '../pack/context.js'
import { resolveUserTurnPolicy } from './userTurnPolicy.js'
import {
  evaluateSalvageNeed,
  buildSalvageRewriteUserDirective,
  shouldAdoptSalvageResult,
} from './salvage.js'
import { spokenContentCharCount } from '../engines/replyForbidFamilies.js'
import {
  runPresenceBehaviorEngine,
  commitPendingAffectState,
  discardPendingAffectState,
} from '../engines/presenceBehaviorEngine.js'
import {
  evaluateTensionReplies,
  shouldRetryTension,
  buildTensionRewriteUserDirective,
  getTensionMaxBubbles,
} from '../engines/presenceTensionGuardService.js'
import { compilePrompt } from './compilePrompt.js'
import { parseModelReplies, dedupeIdenticalReplies } from './composer.js'
import { applyForbidStrip } from './postprocess.js'
import { ingestUserFacts, retrieveMemories } from './memory.js'

function formatApiError(message) {
  const text = String(message || '')
  const lower = text.toLowerCase()
  if (lower.includes('invalid api key') || lower.includes('incorrect api key')) {
    return 'API Key 无效。'
  }
  if (lower.includes('insufficient') && lower.includes('balance')) {
    return '账户余额不足。'
  }
  if (lower.includes('rate limit') || lower.includes('too many requests')) {
    return '请求过于频繁，请稍后再试。'
  }
  return text || '未知错误'
}

async function callChatOnce(llm, messages, temperature, maxTokens) {
  const response = await fetch(llm.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${llm.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: llm.model,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
  })
  let payload = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  if (!response.ok) {
    const raw = payload?.error?.message || payload?.message || `HTTP ${response.status}`
    throw new Error(formatApiError(raw))
  }
  const msg = payload?.choices?.[0]?.message || {}
  const rawContent = String(msg.content || msg.reasoning_content || '').trim()
  if (!rawContent) throw new Error('模型未返回有效内容')
  return rawContent
}

/**
 * 一轮对话入口。
 * @param {{
 *   userMessage: string,
 *   history?: object[],
 *   pack?: object,
 *   llm: { apiKey: string, endpoint: string, model: string },
 * }} input
 */
export async function sendTurn(input = {}) {
  const userMessage = String(input.userMessage || '').trim()
  const history = Array.isArray(input.history) ? input.history : []
  const pack = setActivePack(input.pack || BLANK_PACK)
  const llm = input.llm || {}
  if (!llm.apiKey) {
    throw new Error('请先填写 API Key')
  }
  if (!llm.endpoint || !llm.model) {
    throw new Error('请填写模型 endpoint 和 model')
  }

  ingestUserFacts(userMessage, pack)
  const memories = retrieveMemories(userMessage, 4)
  const policy = resolveUserTurnPolicy(userMessage, { chatHistory: history })
  const presence = runPresenceBehaviorEngine({
    userMessage,
    persist: false,
    channel: 'chat',
  })

  const { messages } = compilePrompt({
    userMessage,
    history,
    policy,
    presence,
    memories,
  })

  const temperature = presence.tensionActive ? 0.55 : 0.8
  const maxTokens = presence.tensionActive ? 180 : 240
  const maxBubbles = presence.tensionActive
    ? getTensionMaxBubbles({ presenceMaxBubbles: presence.maxBubbles })
    : Math.min(2, presence.maxBubbles || 2)

  try {
    let content = await callChatOnce(llm, messages, temperature, maxTokens)
    let replies = applyForbidStrip(
      dedupeIdenticalReplies(parseModelReplies(content, maxBubbles)),
      policy.forbidFamilies,
    )

    const conversationPolicy = {
      userTurnPolicy: policy,
      presenceTension: presence.tensionActive,
      presenceFlags: presence.flags || [],
      presencePosture: presence.posture || '',
      presenceSignal: presence.signal?.layer || 'general',
      presenceMaxBubbles: maxBubbles,
    }

    let salvageMeta = { used: false, adopted: false, reasons: [] }

    const salvage = evaluateSalvageNeed(replies, userMessage, policy)
    const tensionEval = evaluateTensionReplies(replies, {
      flags: conversationPolicy.presenceFlags,
      posture: conversationPolicy.presencePosture,
      userMessage,
    })
    const tensionRetry = shouldRetryTension(conversationPolicy, replies, userMessage)

    const needSecond = salvage.need || tensionRetry
    if (needSecond) {
      const reasons = [
        ...salvage.reasons,
        ...(tensionEval.ok ? [] : tensionEval.reasons),
      ]
      salvageMeta = { used: true, adopted: false, reasons }
      const badPreview = replies
        .map((r) => r.displayText || r.content)
        .filter(Boolean)
        .join(' / ')
      const rewrite = tensionRetry
        ? buildTensionRewriteUserDirective(userMessage, tensionEval.reasons, badPreview)
        : buildSalvageRewriteUserDirective(
            userMessage,
            salvage.reasons,
            salvage.preview,
            salvage.policy,
          )
      try {
        const second = await callChatOnce(
          llm,
          [
            ...messages,
            { role: 'assistant', content },
            { role: 'user', content: rewrite },
          ],
          Math.min(temperature, 0.35),
          maxTokens,
        )
        const secondReplies = applyForbidStrip(
          dedupeIdenticalReplies(parseModelReplies(second, maxBubbles)),
          policy.forbidFamilies,
        )
        const beforeSpoken = spokenContentCharCount(
          replies.map((r) => r.displayText || r.content).join(' / '),
        )
        const afterSpoken = spokenContentCharCount(
          secondReplies.map((r) => r.displayText || r.content).join(' / '),
        )
        const afterCheck = evaluateSalvageNeed(secondReplies, userMessage, policy)
        if (
          shouldAdoptSalvageResult({
            beforeSpoken,
            afterSpoken,
            beforeReasons: salvage.reasons,
            afterReasons: afterCheck.reasons,
          }) ||
          (tensionRetry && afterSpoken >= 1)
        ) {
          replies = secondReplies
          content = second
          salvageMeta.adopted = true
        }
      } catch {
        // 第二遍失败：保留第一遍 API，不灌模板
      }
    }

    if (presence.tensionActive) {
      replies = replies.slice(0, maxBubbles)
    }

    commitPendingAffectState()
    return {
      replies,
      policy,
      presence: {
        affect: presence.affect,
        flags: presence.flags,
        posture: presence.posture,
        tensionActive: presence.tensionActive,
        signal: presence.signal?.layer,
      },
      memories,
      salvage: salvageMeta,
      pack: { id: pack.id, name: pack.name },
    }
  } catch (err) {
    discardPendingAffectState()
    throw err
  }
}
