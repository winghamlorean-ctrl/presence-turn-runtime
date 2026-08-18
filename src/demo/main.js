import { sendTurn, mergePack, BLANK_PACK } from '../index.js'

const KEYS = {
  apiKey: 'ptr_demo_api_key',
  endpoint: 'ptr_demo_endpoint',
  model: 'ptr_demo_model',
  packName: 'ptr_demo_pack_name',
  factName: 'ptr_demo_fact_name',
  factDrink: 'ptr_demo_fact_drink',
}

const defaults = {
  endpoint: 'https://api.openai.com/v1/chat/completions',
  model: 'gpt-4o-mini',
  packName: '角色',
}

const els = {
  apiKey: document.querySelector('#apiKey'),
  endpoint: document.querySelector('#endpoint'),
  model: document.querySelector('#model'),
  packName: document.querySelector('#packName'),
  factName: document.querySelector('#factName'),
  factDrink: document.querySelector('#factDrink'),
  saveCfg: document.querySelector('#saveCfg'),
  log: document.querySelector('#log'),
  form: document.querySelector('#form'),
  input: document.querySelector('#input'),
  send: document.querySelector('#send'),
  debug: document.querySelector('#debug'),
}

const history = []

function loadCfg() {
  els.apiKey.value = localStorage.getItem(KEYS.apiKey) || ''
  els.endpoint.value = localStorage.getItem(KEYS.endpoint) || defaults.endpoint
  els.model.value = localStorage.getItem(KEYS.model) || defaults.model
  els.packName.value = localStorage.getItem(KEYS.packName) || defaults.packName
  els.factName.value = localStorage.getItem(KEYS.factName) || ''
  els.factDrink.value = localStorage.getItem(KEYS.factDrink) || ''
}

function saveCfg() {
  localStorage.setItem(KEYS.apiKey, els.apiKey.value.trim())
  localStorage.setItem(KEYS.endpoint, els.endpoint.value.trim())
  localStorage.setItem(KEYS.model, els.model.value.trim())
  localStorage.setItem(KEYS.packName, els.packName.value.trim() || defaults.packName)
  localStorage.setItem(KEYS.factName, els.factName.value.trim())
  localStorage.setItem(KEYS.factDrink, els.factDrink.value.trim())
}

function currentPack() {
  return mergePack({
    ...BLANK_PACK,
    name: els.packName.value.trim() || BLANK_PACK.name,
    facts: {
      name: els.factName.value.trim(),
      drink: els.factDrink.value.trim(),
    },
  })
}

function append(role, html) {
  const li = document.createElement('li')
  li.className = role
  li.innerHTML = html
  els.log.appendChild(li)
  els.log.scrollTop = els.log.scrollHeight
}

els.saveCfg.addEventListener('click', () => {
  saveCfg()
  els.debug.textContent = '配置已保存。'
})

els.form.addEventListener('submit', async (event) => {
  event.preventDefault()
  const text = els.input.value.trim()
  if (!text) return
  saveCfg()
  els.input.value = ''
  append('user', `<strong>你</strong> ${escapeHtml(text)}`)
  history.push({ role: 'user', content: text })
  els.send.disabled = true
  try {
    const result = await sendTurn({
      userMessage: text,
      history: history.slice(0, -1),
      pack: currentPack(),
      llm: {
        apiKey: els.apiKey.value.trim(),
        endpoint: els.endpoint.value.trim(),
        model: els.model.value.trim(),
      },
    })
    for (const reply of result.replies || []) {
      const display = String(reply.displayText || reply.content || '')
      const spoken = String(reply.spokenText || '')
      append(
        'assistant',
        `<div class="spoken">${escapeHtml(display)}</div>${
          spoken && spoken !== display
            ? `<span class="stage-note">spoken：${escapeHtml(spoken)}</span>`
            : ''
        }`,
      )
      history.push({ role: 'assistant', content: display, spokenText: spoken })
    }
    els.debug.textContent = JSON.stringify(
      {
        turnKind: result.policy?.turnKind,
        cite: result.policy?.cite,
        signal: result.presence?.signal,
        posture: result.presence?.posture,
        tension: result.presence?.tensionActive,
        affect: result.presence?.affect,
        salvage: result.salvage,
        memories: (result.memories || []).map((m) => m.text),
      },
      null,
      2,
    )
  } catch (err) {
    append('assistant', `<em>${escapeHtml(err?.message || String(err))}</em>`)
    history.pop()
  } finally {
    els.send.disabled = false
    els.input.focus()
  }
})

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

loadCfg()
