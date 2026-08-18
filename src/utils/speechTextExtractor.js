function normalizeWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

const STAGE_LABEL_LINE = /^(动作|神态|语气|旁白|场景)[：:].*$/gm

const EMOTION_PREFIX =
  /^(?:委屈地|低声地|怯怯地|声音发颤地|轻声地|慢慢地说|轻声说|低声道|她说|他说|声音很轻|声音很轻地|声音发颤)[：:，,]?\s*/

const NARRATION_ONLY =
  /^她(?:低头|攥|沉默|眼眶|往后|轻轻|没有说话|看了看|微红|叹了口气|退|停|站|走|转|望)[^。！？：:]*[。！？…]?$/

const NARRATION_CLAUSE =
  /^她[^：:]{0,80}[，,]\s*(?:声音|低声|轻声|慢慢|眼眶|沉默|没有说话)/

/** 剥掉括号动作后若为空，视为「只有描写、无可念台词」。 */
export function isBracketOnlyDisplay(text) {
  const value = normalizeWhitespace(text)
  if (!value) return false
  if (!/[（(\[]/.test(value)) return false
  return !normalizeWhitespace(removeBracketActions(value))
}

function removeBracketActions(text) {
  let value = String(text || '')
  let prev = ''
  while (value !== prev) {
    prev = value
    value = value
      .replace(/（[^（）]*）/g, '')
      .replace(/\([^()]*\)/g, '')
      .replace(/\[[^\[\]]*\]/g, '')
  }
  return value
}

function stripEmotionPrefix(text) {
  let value = normalizeWhitespace(text)
  let prev = ''
  while (value !== prev) {
    prev = value
    value = normalizeWhitespace(value.replace(EMOTION_PREFIX, ''))
  }
  return value
}

function extractAfterSpeechColon(text) {
  const value = normalizeWhitespace(text)
  if (!value) return ''

  const colonIndex = Math.max(value.lastIndexOf('：'), value.lastIndexOf(':'))
  if (colonIndex === -1) return value

  const before = value.slice(0, colonIndex)
  const after = value.slice(colonIndex + 1).trim()
  if (!after) return value

  const speechCue =
    /说|道|问|答|喊|叫|低声|轻声|声音|嘱咐|叮嘱|开口|应|答|回|叹/.test(before) ||
    /她[^，。！？：:]{0,48}$/.test(before)

  if (speechCue) {
    return after
  }

  return value
}

function isNarrationOnly(text) {
  const value = normalizeWhitespace(text)
  if (!value) return true
  if (/你/.test(value)) return false
  if (NARRATION_ONLY.test(value)) return true
  if (
    /^她[^：:]{2,60}[。！？…]$/.test(value) &&
    !/[“「『""]/.test(value) &&
    /低头|攥|沉默|眼眶|往后|轻轻|没有说话|看了看|微红|叹了口气|退|停|站|走|转|望/.test(
      value,
    )
  ) {
    return true
  }
  if (NARRATION_CLAUSE.test(value) && !/[：:].{2,}/.test(value)) {
    return true
  }
  return false
}

function finalizeSpokenCandidate(value) {
  let next = normalizeWhitespace(value)
  if (!next || isNarrationOnly(next)) return ''
  next = next.replace(/^[，,、；;：:\s]+|[，,、；;：:\s]+$/g, '')
  if (!next || isNarrationOnly(next)) return ''
  return next
}

function extractSpokenFromDisplay(displayText) {
  const original = normalizeWhitespace(displayText)
  if (!original) return ''

  // 全文只在括号里：无可念台词（勿回退朗读括号内容）
  if (isBracketOnlyDisplay(original)) {
    return ''
  }

  let withoutBrackets = removeBracketActions(original)
  withoutBrackets = withoutBrackets.replace(STAGE_LABEL_LINE, '').trim()
  withoutBrackets = normalizeWhitespace(withoutBrackets)
  if (!withoutBrackets) return ''

  const viaColon = finalizeSpokenCandidate(
    stripEmotionPrefix(extractAfterSpeechColon(withoutBrackets)),
  )
  const withoutColon = finalizeSpokenCandidate(stripEmotionPrefix(withoutBrackets))

  // 冒号后若明显短于去括号整句，当碎片丢掉，避免念半截
  if (
    viaColon &&
    withoutColon &&
    viaColon.length + 8 <= withoutColon.length &&
    !isNarrationOnly(withoutColon)
  ) {
    return withoutColon
  }

  const SHORT_COLON = 8
  if (viaColon && viaColon.length >= SHORT_COLON) {
    return viaColon
  }
  if (
    withoutColon &&
    withoutColon.length >= SHORT_COLON &&
    (!viaColon || viaColon.length < SHORT_COLON)
  ) {
    if (viaColon && /[：:]/.test(withoutColon) && viaColon.length >= 2) {
      return viaColon
    }
    return withoutColon
  }

  return viaColon || withoutColon || ''
}

function stageCharCount(text = '') {
  const chunks = String(text || '').match(/（[^）]*）|\([^)]*\)/g) || []
  return chunks
    .join('')
    .replace(/[（）()\s]/g, '')
    .length
}

/** 句首括号旁白 vs 可念台词，便于把过短 spoken 从气泡里捞回来。 */
export function measureStageSpoken(text = '') {
  const display = normalizeWhitespace(text)
  const spoken = extractSpokenFromDisplay(display)
  const stageChars = stageCharCount(display)
  const spokenChars = spoken.replace(/\s+/g, '').length
  return { spoken, stageChars, spokenChars }
}

function pickSpokenCandidate(explicit, fromDisplay, display = '') {
  const a = normalizeWhitespace(explicit)
  const b = normalizeWhitespace(fromDisplay)
  if (!a) return b
  if (!b) return a
  if (a === b) return a
  const stageChars = stageCharCount(display)
  const aChars = a.replace(/\s+/g, '').length
  const bChars = b.replace(/\s+/g, '').length
  // JSON 里 spoken 只剩碎片、气泡正文其实更完整 → 用气泡
  if (b.includes(a) && a.length + 8 <= b.length) return b
  if (aChars < 12 && bChars >= 16) return b
  if (stageChars > 0 && aChars < stageChars && bChars >= stageChars) return b
  return aChars >= bChars ? a : b
}

function sanitizeExplicitSpoken(spokenText) {
  let value = normalizeWhitespace(spokenText)
  if (!value) return ''
  if (isBracketOnlyDisplay(value)) return ''
  value = removeBracketActions(value)
  value = stripEmotionPrefix(value)
  value = normalizeWhitespace(value)
  if (isNarrationOnly(value)) return ''
  return value
}

export function extractSpokenText(input) {
  if (input == null) return ''

  if (typeof input === 'object') {
    const display = normalizeWhitespace(
      input.displayText || input.content || input.text || '',
    )
    const fromDisplay =
      display && !isBracketOnlyDisplay(display)
        ? extractSpokenFromDisplay(display)
        : ''
    const explicit = normalizeWhitespace(input.spokenText)
    if (explicit) {
      const sanitized = sanitizeExplicitSpoken(explicit)
      return pickSpokenCandidate(sanitized, fromDisplay, display)
    }
    return fromDisplay
  }

  return extractSpokenFromDisplay(normalizeWhitespace(input))
}

export function resolveDisplayText(reply = {}) {
  return stripLeadingStageParens(
    normalizeWhitespace(reply.displayText || reply.content || reply.text || ''),
  )
}

/** 去掉句首括号旁白，如「（顿了顿）先这样。」→ 台词本体 */
export function stripLeadingStageParens(text = '') {
  let value = normalizeWhitespace(text)
  if (!value) return ''
  let prev = ''
  while (value !== prev) {
    prev = value
    value = normalizeWhitespace(
      value
        .replace(/^[（(][^）)]{0,40}[）)]\s*/u, '')
        .replace(/^[【\[][^】\]]{0,40}[】\]]\s*/u, ''),
    )
  }
  return value
}
