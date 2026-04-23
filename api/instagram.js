export const config = { maxDuration: 25 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { username } = req.body || {};
  if (!username || typeof username !== 'string') return res.status(400).json({ error: 'Вкажи нік' });

  const clean = username.replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/$/, '').trim();
  if (!clean || clean.length > 60) return res.status(400).json({ error: 'Невірний нік' });

  const igUrl = `https://www.instagram.com/${clean}/`;

  // ─── 1. Fetch HTML via CORS proxies ───
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

  if (!html) {
    return res.status(200).json({
      ok: true,
      data: null,
      screenshot: null,
      reason: 'profile_not_found'
    });
  }

  // ─── 2. Parse OG meta ───
  const getMeta = (prop) => {
    const r1 = new RegExp(`<meta[^>]*(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, 'i');
    const r2 = new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, 'i');
    const m = html.match(r1) || html.match(r2);
    return m ? m[1] : null;
  };

  const ogDesc = getMeta('og:description') || '';
  const ogTitle = getMeta('og:title') || '';
  const ogImage = getMeta('og:image') || '';

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
    externalUrl: null,
    profilePicUrl: ogImage || null
  };

  const extMatch = html.match(/"external_url":"(https?:[^"]+)"/);
  if (extMatch) data.externalUrl = extMatch[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');

  const hasData = data.followers || data.bio || data.displayName;

  if (!hasData) {
    return res.status(200).json({
      ok: true,
      data: null,
      screenshot: null,
      reason: 'profile_not_found'
    });
  }

  // ─── 3. Capture screenshot for AI visual analysis ───
  let screenshot = null;

  // Strategy A: Full page screenshot via thum.io (free, no API key)
  const screenshotServices = [
    `https://image.thum.io/get/width/1080/crop/1920/noanimate/${igUrl}`,
    `https://image.thum.io/get/width/1080/noanimate/${igUrl}`
  ];

  for (const ssUrl of screenshotServices) {
    if (screenshot) break;
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 12000);
      const imgRes = await fetch(ssUrl, { signal: controller.signal });
      clearTimeout(tid);

      if (imgRes.ok) {
        const ct = imgRes.headers.get('content-type') || '';
        if (ct.startsWith('image/')) {
          const buf = Buffer.from(await imgRes.arrayBuffer());
          // Skip if too small (error/redirect page) or too large
          if (buf.length > 10000 && buf.length < 4 * 1024 * 1024) {
            screenshot = `data:${ct.split(';')[0]};base64,${buf.toString('base64')}`;
          }
        }
      }
    } catch (_) {}
  }

  // Strategy B: If no full screenshot, try fetching profile picture from og:image
  if (!screenshot && ogImage) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 6000);
      const imgRes = await fetch(ogImage, { signal: controller.signal });
      clearTimeout(tid);

      if (imgRes.ok) {
        const ct = imgRes.headers.get('content-type') || 'image/jpeg';
        if (ct.startsWith('image/')) {
          const buf = Buffer.from(await imgRes.arrayBuffer());
          if (buf.length > 1000 && buf.length < 3 * 1024 * 1024) {
            screenshot = `data:${ct.split(';')[0]};base64,${buf.toString('base64')}`;
            data._screenshotType = 'profile_pic_only';
          }
        }
      }
    } catch (_) {}
  }

  return res.status(200).json({
    ok: true,
    data,
    screenshot,
    reason: null
  });
}
