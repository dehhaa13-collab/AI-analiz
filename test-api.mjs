const fetch = require('node-fetch'); // Oh wait, in node 18+ fetch is global
async function test() {
  try {
    const res = await fetch('https://ai-analiz-navy.vercel.app/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'say ok' }] })
    });
    const text = await res.text();
    console.log('Status:', res.status);
    console.log('Body:', text);
  } catch(e) {
    console.error(e);
  }
}
test();