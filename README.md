# Presence Turn Runtime

**The turn law companion chat is missing.**

Most companion bots don't fail at IQ. They fail **the line**:

| They do this | This engine does not |
| --- | --- |
| Pour you water you never asked to be served | Strip servant-speak. Never invent a replacement line. |
| Answer a question with「你先忙」 | Dodge is a forbid family, not a personality. |
| Return `(paused)` with nothing spoken | A turn must have a spoken line. |
| Silently hit the model again because it “felt weak” | Salvage **at most once**, and only if the turn is actually broken. |

Then mood carries — attachment / hurt / trust / guard — so “hi” tomorrow does not wipe last night.

One function: `sendTurn`. No backend. Your UI, your key, your character pack. Demo 是浏览器页；引擎本身是普通 JS + `fetch`。叠态/记忆目前用 `localStorage` 落盘，Node 里自己垫一层存储即可。

```
classify once → constraint card → strip (never invent) → salvage ≤ 1 → mood + memory carry
```

它不是 VTuber 平台，不是完整 App，也不绑任何人设。差别在回合纪律，不在立绘和实时语音。

## What it actually does

- **本轮分类一次** → 写出这一轮约束卡（招呼 / 短附和 / 暂离 / 缓和 / 口渴…）
- **禁令族只剥不编** → 伺候、训斥、打发从模型原文里抠掉；剥空就留残句，不灌「嗯。」
- **抢救最多一次** → 空壳、禁语漏网、问句答偏才重打；不做「感觉虚就再写一遍」
- **情绪叠态** → 放不下 / 受伤 / 信任 / 收住会惯性；张力后检拦认命腔和吃喝抹平
- **短聊节奏 + 本地记忆** → 像微信一句；检索进这一轮，不另起后端
- **旁白 / 台词分开** → `displayText` 可带句首括号，`spokenText` 是纯台词（TTS 你自己接）

## What it is not

- 角色包、剧情、Live2D、看一眼、通知、Android 壳
- 服务端、多用户账号、把 Key 存在别人机器上
- 保证「更像真人」的魔法。它只保证这一轮有规矩

## Quick start

```bash
npm install
npm run dev
```

打开终端提示的地址（默认 `http://localhost:5177`），填自己的 API Key，以及任意 **OpenAI 兼容** Chat Completions 地址。右边会显示本轮 `turnKind`、叠态和有没有抢救——那就是这套引擎在干什么。Demo 在浏览器里跑；把 `sendTurn` 接到自己的客户端即可。

## Use as a module

```js
import { sendTurn, mergePack } from './src/index.js'

const result = await sendTurn({
  userMessage: '在吗',
  history: [],
  pack: mergePack({
    name: '阿宁',
    facts: { name: '小周', drink: '热茶' },
  }),
  llm: {
    apiKey: '...',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
  },
})

result.replies[0].displayText  // 气泡（可带句首旁白）
result.replies[0].spokenText   // 纯台词
result.policy.turnKind         // greeting | short_ack | leaving | …
result.salvage                 // 有没有第二遍、用了没有
```

换角色只改 Pack（`src/pack/blank.js`）。人名、饮品偏好、口吻都放 Pack 里，不要写进引擎。

## Tests

```bash
npm test
```

不打模型。测的是分类、禁令剥离、抢救判定——也就是纪律本身。

## Safety

API Key 只在你本机（Demo 用 `localStorage`）。不要把 Key 或对话日志提交进 git，也不要贴到 Issue 里。

## License

MIT. Keep the copyright notice; use it in closed-source products if you want.
