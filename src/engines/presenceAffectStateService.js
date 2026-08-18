/**
 * 在场叠态（attachment / hurt / trust / guard）+ 近窗感情事件。
 * 行为引擎底座属性：无开关，localStorage 持久化。
 * 依恋地板由当前 Pack 提供；空白包默认较低，不绑特定角色。
 */

import { getActivePack } from '../pack/context.js'

const STORAGE_KEY = 'ptr_affect_state_v1'
const MAX_EVENTS = 48

export function getAttachmentFloor() {
  const n = Number(getActivePack()?.affect?.attachmentFloor)
  if (Number.isFinite(n)) return Math.max(0, Math.min(1, n))
  return 0.2
}

export const DEFAULT_AFFECT = Object.freeze({
  attachment: 0.55,
  hurt: 0.12,
  trust: 0.52,
  guard: 0.22,
})

function clamp01(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return 0
  return Math.max(0, Math.min(1, x))
}

function normalizeAffect(raw = {}) {
  return {
    attachment: Math.max(getAttachmentFloor(), clamp01(raw.attachment ?? DEFAULT_AFFECT.attachment)),
    hurt: clamp01(raw.hurt ?? DEFAULT_AFFECT.hurt),
    trust: clamp01(raw.trust ?? DEFAULT_AFFECT.trust),
    guard: clamp01(raw.guard ?? DEFAULT_AFFECT.guard),
  }
}

function normalizeEvent(ev = {}) {
  const type = String(ev.type || '').trim()
  if (!type) return null
  const at = Number(ev.at) || Date.now()
  const summary = String(ev.summary || '').trim().slice(0, 80)
  const weight = clamp01(ev.weight ?? 0.7)
  return { type, at, summary, weight }
}

function defaultState() {
  return {
    version: 1,
    affect: { ...DEFAULT_AFFECT },
    events: [],
    contradictionCount: 0,
    updatedAt: Date.now(),
  }
}

export function loadAffectState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultState()
    const parsed = JSON.parse(raw)
    const events = Array.isArray(parsed.events)
      ? parsed.events.map(normalizeEvent).filter(Boolean).slice(-MAX_EVENTS)
      : []
    return {
      version: 1,
      affect: normalizeAffect(parsed.affect),
      events,
      contradictionCount: Math.max(0, Number(parsed.contradictionCount) || 0),
      updatedAt: Number(parsed.updatedAt) || Date.now(),
    }
  } catch {
    return defaultState()
  }
}

export function saveAffectState(state) {
  const next = {
    version: 1,
    affect: normalizeAffect(state?.affect),
    events: (Array.isArray(state?.events) ? state.events : [])
      .map(normalizeEvent)
      .filter(Boolean)
      .slice(-MAX_EVENTS),
    contradictionCount: Math.max(0, Number(state?.contradictionCount) || 0),
    updatedAt: Date.now(),
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}

export function pushAffectEvent(state, event) {
  const normalized = normalizeEvent(event)
  if (!normalized) return state
  const events = [...(state.events || []), normalized].slice(-MAX_EVENTS)
  return { ...state, events, updatedAt: Date.now() }
}

/**
 * 近窗内按类型检索事件（新→旧），带时间衰减权重。
 * @param {number} windowMs
 */
export function retrieveRecentEvents(state, { types = null, windowMs = 6 * 60 * 60 * 1000, limit = 8 } = {}) {
  const now = Date.now()
  const typeSet = types ? new Set(types) : null
  const scored = []

  for (let i = (state.events || []).length - 1; i >= 0; i -= 1) {
    const ev = state.events[i]
    if (typeSet && !typeSet.has(ev.type)) continue
    const age = now - ev.at
    if (age > windowMs) continue
    const decay = Math.max(0.15, 1 - age / windowMs)
    scored.push({
      ...ev,
      effectiveWeight: clamp01(ev.weight * decay),
      ageMs: age,
    })
    if (scored.length >= limit) break
  }

  return scored
}

export function applyAffectDelta(state, delta = {}) {
  const cur = normalizeAffect(state.affect)
  return {
    ...state,
    affect: normalizeAffect({
      attachment: cur.attachment + (Number(delta.attachment) || 0),
      hurt: cur.hurt + (Number(delta.hurt) || 0),
      trust: cur.trust + (Number(delta.trust) || 0),
      guard: cur.guard + (Number(delta.guard) || 0),
    }),
    updatedAt: Date.now(),
  }
}

export function resetAffectState() {
  const next = defaultState()
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}
