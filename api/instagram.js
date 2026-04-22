export const config = { maxDuration: 15 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { username } = req.body || {};
  if (!username || typeof username !== 'string') return res.status(400).json({ error: 'Вкажи нік' });

  const clean = username.replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/$/, '').trim();
  if (!clean || clean.length > 60) return res.status(400).json({ error: 'Невірний нік' });

  const igUrl = `https://www.instagram.com/${clean}/`;

  const proxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(igUrl)}`,
    `https://corsproxy.io/?${encodeURIComponent(igUrl)}`
  ];

  let html = null;
  for (const proxyUrl of proxies) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 8000);
      const r = await fetch(proxyUrl, { signal: controller.signal });
      clearTimeout(tid);
      if (r.ok) {
        html = await r.text();
        if (html && html.includes('instagram')) break;
        html = null;
      }
    } catch (_) { continue; }
  }

  if (!html) return res.status(200).json({ ok: true, data: null, reason: 'no_data' });

  // Parse OG meta
  const getMeta = (prop) => {
    const r1 = new RegExp(`<meta[^>]*(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, 'i');
    const r2 = new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, 'i');
    const m = html.match(r1) || html.match(r2);
    return m ? m[1] : null;
  };

  const ogDesc = getMeta('og:description') || '';
  const ogTitle = getMeta('og:title') || '';

  const counts = ogDesc.match(/([\d,.]+[KMkm]?)\s*Followers?,?\s*([\d,.]+[KMkm]?)\s*Following,?\s*([\d,.]+[KMkm]?)\s*Posts?/i);

  let bio = '';
  const parts = ogDesc.split(' - ');
  if (parts.length > 1) bio = parts.slice(1).join(' - ').replace(/See Instagram photos and videos from.*$/i, '').trim();

  const nameMatch = ogTitle.match(/^(.+?)\s*\(@/);

  const data = {
    username: clean,
    displayName: nameMatch ? nameMatch[1].trim() : '',
    bio: bio || null,
    followers: counts ? counts[1] : null,
    following: counts ? counts[2] : null,
    posts: counts ? counts[3] : null,
    isPrivate: html.includes('"is_private":true'),
    isVerified: html.includes('"is_verified":true'),
    externalUrl: null
  };

  const extMatch = html.match(/"external_url":"(https?:[^"]+)"/);
  if (extMatch) data.externalUrl = extMatch[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');

  const hasData = data.followers || data.bio || data.displayName;

  return res.status(200).json({ ok: true, data: hasData ? data : null, reason: hasData ? null : 'no_data' });
}
