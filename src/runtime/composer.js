import {
  extractSpokenText,
  stripLeadingStageParens,
} from '../utils/speechTextExtractor.js'

function tryParseJsonObject(text) {
  const trimmed = String(text || '').trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    // continue
  }
  const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (codeBlock) {
    try {
      return JSON.parse(codeBlock[1].trim())
    } catch {
      // continue
    }
  }
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1))
    } catch {
      return null
    }
  }
  return null
}

function coerceRepliesPayload(parsed) {
  if (!parsed) return null
  if (Array.isArray(parsed)) return { replies: parsed }
  if (typeof parsed !== 'object') return null
  if (Array.isArray(parsed.replies)) return parsed
  const text = String(
    parsed.displayText || parsed.content || parsed.spokenText || parsed.text || '',
  ).trim()
  if (text) {
    return { replies: [{ type: 'text', content: text, displayText: text }] }
  }
  return null
}

function stripLeakedSpeakerLabel(text) {
  return String(text || '')
    .replace(/^(用户|她|助手|角色)\s*[：:]\s*/u, '')
    .trim()
}

function normalizeReplyItem(item) {
  if (!item || typeof item !== 'object') return null
  const rawDisplay = stripLeakedSpeakerLabel(
    String(item.displayText || item.content || item.text || '').trim(),
  )
  if (!rawDisplay) return null
  const displayText = rawDisplay
  let spokenText = extractSpokenText({
    ...item,
    displayText,
    content: displayText,
  })
  if (spokenText) {
    spokenText = stripLeakedSpeakerLabel(spokenText)
    spokenText = stripLeadingStageParens(spokenText)
  }
  if (!spokenText) {
    spokenText = stripLeadingStageParens(displayText) || displayText
  }
  return {
    type: 'text',
    content: displayText,
    displayText,
    spokenText,
    tone: item.tone || 'normal',
    shouldSpeak: false,
  }
}

function wrapPlainDialogueReplies(text = '', limit = 2) {
  const value = String(text || '').trim()
  if (!value) return []
  const lines = value
    .split(/\n+/)
    .map((line) => stripLeakedSpeakerLabel(line))
    .filter(Boolean)
  const chunks =
    lines.length >= 2 &&
    lines.length <= limit &&
    lines.every((line) => line.length >= 4 && line.length <= 120)
      ? lines.slice(0, limit)
      : [value.slice(0, 240)]
  return chunks.map((line) =>
    normalizeReplyItem({ type: 'text', content: line, displayText: line }),
  ).filter(Boolean)
}

/** 解析模型输出。空结果保持空，不灌本地模板句。 */
export function parseModelReplies(rawText, maxReplyCount = 2) {
  const fallbackContent = String(rawText || '').trim()
  const limit = Math.min(4, Math.max(1, Number(maxReplyCount) || 2))
  const parsed = coerceRepliesPayload(tryParseJsonObject(rawText))
  if (parsed?.replies) {
    const replies = parsed.replies
      .map((item) =>
        typeof item === 'string'
          ? normalizeReplyItem({ type: 'text', content: item, displayText: item })
          : normalizeReplyItem(item),
      )
      .filter(Boolean)
      .slice(0, limit)
    if (replies.length) return replies
  }
  return wrapPlainDialogueReplies(fallbackContent, limit)
}

export function dedupeIdenticalReplies(replies = []) {
  const seen = new Set()
  return (replies || []).filter((reply) => {
    const text = String(reply?.displayText || reply?.content || '').trim()
    if (!text) return false
    if (seen.has(text)) return false
    seen.add(text)
    return true
  })
}

export function getReplyFormatInstructions(maxReplyCount = 2) {
  const maxCount = Math.min(2, Math.max(1, Number(maxReplyCount) || 2))
  return `【输出】直接写角色要说的话，不要 json、不要 markdown、不要解释、不要角色名前缀。
句首可带轻旁白如（顿了顿），括号约≤40字；不要大段动作描写。
1～${maxCount}句即可；像微信聊天；完整句；忌只回嗯/好/在；单条约40～100字，整轮≤240；台词不少于旁白。
若要连发两条，用换行分开。`
}
