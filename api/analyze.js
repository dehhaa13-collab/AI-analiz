export const config = { maxDuration: 60 };

// ═══════════════════════════════════════════
// ERROR CODES
// ═══════════════════════════════════════════
const ERROR_CODES = {
  NO_KEYS:       { code: 'NO_KEYS',       status: 500, msg: '❌ API ключі не налаштовані' },
  RATE_LIMIT:    { code: 'RATE_LIMIT',    status: 429, msg: '⏳ Забагато запитів — зачекай хвилину' },
  DAILY_LIMIT:   { code: 'DAILY_LIMIT',   status: 429, msg: '📅 Денний ліміт вичерпано — спробуй завтра' },
  INVALID_REQ:   { code: 'INVALID_REQ',   status: 400, msg: '⚠️ Невалідний запит' },
  TOO_MANY_MSG:  { code: 'TOO_MANY_MSG',  status: 400, msg: '⚠️ Занадто багато повідомлень' },
  REQ_TOO_BIG:   { code: 'REQ_TOO_BIG',   status: 400, msg: '⚠️ Запит занадто великий (макс. 10 МБ)' },
  QUOTA:         { code: 'QUOTA',         status: 429, msg: '🔑 Вичерпано квоту Gemini' },
  OVERLOADED:    { code: 'OVERLOADED',    status: 503, msg: '🔥 Сервер AI перевантажений' },
  API_ERROR:     { code: 'API_ERROR',     status: 502, msg: '💥 Помилка API' },
  ALL_FAILED:    { code: 'ALL_FAILED',    status: 503, msg: '😔 Всі AI сервіси тимчасово недоступні' },
  OPENAI_BUDGET: { code: 'OPENAI_BUDGET', status: 429, msg: '💰 Денний бюджет OpenAI вичерпано. Спробуй завтра' },
};

// ═══════════════════════════════════════════
// RATE LIMITER (per IP)
// ═══════════════════════════════════════════
const ipRequests = new Map();

function rateLimit(ip) {
  const now = Date.now();
  const entry = ipRequests.get(ip) || { count: 0, resetAt: now + 60000, daily: 0, dayReset: now + 86400000 };
  if (now > entry.dayReset) { entry.daily = 0; entry.dayReset = now + 86400000; }
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 60000; }
  entry.count++;
  entry.daily++;
  ipRequests.set(ip, entry);
  if (entry.count > 5) return ERROR_CODES.RATE_LIMIT;
  if (entry.daily > 50) return ERROR_CODES.DAILY_LIMIT;
  return null;
}

// ═══════════════════════════════════════════
// OPENAI DAILY BUDGET GUARD
// Prevents OpenAI from eating all your money.
// Max 100 requests/day to OpenAI (~$0.50/day max)
// ═══════════════════════════════════════════
const openaiUsage = { count: 0, resetAt: 0 };
const OPENAI_DAILY_MAX = 100; // ~$0.005 per request × 100 = ~$0.50/day max

function canUseOpenAI() {
  const now = Date.now();
  if (now > openaiUsage.resetAt) {
    openaiUsage.count = 0;
    openaiUsage.resetAt = now + 86400000; // reset in 24h
  }
  return openaiUsage.count < OPENAI_DAILY_MAX;
}

function trackOpenAIUsage() {
  openaiUsage.count++;
  console.log(`💰 OpenAI usage: ${openaiUsage.count}/${OPENAI_DAILY_MAX} today`);
}

// ═══════════════════════════════════════════
// VALIDATOR
// ═══════════════════════════════════════════
function validate(body) {
  if (!body || !body.messages || !Array.isArray(body.messages)) return ERROR_CODES.INVALID_REQ;
  if (body.messages.length > 5) return ERROR_CODES.TOO_MANY_MSG;
  const totalSize = JSON.stringify(body.messages).length;
  if (totalSize > 10 * 1024 * 1024) return ERROR_CODES.REQ_TOO_BIG;
  return null;
}

// ═══════════════════════════════════════════
// GEMINI API (FREE — Primary)
// ═══════════════════════════════════════════
const GEMINI_MODELS = ['gemini-2.5-flash'];
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function classifyGeminiError(statusCode, errorBody) {
  const msg = errorBody?.error?.message || '';
  const status = errorBody?.error?.status || '';
  if (statusCode === 429 || status === 'RESOURCE_EXHAUSTED' || msg.includes('quota') || msg.includes('Quota')) {
    return { ...ERROR_CODES.QUOTA, detail: msg.slice(0, 200) };
  }
  if (statusCode === 503 || status === 'UNAVAILABLE' || msg.includes('high demand') || msg.includes('overloaded')) {
    return { ...ERROR_CODES.OVERLOADED, detail: msg.slice(0, 200) };
  }
  if (statusCode === 400) {
    return { ...ERROR_CODES.API_ERROR, detail: `Bad Request: ${msg.slice(0, 200)}` };
  }
  if (statusCode === 403) {
    return { ...ERROR_CODES.API_ERROR, detail: `Forbidden: ключ невалідний` };
  }
  return { ...ERROR_CODES.API_ERROR, detail: `HTTP ${statusCode}: ${msg.slice(0, 200)}` };
}

// ═══════════════════════════════════════════
// SERVER-SIDE JSON CLEANING & VALIDATION
// Ensures the client always receives valid JSON
// ═══════════════════════════════════════════
function cleanAIResponse(result) {
  const rawText = result?.choices?.[0]?.message?.content || '';
  if (!rawText) return result;

  let cleaned = rawText
    .replace(/^\uFEFF/, '')                          // BOM
    .replace(/```json\s*/gi, '')                     // ```json blocks
    .replace(/```\s*/g, '')                          // ``` blocks
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')  // control chars
    .trim();

  // Strategy 1: direct parse
  try {
    const parsed = JSON.parse(cleaned);
    const validated = validateAIStructure(parsed);
    result.choices[0].message.content = JSON.stringify(validated);
    console.log('✅ JSON cleaned: direct parse OK');
    return result;
  } catch (_) {}

  // Strategy 2: find outermost { ... }
  let depth = 0, start = -1;
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === '{') { if (depth === 0) start = i; depth++; }
    else if (cleaned[i] === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        try {
          const parsed = JSON.parse(cleaned.substring(start, i + 1));
          const validated = validateAIStructure(parsed);
          result.choices[0].message.content = JSON.stringify(validated);
          console.log('✅ JSON cleaned: brace extraction OK');
          return result;
        } catch (_) { start = -1; }
      }
    }
  }

  // Strategy 3: regex + fix common JSON issues
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    let fixed = jsonMatch[0]
      .replace(/,\s*}/g, '}')             // trailing commas in objects
      .replace(/,\s*]/g, ']')             // trailing commas in arrays
      .replace(/(["'])\s*\n\s*/g, '$1')    // broken strings
      .replace(/[\r\n]+/g, ' ');           // actual newlines (not escaped \\n)
    try {
      const parsed = JSON.parse(fixed);
      const validated = validateAIStructure(parsed);
      result.choices[0].message.content = JSON.stringify(validated);
      console.log('✅ JSON cleaned: regex fix OK');
      return result;
    } catch (_) {}
  }

  // Strategy 4: aggressive cleanup — remove all newlines, fix quotes
  try {
    let aggressive = cleaned
      .replace(/[\r\n]/g, ' ')
      .replace(/\s+/g, ' ');
    const braceStart = aggressive.indexOf('{');
    const braceEnd = aggressive.lastIndexOf('}');
    if (braceStart !== -1 && braceEnd > braceStart) {
      let chunk = aggressive.substring(braceStart, braceEnd + 1);
      const parsed = JSON.parse(chunk);
      const validated = validateAIStructure(parsed);
      result.choices[0].message.content = JSON.stringify(validated);
      console.log('✅ JSON cleaned: aggressive cleanup OK');
      return result;
    }
  } catch (_) {}

  console.warn('⚠️ Could not clean AI response JSON, returning raw');
  console.warn('Raw content (first 500 chars):', rawText.slice(0, 500));
  return result;
}

function validateAIStructure(data) {
  if (!data || typeof data !== 'object') return data;
  return {
    score: Math.max(1, Math.min(100, parseInt(data.score) || 50)),
    score_label: data.score_label || 'Середній',
    summary: data.summary || '',
    problems: Array.isArray(data.problems) ? data.problems.slice(0, 5).map(p => ({
      title: p.title || '',
      description: p.description || '',
      fix: p.fix || ''
    })) : [],
    content_plan: Array.isArray(data.content_plan) ? data.content_plan.map(item => ({
      day: item.day || '',
      format: item.format || '',
      idea: item.idea || '',
      hook: item.hook || '',
      caption: item.caption || ''
    })) : [],
    action_plan: Array.isArray(data.action_plan) ? data.action_plan.slice(0, 5) : [],
    hashtags: Array.isArray(data.hashtags) ? data.hashtags.slice(0, 15) : [],
    cta: data.cta || ''
  };
}

async function callGeminiWithModel(model, messages, apiKey) {
  const contents = [];
  const systemInstruction = messages.find(m => m.role === 'system');
  for (const msg of messages.filter(m => m.role !== 'system')) {
    const parts = [];
    if (typeof msg.content === 'string') {
      parts.push({ text: msg.content });
    } else if (Array.isArray(msg.content)) {
      for (const c of msg.content) {
        if (c.type === 'text') parts.push({ text: c.text });
        else if (c.type === 'image_url') {
          const base64 = c.image_url.url.replace(/^data:image\/\w+;base64,/, '');
          const mimeMatch = c.image_url.url.match(/^data:(image\/\w+);/);
          parts.push({ inline_data: { mime_type: mimeMatch ? mimeMatch[1] : 'image/jpeg', data: base64 } });
        }
      }
    }
    contents.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts });
  }

  const payload = {
    contents,
    generationConfig: { temperature: 0.7, maxOutputTokens: 3000, responseMimeType: 'application/json' }
  };
  if (systemInstruction) {
    payload.system_instruction = { parts: [{ text: systemInstruction.content }] };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 50000); // 50s timeout
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const classified = classifyGeminiError(res.status, errBody);
    const err = new Error(classified.detail || classified.msg);
    err.classified = classified;
    throw err;
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!text) {
    const err = new Error('Gemini: пуста відповідь');
    err.classified = { ...ERROR_CODES.API_ERROR, detail: 'Empty response' };
    throw err;
  }
  return { choices: [{ message: { content: text } }] };
}

async function callGemini(messages, apiKeys) {
  const keys = Array.isArray(apiKeys) ? apiKeys : [apiKeys];
  const attemptLog = [];

  for (let keyIdx = 0; keyIdx < keys.length; keyIdx++) {
    const key = keys[keyIdx];
    const keyLabel = `key${keyIdx + 1}(…${key.slice(-4)})`;

    for (const model of GEMINI_MODELS) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const label = `${keyLabel}/${model}/try${attempt + 1}`;
        try {
          console.log(`🔄 Gemini ${label}...`);
          const result = await callGeminiWithModel(model, messages, key);
          console.log(`✅ Gemini ${label} — success`);
          return result;
        } catch (err) {
          const classified = err.classified || ERROR_CODES.API_ERROR;
          attemptLog.push({ attempt: label, code: classified.code, detail: err.message?.slice(0, 150) });
          console.warn(`❌ Gemini ${label}: [${classified.code}] ${err.message?.slice(0, 150)}`);
          if (classified.code === 'QUOTA') break;
          if (classified.code === 'OVERLOADED' && attempt === 0) { await delay(3000); continue; }
          break;
        }
      }
    }
  }

  console.error('💀 ALL GEMINI KEYS FAILED:', JSON.stringify(attemptLog));
  const allQuota = attemptLog.every(a => a.code === 'QUOTA');
  const allOverloaded = attemptLog.every(a => a.code === 'OVERLOADED');
  const error = new Error(allQuota ? 'Gemini: всі ключі вичерпали квоту' : allOverloaded ? 'Gemini: сервер перевантажений' : `Gemini: ${attemptLog.at(-1)?.detail || 'невідома помилка'}`);
  error.attemptLog = attemptLog;
  error.geminiCode = allQuota ? 'QUOTA' : allOverloaded ? 'OVERLOADED' : 'API_ERROR';
  throw error;
}

// ═══════════════════════════════════════════
// OPENAI API (PAID — Fallback only)
// ═══════════════════════════════════════════
async function callOpenAI(messages, apiKey) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 50000); // 50s timeout
  let res;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        response_format: { type: 'json_object' },
        temperature: 0.7,
        max_tokens: 3000
      }),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const msg = errBody?.error?.message || `HTTP ${res.status}`;
    const err = new Error(`OpenAI: ${msg}`);
    err.code = 'API_ERROR';
    throw err;
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';
  if (!content) throw new Error('OpenAI: пуста відповідь');
  return { choices: [{ message: { content } }] };
}

// ═══════════════════════════════════════════
// MAIN HANDLER
// Strategy: Gemini (free) → OpenAI (paid fallback, budget-limited)
// ═══════════════════════════════════════════
export default async function handler(req, res) {
  const startTime = Date.now();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed', code: 'METHOD_NOT_ALLOWED' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  console.log(`📥 Request from ${ip}`);

  const rlError = rateLimit(ip);
  if (rlError) {
    console.warn(`🚫 Rate limited: ${ip}`);
    return res.status(rlError.status).json({ error: rlError.msg, code: rlError.code });
  }

  const vError = validate(req.body);
  if (vError) {
    return res.status(vError.status).json({ error: vError.msg, code: vError.code });
  }

  // Collect keys
  const geminiKeys = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3
  ].filter(Boolean);
  const openaiKey = process.env.OPENAI_API_KEY;

  console.log(`🔑 Keys: Gemini=${geminiKeys.length}, OpenAI=${openaiKey ? 'yes' : 'no'}`);

  if (geminiKeys.length === 0 && !openaiKey) {
    return res.status(500).json({ error: ERROR_CODES.NO_KEYS.msg, code: 'NO_KEYS' });
  }

  const { messages } = req.body;
  let geminiError = null;

  // ── STEP 1: Try Gemini (FREE) ──
  if (geminiKeys.length > 0) {
    try {
      const result = await callGemini(messages, geminiKeys);
      const dur = Date.now() - startTime;
      console.log(`✅ Gemini OK in ${dur}ms (FREE, $0 spent)`);
      return res.status(200).json({ ...cleanAIResponse(result), _provider: 'gemini' });
    } catch (err) {
      geminiError = err;
      console.warn(`⚠️ Gemini cascade failed: [${err.geminiCode}] ${err.message?.slice(0, 200)}`);
    }
  }

  // ── STEP 2: OpenAI (PAID — fallback or forced by user) ──
  if (openaiKey) {
    // Check daily budget
    if (!canUseOpenAI()) {
      console.warn(`💰 OpenAI daily budget exhausted (${openaiUsage.count}/${OPENAI_DAILY_MAX})`);
      return res.status(429).json({
        error: ERROR_CODES.OPENAI_BUDGET.msg,
        code: 'OPENAI_BUDGET',
        detail: `Використано ${openaiUsage.count}/${OPENAI_DAILY_MAX} платних запитів сьогодні`
      });
    }

    try {
      console.log(`🔄 Falling back to OpenAI (paid)...`);
      const result = await callOpenAI(messages, openaiKey);
      trackOpenAIUsage(); // Count only on success — don't waste budget on failed requests
      const dur = Date.now() - startTime;
      console.log(`✅ OpenAI OK in ${dur}ms (fallback, usage: ${openaiUsage.count}/${OPENAI_DAILY_MAX})`);
      return res.status(200).json({ ...cleanAIResponse(result), _provider: 'openai' });
    } catch (err) {
      const dur = Date.now() - startTime;
      console.error(`❌ OpenAI also failed after ${dur}ms: ${err.message}`);
      return res.status(503).json({
        error: `${ERROR_CODES.ALL_FAILED.msg}\n\n📊 Gemini: ${geminiError?.message?.slice(0, 100) || '—'}\n📊 OpenAI: ${err.message?.slice(0, 100)}`,
        code: 'ALL_FAILED',
        duration: `${dur}ms`
      });
    }
  }

  // No OpenAI key configured — return Gemini error
  const dur = Date.now() - startTime;
  return res.status(503).json({
    error: `${geminiError?.message || ERROR_CODES.ALL_FAILED.msg}`,
    code: geminiError?.geminiCode || 'ALL_FAILED',
    duration: `${dur}ms`,
    keys_tried: geminiKeys.length,
    has_openai: false
  });
}
