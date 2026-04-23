export const config = { maxDuration: 60 };

const ipRequests = new Map();

function rateLimit(ip) {
  const now = Date.now();
  const entry = ipRequests.get(ip) || { count: 0, resetAt: now + 60000, daily: 0, dayReset: now + 86400000 };
  if (now > entry.dayReset) { entry.daily = 0; entry.dayReset = now + 86400000; }
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 60000; }
  entry.count++;
  entry.daily++;
  ipRequests.set(ip, entry);
  if (entry.count > 3) return 'Забагато запитів — зачекай хвилину';
  if (entry.daily > 15) return 'Денний ліміт вичерпано — спробуй завтра';
  return null;
}

function validate(body) {
  if (!body || !body.messages || !Array.isArray(body.messages)) return 'Невалідний запит';
  if (body.messages.length > 5) return 'Занадто багато повідомлень';
  const totalSize = JSON.stringify(body.messages).length;
  if (totalSize > 5 * 1024 * 1024) return 'Запит занадто великий';
  return null;
}

const GEMINI_MODELS = ['gemini-2.5-flash'];

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

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
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Gemini ${res.status}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return { choices: [{ message: { content: text } }] };
}

async function callGemini(messages, apiKeys) {
  const keys = Array.isArray(apiKeys) ? apiKeys : [apiKeys];
  let lastErrorMsg = '';
  // Try each key × each model
  for (const key of keys) {
    for (const model of GEMINI_MODELS) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          console.log(`Trying ${model} key=${key.slice(-6)} (attempt ${attempt + 1})...`);
          return await callGeminiWithModel(model, messages, key);
        } catch (err) {
          console.warn(`${model} key=${key.slice(-6)} attempt ${attempt + 1} failed:`, err.message);
          lastErrorMsg = err.message;
          // If quota exceeded, skip to next key immediately
          if (err.message.includes('quota') || err.message.includes('Quota')) { break; }
          // If overloaded, wait and retry once
          if (attempt === 0 && err.message.includes('high demand')) {
            await delay(3000);
            continue;
          }
          break;
        }
      }
    }
  }
  throw new Error(`Всі моделі Gemini недоступні. Останная помилка: ${lastErrorMsg}`);
}

async function callGroq(messages, apiKey) {
  // Remove image data for text-only Groq
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
    throw new Error(err.error?.message || `Groq ${res.status}`);
  }
  return await res.json();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const rlError = rateLimit(ip);
  if (rlError) return res.status(429).json({ error: rlError });

  const vError = validate(req.body);
  if (vError) return res.status(400).json({ error: vError });

  // Collect all available Gemini keys (rotation across accounts)
  const geminiKeys = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3
  ].filter(Boolean);
  const groqKey = process.env.GROQ_API_KEY;

  if (geminiKeys.length === 0 && !groqKey) return res.status(500).json({ error: 'API ключі не налаштовані' });

  const { messages } = req.body;

  // Try Gemini first, fallback to Groq
  let lastError = 'AI сервіси тимчасово недоступні';

  if (geminiKeys.length > 0) {
    try {
      const result = await callGemini(messages, geminiKeys);
      return res.status(200).json(result);
    } catch (err) {
      console.warn('All Gemini keys failed:', err.message);
      lastError = err.message;
    }
  }

  if (groqKey) {
    try {
      const result = await callGroq(messages, groqKey);
      return res.status(200).json(result);
    } catch (err) {
      console.error('Groq failed:', err.message);
      lastError = `Groq: ${err.message}`;
    }
  }

  return res.status(503).json({ error: lastError });
}
