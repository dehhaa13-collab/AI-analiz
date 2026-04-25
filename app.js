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
    profileScreenshot: null,
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
        // Track each quiz answer
        if (window.BA) BA.track('quiz_answer', { question: name, answer: input.value });
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
        if (window.BA) BA.track('input_tab_switch', { tab: tab });
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
      if (window.BA) BA.track('image_uploaded', { size_kb: Math.round(file.size / 1024) });
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
  function showError(msg, debugInfo) {
    // Show main error message
    els.errorText.textContent = msg;
    
    // Add debug code if available (small, gray)
    const existingDebug = els.errorMessage.querySelector('.error-debug');
    if (existingDebug) existingDebug.remove();
    if (debugInfo) {
      const debug = document.createElement('div');
      debug.className = 'error-debug';
      debug.style.cssText = 'font-size:11px;color:#999;margin-top:4px;word-break:break-all;';
      debug.textContent = `[${debugInfo.code || '?'}] ${debugInfo.detail || ''}`;
      els.errorText.after(debug);
    }
    
    els.errorMessage.classList.remove('hidden');
    // Remove old extra buttons
    const existingSwitch = els.errorMessage.querySelector('.error-toast__switch');
    if (existingSwitch) existingSwitch.remove();
    const existingOpenai = els.errorMessage.querySelector('.error-toast__openai');
    if (existingOpenai) existingOpenai.remove();

  }

  function showProfileError(username) {
    els.errorText.innerHTML = `Не вдалося знайти профіль <strong>@${esc(username)}</strong>.<br>Перевір нік або обери інший спосіб аналізу.`;
    els.errorMessage.classList.remove('hidden');

    // Remove old buttons if exists
    const existingSwitch = els.errorMessage.querySelector('.error-toast__switch');
    if (existingSwitch) existingSwitch.remove();
    const existingFallback = els.errorMessage.querySelector('.error-toast__fallback');
    if (existingFallback) existingFallback.remove();

    // Add switch-to-screenshot button
    const switchBtn = document.createElement('button');
    switchBtn.type = 'button';
    switchBtn.className = 'error-toast__retry error-toast__switch';
    switchBtn.style.marginTop = '8px';
    switchBtn.innerHTML = '📸 Завантажити скріншот замість ніку';
    switchBtn.addEventListener('click', () => {
      hideError();
      // Switch to screenshot tab
      $$('.tabs__btn').forEach(b => b.classList.remove('active'));
      const screenshotTab = $('.tabs__btn[data-tab="screenshot"]');
      if (screenshotTab) screenshotTab.classList.add('active');
      state.inputMode = 'screenshot';
      $('#panel-screenshot').classList.remove('hidden');
      $('#panel-username').classList.add('hidden');
      checkUploadValid();
    });
    els.errorMessage.appendChild(switchBtn);

    // Add fallback button — analyze without real data
    const fallbackBtn = document.createElement('button');
    fallbackBtn.type = 'button';
    fallbackBtn.className = 'error-toast__retry error-toast__fallback';
    fallbackBtn.style.cssText = 'margin-top:6px;background:linear-gradient(135deg,rgba(139,92,246,.12),rgba(168,85,247,.08));border:1px solid rgba(139,92,246,.25);color:#a78bfa;';
    fallbackBtn.innerHTML = '✨ Аналізувати без реальних даних (за анкетою)';
    fallbackBtn.addEventListener('click', () => {
      hideError();
      // Set minimal profile data so analysis proceeds
      state.profileData = { username: username, _fallback: true };
      state.profileScreenshot = null;
      runAnalysisWithData();
    });
    els.errorMessage.appendChild(fallbackBtn);
  }

  function hideError() { els.errorMessage.classList.add('hidden'); }

  // ── Fetch Instagram profile + screenshot ──
  async function fetchProfile(username) {
    try {
      const res = await fetch('/api/instagram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
      });
      if (!res.ok) return { data: null, screenshot: null, reason: 'error' };
      const json = await res.json();
      return {
        data: json.data || null,
        screenshot: json.screenshot || null,
        reason: json.reason || null
      };
    } catch (_) { return { data: null, screenshot: null, reason: 'error' }; }
  }

  // ── System prompt ──
  function buildPrompt() {
    const a = state.answers;
    const q4El = $('#q4-text');
    const q4 = q4El ? q4El.value.trim() : '';
    const pd = state.profileData;

    let userMsg = `Проаналізуй Instagram-профіль б'юті-майстра.\n\nАнкета:\n- Сфера: ${a.q0}\n- Мета: ${a.q1}\n- Підписники: ${a.q2}\n- Частота контенту: ${a.q3}`;
    if (q4) userMsg += `\n- Що турбує: ${q4}`;

    // Add real profile data (only real data — never fake/fallback)
    if (pd && !pd._fallback) {
      userMsg += `\n\n📊 РЕАЛЬНІ дані профілю @${pd.username}:`;
      if (pd.displayName) userMsg += `\n- Ім'я: ${pd.displayName}`;
      if (pd.bio) userMsg += `\n- Біо: ${pd.bio}`;
      if (pd.followers) userMsg += `\n- Підписники: ${pd.followers}`;
      if (pd.following) userMsg += `\n- Підписки: ${pd.following}`;
      if (pd.posts) userMsg += `\n- Постів: ${pd.posts}`;
      if (pd.isPrivate) userMsg += `\n- ⚠️ Профіль ЗАКРИТИЙ`;
      if (pd.isVerified) userMsg += `\n- ✅ Верифікований`;
      if (pd.externalUrl) userMsg += `\n- Посилання: ${pd.externalUrl}`;
    }

    const hasRealData = !!pd && !pd._fallback;
    const hasVisual = !!(state.imageBase64 || state.profileScreenshot);

    const systemPrompt = `Ти — провідний SMM-стратег з 10+ роками досвіду роботи з б'юті-майстрами в Україні. Ти проводиш глибокий аудит Instagram-профілів і даєш КОНКРЕТНІ, готові до дії рекомендації, які майстер може впровадити самостійно.

ТВОЯ ЗАДАЧА: провести детальний аналіз і повернути JSON з 10 секціями. Кожна секція повинна нести РЕАЛЬНУ цінність.

${hasRealData ? 'Тобі дано РЕАЛЬНІ дані профілю. Аналізуй їх уважно:\n- Якщо профіль закритий — це критична помилка для бізнесу\n- Якщо біо порожнє або неінформативне — запропонуй повний текст\n- Оцінку став СПРАВЕДЛИВО на основі реальних даних: мало підписників та постів = нижчий бал\n- Аналізуй співвідношення підписників/підписок' : 'Зосередься на стратегії та контент-ідеях для ніші, оскільки реальні дані профілю відсутні.'}

${hasVisual ? 'Тобі дано ЗОБРАЖЕННЯ (скріншот профілю). ОБОВ\'ЯЗКОВО оціни:\n- Аватар: професійність, привабливість, чи видно обличчя\n- Сітка публікацій: єдиний стиль, кольорова гама, чистота\n- Якість фото та відео: світло, композиція\n- Загальне враження: чи хочеться підписатись з першого погляду?\nВ summary та categories.visual ОБОВ\'ЯЗКОВО відобрази свою оцінку візуалу.' : ''}

ФОРМАТ ВІДПОВІДІ — тільки валідний JSON, без жодних пояснень до або після:

{
  "score": <число 10–99, справедлива оцінка>,
  "score_label": "<одне з: Початковий | Зростаючий | Середній | Професійний>",

  "categories": {
    "visual": <1–10, візуальна якість фото/відео/сітки>,
    "bio": <1–10, якість шапки профілю: ім'я, опис, CTA, контакти>,
    "content": <1–10, якість та різноманітність контенту>,
    "engagement": <1–10, робота з аудиторією: сторіз, відповіді, інтерактив>,
    "conversion": <1–10, наскільки профіль конвертує відвідувача у клієнта>
  },

  "summary": "<2–3 речення: головний висновок аудиту. Що добре, що критично. Без води>",

  "quick_wins": [
    "<Дія 1 яку можна зробити за 5 хвилин прямо зараз>",
    "<Дія 2 яку можна зробити за 5 хвилин прямо зараз>",
    "<Дія 3 яку можна зробити за 5 хвилин прямо зараз>"
  ],

  "problems": [
    {"title": "<назва>", "description": "<чому це проблема — 1 речення>", "fix": "<конкретне рішення з прикладом>"},
    {"title": "<назва>", "description": "<чому це проблема>", "fix": "<конкретне рішення>"},
    {"title": "<назва>", "description": "<чому це проблема>", "fix": "<конкретне рішення>"}
  ],

  "bio_rewrite": {
    "current_issues": "<що не так з поточною шапкою: 1–2 речення>",
    "suggested": "<ПОВНИЙ готовий текст нової шапки профілю, який можна скопіювати. Включи: спеціалізацію, локацію, УТП, CTA. Використовуй емодзі. Максимум 150 символів>"
  },

  "content_plan": [
    {"day": "Понеділок", "format": "Reels", "idea": "<конкретна ідея>", "hook": "<перші 2 сек — що показати/сказати>", "caption": "<готовий текст підпису 2–3 речення>"},
    {"day": "Середа", "format": "Карусель", "idea": "<конкретна ідея>", "hook": "<перший слайд — що написати>", "caption": "<готовий підпис>"},
    {"day": "П'ятниця", "format": "Reels", "idea": "<конкретна ідея>", "hook": "<перші 2 сек>", "caption": "<готовий підпис>"},
    {"day": "Неділя", "format": "Сторіз", "idea": "<серія з 3–5 сторіз>", "hook": "<перша сторіз — чим зачепити>", "caption": "<що написати на кожній>"}
  ],

  "action_plan": [
    "<🔥 СЬОГОДНІ: конкретна дія, яку зробити прямо зараз>",
    "<📅 ЦЕЙ ТИЖДЕНЬ: що впровадити протягом 7 днів>",
    "<🎯 ЦЕЙ МІСЯЦЬ: стратегічна ціль на 30 днів>"
  ],

  "niche_comparison": {
    "avg_score": <число 70–85: середній бал успішних профілів у цій ніші>,
    "common_mistake": "<найчастіша помилка у ніші '${a.q0}' — 1 речення>"
  },

  "growth_forecast": "<Якщо виправити всі зазначені проблеми, протягом 30 днів можна очікувати: [конкретний прогноз зростання підписників/записів]. 1–2 речення>",

  "hashtags": ["#хештег1", "#хештег2", "...максимум 15 релевантних для ${a.q0} в Україні"],

  "cta": "<мотивуючий текст 1–2 речення: чому варто працювати з професійним маркетологом>"
}

КРИТИЧНІ ПРАВИЛА:
1. Відповідай ТІЛЬКИ JSON. Жодного тексту до або після.
2. Не використовуй \`\`\`json теги.
3. Всі тексти — УКРАЇНСЬКОЮ.
4. quick_wins — ТРИ дії, які реально можна зробити за 5 хвилин (не "вивчіть конкурентів").
5. bio_rewrite.suggested — повний готовий текст, який можна вставити в профіль.
6. content_plan — 4 конкретні ідеї з ГОТОВИМИ підписами.
7. problems — максимум 3, з КОНКРЕТНИМИ рішеннями (не загальні фрази).
8. Оцінка має бути СПРАВЕДЛИВОЮ: не завищуй і не занижуй.
9. Будь прямим та конкретним. Жодної води.`;

    const messages = [{ role: 'system', content: systemPrompt }];

    // Determine which image to send (user screenshot OR server-captured screenshot)
    const imageToSend = state.imageBase64 || state.profileScreenshot;

    if (imageToSend) {
      const imageLabel = state.imageBase64
        ? '\n\nОсь скріншот профілю для аналізу:'
        : (pd?._screenshotType === 'profile_pic_only'
          ? '\n\nОсь аватарка профілю — оціни її якість та привабливість:'
          : '\n\nОсь скріншот сторінки профілю — оціни візуальну складову:');
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: userMsg + imageLabel },
          { type: 'image_url', image_url: { url: imageToSend } }
        ]
      });
    } else {
      messages.push({ role: 'user', content: userMsg });
    }
    return messages;
  }

  // ── API call ──
  async function apiAnalyze(retryCount) {
    retryCount = retryCount || 0;
    const messages = buildPrompt();

    // If retrying due to bad format, add a hint
    if (retryCount > 0) {
      messages.push({ role: 'user', content: 'УВАГА: поверни ТІЛЬКИ чистий JSON без ```json тегів, без пояснень. Починай з { і закінчуй }' });
    }

    const payload = { messages };


    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const err = new Error(errBody.error || `Помилка сервера: ${res.status}`);
      err.debugInfo = { code: errBody.code || res.status, detail: errBody.detail || errBody.duration || '' };
      throw err;
    }
    const data = await res.json();

    // Server-side cleanAIResponse() already guarantees valid JSON in content.
    // Strategy 1: If server returned data with score directly (future-proof)
    if (typeof data.score === 'number' || typeof data.summary === 'string') {
      return data;
    }

    // Strategy 2: Extract content string from choices (standard path)
    let content = '';
    if (data.choices && data.choices[0]) {
      content = data.choices[0].message?.content || '';
    } else if (data.candidates && data.candidates[0]) {
      content = data.candidates[0].content?.parts?.[0]?.text || '';
    } else if (typeof data.text === 'string') {
      content = data.text;
    }

    if (!content) {
      if (retryCount < 1) return apiAnalyze(retryCount + 1);
      const err = new Error('AI повернув порожню відповідь');
      err.debugInfo = { code: 'EMPTY_CONTENT', detail: 'No text or content array found in response' };
      throw err;
    }

    // Server already cleaned this, just parse
    try { return JSON.parse(content); } catch (_) {}

    // Light fallback: strip markdown artifacts and try again
    let cleaned = content
      .replace(/^\uFEFF/, '')
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();
    try { return JSON.parse(cleaned); } catch (_) {}

    // Last resort: extract outermost { ... }
    const braceStart = cleaned.indexOf('{');
    const braceEnd = cleaned.lastIndexOf('}');
    if (braceStart !== -1 && braceEnd > braceStart) {
      try { return JSON.parse(cleaned.substring(braceStart, braceEnd + 1)); } catch (_) {}
    }

    // Auto-retry once
    if (retryCount < 1) {
      return apiAnalyze(retryCount + 1);
    }

    const err = new Error('AI повернув некоректний формат. Спробуй ще раз');
    err.debugInfo = { code: 'PARSE_ERROR', detail: `LEN: ${content.length} | END: ${content.slice(-150).replace(/\n/g, ' ')}` };
    throw err;
  }

  // ── Loading stages animation ──
  let loadingTimers = [];
  let progressInterval = null;
  function startLoadingStages() {
    // Clear previous timers
    loadingTimers.forEach(t => clearTimeout(t));
    loadingTimers = [];
    if (progressInterval) clearInterval(progressInterval);

    const progressBar = document.getElementById('loading-progress-glow');
    const progressText = document.getElementById('loading-progress-percent');
    if (progressBar) progressBar.style.width = '0%';
    if (progressText) progressText.textContent = '0%';

    let currentProgress = 0;
    // Animate up to 96% over ~15 seconds (150ms per 1%)
    progressInterval = setInterval(() => {
      if (currentProgress < 96) {
        currentProgress += 1;
        if (progressBar) progressBar.style.width = `${currentProgress}%`;
        if (progressText) progressText.textContent = `${currentProgress}%`;
      }
    }, 150);

    const stages = document.querySelectorAll('.loading-stage');
    stages.forEach(s => { s.classList.remove('visible', 'active', 'done'); });

    stages.forEach((stage, i) => {
      const delay = parseInt(stage.dataset.delay) || 0;
      const t = setTimeout(() => {
        // Mark previous stages as done
        for (let j = 0; j < i; j++) {
          stages[j].classList.remove('active');
          stages[j].classList.add('done');
        }
        stage.classList.add('visible', 'active');
      }, delay);
      loadingTimers.push(t);
    });
  }

  function finishLoadingStages() {
    if (progressInterval) clearInterval(progressInterval);
    const progressBar = document.getElementById('loading-progress-glow');
    const progressText = document.getElementById('loading-progress-percent');
    if (progressBar) progressBar.style.width = '100%';
    if (progressText) progressText.textContent = '100%';
    
    return new Promise(resolve => setTimeout(resolve, 300));
  }

  // ── Run analysis ──
  async function runAnalysis() {
    hideError();
    state.profileData = null;
    state.profileScreenshot = null;

    if (state.inputMode === 'username') {
      state.username = els.igUsername.value.trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/$/, '');
    }

    showScreen('screen-loading');
    startLoadingStages();
    if (window.BA) BA.track('analysis_started', { input_mode: state.inputMode, niche: state.answers.q0 || '' });

    try {
      // Fetch real Instagram data + screenshot if username mode
      if (state.inputMode === 'username' && state.username) {
        const result = await fetchProfile(state.username);

        if (!result.data) {
          // No real data found → show error, don't proceed with fake analysis
          showScreen('screen-upload');
          showProfileError(state.username);
          if (window.BA) BA.track('profile_not_found', { username: state.username });
          return;
        }

        state.profileData = result.data;
        state.profileScreenshot = result.screenshot; // May be null
      }

      state.aiResult = await apiAnalyze();
      await finishLoadingStages();
      renderResults(state.aiResult);
      showScreen('screen-results');
      if (window.BA) BA.track('analysis_completed', {
        score: state.aiResult.score,
        niche: state.answers.q0,
        input_mode: state.inputMode,
        has_profile_data: !!state.profileData,
        has_screenshot: !!(state.imageBase64 || state.profileScreenshot)
      });
      // FB standard event for retargeting
      if (typeof fbq === 'function') fbq('track', 'ViewContent', {
        content_name: 'AI Analysis Result',
        content_category: state.answers.q0,
        value: state.aiResult.score
      });
    } catch (err) {
      if (progressInterval) clearInterval(progressInterval);
      showScreen('screen-upload');
      showError(err.message || 'Щось пішло не так', err.debugInfo || null);
      if (window.BA) BA.track('analysis_error', { error: err.message || 'unknown', code: err.debugInfo?.code || 'unknown', input_mode: state.inputMode });
    }
  }

  // ── Run analysis with pre-set data (fallback when profile not found) ──
  async function runAnalysisWithData() {
    showScreen('screen-loading');
    startLoadingStages();
    if (window.BA) BA.track('analysis_started', { input_mode: 'fallback', niche: state.answers.q0 || '' });

    try {
      state.aiResult = await apiAnalyze();
      await finishLoadingStages();
      renderResults(state.aiResult);
      showScreen('screen-results');
      if (window.BA) BA.track('analysis_completed', {
        score: state.aiResult.score,
        niche: state.answers.q0,
        input_mode: 'fallback',
        has_profile_data: false,
        has_screenshot: false
      });
      if (typeof fbq === 'function') fbq('track', 'ViewContent', {
        content_name: 'AI Analysis Result (Fallback)',
        content_category: state.answers.q0,
        value: state.aiResult.score
      });
    } catch (err) {
      if (progressInterval) clearInterval(progressInterval);
      showScreen('screen-upload');
      showError(err.message || 'Щось пішло не так', err.debugInfo || null);
      if (window.BA) BA.track('analysis_error', { error: err.message || 'unknown', code: err.debugInfo?.code || 'unknown', input_mode: 'fallback' });
    }
  }

  // ── Render results ──
  function renderResults(data) {
    const c = els.resultsContainer;
    c.innerHTML = '';
    let blockIdx = 0;

    // ═══ 1. Score Ring ═══
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

    // ═══ 2. Category Scores ═══
    if (data.categories) {
      const cats = data.categories;
      const catLabels = {
        visual: { label: 'Візуал', emoji: '📸', color: '#f472b6' },
        bio: { label: 'Шапка профілю', emoji: '✍️', color: '#a78bfa' },
        content: { label: 'Контент', emoji: '📝', color: '#60a5fa' },
        engagement: { label: 'Залучення', emoji: '💬', color: '#fbbf24' },
        conversion: { label: 'Конверсія в запис', emoji: '🎯', color: '#34d399' }
      };
      let html = `<div class="result-block" style="animation-delay:.12s">
        <div class="r-heading"><div class="r-heading__icon" style="background:linear-gradient(135deg,rgba(139,92,246,.12),rgba(59,130,246,.12))">📊</div>Детальна оцінка</div>
        <div class="result-card">`;
      for (const [key, meta] of Object.entries(catLabels)) {
        const val = cats[key] || 5;
        const pct = val * 10;
        html += `<div style="margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <span style="font-size:.75rem;color:var(--text-2)">${meta.emoji} ${meta.label}</span>
            <span style="font-size:.75rem;font-weight:700;color:${meta.color}">${val}/10</span>
          </div>
          <div style="height:6px;border-radius:3px;background:rgba(255,255,255,.06);overflow:hidden">
            <div style="height:100%;width:${pct}%;background:${meta.color};border-radius:3px;transition:width 1s ease .${blockIdx + 3}s"></div>
          </div>
        </div>`;
      }
      html += '</div></div>';
      c.innerHTML += html;
    }

    // ═══ 3. Summary ═══
    if (data.summary) {
      c.innerHTML += `<div class="result-card result-block" style="animation-delay:.2s">
        <p style="font-size:.8125rem;color:#d4d4d8;line-height:1.6">${esc(data.summary)}</p>
      </div>`;
    }

    // ═══ 4. Niche Comparison ═══
    if (data.niche_comparison) {
      const nc = data.niche_comparison;
      const diff = score - nc.avg_score;
      const diffText = diff >= 0 ? `вище на ${diff}%` : `нижче на ${Math.abs(diff)}%`;
      const diffColor = diff >= 0 ? '#4ade80' : '#f87171';
      c.innerHTML += `<div class="result-block" style="animation-delay:.25s">
        <div class="result-card" style="border:1px solid rgba(139,92,246,.15)">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <span style="font-size:1.2rem">🏆</span>
            <span style="font-size:.75rem;font-weight:700;color:var(--text-2)">Порівняння з нішею</span>
          </div>
          <div style="display:flex;gap:16px;align-items:center;margin-bottom:8px">
            <div style="text-align:center">
              <div style="font-size:1.5rem;font-weight:800;color:#a78bfa">${nc.avg_score}</div>
              <div style="font-size:.625rem;color:var(--text-3)">середній бал</div>
            </div>
            <div style="text-align:center">
              <div style="font-size:1.5rem;font-weight:800;color:${diffColor}">${score}</div>
              <div style="font-size:.625rem;color:var(--text-3)">твій бал</div>
            </div>
            <div style="flex:1;font-size:.75rem;color:${diffColor};font-weight:600">${diffText}</div>
          </div>
          ${nc.common_mistake ? `<p style="font-size:.7rem;color:var(--text-3);margin:0;border-top:1px solid rgba(255,255,255,.04);padding-top:8px">💡 Типова помилка у ніші: ${esc(nc.common_mistake)}</p>` : ''}
        </div>
      </div>`;
    }

    // ═══ 5. Quick Wins ═══
    if (data.quick_wins?.length) {
      let html = `<div class="result-block" style="animation-delay:.3s">
        <div class="r-heading"><div class="r-heading__icon" style="background:linear-gradient(135deg,rgba(245,158,11,.12),rgba(234,179,8,.12))">⚡</div>Зроби прямо зараз (5 хвилин)</div>
        <div class="result-card">`;
      data.quick_wins.forEach((win, i) => {
        html += `<div style="${i > 0 ? 'margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.04)' : ''}">
          <div style="display:flex;gap:8px;align-items:flex-start">
            <span style="display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;background:rgba(245,158,11,.1);color:#fbbf24;font-size:.7rem;font-weight:800;flex-shrink:0">${i + 1}</span>
            <p style="font-size:.8125rem;color:var(--text-2);margin:0">${esc(win)}</p>
          </div>
        </div>`;
      });
      html += '</div></div>';
      c.innerHTML += html;
    }

    // ═══ 6. Problems / Growth Zones ═══
    if (data.problems?.length) {
      let html = `<div class="result-block" style="animation-delay:.35s">
        <div class="r-heading"><div class="r-heading__icon" style="background:linear-gradient(135deg,rgba(244,114,182,.12),rgba(239,68,68,.12))">🔍</div>Зони росту</div>`;
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

    // ═══ 7. Bio Rewrite ═══
    if (data.bio_rewrite?.suggested) {
      const br = data.bio_rewrite;
      c.innerHTML += `<div class="result-block" style="animation-delay:.4s">
        <div class="r-heading"><div class="r-heading__icon" style="background:linear-gradient(135deg,rgba(167,139,250,.12),rgba(139,92,246,.12))">✍️</div>Нова шапка профілю</div>
        <div class="result-card">
          ${br.current_issues ? `<p style="font-size:.7rem;color:var(--text-3);margin:0 0 10px">⚠️ ${esc(br.current_issues)}</p>` : ''}
          <div style="padding:14px;border-radius:12px;background:rgba(139,92,246,.06);border:1px solid rgba(139,92,246,.15)">
            <p style="font-size:.8125rem;color:#e2e8f0;margin:0;white-space:pre-wrap;line-height:1.6" id="bio-text">${esc(br.suggested)}</p>
          </div>
          <button type="button" class="copy-btn" style="margin-top:10px" id="copy-bio">📋 Скопіювати шапку</button>
        </div>
      </div>`;
      setTimeout(() => {
        const btn = $('#copy-bio');
        if (btn) btn.addEventListener('click', () => copyText(data.bio_rewrite.suggested, btn));
      }, 100);
    }

    // ═══ 8. Content Plan ═══
    if (data.content_plan?.length) {
      const formatEmoji = { 'Reels': '🎬', 'Карусель': '📸', 'Сторіз': '📱' };
      const formatBg = {
        'Reels': 'rgba(244,114,182,.1)', 'Карусель': 'rgba(59,130,246,.1)', 'Сторіз': 'rgba(245,158,11,.1)'
      };
      const formatBorder = {
        'Reels': 'rgba(244,114,182,.18)', 'Карусель': 'rgba(59,130,246,.18)', 'Сторіз': 'rgba(245,158,11,.18)'
      };
      let html = `<div class="result-block" style="animation-delay:.45s">
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

    // ═══ 9. Action Plan ═══
    if (data.action_plan?.length) {
      const labels = ['🔥 Сьогодні', '📅 Цей тиждень', '🎯 Цей місяць'];
      const colors = ['#f87171', '#fbbf24', '#4ade80'];
      let html = `<div class="result-block" style="animation-delay:.5s">
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

    // ═══ 10. Growth Forecast ═══
    if (data.growth_forecast) {
      c.innerHTML += `<div class="result-block" style="animation-delay:.55s">
        <div class="result-card" style="border:1px solid rgba(34,197,94,.15);background:rgba(34,197,94,.04)">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <span style="font-size:1.2rem">📈</span>
            <span style="font-size:.75rem;font-weight:700;color:#4ade80">Прогноз росту</span>
          </div>
          <p style="font-size:.8125rem;color:var(--text-2);margin:0;line-height:1.6">${esc(data.growth_forecast)}</p>
        </div>
      </div>`;
    }

    // ═══ 11. Hashtags ═══
    if (data.hashtags?.length) {
      const allTags = data.hashtags.join(' ');
      let html = `<div class="result-block" style="animation-delay:.6s">
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
    const label = btn.closest('.idea-card') ? 'content_plan' : 'hashtags';
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
      if (window.BA) BA.track('copy_click', { type: label });
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
    const ig = state.username || '';
    if (ig && els.leadIg) els.leadIg.value = '@' + ig.replace(/^@/, '');
    if (window.BA) BA.track('cta_click', { type: 'callback_modal', score: state.aiResult?.score });
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
      } catch (_) { }
    }

    // Always show success
    els.callbackForm.classList.add('hidden');
    els.callbackSuccess.classList.remove('hidden');
    if (window.BA) BA.track('Lead', { niche: state.answers.q0, score: state.aiResult?.score, time_slot: payload.time });
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
      if (window.BA) BA.track('quiz_completed', {
        niche: state.answers.q0,
        goal: state.answers.q1,
        followers: state.answers.q2,
        frequency: state.answers.q3,
        has_concern: !!state.answers.q4
      });
    });

    els.btnBackQuiz.addEventListener('click', () => showScreen('screen-quiz'));
    els.btnAnalyze.addEventListener('click', runAnalysis);
    els.btnRetry.addEventListener('click', () => { hideError(); runAnalysis(); });

    // "Switch to screenshot" recommendation button on username panel
    const btnSwitchScreenshot = $('#btn-switch-screenshot');
    if (btnSwitchScreenshot) {
      btnSwitchScreenshot.addEventListener('click', () => {
        $$('.tabs__btn').forEach(b => b.classList.remove('active'));
        const screenshotTab = $('.tabs__btn[data-tab="screenshot"]');
        if (screenshotTab) screenshotTab.classList.add('active');
        state.inputMode = 'screenshot';
        $('#panel-screenshot').classList.remove('hidden');
        $('#panel-username').classList.add('hidden');
        checkUploadValid();
        if (window.BA) BA.track('switch_to_screenshot', { from: 'recommendation' });
      });
    }

    // CTA clicks tracking
    els.ctaCallback.addEventListener('click', openModal);
    const ctaCall = $('#cta-call');
    const ctaMsg = $('#cta-message');
    const ctaIg = $('#cta-instagram');
    if (ctaCall) ctaCall.addEventListener('click', () => { if (window.BA) BA.track('cta_click', { type: 'phone_call' }); });
    if (ctaMsg) ctaMsg.addEventListener('click', () => { if (window.BA) BA.track('cta_click', { type: 'telegram' }); });
    if (ctaIg) ctaIg.addEventListener('click', () => { if (window.BA) BA.track('cta_click', { type: 'instagram_dm' }); });

    els.modalBackdrop.addEventListener('click', closeModal);
    els.modalClose.addEventListener('click', closeModal);
    els.callbackForm.addEventListener('submit', submitLead);
  }

  init();
})();
