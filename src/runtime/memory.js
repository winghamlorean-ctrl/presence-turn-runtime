const STORAGE_KEY = 'ptr_local_memories_v1'
const MAX_ITEMS = 40

function loadAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveAll(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(-MAX_ITEMS)))
}

export function rememberFact(text, kind = 'note') {
  const value = String(text || '').trim().slice(0, 120)
  if (!value) return null
  const items = loadAll()
  if (items.some((item) => item.text === value)) return items.find((item) => item.text === value)
  const next = {
    id: `m_${Date.now()}`,
    kind,
    text: value,
    at: Date.now(),
  }
  items.push(next)
  saveAll(items)
  return next
}

/** 很轻的本地检索：关键词重叠，不打 embedding。 */
export function retrieveMemories(userMessage = '', limit = 4) {
  const query = String(userMessage || '').trim()
  if (!query) return []
  const tokens = query.split(/[\s，。！？、]+/).filter((t) => t.length >= 2)
  const scored = loadAll()
    .map((item) => {
      const hay = String(item.text || '')
      let score = 0
      for (const token of tokens) {
        if (hay.includes(token)) score += token.length
      }
      if (query.includes(hay) || hay.includes(query.slice(0, 8))) score += 2
      return { ...item, score }
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.at - a.at)
  return scored.slice(0, limit)
}

export function ingestUserFacts(userMessage = '', pack = null) {
  const u = String(userMessage || '').trim()
  const nameHit = u.match(/我叫([\u4e00-\u9fffA-Za-z]{1,12})/)
  if (nameHit?.[1]) rememberFact(`用户名叫${nameHit[1]}`, 'name')
  const drinkHit = u.match(/我(?:爱|喜欢)喝(.{1,12})/)
  if (drinkHit?.[1]) rememberFact(`用户爱喝${drinkHit[1].replace(/[。！？]/g, '')}`, 'drink')
  void pack
}

export function buildMemoryPrompt(hits = []) {
  if (!hits.length) return ''
  const lines = hits.map((item) => `- ${item.text}`)
  return ['【本轮检索到的本地记忆】', ...lines, '用上即可，不要说「根据记忆」或复读整条。'].join('\n')
}

export function listMemories() {
  return loadAll()
}

export function clearMemories() {
  saveAll([])
}
