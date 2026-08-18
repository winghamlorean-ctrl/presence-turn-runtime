/**
 * 回复禁语族表（机制层）：伺候 / 训斥使唤 / 打发 / 休息碎催。
 * 增覆盖：往对应 family.patterns 加正则；业务侧只按 family id 剥离，勿散落 if。
 */

/** @typedef {{ id: string, patterns: RegExp[] }} ForbidFamily */

export const REST_PHRASE_PATTERNS = [
  /歇(?:一?会儿|歇)/,
  /先歇(?:一?会儿|歇)?/,
  /你歇(?:一?会儿|歇)?/,
  /你先歇/,
  /休息(?:一下|会儿)?/,
  /先缓缓/,
  /缓缓(?:一下|来)?/,
  /喘口气/,
  /歇口气/,
  /不差这(?:一)?小?会儿/,
  /事再急.*不差/,
  /慢慢来/,
  /(?:^|[，,。！？!?])别急(?:[，,。！？!?]|$)/,
  /我陪着你/,
  /夜深了/,
  /早些?睡/,
  /早点休息/,
  /该睡了/,
  /早点睡/,
]

export const SERVANT_CARE_PATTERNS = [
  /我去给你(?:端|拿|倒|冲|弄)/,
  /我给你(?:熬|煮|端|倒|冲)/,
  /给你端/,
  /给你倒(?:杯|碗)?/,
  /倒(?:杯|碗|壶)?水/,
  /倒一杯/,
  /递杯/,
  /递给你/,
  /递到你/,
  /把杯子递/,
  /杯子递过/,
  /把杯子推/,
  /杯子推过/,
  /往你手边推/,
  /手边推了?推?/,
  /把.*往你手边/,
  /递过(?:手边|来|杯子|茶杯|水杯)/,
  /去拿杯子/,
  /转身去拿/,
  /起身去倒/,
  /刚烧的/,
  /刚冲的/,
  /润润喉/,
  /先喝口水/,
  /喝口水/,
  /喝口热水/,
  /先喝口(?:水|垫)?/,
  /倒杯水来/,
  /杯热水/,
  /白水倒管够/,
  /白水(?:倒|管够)/,
  /手边的(?:热)?水/,
  /水还(?:热|温)着/,
  /给你晾着/,
  /下次给你冲/,
  /给你冲(?:一?杯|好)?/,
  /我去冲(?:一?杯|好)?/,
  /我去弄/,
  /抢着去弄/,
  /站起身.*(?:弄|倒|冲)/,
  /去倒杯.*醒/,
  /倒杯.*醒醒神/,
  /累不累[？?，,]*先喝/,
  /先坐会儿[，,].{0,8}水/,
  /我去给你揉/,
  /给你揉(?:揉)?/,
  /帮你揉(?:揉|腿|肩)?/,
  /我去揉/,
  /揉揉(?:腿|肩|你)/,
  /你先睡(?:吧|着)?我/,
  /我(?:在这|在这儿)?守着你睡/,
  /我守着就行/,
]

/** 训斥 / 使唤 / 短附和催话 */
export const ORDER_SCOLD_PATTERNS = [
  /坐好/,
  /你坐好/,
  /坐好别/,
  /别乱跑/,
  /别犯傻/,
  /嗯什么/,
  /哦什么/,
  /啊什么/,
  /别光应/,
  /别光嗯/,
  /光应声/,
  /只应一声/,
  /话真少/,
  /净问些/,
  /先喝口水/,
  /喝口水/,
  /先喝口/,
  /杯热水/,
  /去倒/,
  /去倒杯/,
  /给你倒/,
  /去端/,
  /端给你/,
  /赶紧吃/,
  /给你揉(?:揉)?/,
  /帮你揉/,
  /我去揉/,
  /我去弄/,
  /我去冲/,
  /倒杯.*醒/,
  /抢着去弄/,
  /像伺候/,
]

/** 非暂离时的打发 / 空应 */
export const PEER_DODGE_PATTERNS = [
  /你先忙[。.!！…~]*/,
  /去吧[，,]?\s*我不吵(?:你)?[。.!！…~]*/,
  /我不吵(?:你)?[。.!！…~]*/,
  /行[，,]?\s*那你去[。.!！…~]*/,
  /那你去[。.!！…~]*/,
  /你先去[。.!！…~]*/,
  /行[，,]?\s*你弄你的[。.!！…~]*/,
  /好[，,]?\s*我听着[。.!！…~]*/,
  /(?<!不)去吧[。.!！…~]*/,
  /随你(?:便)?[。.!！…~]*/,
  /爱咋咋地[。.!！…~]*/,
  /随便你[。.!！…~]*/,
  /爱怎样怎样[。.!！…~]*/,
]

/** @type {ForbidFamily[]} */
export const REPLY_FORBID_FAMILIES = [
  { id: 'servant', patterns: SERVANT_CARE_PATTERNS },
  { id: 'order_scold', patterns: ORDER_SCOLD_PATTERNS },
  { id: 'peer_dodge', patterns: PEER_DODGE_PATTERNS },
  { id: 'rest_nag', patterns: REST_PHRASE_PATTERNS },
]

const FAMILY_MAP = new Map(
  REPLY_FORBID_FAMILIES.map((family) => [family.id, family]),
)

function asGlobal(pattern) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  return new RegExp(pattern.source, flags)
}

export function getForbidFamilyPatterns(familyId = '') {
  return FAMILY_MAP.get(String(familyId || ''))?.patterns || []
}

export function textHitsForbidFamilies(text = '', familyIds = []) {
  const value = String(text || '')
  if (!value || !familyIds?.length) return false
  for (const id of familyIds) {
    const patterns = getForbidFamilyPatterns(id)
    if (id === 'servant') {
      if (
        /(?:把杯子|杯子|手边).{0,8}喏|(?:推过|递过).{0,6}喏|喏[。！]?\s*$/.test(
          value,
        ) &&
        /杯|盏|推|递|拿|喏/.test(value)
      ) {
        return true
      }
    }
    if (patterns.some((p) => p.test(value))) return true
  }
  return false
}

function cleanupPunctuation(text = '') {
  return String(text || '')
    .replace(/[，,]{2,}/g, '，')
    .replace(/[，,]+[。.]+/g, '。')
    .replace(/^[，,。！？!?]+/, '')
    .replace(/[，,。！？!?]+$/, '')
    .trim()
}

export function spokenContentCharCount(text = '') {
  return String(text || '')
    .replace(/（[^）]*）/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, '')
    .length
}

/**
 * 按禁语族剥离；不编造替身台词。
 */
export function stripForbidFamilies(text = '', familyIds = []) {
  let next = String(text || '')
  if (!next || !familyIds?.length) return next

  // 旁白整段含伺候：整段去掉，避免残句
  if (familyIds.includes('servant')) {
    next = next.replace(/（[^）]*）|\([^)]*\)/g, (block) =>
      textHitsForbidFamilies(block, ['servant']) ? '' : block,
    )
  }

  for (const id of familyIds) {
    for (const pattern of getForbidFamilyPatterns(id)) {
      next = next.replace(asGlobal(pattern), '')
    }
  }
  return cleanupPunctuation(next)
}

function ensureTerminalPunct(text = '') {
  let next = String(text || '').trim()
  if (!next) return next
  if (!/[。！？!?]$/.test(next) && !/）\s*$/.test(next)) next = `${next}。`
  return next
}

/**
 * 剥空后从 API 原文里挑最长未踩禁族的子句/旁白；仍是模型字，不灌模板。
 */
export function salvageLongestCleanClause(original = '', familyIds = []) {
  const raw = String(original || '').trim()
  if (!raw) return ''

  const chunks = raw
    .split(/(?<=[。！？!?])|(?:\s*\/\s*)|[；;]/)
    .map((part) => part.trim())
    .filter(Boolean)

  let best = ''
  for (const chunk of chunks) {
    if (textHitsForbidFamilies(chunk, familyIds)) continue
    if (spokenContentCharCount(chunk) < 1) continue
    if (chunk.length >= best.length) best = chunk
  }
  if (best) return ensureTerminalPunct(cleanupPunctuation(best))

  const stages = (raw.match(/（[^）]*）|\([^)]*\)/g) || []).filter(
    (block) => !textHitsForbidFamilies(block, familyIds),
  )
  if (stages.length) return stages.join('')

  // 全灭：不要把踩禁族的原文退回（否则伺候句会原样复活）
  return ''
}

/**
 * 剥词后优先保住剩余 API；口语没了则 salvage。
 */
export function preferCleanApiText(stripped = '', original = '', familyIds = []) {
  const cleaned = cleanupPunctuation(stripped)
  if (spokenContentCharCount(cleaned) >= 1) {
    return ensureTerminalPunct(cleaned)
  }
  const stages =
    String(cleaned || '').match(/（[^）]*）|\([^)]*\)/g) ||
    String(original || '')
      .match(/（[^）]*）|\([^)]*\)/g)
      ?.filter((block) => !textHitsForbidFamilies(block, familyIds)) ||
    []
  if (stages.length) return stages.join('')
  if (familyIds?.length) {
    const salvaged = salvageLongestCleanClause(original, familyIds)
    if (salvaged) return salvaged
  }
  // 原文也全是禁语：返回空，不复活禁句、不灌模板
  return ''
}
