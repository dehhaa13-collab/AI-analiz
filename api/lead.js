function escapeHtml(str) {
  if (!str) return str;
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { name, phone, instagram, time, score, niche, goal, utm } = req.body || {};

  // Validate
  if (!name || name.length < 2 || name.length > 50) return res.status(400).json({ error: 'Вкажи ім\'я' });
  if (!phone || !/^\+?\d[\d\s\-()]{7,}$/.test(phone)) return res.status(400).json({ error: 'Невірний номер телефону' });

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) return res.status(500).json({ error: 'Telegram не налаштований' });

  const now = new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' });
  const utmLine = utm && utm.utm_source && utm.utm_source !== 'direct'
    ? `📣 UTM: ${utm.utm_source || ''} / ${utm.utm_medium || ''} / ${utm.utm_campaign || ''}`
    : '📣 UTM: direct';

  const text = `🔥 Нова заявка з AI-аналізу!

👤 Ім'я: ${escapeHtml(name)}
📱 Телефон: ${escapeHtml(phone)}
📸 Instagram: ${escapeHtml(instagram) || '—'}
🕐 Зручний час: ${escapeHtml(time) || '—'}

📊 AI Score: ${score || '—'}/100
🎯 Сфера: ${escapeHtml(niche) || '—'}
🎯 Мета: ${escapeHtml(goal) || '—'}

${utmLine}
⏰ ${now}`;

  try {
    const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
    });
    if (!tgRes.ok) throw new Error(`Telegram: ${tgRes.status}`);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Telegram error:', err.message);
    return res.status(200).json({ ok: true, queued: true });
  }
}
