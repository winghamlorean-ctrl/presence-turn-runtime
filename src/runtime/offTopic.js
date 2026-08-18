/** 问句答偏检测（机制层，不绑剧情词表）。 */

function bareReply(text = '') {
  return String(text || '')
    .replace(/（[^）]*）/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, '')
    .trim()
}

export function isDirectUserAsk(userMessage = '') {
  const t = String(userMessage || '').trim()
  if (!t) return false
  if (/爱喝什么|喜欢喝|记得.*喝|我叫什么|叫我什么/.test(t)) return true
  if (
    /会怎么说|怎么说我|在旁边会|要是你在|你会怎么看|你会怎么说|假如你在/.test(t)
  ) {
    return true
  }
  if (
    /(?:你)?(?:今天|刚才|这会儿)?(?:在)?(?:做什么|干嘛|忙什么|怎么样)|你呢|近来如何/.test(
      t,
    )
  ) {
    return true
  }
  if (/[？?]/.test(t) || /(?:吗|呢)\s*$/.test(t)) return true
  if (/^(?:为什么|怎么|什么|哪|是否|会不会)/.test(t)) return true
  return false
}

function isPeerDodgeReply(text = '') {
  const t = String(text || '')
  return /你先忙|去吧[，,]?\s*我不吵|我不吵(?:你)?|那你去|你先去|随你(?:便)?|好[，,]?\s*我听着/.test(
    t,
  )
}

export function isOffTopicReply(userMessage = '', replyText = '') {
  const u = String(userMessage || '').trim()
  const r = bareReply(replyText)
  if (!u || !r) return false
  if (!isDirectUserAsk(u)) return false
  if (isPeerDodgeReply(replyText)) return true

  if (
    /去吧|你先忙|那你去|我不吵/.test(r) &&
    !/(?:我去|先忙|走了|出门|开会|睡了)/.test(u)
  ) {
    return true
  }

  if (/你呢\s*$/.test(u) || /你呢[？?]/.test(u)) {
    if (!/(?:我|也|随便|都行|一样)/.test(r) && r.length < 8) return true
  }

  return false
}
