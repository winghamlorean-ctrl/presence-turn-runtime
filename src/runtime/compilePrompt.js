import { getActivePack } from '../pack/context.js'
import { buildTurnConstraintCard } from './userTurnPolicy.js'
import { getReplyFormatInstructions } from './composer.js'
import { buildMemoryPrompt } from './memory.js'

export function buildDialogueRhythm(turnKind = 'default') {
  const lines = [
    '【短聊节奏】',
    '像微信随口一句：1～2 句；单条约 40～100 字，整轮 ≤240。',
    '必须有说出口的人话；句首可带括号轻旁白；spoken 只要纯台词。',
  ]
  if (turnKind === 'greeting') {
    lines.push('招呼轮更短，不要寒暄堆砌。')
  }
  if (turnKind === 'short_ack') {
    lines.push('短附和：轻轻往下接半步，不要复述上一句。')
  }
  return lines.join('\n')
}

function historyLimit(turnKind) {
  return turnKind === 'greeting' ? 4 : 10
}

export function compilePrompt({
  userMessage,
  history = [],
  policy,
  presence,
  memories = [],
} = {}) {
  const pack = getActivePack()
  const system = [
    pack.systemPrompt,
    `你现在的名字：${pack.name}。对方可称为「${pack.userName}」。`,
    pack.voiceHint,
    buildTurnConstraintCard(policy),
    presence?.promptText || '',
    buildDialogueRhythm(policy?.turnKind),
    buildMemoryPrompt(memories),
    getReplyFormatInstructions(presence?.maxBubbles || 2),
  ]
    .filter(Boolean)
    .join('\n\n')

  const limit = historyLimit(policy?.turnKind)
  const trimmed = (history || []).slice(-limit)
  const messages = [{ role: 'system', content: system }]
  for (const item of trimmed) {
    const role = item.role === 'assistant' ? 'assistant' : 'user'
    const content = String(item.content || item.displayText || item.text || '').trim()
    if (!content) continue
    messages.push({ role, content })
  }
  messages.push({ role: 'user', content: String(userMessage || '').trim() })
  return { messages, system }
}
