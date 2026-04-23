import fetch from 'node-fetch';
const res = await fetch('https://ai-analiz-navy.vercel.app/api/analyze', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    messages: [
      { role: 'user', content: 'Say OK' }
    ]
  })
});
const text = await res.text();
console.log('Status:', res.status);
console.log('Response:', text);
