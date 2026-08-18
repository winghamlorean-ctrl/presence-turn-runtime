import {
  preferCleanApiText,
  stripForbidFamilies,
} from '../engines/replyForbidFamilies.js'

export function applyForbidStrip(replies = [], familyIds = []) {
  const ids = Array.isArray(familyIds) ? familyIds : []
  return (replies || [])
    .map((reply) => {
      const original = String(reply?.displayText || reply?.content || '').trim()
      if (!original) return null
      const stripped = stripForbidFamilies(original, ids)
      const kept = preferCleanApiText(stripped, original, ids)
      if (!kept) return null
      const spokenSource = String(reply?.spokenText || kept)
      const spokenStripped = stripForbidFamilies(spokenSource, ids)
      const spokenKept = preferCleanApiText(spokenStripped, spokenSource, ids)
      return {
        ...reply,
        content: kept,
        displayText: kept,
        spokenText: spokenKept || spokenSource,
      }
    })
    .filter(Boolean)
}
