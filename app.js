/* ==========================================================
   Bless Academy — AI Instagram Analyzer
   Client-side logic
   ========================================================== */

(function () {
  'use strict';

  // ── State ──
  const state = {
    currentScreen: 'screen-quiz',
    answers: {},
    imageBase64: null,
    username: '',
    inputMode: 'screenshot',
    aiResult: null,
    profileData: null,
    formStartTime: Date.now(),
    utm: {}
  };

  // ── DOM refs ──
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  const els = {
    quizForm: $('#quiz-form'),
    btnNext: $('#btn-next'),
    btnAnalyze: $('#btn-analyze'),
    btnBackQuiz: $('#btn-back-quiz'),
    uploadZone: $('#upload-zone'),
    fileInput: $('#file-input'),
    uploadPreview: $('#upload-preview'),
    uploadPlaceholder: $('#upload-placeholder'),
    changeImage: $('#change-image'),
    igUsername: $('#ig-username'),
    errorMessage: $('#error-message'),
    errorText: $('#error-text'),
    btnRetry: $('#btn-retry'),
    resultsContainer: $('#results-container'),
    progressFill: $('#progress-fill'),
    callbackModal: $('#callback-modal'),
    modalBackdrop: $('#modal-backdrop'),
    modalClose: $('#modal-close'),
    callbackForm: $('#callback-form'),
    callbackSuccess: $('#callback-success'),
    ctaCallback: $('#cta-callback'),
    leadIg: $('#lead-ig'),
    btnSubmitLead: $('#btn-submit-lead')
  };

  // ── UTM tracking ──
  function captureUTM() {
    const p = new URLSearchParams(window.location.search);
    state.utm = {
      utm_source: p.get('utm_source') || 'direct',
      utm_medium: p.get('utm_medium') || '',
      utm_campaign: p.get('utm_campaign') || '',
      utm_content: p.get('utm_content') || ''
    };
  }

  // ── Screen transitions ──
  function showScreen(id) {
    const prev = $(`.screen.active`);
    if (prev) {
      prev.classList.remove('visible');
      setTimeout(() => prev.classList.remove('active'), 400);
    }
    setTimeout(() => {
      const next = $(`#${id}`);
      next.classList.add('active');
      window.scrollTo({ top: 0, behavior: 'instant' });
      requestAnimationFrame(() => {
        requestAnimationFrame(() => next.classList.add('visible'));
      });
      state.currentScreen = id;
      updateProgress(id);
    }, prev ? 350 : 0);
  }

  function updateProgress(screenId) {
    const map = { 'screen-quiz': 33, 'screen-upload': 66, 'screen-loading': 80, 'screen-results': 100 };
    els.progressFill.style.width = (map[screenId] || 33) + '%';
    $$('.progress-bar__step').forEach((s) => {
      s.classList.remove('active', 'done');
    });
    const steps = $$('.progress-bar__step');
    if (screenId === 'screen-quiz') { steps[0].classList.add('active'); }
    else if (screenId === 'screen-upload') { steps[0].classList.add('done'); steps[1].classList.add('active'); }
    else { steps[0].classList.add('done'); steps[1].classList.add('done'); steps[2].classList.add('active'); }
  }

  // ── Radio cards ──
  function initRadioCards() {
    $$('.radio-card').forEach((card) => {
      card.addEventListener('click', () => {
        const input = card.querySelector('input[type=radio]');
        if (!input) return;
        const name = input.name;
        $$(`.radio-card input[name="${name}"]`).forEach((r) => r.closest('.radio-card').classList.remove('selected'));
        card.classList.add('selected');
        input.checked = true;
        state.answers[name] = input.value;
        checkQuizValid();
      });
    });
  }

  function checkQuizValid() {
    const needed = ['q0', 'q1', 'q2', 'q3'];
    const valid = needed.every((n) => state.answers[n]);
    els.btnNext.disabled = !valid;
  }

  // ── Tabs ──
  function initTabs() {
    $$('.tabs__btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('.tabs__btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        state.inputMode = tab;
        $('#panel-screenshot').classList.toggle('hidden', tab !== 'screenshot');
        $('#panel-username').classList.toggle('hidden', tab !== 'username');
        checkUploadValid();
      });
    });
  }

  function checkUploadValid() {
    const valid = state.inputMode === 'screenshot' ? !!state.imageBase64 : els.igUsername.value.trim().length > 1;
    els.btnAnalyze.disabled = !valid;
  }

  // ── Image upload + compression ──
  function initUpload() {
    els.uploadZone.addEventListener('click', () => {
      if (!state.imageBase64) els.fileInput.click();
    });
    els.fileInput.addEventListener('change', (e) => {
      if (e.target.files[0]) handleFile(e.target.files[0]);
    });
    els.uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); els.uploadZone.classList.add('drag-over'); });
    els.uploadZone.addEventListener('dragleave', () => els.uploadZone.classList.remove('drag-over'));
    els.uploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      els.uploadZone.classList.remove('drag-over');
      if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });
    els.changeImage.querySelector('button').addEventListener('click', () => {
      state.imageBase64 = null;
      els.uploadPreview.classList.add('hidden');
      els.uploadPlaceholder.classList.remove('hidden');
      els.changeImage.classList.add('hidden');
      els.uploadZone.classList.remove('has-image');
      els.fileInput.value = '';
      checkUploadValid();
    });
    els.igUsername.addEventListener('input', checkUploadValid);
  }

  async function handleFile(file) {
    if (!file.type.startsWith('image/')) return;
    if (file.size > 10 * 1024 * 1024) {
      showError('Файл занадто великий — максимум 10 МБ');
      return;
    }
    try {
      const compressed = await compressImage(file, 800, 0.75);
      state.imageBase64 = compressed;
      els.uploadPreview.src = compressed;
      els.uploadPreview.classList.remove('hidden');
      els.uploadPlaceholder.classList.add('hidden');
      els.changeImage.classList.remove('hidden');
      els.uploadZone.classList.add('has-image');
      checkUploadValid();
    } catch (err) {
      showError('Не вдалось обробити зображення');
    }
  }

  function compressImage(file, maxW, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          const scale = Math.min(1, maxW / img.width);
          c.width = img.width * scale;
          c.height = img.height * scale;
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', quality));
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // ── Error handling ──
  function showError(msg) {
    els.errorText.textContent = msg;
    els.errorMessage.classList.remove('hidden');
  }
  function hideError() { els.errorMessage.classList.add('hidden'); }

  // ── Fetch Instagram profile ──
  async function fetchProfile(username) {
    try {
      const res = await fetch('/api/instagram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
      });
      if (!res.ok) return null;
      const json = await res.json();
      return json.data || null;
    } catch (_) { return null; }
  }

  // ── System prompt ──
  function buildPrompt() {
    const a = state.answers;
    const q4 = $('#q4-text').value.trim();
    const pd = state.profileData;

    let userMsg = `Проаналізуй Instagram-профіль б'юті-майстра.\n\nАнкета:\n- Сфера: ${a.q0}\n- Мета: ${a.q1}\n- Підписники: ${a.q2}\n- Частота контенту: ${a.q3}`;
    if (q4) userMsg += `\n- Що турбує: ${q4}`;

    // Add real profile data if available
    if (pd) {
      userMsg += `\n\n📊 РЕАЛЬНІ дані профілю @${pd.username}:`;
      if (pd.displayName) userMsg += `\n- Ім'я: ${pd.displayName}`;
      if (pd.bio) userMsg += `\n- Біо: ${pd.bio}`;
      if (pd.followers) userMsg += `\n- Підписники: ${pd.followers}`;
      if (pd.following) userMsg += `\n- Підписки: ${pd.following}`;
      if (pd.posts) userMsg += `\n- Постів: ${pd.posts}`;
      if (pd.isPrivate) userMsg += `\n- ⚠️ Профіль ЗАКРИТИЙ`;
      if (pd.isVerified) userMsg += `\n- ✅ Верифікований`;
      if (pd.externalUrl) userMsg += `\n- Посилання: ${pd.externalUrl}`;
    } else if (state.inputMode === 'username' && state.username) {
      userMsg += `\n- Instagram нік: @${state.username} (дані профілю недоступні — аналізуй на основі анкети)`;
    }

    const hasRealData = !!pd;
    const systemPrompt = `Ти — провідний SMM-стратег з 10+ роками досвіду в б'юті-індустрії. Ти аналізуєш Instagram-сторінки б'юті-майстрів і створюєш конкретні контент-плани.
${hasRealData ? '\nТобі дано РЕАЛЬНІ дані профілю. Аналізуй їх уважно. Якщо профіль закритий — рекомендуй відкрити. Якщо біо порожнє — запропонуй текст. Оцінку став справедливо: мало підписників/постів = нижчий бал, багато = вищий.' : '\nСкріншот або нік без даних — зосередься на стратегії та контент-ідеях для ніші.'}

ВАЖЛИВО: відповідай ТІЛЬКИ валідним JSON, без \`\`\`json тегів, без пояснень.
ОЦІНКА SCORE: має бути ДИНАМІЧНОЮ від 10 до 99. Оцінюй справедливо!

Формат відповіді JSON:
{
  "score": число від 1 до 100,
  "score_label": "Початковий" | "Середній" | "Зростаючий" | "Професійний",
  "summary": "2-3 речення загальної оцінки профілю",
  "problems": [
    {"title": "назва проблеми", "description": "опис", "fix": "конкретне рішення"}
  ],
  "content_plan": [
    {"day": "Понеділок", "format": "Reels", "idea": "конкретна ідея відео", "hook": "перші 2 секунди - що показати", "caption": "готовий підпис до поста"},
    {"day": "Середа", "format": "Карусель", "idea": "...", "hook": "...", "caption": "..."},
    {"day": "П'ятниця", "format": "Сторіз", "idea": "...", "hook": "...", "caption": "..."}
  ],
  "action_plan": ["крок 1 — що зробити сьогодні", "крок 2 — що зробити цього тижня", "крок 3 — що зробити цього місяця"],
  "hashtags": ["#хештег1", "#хештег2", ...макс 15],
  "cta": "мотивуючий текст, чому варто працювати з професіоналом"
}

Правила:
- Максимум 3 problems
- Контент-план на тиждень — 3 конкретні ідеї з HOOK та CAPTION
- ACTION PLAN — 3 кроки (сьогодні / тиждень / місяць)
- Хештеги — релевантні для сфери "${a.q0}" в Україні
- Мова — українська
- Будь конкретним, без води`;

    const messages = [{ role: 'system', content: systemPrompt }];

    if (state.inputMode === 'screenshot' && state.imageBase64) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: userMsg + '\n\nОсь скріншот профілю для аналізу:' },
          { type: 'image_url', image_url: { url: state.imageBase64 } }
        ]
      });
    } else {
      messages.push({ role: 'user', content: userMsg });
    }
    return messages;
  }

  // ── API call ──
  async function apiAnalyze() {
    const messages = buildPrompt();
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Помилка сервера: ${res.status}`);
    }
    const data = await res.json();
    // Parse AI response
    let content = '';
    if (data.choices && data.choices[0]) {
      content = data.choices[0].message?.content || '';
    } else if (data.candidates && data.candidates[0]) {
      content = data.candidates[0].content?.parts?.[0]?.text || '';
    } else if (typeof data.text === 'string') {
      content = data.text;
    }
    // Clean and parse JSON
    content = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI не повернув валідний результат');
    return JSON.parse(jsonMatch[0]);
  }

  // ── Run analysis ──
  async function runAnalysis() {
    hideError();
    state.profileData = null;

    if (state.inputMode === 'username') {
      state.username = els.igUsername.value.trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/$/, '');
    }

    showScreen('screen-loading');

    try {
      // Fetch real Instagram data if username mode
      if (state.inputMode === 'username' && state.username) {
        state.profileData = await fetchProfile(state.username);
      }

      state.aiResult = await apiAnalyze();
      renderResults(state.aiResult);
      showScreen('screen-results');
    } catch (err) {
      showScreen('screen-upload');
      showError(err.message || 'Щось пішло не так');
    }
  }

  // ── Render results ──
  function renderResults(data) {
    const c = els.resultsContainer;
    c.innerHTML = '';

    // Score
    const score = Math.max(1, Math.min(100, data.score || 50));
    const circumference = 2 * Math.PI * 54;
    const offset = circumference - (score / 100) * circumference;
    const colorClass = score < 40 ? 'score-red' : score < 70 ? 'score-yellow' : 'score-green';
    const gradId = score < 40 ? '#ef4444' : score < 70 ? '#f59e0b' : '#22c55e';

    c.innerHTML += `
      <div class="score-wrap">
        <div class="score-ring">
          <svg viewBox="0 0 120 120">
            <circle class="score-ring-bg" cx="60" cy="60" r="54"/>
            <circle class="score-ring-fg" cx="60" cy="60" r="54"
              stroke="${gradId}" stroke-dasharray="${circumference}"
              stroke-dashoffset="${circumference}"
              style="transition-delay:.3s"/>
          </svg>
          <div class="score-value">
            <span class="score-num ${colorClass}" id="score-counter">0</span>
            <span class="score-of">/ 100</span>
          </div>
        </div>
        <span class="score-label">${esc(data.score_label || '')}</span>
      </div>`;

    // Animate score
    requestAnimationFrame(() => {
      const fg = c.querySelector('.score-ring-fg');
      if (fg) fg.style.strokeDashoffset = offset;
      animateCounter('score-counter', score, 2500);
    });

    // Summary
    if (data.summary) {
      c.innerHTML += `<div class="result-card result-block" style="animation-delay:.15s">
        <p style="font-size:.8125rem;color:#d4d4d8;line-height:1.6">${esc(data.summary)}</p>
      </div>`;
    }

    // Problems
    if (data.problems?.length) {
      let html = `<div class="result-block" style="animation-delay:.25s">
        <div class="r-heading"><div class="r-heading__icon" style="background:linear-gradient(135deg,rgba(244,114,182,.12),rgba(239,68,68,.12))">⚡</div>Зони росту</div>`;
      data.problems.forEach((p, i) => {
        html += `<div class="result-card" style="margin-bottom:8px">
          <div style="display:flex;gap:8px;margin-bottom:6px">
            <span style="background:var(--grad);-webkit-background-clip:text;-webkit-text-fill-color:transparent;font-weight:800;font-size:1rem;line-height:1.2">${String(i + 1).padStart(2, '0')}</span>
            <strong style="font-size:.8125rem">${esc(p.title)}</strong>
          </div>
          <p style="font-size:.75rem;color:var(--text-2);margin:0 0 8px 30px">${esc(p.description)}</p>
          <div style="margin-left:30px;padding:10px;border-radius:10px;background:rgba(34,197,94,.06);border:1px solid rgba(34,197,94,.12)">
            <p style="font-size:.75rem;color:#4ade80;margin:0"><strong>✅ Рішення:</strong> ${esc(p.fix)}</p>
          </div>
        </div>`;
      });
      html += '</div>';
      c.innerHTML += html;
    }

    // Content Plan
    if (data.content_plan?.length) {
      const formatEmoji = { 'Reels': '🎬', 'Карусель': '📸', 'Сторіз': '📱' };
      const formatBg = {
        'Reels': 'rgba(244,114,182,.1)', 'Карусель': 'rgba(59,130,246,.1)', 'Сторіз': 'rgba(245,158,11,.1)'
      };
      const formatBorder = {
        'Reels': 'rgba(244,114,182,.18)', 'Карусель': 'rgba(59,130,246,.18)', 'Сторіз': 'rgba(245,158,11,.18)'
      };
      let html = `<div class="result-block" style="animation-delay:.35s">
        <div class="r-heading"><div class="r-heading__icon" style="background:linear-gradient(135deg,rgba(34,197,94,.12),rgba(16,185,129,.12))">📅</div>Контент-план на тиждень</div>`;
      data.content_plan.forEach((item, i) => {
        const bg = formatBg[item.format] || formatBg['Reels'];
        const bc = formatBorder[item.format] || formatBorder['Reels'];
        html += `<div class="idea-card" style="background:${bg};border:1px solid ${bc}">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
            <span style="font-size:1rem">${formatEmoji[item.format] || '📌'}</span>
            <span style="font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-2)">${esc(item.day || '')} · ${esc(item.format)}</span>
          </div>
          <p style="font-size:.8125rem;font-weight:600;margin:0 0 4px">${esc(item.idea)}</p>
          ${item.hook ? `<p style="font-size:.7rem;color:var(--text-3);margin:0 0 6px">🎯 Hook: ${esc(item.hook)}</p>` : ''}
          ${item.caption ? `<div style="margin-top:8px;padding:10px;border-radius:10px;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.04)">
            <p style="font-size:.75rem;color:var(--text-2);margin:0;white-space:pre-wrap" id="plan-text-${i}">${esc(item.caption)}</p>
            <button type="button" class="copy-btn" style="margin-top:8px" onclick="window.__copy(${i},this)">📋 Копіювати підпис</button>
          </div>` : ''}
        </div>`;
      });
      html += '</div>';
      c.innerHTML += html;
    }

    // Action Plan
    if (data.action_plan?.length) {
      const labels = ['🔥 Сьогодні', '📅 Цей тиждень', '🎯 Цей місяць'];
      const colors = ['#f87171', '#fbbf24', '#4ade80'];
      let html = `<div class="result-block" style="animation-delay:.45s">
        <div class="r-heading"><div class="r-heading__icon" style="background:linear-gradient(135deg,rgba(34,197,94,.12),rgba(16,185,129,.12))">✅</div>План дій</div>
        <div class="result-card">`;
      data.action_plan.forEach((step, i) => {
        html += `<div style="${i > 0 ? 'margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.04)' : ''}">
          <span style="display:inline-block;font-size:.625rem;font-weight:700;padding:3px 8px;border-radius:6px;margin-bottom:6px;background:rgba(${i === 0 ? '239,68,68' : i === 1 ? '245,158,11' : '34,197,94'},.08);color:${colors[i]}">${labels[i] || '📌'}</span>
          <p style="font-size:.8125rem;color:var(--text-2);margin:0">${esc(step)}</p>
        </div>`;
      });
      html += '</div></div>';
      c.innerHTML += html;
    }

    // Hashtags
    if (data.hashtags?.length) {
      const allTags = data.hashtags.join(' ');
      let html = `<div class="result-block" style="animation-delay:.55s">
        <div class="r-heading"><div class="r-heading__icon" style="background:linear-gradient(135deg,rgba(192,132,252,.12),rgba(139,92,246,.12))">#</div>Хештеги</div>
        <div class="result-card">
          <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:12px">
            ${data.hashtags.map((t) => `<span class="hash-chip">${esc(t)}</span>`).join('')}
          </div>
          <button type="button" class="copy-btn" id="copy-hashtags">📋 Копіювати хештеги</button>
        </div>
      </div>`;
      c.innerHTML += html;
      // Bind copy
      setTimeout(() => {
        const btn = $('#copy-hashtags');
        if (btn) btn.addEventListener('click', () => copyText(allTags, btn));
      }, 100);
    }
  }

  // ── Copy utils ──
  window.__copy = function (idx, btn) {
    const el = $(`#plan-text-${idx}`);
    if (el) copyText(el.innerText, btn);
  };

  function copyText(text, btn) {
    const orig = btn.textContent;
    navigator.clipboard.writeText(text).then(() => done()).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      done();
    });
    function done() {
      btn.textContent = '✅ Скопійовано!';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 2000);
    }
  }

  function animateCounter(id, target, duration) {
    const el = $(`#${id}`);
    if (!el) return;
    const start = performance.now();
    function tick(now) {
      const t = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      el.textContent = Math.round(ease * target);
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function esc(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.appendChild(document.createTextNode(s));
    return d.innerHTML;
  }

  // ── Modal ──
  function openModal() {
    els.callbackModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    // Pre-fill Instagram
    const ig = state.username || state.answers.username || '';
    if (ig && els.leadIg) els.leadIg.value = '@' + ig.replace(/^@/, '');
  }

  function closeModal() {
    els.callbackModal.classList.add('hidden');
    document.body.style.overflow = '';
  }

  // ── Lead submission ──
  async function submitLead(e) {
    e.preventDefault();
    const btn = els.btnSubmitLead;
    btn.disabled = true;
    btn.querySelector('span').textContent = 'Надсилаю...';

    const payload = {
      name: $('#lead-name').value.trim(),
      phone: $('#lead-phone').value.trim(),
      instagram: $('#lead-ig').value.trim(),
      time: $('#lead-time').value,
      score: state.aiResult?.score || 0,
      niche: state.answers.q0 || '',
      goal: state.answers.q1 || '',
      utm: state.utm
    };

    try {
      const res = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error();
    } catch (err) {
      // Save to localStorage as backup
      try {
        const q = JSON.parse(localStorage.getItem('ba_lead_queue') || '[]');
        q.push({ ...payload, ts: new Date().toISOString() });
        localStorage.setItem('ba_lead_queue', JSON.stringify(q));
      } catch (_) {}
    }

    // Always show success
    els.callbackForm.classList.add('hidden');
    els.callbackSuccess.classList.remove('hidden');
    setTimeout(closeModal, 3000);
  }

  // ── Event bindings ──
  function init() {
    captureUTM();
    initRadioCards();
    initTabs();
    initUpload();
    checkQuizValid();

    els.btnNext.addEventListener('click', () => {
      state.answers.q4 = $('#q4-text').value.trim();
      showScreen('screen-upload');
    });

    els.btnBackQuiz.addEventListener('click', () => showScreen('screen-quiz'));
    els.btnAnalyze.addEventListener('click', runAnalysis);
    els.btnRetry.addEventListener('click', () => { hideError(); runAnalysis(); });

    // CTA
    els.ctaCallback.addEventListener('click', openModal);
    els.modalBackdrop.addEventListener('click', closeModal);
    els.modalClose.addEventListener('click', closeModal);
    els.callbackForm.addEventListener('submit', submitLead);
  }

  init();
})();
