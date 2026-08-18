/** 从主项目抽出的最小分类辅助，去掉剧情/视觉依赖。 */

export function isShortAck(text = '') {
  const value = String(text || '').trim()
  if (!value) return false
  if (value.length > 12) return false
  return /^(嗯+|恩+|唔+|好的?|好哒|好吧|好了|行|可以|嗯好|嗯嗯|哦|喔|额|啊|是|对|知道了|明白|收到|哈哈+|呵+|……+|…+|OK|ok|Okay|okay)([。！？?…~\s]|啦|呀|呢|啊|喔)*$/i.test(
    value,
  )
}

export function userSaidLeavingOrBusy(userMessage = '') {
  return /(?:我去|先忙|走了|出门|开会|睡了|忙去了|去忙|洗澡|我忙|先走|忙完再|回头聊|我先回|回个消息|马上回来|别挂着|先忙三十|有人喊)/.test(
    String(userMessage || '').trim(),
  )
}

export const BODY_NEED_PATTERN =
  /有点渴|好渴|渴了|口渴|想喝|喝点|口干|嗓子发[干紧]|喉咙.*干|有点饿|好饿|饿了|想吃|有点冷|好冷|冷死|热死|好热|有点累|好累|困了|头疼|难受|腿(?:有点)?酸|肩膀僵|眼睛干/

export const DRINK_NEED_PATTERN =
  /有点渴|好渴|渴了|口渴|想喝|喝点|口干|嗓子发[干紧]|喉咙.*干/

export function isBodyNeedMessage(userMessage = '') {
  return BODY_NEED_PATTERN.test(String(userMessage || '').trim())
}

export function isDrinkNeedMessage(userMessage = '') {
  return DRINK_NEED_PATTERN.test(String(userMessage || '').trim())
}
