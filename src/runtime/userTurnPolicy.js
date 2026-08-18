/**
 * UserTurnPolicy：每轮一次用户态分类。
 * 驱动「本轮约束卡」+ forbidFamilies 后检；禁止多处平行 if 各写一套禁令。
 * 称呼 / 饮品 cite 来自当前 Pack，空白包未填则不强制。
 */

import { isShortAck, userSaidLeavingOrBusy, isBodyNeedMessage, isDrinkNeedMessage } from './helpers.js'
import { getActivePack } from '../pack/context.js'

const SOFT_HOLD_PATTERN =
  /我说重了|说重了|没有不爱|不是不爱|别多想|你别多想|别往心里|开玩笑|我错了|对不起|没有那个意思|等一下|有人喊|先这样|还是陪着|我没生气|那句不算数|其实挺想你|在就好|别怕|开完玩笑|气话/

const BODY_HOLD_PATTERN =
  /有点累|好累|累了|腿.{0,4}酸|头.?疼|头疼|眼睛.?干|嗓子|肩膀.{0,4}僵|困了|手冷|不舒服|难受/

const GOODNIGHT_PATTERN = /晚安|睡了|先睡|去睡/

const GREETING_KEYWORDS = ['你好', '在吗', '在么', '早安', '晚安', '谢谢']
const GREETING_SHORT = /^(早|ok|okay)$/i

const NAME_RECALL_USER =
  /我叫什么|叫什么来着|我叫啥|你记得我(?:叫|的名字)|记得叫我/
const DRINK_RECALL_USER = /爱喝什么|喜欢喝什么|记得.*喝|喝什么来着/

const BASE_FORBID = ['servant', 'order_scold', 'peer_dodge']

/**
 * @typedef {{
 *   turnKind: string,
 *   must: string[],
 *   forbidFamilies: string[],
 *   cite: null | 'drink' | 'name',
 *   historyMode: 'default' | 'greeting',
 * }} UserTurnPolicy
 */

export function resolveUserTurnPolicy(userMessage = '', options = {}) {
  void options
  const u = String(userMessage || '').trim()
  const pack = getActivePack()
  const hasName = Boolean(String(pack?.facts?.name || '').trim())
  const hasDrink = Boolean(String(pack?.facts?.drink || '').trim())

  /** @type {UserTurnPolicy} */
  const base = {
    turnKind: 'default',
    must: ['spoken_line'],
    forbidFamilies: [...BASE_FORBID],
    cite: null,
    historyMode: 'default',
  }

  if (!u) return base

  if (userSaidLeavingOrBusy(u) || GOODNIGHT_PATTERN.test(u)) {
    return {
      ...base,
      turnKind: 'leaving',
      forbidFamilies: ['servant', 'order_scold'],
    }
  }

  if (SOFT_HOLD_PATTERN.test(u)) {
    return {
      ...base,
      turnKind: 'soft_hold',
      forbidFamilies: [...BASE_FORBID],
    }
  }

  if (isDrinkNeedMessage(u)) {
    return {
      ...base,
      turnKind: 'thirst',
      cite: hasDrink ? 'drink' : null,
      forbidFamilies: [...BASE_FORBID],
    }
  }

  if (BODY_HOLD_PATTERN.test(u) || isBodyNeedMessage(u)) {
    return {
      ...base,
      turnKind: 'body_hold',
      forbidFamilies: [...BASE_FORBID],
    }
  }

  if (isShortAck(u)) {
    return {
      ...base,
      turnKind: 'short_ack',
      historyMode: 'default',
      forbidFamilies: [...BASE_FORBID],
    }
  }

  if (
    GREETING_SHORT.test(u) ||
    (u.length <= 12 && GREETING_KEYWORDS.some((k) => u.includes(k)))
  ) {
    return {
      ...base,
      turnKind: 'greeting',
      historyMode: 'greeting',
      forbidFamilies: [...BASE_FORBID],
    }
  }

  if (NAME_RECALL_USER.test(u)) {
    return {
      ...base,
      turnKind: 'recall_name',
      cite: hasName ? 'name' : null,
      forbidFamilies: [...BASE_FORBID],
    }
  }

  if (DRINK_RECALL_USER.test(u)) {
    return {
      ...base,
      turnKind: 'recall_drink',
      cite: hasDrink ? 'drink' : null,
      forbidFamilies: [...BASE_FORBID],
    }
  }

  return base
}

export function buildTurnConstraintCard(policy) {
  const p = policy || resolveUserTurnPolicy('')
  const pack = getActivePack()
  const name = String(pack?.facts?.name || '').trim()
  const drink = String(pack?.facts?.drink || '').trim()

  const lines = [
    '【本轮约束卡】',
    '必须有一句说出口的人话；禁止只写括号旁白。',
    '禁止仆人式伺候（递杯推盏、端水揉腿、安排作息）。',
    '禁止训斥使唤（别光应声、坐好、先喝口水）。',
  ]

  switch (p.turnKind) {
    case 'short_ack':
      lines.push(
        '本轮是短附和：环顾近几轮轻轻往下接半步，可顺着闲扯或轻抛生活话头；禁止复述上一句原话；禁止训斥催话。',
      )
      break
    case 'soft_hold':
      lines.push(
        '本轮是缓和：先接住他这句话；禁止抬杠（谁信/少哄我）；禁止空旁白。',
      )
      break
    case 'body_hold':
      lines.push(
        '本轮是身体不适：口头接住即可；禁止递杯揉腿伺候；不要硬塞饮品。',
      )
      break
    case 'thirst':
      lines.push(
        drink
          ? `本轮口渴：口头点到已知饮品偏好（${drink}）；禁止递杯推盏润喉。`
          : '本轮口渴：口头接住即可；禁止递杯推盏润喉。',
      )
      break
    case 'leaving':
      lines.push(
        '本轮暂离/晚安：用完整短句应（优先「去吧」「睡吧」「你去」）；禁止只回单字「好」「嗯」。',
      )
      break
    case 'greeting':
      lines.push(
        '本轮是招呼：短应即可，自然接住；可带半句生活气，不必端着。',
      )
      break
    case 'recall_name':
      lines.push(
        name ? `本轮考称呼：必须点到「${name}」。` : '本轮问名字：若还不知道就诚实说还没记住，不要编。',
      )
      break
    case 'recall_drink':
      lines.push(
        drink
          ? `本轮问爱喝什么：必须点到「${drink}」。`
          : '本轮问爱喝什么：若还不知道就诚实说还没记住，不要编。',
      )
      break
    default:
      lines.push(
        '先接住本轮这一句；日常碎聊（天气/琐事/玩笑/心情）可以顺着聊半步，不必句句正经。',
        '用户没说要走时，禁止「你先忙/去吧我不吵/随你」搪塞。',
      )
  }

  if (p.must?.includes('spoken_line')) {
    lines.push('口语字数至少一句完整短句。')
  }

  return lines.join('\n')
}
