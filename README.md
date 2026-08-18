# Presence Turn Runtime

No-backend, client-side turn dialogue runtime.  
Bring your own UI, API key, and character pack — one `sendTurn` per user message.

无后端、浏览器里跑的回合对话引擎。自己的界面 + 自己的 Key，一轮一次 `sendTurn`。  
不绑固定角色，不带剧情、视觉、通知或移动壳。

## What you get

- 本轮分类 + 约束卡
- 禁令族剥离（只剥不编）+ **每轮最多一次**抢救重写
- 情绪叠态（惯性、张力后检）
- 上下文编译 + 短聊节奏
- 本地记忆检索进这一轮
- 旁白 / `spokenText` 字段（TTS 不接）
- 空白角色 Pack + 最小聊天页

## What you do not get

- 任何绑定角色或剧情包
- 看一眼、发图、半视频
- 离场通知、移动壳、设置中心、语音试验台

## Quick start

```bash
npm install
npm run dev
```

打开终端提示的地址（默认 `http://localhost:5177`），填自己的 API Key，以及任意 **OpenAI 兼容** Chat Completions 地址。

## Use as a module

```js
import { sendTurn, BLANK_PACK, mergePack } from './src/index.js'

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
```

换角色只改 Pack（`src/pack/blank.js`），不要往引擎里写死人名。

## Tests

```bash
npm test
```

不打模型，只测分类 / 禁令剥离 / 抢救判定。

## Safety

API Key 只存在你本机（Demo 用 `localStorage`）。不要把 Key、对话日志提交进 git，也不要贴到 Issue 里。

## License

MIT
