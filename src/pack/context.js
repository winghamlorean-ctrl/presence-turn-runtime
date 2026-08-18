import { BLANK_PACK, mergePack } from './blank.js'

let activePack = BLANK_PACK

export function setActivePack(pack = null) {
  activePack = mergePack(pack || {})
  return activePack
}

export function getActivePack() {
  return activePack
}
