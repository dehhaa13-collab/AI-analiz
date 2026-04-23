export const config = { maxDuration: 60 };

// ═══════════════════════════════════════════
// ERROR CODES — for clear diagnosis
// ═══════════════════════════════════════════
const ERROR_CODES = {
  NO_KEYS:       { code: 'NO_KEYS',       status: 500, msg: '❌ API ключі не налаштовані на сервері' },
  RATE_LIMIT:    { code: 'RATE_LIMIT',    status: 429, msg: '⏳ Забагато запитів — зачекай хвилину' },
  DAILY_LIMIT:   { code: 'DAILY_LIMIT',   status: 429, msg: '📅 Денний ліміт вичерпано — спробуй завтра' },
  INVALID_REQ:   { code: 'INVALID_REQ',   status: 400, msg: '⚠️ Невалідний запит' },
  TOO_MANY_MSG:  { code: 'TOO_MANY_MSG',  status: 400, msg: '⚠️ Занадто багато повідомлень' },
  REQ_TOO_BIG:   { code: 'REQ_TOO_BIG',   status: 400, msg: '⚠️ Запит занадто великий (макс. 5 МБ)' },
  QUOTA:         { code: 'QUOTA',         status: 429, msg: '🔑 Вичерпано квоту API. Спробуй через хвилину' },
  OVERLOADED:    { code: 'OVERLOADED',    status: 503, msg: '🔥 Сервер AI перевантажений. Спробуй через 30 сек' },
  API_ERROR:     { code: 'API_ERROR',     status: 502, msg: '💥 Помилка API. Спробуй ще раз' },
  ALL_FAILED:    { code: 'ALL_FAILED',    status: 503, msg: '😔 Всі AI сервіси тимчасово недоступні' },
};

// ═══════════════════════════════════════════
// RATE LIMITER
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
  if (entry.count > 3) return ERROR_CODES.RATE_LIMIT;
  if (entry.daily > 15) return ERROR_CODES.DAILY_LIMIT;
  return null;
}

// ═══════════════════════════════════════════
// VALIDATOR
// ═══════════════════════════════════════════
function validate(body) {
  if (!body || !body.messages || !Array.isArray(body.messages)) return ERROR_CODES.INVALID_REQ;
  if (body.messages.length > 5) return ERROR_CODES.TOO_MANY_MSG;
  const totalSize = JSON.stringify(body.messages).length;
  if (totalSize > 5 * 1024 * 1024) return ERROR_CODES.REQ_TOO_BIG;
  return null;
}

// ═══════════════════════════════════════════
// GEMINI API
// ═══════════════════════════════════════════
const GEMINI_MODELS = ['gemini-2.5-flash'];

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// Classify API error into our error code
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
    return { ...ERROR_CODES.API_ERROR, detail: `Forbidden: API ключ заблокований або невалідний` };
  }
  return { ...ERROR_CODES.API_ERROR, detail: `HTTP ${statusCode}: ${msg.slice(0, 200)}` };
}

async function callGeminiWithModel(model, messages, apiKey) {
  // Convert messages to Gemini format
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
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

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
    const err = new Error('Gemini повернув пусту відповідь');
    err.classified = { ...ERROR_CODES.API_ERROR, detail: 'Empty response from model' };
    throw err;
  }

  return { choices: [{ message: { content: text } }] };
}

async function callGemini(messages, apiKeys) {
  const keys = Array.isArray(apiKeys) ? apiKeys : [apiKeys];
  
  // Detailed attempt log
  const attemptLog = [];
  
  for (let keyIdx = 0; keyIdx < keys.length; keyIdx++) {
    const key = keys[keyIdx];
    const keyLabel = `key${keyIdx + 1}(…${key.slice(-4)})`;
    
    for (const model of GEMINI_MODELS) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const attemptLabel = `${keyLabel}/${model}/attempt${attempt + 1}`;
        try {
          console.log(`🔄 Trying ${attemptLabel}...`);
          const result = await callGeminiWithModel(model, messages, key);
          console.log(`✅ Success: ${attemptLabel}`);
          return result;
        } catch (err) {
          const classified = err.classified || ERROR_CODES.API_ERROR;
          const logEntry = {
            attempt: attemptLabel,
            code: classified.code,
            detail: err.message?.slice(0, 150)
          };
          attemptLog.push(logEntry);
          console.warn(`❌ ${attemptLabel}: [${classified.code}] ${err.message?.slice(0, 150)}`);
          
          // QUOTA → skip to next key (this key's account is exhausted)
          if (classified.code === 'QUOTA') break;
          
          // OVERLOADED → wait 3s and retry once
          if (classified.code === 'OVERLOADED' && attempt === 0) {
            console.log(`⏳ ${attemptLabel}: waiting 3s before retry...`);
            await delay(3000);
            continue;
          }
          
          // Any other error → skip this model
          break;
        }
      }
    }
  }
  
  // All attempts failed — build detailed error
  console.error('💀 ALL GEMINI ATTEMPTS FAILED:', JSON.stringify(attemptLog, null, 2));
  
  // Pick the most informative error to show user
  const lastAttempt = attemptLog[attemptLog.length - 1];
  const allQuota = attemptLog.every(a => a.code === 'QUOTA');
  const allOverloaded = attemptLog.every(a => a.code === 'OVERLOADED');
  
  let userError;
  if (allQuota) {
    userError = `${ERROR_CODES.QUOTA.msg}\n\n📊 Деталі: всі ${keys.length} ключі вичерпали квоту`;
  } else if (allOverloaded) {
    userError = `${ERROR_CODES.OVERLOADED.msg}\n\n📊 Деталі: сервер Google перевантажений`;
  } else {
    userError = `${ERROR_CODES.ALL_FAILED.msg}\n\n📊 Деталі: ${lastAttempt?.detail || 'невідома помилка'}`;
  }
  
  const error = new Error(userError);
  error.attemptLog = attemptLog;
  error.code = allQuota ? 'QUOTA' : allOverloaded ? 'OVERLOADED' : 'ALL_FAILED';
  throw error;
}

// ═══════════════════════════════════════════
// GROQ FALLBACK
// ═══════════════════════════════════════════
async function callGroq(messages, apiKey) {
  const cleanMessages = messages.map(m => {
    if (typeof m.content === 'string') return m;
    if (Array.isArray(m.content)) {
      const textParts = m.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
      return { ...m, content: textParts || 'Проаналізуй профіль на основі анкети вище.' };
    }
    return m;
  });

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: cleanMessages,
      max_tokens: 3000,
      temperature: 0.7
    })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Groq ${res.status}: ${err.error?.message || 'unknown'}`);
  }
  return await res.json();
}

// ═══════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════
export default async function handler(req, res) {
  const startTime = Date.now();
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed', code: 'METHOD_NOT_ALLOWED' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  console.log(`📥 New request from ${ip}`);
  
  // Rate limit
  const rlError = rateLimit(ip);
  if (rlError) {
    console.warn(`🚫 Rate limited: ${ip} → ${rlError.code}`);
    return res.status(rlError.status).json({ 
      error: rlError.msg, 
      code: rlError.code 
    });
  }

  // Validate
  const vError = validate(req.body);
  if (vError) {
    return res.status(vError.status).json({ 
      error: vError.msg, 
      code: vError.code 
    });
  }

  // Collect API keys
  const geminiKeys = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3
  ].filter(Boolean);
  const groqKey = process.env.GROQ_API_KEY;

  console.log(`🔑 Available keys: Gemini=${geminiKeys.length}, Groq=${groqKey ? 1 : 0}`);

  if (geminiKeys.length === 0 && !groqKey) {
    console.error('💀 NO API KEYS CONFIGURED');
    return res.status(500).json({ 
      error: ERROR_CODES.NO_KEYS.msg, 
      code: ERROR_CODES.NO_KEYS.code 
    });
  }

  const { messages } = req.body;
  let lastError = null;

  // Try Gemini (primary)
  if (geminiKeys.length > 0) {
    try {
      const result = await callGemini(messages, geminiKeys);
      const duration = Date.now() - startTime;
      console.log(`✅ Gemini success in ${duration}ms`);
      return res.status(200).json(result);
    } catch (err) {
      console.warn(`⚠️ All Gemini failed: [${err.code}] ${err.message?.slice(0, 200)}`);
      lastError = err;
    }
  }

  // Try Groq (fallback)
  if (groqKey) {
    try {
      console.log('🔄 Falling back to Groq...');
      const result = await callGroq(messages, groqKey);
      const duration = Date.now() - startTime;
      console.log(`✅ Groq success in ${duration}ms`);
      return res.status(200).json(result);
    } catch (err) {
      console.error(`❌ Groq also failed: ${err.message}`);
      lastError = err;
    }
  }

  // Everything failed
  const duration = Date.now() - startTime;
  console.error(`💀 ALL PROVIDERS FAILED after ${duration}ms`);
  
  const errorResponse = {
    error: lastError?.message || ERROR_CODES.ALL_FAILED.msg,
    code: lastError?.code || 'ALL_FAILED',
    duration: `${duration}ms`,
    keys_tried: geminiKeys.length,
    has_groq: !!groqKey
  };
  
  // Don't leak attempt details to client in production, just log them
  if (lastError?.attemptLog) {
    console.error('📋 Attempt log:', JSON.stringify(lastError.attemptLog));
  }
  
  return res.status(503).json(errorResponse);
}
