export const config = { maxDuration: 60 };

// ═══════════════════════════════════════════
// ERROR CODES
// ═══════════════════════════════════════════
const ERROR_CODES = {
  NO_KEYS:       { code: 'NO_KEYS',       status: 500, msg: '❌ API ключ OpenAI не налаштований' },
  RATE_LIMIT:    { code: 'RATE_LIMIT',    status: 429, msg: '⏳ Забагато запитів — зачекай хвилину' },
  DAILY_LIMIT:   { code: 'DAILY_LIMIT',   status: 429, msg: '📅 Денний ліміт вичерпано — спробуй завтра' },
  INVALID_REQ:   { code: 'INVALID_REQ',   status: 400, msg: '⚠️ Невалідний запит' },
  TOO_MANY_MSG:  { code: 'TOO_MANY_MSG',  status: 400, msg: '⚠️ Занадто багато повідомлень' },
  REQ_TOO_BIG:   { code: 'REQ_TOO_BIG',   status: 400, msg: '⚠️ Запит занадто великий (макс. 10 МБ)' },
  API_ERROR:     { code: 'API_ERROR',     status: 502, msg: '💥 Помилка API. Спробуй ще раз' },
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
  if (entry.count > 5) return ERROR_CODES.RATE_LIMIT; // Relaxed rate limit slightly
  if (entry.daily > 50) return ERROR_CODES.DAILY_LIMIT; // Relaxed daily limit
  return null;
}

// ═══════════════════════════════════════════
// VALIDATOR
// ═══════════════════════════════════════════
function validate(body) {
  if (!body || !body.messages || !Array.isArray(body.messages)) return ERROR_CODES.INVALID_REQ;
  if (body.messages.length > 5) return ERROR_CODES.TOO_MANY_MSG;
  const totalSize = JSON.stringify(body.messages).length;
  if (totalSize > 10 * 1024 * 1024) return ERROR_CODES.REQ_TOO_BIG; // Up to 10MB for OpenAI
  return null;
}

// ═══════════════════════════════════════════
// OPENAI API
// ═══════════════════════════════════════════
async function callOpenAI(messages, apiKey) {
  // Our frontend already outputs messages in exactly the format OpenAI expects
  // [{role: 'user', content: [{type: 'text', text: '...'}, {type: 'image_url', image_url: {url: 'data:image...'}}]}]
  
  const payload = {
    model: 'gpt-4o-mini',
    messages: messages,
    response_format: { type: 'json_object' },
    temperature: 0.7,
    max_tokens: 3000
  };

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const msg = errBody?.error?.message || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.code = 'API_ERROR';
    err.detail = msg;
    throw err;
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';
  
  if (!content) {
    const err = new Error('Пуста відповідь від OpenAI');
    err.code = 'API_ERROR';
    err.detail = 'Empty choices array';
    throw err;
  }

  return { choices: [{ message: { content } }] };
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

  const openaiKey = process.env.OPENAI_API_KEY;

  if (!openaiKey) {
    console.error('💀 NO API KEYS CONFIGURED');
    return res.status(500).json({ 
      error: ERROR_CODES.NO_KEYS.msg, 
      code: ERROR_CODES.NO_KEYS.code 
    });
  }

  const { messages } = req.body;

  try {
    console.log(`🔄 Sending request to OpenAI (gpt-4o-mini)...`);
    const result = await callOpenAI(messages, openaiKey);
    const duration = Date.now() - startTime;
    console.log(`✅ OpenAI success in ${duration}ms`);
    return res.status(200).json(result);
  } catch (err) {
    const duration = Date.now() - startTime;
    console.error(`❌ OpenAI failed after ${duration}ms: ${err.message}`);
    
    return res.status(502).json({
      error: ERROR_CODES.API_ERROR.msg,
      code: err.code || 'API_ERROR',
      detail: err.detail || err.message,
      duration: `${duration}ms`
    });
  }
}
