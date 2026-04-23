# Bless Academy — AI Instagram Analyzer
> Лендинг для рекламы услуг b'юті-академії. Пользователь проходит квиз → загружает скриншот или вводит ник → AI (Gemini) генерирует персональный контент-план → CTA на услуги.

---

## 📌 Быстрый старт

| Параметр | Значение |
|---|---|
| **Репозиторий** | [github.com/dehhaa13-collab/AI-analiz](https://github.com/dehhaa13-collab/AI-analiz) |
| **Хостинг** | Vercel (auto-deploy из `main`) |
| **Продакшн URL** | Смотри в дашборде Vercel → `ai-analiz` проект |
| **Локальная папка** | `/Users/vladislav/Desktop/Для рекламы, АИ тест инстграмм страницы/` |

### Как запустить локально
```bash
# 1. Установить Vercel CLI (если ещё нет)
npm i -g vercel

# 2. Перейти в папку проекта
cd "/Users/vladislav/Desktop/Для рекламы, АИ тест инстграмм страницы"

# 3. Запустить (подтянет env-переменные с Vercel)
vercel dev
```
Откроется на `http://localhost:3000`.

---

## 🏗 Архитектура проекта

```
├── index.html          — Главная (и единственная) страница
├── styles.css          — Все стили (glassmorphism, iPhone-адаптация)
├── app.js              — Клиентская логика (квиз, загрузка, AI, рендер результатов)
├── vercel.json         — Конфигурация Vercel (security headers, cleanUrls)
├── .gitignore          — Защита ключей (.env.local, node_modules)
├── .env.local          — Локальные API-ключи (НЕ пушится в Git!)
└── api/
    ├── analyze.js      — Серверный прокси к AI (Gemini → Groq fallback)
    ├── instagram.js    — Парсер данных Instagram-профиля через CORS-прокси
    └── lead.js         — Отправка заявки в Telegram-бот
```

### Принцип работы
```
Пользователь                    Vercel Serverless             Внешние API
─────────────                   ─────────────────             ───────────
  │                                  │                             │
  ├─ Проходит квиз (5 вопросов) ─────│                             │
  │                                  │                             │
  ├─ Загружает скрин ИЛИ вводит ник ─│                             │
  │                                  │                             │
  ├─ POST /api/instagram ───────────►│──── CORS-proxy ───────────►│ instagram.com
  │  (парсит OG-метаданные)          │◄──── followers, bio ───────│
  │                                  │                             │
  ├─ POST /api/analyze ─────────────►│──── Gemini 2.0 Flash ────►│ generativelanguage.googleapis.com
  │  (промпт + скрин/данные)         │◄──── JSON (score, plan) ──│
  │                                  │                             │
  │  (если Gemini упал)              │──── Groq LLaMA 4 ─────────►│ api.groq.com
  │                                  │◄──── JSON (score, plan) ──│
  │                                  │                             │
  ├─ Видит результаты + CTA          │                             │
  │                                  │                             │
  ├─ POST /api/lead ────────────────►│──── Telegram Bot API ────►│ api.telegram.org
  │  (имя, телефон, IG)              │◄──── ok ──────────────────│
  └──────────────────────────────────└─────────────────────────────┘
```

---

## 📄 Описание каждого файла

### `index.html` — Главная страница
**Что делает:** Содержит 4 экрана (Quiz → Upload → Loading → Results+CTA) + модальное окно заявки.

**Ключевые интеграции в `<head>`:**
- **Facebook Pixel** (ID: `1006602698050276`) — `fbq('init', ...)` + `PageView`
- **Google Analytics 4** (ID: `G-F0RPGF106Q`) — `gtag('config', ...)`
- **Unified Analytics Layer (`BA.track`)** — единая функция, которая при вызове отправляет событие ОДНОВРЕМЕННО в GA4 и FB Pixel

**Пассивное отслеживание (встроено в `<head>`):**
| Событие | Что отслеживает |
|---|---|
| `scroll_depth` | Глубина скролла — 25%, 50%, 75%, 90%, 100% |
| `time_on_page` | Время на странице — 15, 30, 60, 120, 300 сек |
| `session_end` | Общее время при закрытии вкладки |
| `tab_return` | Возврат из другой вкладки (с длительностью) |

---

### `app.js` — Клиентская логика
**686 строк.** Основные блоки:

#### 1. State-машина (строки 9-20)
```js
state = { currentScreen, answers, imageBase64, username, inputMode, aiResult, profileData, utm }
```
Хранит всё состояние приложения в одном объекте.

#### 2. Квиз (5 вопросов)
| # | Вопрос | Варианты |
|---|---|---|
| 01 | Сфера работы | Маникюр, Брови, Перукар, Косметолог, Визажист, Массажист, Волосы, Другое |
| 02 | Цель в Instagram | Больше клиентов, Личный бренд, Продажа курсов, Другое |
| 03 | Подписчики | до 1K, 1-5K, 5-20K, 20K+ |
| 04 | Частота постинга | Каждый день, 3-4/неделю, Реже |
| 05 | Что беспокоит? | Свободный текст (необязательно) |

Каждый ответ трекается через `BA.track('quiz_answer', { question, answer })`.

#### 3. Загрузка профиля — 2 режима
- **Скриншот:** drag&drop или клик → file → конвертация в base64 → отправка в Gemini как `inline_data`
- **Ник/ссылка:** ввод `@username` или `instagram.com/username` → запрос к `/api/instagram` → получение followers/bio/posts → включение в промпт как текст

#### 4. Robust JSON Parser (строки 333-369) — ⚠️ КРИТИЧЕСКИ ВАЖНО
AI иногда возвращает не чистый JSON, а JSON обёрнутый в текст или markdown. Поэтому парсер работает в 3 стратегии:
1. **Прямой `JSON.parse`** — если AI вернул чистый JSON
2. **Поиск `{ ... }`** — если вокруг JSON есть текст, ищем внешние скобки с подсчётом глубины
3. **Auto-fix** — убираем trailing commas, меняем одинарные кавычки на двойные, оборачиваем ключи

Если все 3 стратегии провалились → **auto-retry** (повторный запрос с подсказкой "верни ТОЛЬКО JSON").

#### 5. Рендер результатов
AI возвращает JSON с полями:
```json
{
  "score": 45,
  "score_label": "Хороший старт, є куди рости",
  "summary": "...",
  "problems": [
    { "title": "...", "description": "...", "fix": "..." }
  ],
  "content_plan": [
    { "day": "Понеділок", "format": "Reels", "idea": "...", "hook": "...", "caption": "..." }
  ],
  "action_plan": [
    { "when": "Сьогодні", "action": "..." }
  ],
  "hashtags": ["#...", "#..."]
}
```

Результат рендерится как:
- 🎯 Анимированный score-ring (SVG круг с анимацией)
- ⚡ Зоны роста (проблемы + решения)
- 📅 Контент-план на неделю (3 идеи с hook и caption)
- 🚀 Action plan (сегодня / неделя / месяц)
- #️⃣ Хештеги (с кнопкой копирования)

#### 6. CTA секция (после результатов)
4 контактные кнопки:
1. 📞 **Запланировать звонок** — открывает модалку с формой (имя, телефон, Instagram, время)
2. 📱 **Позвонить** — `tel:+380000000000` (⚠️ нужно заменить на реальный номер)
3. 💬 **Написать** — ссылка на Telegram (⚠️ нужно указать реальную ссылку)
4. 📹 **Zoom встреча** — ссылка на Google Calendar (⚠️ нужно указать реальную ссылку)

Каждый клик трекается: `BA.track('cta_click', { type: 'callback|phone|telegram|zoom' })`.

#### 7. Форма заявки (модалка)
Отправка на `/api/lead` → Telegram-бот. При успехе стреляет `BA.track('Lead')` — это стандартное FB-событие конверсии.

---

### `api/analyze.js` — AI-прокси
**Зачем:** Ключи API нельзя хранить на клиенте. Этот serverless endpoint принимает сообщения от клиента и проксирует их к AI.

**Модели:**
| Приоритет | Модель | Провайдер | Env-переменная |
|---|---|---|---|
| 1 (основная) | Gemini 2.0 Flash | Google | `GEMINI_API_KEY` |
| 2 (fallback) | LLaMA 4 Scout | Groq | `GROQ_API_KEY` |

**Защита:**
- Rate limiting: 3 запроса/мин, 15 запросов/день на IP
- Валидация payload: проверка структуры, размер до 5 МБ
- `maxDuration: 60` — таймаут 60 секунд

**Формат ответа:** Всегда OpenAI-совместимый `{ choices: [{ message: { content: "..." } }] }`.

---

### `api/instagram.js` — Парсер Instagram
**Зачем:** Получить данные публичного профиля (followers, bio, posts) без Instagram API.

**Как работает:**
1. Очищает ввод пользователя (`@username`, `instagram.com/username` → `username`)
2. Пробует загрузить HTML страницы через CORS-прокси (`allorigins.win`, `corsproxy.io`)
3. Парсит OG-метатеги: `og:description` → followers/following/posts, `og:title` → display name
4. Если данные есть — возвращает объект, если нет — `{ data: null }` (AI анализирует только по квизу)

**Ограничения:**
- Работает только для **публичных** профилей
- Instagram часто блокирует CORS-прокси → не всегда возвращает данные
- Это нормально — AI всё равно даст анализ на основе квиза

---

### `api/lead.js` — Заявки в Telegram
**Зачем:** При нажатии "Запланировать звонок" → данные формы отправляются в Telegram-чат.

**Формат сообщения:**
```
🔥 Нова заявка з AI-аналізу!

👤 Ім'я: Олена
📱 Телефон: +380931188028
📸 Instagram: @beauty_master
🕐 Зручний час: 12:00–15:00

📊 AI Score: 65/100
🎯 Сфера: манікюр
🎯 Мета: більше клієнтів

📣 UTM: facebook / cpc / beauty_test
⏰ 23.04.2026, 12:30:00
```

**Env-переменные:**
- `TELEGRAM_BOT_TOKEN` — токен бота
- `TELEGRAM_CHAT_ID` — ID чата/группы

---

### `styles.css` — Дизайн
**350 строк.** Glassmorphism + тёмная тема.

**Ключевые решения:**
- **CSS Custom Properties** (`:root`) — все цвета, радиусы, градиенты вынесены в переменные
- **Glassmorphism** — `backdrop-filter: blur()` на карточках и хедере
- **Анимации:** `floatGlow` (фоновые пятна), `fadeUp` (появление блоков), `shine` (мерцание текста)

**iPhone/iOS оптимизация (строки 229+):**
| Проблема | Решение |
|---|---|
| Dynamic Island / notch перекрывает контент | `env(safe-area-inset-top)` в padding |
| Home Indicator перекрывает кнопки | `env(safe-area-inset-bottom)` |
| Safari зумит при фокусе на input | `font-size: 16px !important` на всех полях |
| Маленькие кнопки сложно нажимать | `min-height: 48px` (Apple HIG: 44px минимум) |
| Грид ломается на iPhone SE | `@media (max-width: 374px)` → 2 колонки |
| Landscape клавиатура всё закрывает | `@media (orientation: landscape) and (max-height: 500px)` |

---

### `vercel.json` — Конфигурация
- `cleanUrls: true` — убирает `.html` из URL
- Security headers на API: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`

---

### `.env.local` — Секреты (⚠️ НЕ в Git!)
```env
GEMINI_API_KEY=AIza...     # Google Gemini API
GROQ_API_KEY=gsk_...       # Groq (резерв)
TELEGRAM_BOT_TOKEN=...     # Telegram бот
TELEGRAM_CHAT_ID=...       # Чат для заявок
```
Эти же переменные должны быть настроены в **Vercel Dashboard → Settings → Environment Variables** для production.

---

## 📊 Аналитика — Полная карта событий

### Воронка (BA.track → GA4 + FB Pixel одновременно)
```
PageView (авто)
  └─ quiz_answer (×4-5 раз, каждый вопрос)
      └─ quiz_completed (все ответы, niche, goal)
          └─ input_tab_switch (screenshot / username)
              └─ image_uploaded (size_kb) / username entered
                  └─ analysis_started (input_mode, niche)
                      ├─ analysis_completed ✅ (score, niche, has_profile_data)
                      │   └─ ViewContent (FB standard, для ретаргетинга)
                      │       └─ copy_click (content_plan / hashtags)
                      │           └─ cta_click (callback / phone / telegram / zoom)
                      │               └─ Lead ✅ (FB standard conversion)
                      │
                      └─ analysis_error ❌ (error message)
```

### Пассивные события
| Событие | Описание |
|---|---|
| `scroll_depth` | 25/50/75/90/100% |
| `time_on_page` | 15/30/60/120/300 сек |
| `tab_return` | Вернулся из другой вкладки |
| `session_end` | Общее время сессии |

### Где смотреть
- **GA4:** [analytics.google.com](https://analytics.google.com) → Property `G-F0RPGF106Q` → Realtime / Events
- **Facebook:** [business.facebook.com/events_manager](https://business.facebook.com/events_manager) → Pixel `1006602698050276`

---

## 🔐 Безопасность

| Мера | Реализация |
|---|---|
| API-ключи не в коде | Хранятся в `process.env` (Vercel) и `.env.local` (локально) |
| `.gitignore` | Блокирует `.env*`, `node_modules`, `.vercel` |
| Rate limiting | 3 req/min, 15 req/day на IP в `api/analyze.js` |
| Input validation | Проверка payload, ограничение 5 МБ |
| Security headers | `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` |

---

## ⚠️ Что нужно доделать / настроить

### Обязательно перед запуском рекламы
- [ ] **Заменить телефон** в `index.html` строка 410: `tel:+380000000000` → реальный номер
- [ ] **Добавить Telegram-ссылку** в `index.html` строка 417: `https://t.me/` → реальный ник
- [ ] **Добавить Google Calendar ссылку** в `index.html` строка 424: `https://calendar.app.google/` → реальная ссылка
- [ ] **Настроить Telegram-бота** — добавить `TELEGRAM_BOT_TOKEN` и `TELEGRAM_CHAT_ID` в Vercel env vars
- [ ] **Добавить OG-картинку** — создать `/og-image.png` (1200×630px) для превью при шаринге

### Рекомендуемые улучшения
- [ ] **A/B тестирование CTA** — попробовать разные формулировки "Хочеш, щоб ми зняли ці відео за тебе?"
- [ ] **Добавить favicon** — создать `/favicon.png` для вкладки браузера
- [ ] **Кастомная 404** — сейчас стандартная Vercel-страница
- [ ] **Кэширование результатов** — если тот же username → показывать прошлый результат
- [ ] **Webhook в CRM** — помимо Telegram, отправлять лиды в CRM (Bitrix, AmoCRM)
- [ ] **Ретаргетинг аудитории** — создать Custom Audience в FB из тех кто получил score < 50
- [ ] **Email-сбор** — добавить поле email в форму заявки для email-маркетинга

---

## 🔧 Полезные команды

```bash
# Деплой на продакшн (автоматически при push)
git add -A && git commit -m "описание" && git push origin main

# Force push (если конфликт с remote)
git push --force origin main

# Запустить локально
vercel dev

# Проверить env vars на Vercel
vercel env ls

# Добавить новую env var
vercel env add VARIABLE_NAME
```

---

## 📅 История изменений

| Дата | Что сделано |
|---|---|
| 22.04.2026 | Начальная сборка: квиз, загрузка, AI-анализ через Gemini |
| 22.04.2026 | Добавлен парсинг Instagram-профилей (`/api/instagram`) |
| 22.04.2026 | Facebook Pixel (ID: 1006602698050276) + события воронки |
| 22.04.2026 | Полная аналитика: GA4 (G-F0RPGF106Q) + Unified BA.track layer |
| 22.04.2026 | Защита API-ключей: .gitignore + env vars на Vercel |
| 22.04.2026 | Robust JSON parser (3 стратегии + auto-retry) |
| 22.04.2026 | iPhone/iOS оптимизация: safe-area, touch targets, Safari fixes |
| 23.04.2026 | Force-push финальной версии на GitHub, синхронизация с Vercel |

---

## 💡 Контекст проекта

**Для кого:** Бьюти-мастера (маникюр, брови, косметология) в Украине.

**Бизнес-модель:** Бесплатный AI-анализ → лид → продажа услуг по созданию контента (съёмка видео). Лендинг — верхняя часть воронки.

**Трафик:** Facebook/Instagram Ads → лендинг. UTM-параметры автоматически передаются в заявку.

**Язык интерфейса:** Украинский 🇺🇦
