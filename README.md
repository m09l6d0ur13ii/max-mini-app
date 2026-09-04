# MAX ⇄ Telegram Bridge & WebApp Mini-App

Двусторонний шлюз (bridge) для синхронизации сообщений и реакций между **MAX Messenger** ([dev.max.ru](https://dev.max.ru)) и **Telegram**, с встроенным **Mini-App** на базе [MAX WebApp Bridge](https://dev.max.ru/docs/webapps/bridge).

---

## 🌟 Основные возможности

1. **Двусторонняя пересылка сообщений:**
   - **Telegram ➔ MAX:** Сообщения из выбранного чата Telegram автоматически пересылаются в группу MAX с указанием автора и исходного форматирования.
   - **MAX ➔ Telegram:** Сообщения из чата MAX автоматически отправляются в супергруппу Telegram.
   - **Поддержка ответов (Replies):** Если сообщение в одном мессенджере является ответом на пересланное сообщение, в другом мессенджере оно привязывается к соответствующему сообщению!
   - **Поддержка медиа:** Фотографии, документы, аудио и стикеры пересылаются между платформами.
   - **Защита от зацикливания (Anti-loop):** Бот игнорирует свои собственные сообщения и предотвращает бесконечное эхо.

2. **Двусторонняя синхронизация реакций:**
   - **Telegram ➔ MAX:** Когда пользователь в Telegram ставит реакцию (👍, ❤️, 🔥 и др.), бот обрабатывает событие `message_reaction` Telegram Bot API 7.0+, сохраняет реакцию в реестре и отображает её в MAX.
   - **MAX ➔ Telegram:** Когда пользователь в MAX ставит реакцию (через Mini-App или ответом с эмодзи в чате MAX), бот устанавливает нативную реакцию в Telegram через `setMessageReaction`.

3. **MAX Mini-App (WebApp Bridge):**
   - Интеграция со скриптом `https://st.max.ru/js/max-web-app.js` и глобальным объектом `window.WebApp`.
   - Получение данных пользователя через `initData` / `initDataUnsafe`.
   - Поддержка темной и светлой темы MAX.
   - Живой мониторинг сообщений и статистики шлюза.
   - Интерактивная панель реакций прямо в Mini-App: пользователи могут нажимать на эмодзи на любом сообщении, и реакция мгновенно улетает в Telegram и MAX!

---

## 🏗 Архитектура проекта

```text
max-mini-app/
├── src/
│   ├── index.ts               # Точка входа: запуск Express, Telegram Bot и MAX Bot
│   ├── config.ts              # Валидация и загрузка настроек из .env
│   ├── store/
│   │   ├── index.ts           # Персистентное хранилище связей сообщений и реакций
│   │   └── types.ts           # Интерфейсы MessageRecord, ReactionEntry, BridgeStats
│   ├── telegram/
│   │   └── bot.ts             # Логика Telegram-бота (GrammY, сообщения, reactions)
│   ├── max/
│   │   └── bot.ts             # Логика MAX-бота (@maxhub/max-bot-api, события, комментарии)
│   ├── bridge/
│   │   └── manager.ts         # Центральный диспетчер пересылки и синхронизации
│   └── webapp/
│       ├── server.ts          # Express API сервер для Mini-App
│       └── public/
│           ├── index.html     # Интерфейс Mini-App с подключением MAX WebApp Bridge
│           ├── style.css      # Стили, адаптированные под темы MAX и Telegram
│           └── app.js         # Скрипт Mini-App с window.WebApp и обработкой реакций
├── .env.example               # Шаблон переменных окружения
├── tsconfig.json              # Конфигурация TypeScript
├── package.json               # Зависимости и скрипты
└── README.md                  # Документация проекта
```

---

## 🚀 Быстрый старт

### 1. Требования
- **Node.js** версии 18 или новее
- **npm** версии 9 или новее

### 2. Клонирование и установка зависимостей
```bash
git clone https://github.com/m09l6d0ur13ii/max-mini-app.git
cd max-mini-app
npm install
```

### 3. Настройка конфигурации (.env)
Скопируйте пример файла конфигурации:
```bash
cp .env.example .env
```
Откройте `.env` и укажите ваши параметры:

```env
# Токен бота Telegram от @BotFather
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz

# ID группы в Telegram (например, -1001234567890)
TELEGRAM_CHAT_ID=-1001234567890

# Токен бота MAX от платформы MAX (https://dev.max.ru)
MAX_BOT_TOKEN=ваш_токен_бота_макс

# ID группового чата в MAX
MAX_CHAT_ID=12345678

# Порт веб-сервера для Mini-App
PORT=3000

# URL Mini-App (для открытия внутри MAX)
WEBAPP_URL=http://localhost:3000

# Включить синхронизацию реакций
SYNC_REACTIONS=true
```

> **Как узнать `TELEGRAM_CHAT_ID`:**  
> Добавьте бота в нужную группу Telegram, отправьте любое сообщение, затем откройте в браузере:  
> `https://api.telegram.org/bot<ВАШ_ТОКЕН>/getUpdates` и найдите поле `"chat":{"id": -100...}`.

> **Как узнать `MAX_CHAT_ID`:**  
> В платформе MAX при добавлении бота в чат в событии `bot_added` или `message_created` передается `chat_id`.

---

## 💻 Запуск

### Режим разработки (с автоперезагрузкой через tsx)
```bash
npm run dev
```

### Сборка и промышленный запуск (Production)
```bash
npm run build
npm start
```

После запуска в консоли отобразится:
```text
====================================================
       MAX ⇄ Telegram Bridge & WebApp Bridge        
====================================================
[WebApp] Server is running at http://localhost:3000
[WebApp] MAX Mini-App available at: http://localhost:3000
[Telegram] Bot started: @YourBridgeBot (ID: 123456)
[Telegram] Bridging chat ID: -1001234567890
[MAX] Bot verified: MaxBridgeBot (ID: 7890)
[MAX] Bot polling started for chat ID: 12345678
```

---

## 📱 Использование MAX WebApp Mini-App

Mini-App доступен по адресу локального сервера `http://localhost:3000` (или по вашему публичному домену при использовании туннеля / хостинга).

1. В платформе MAX подключите веб-приложение к вашему боту, указав URL Mini-App.
2. При открытии Mini-App внутри MAX клиент автоматически подтягивает:
   - Профиль пользователя (`window.WebApp.initDataUnsafe.user`)
   - Платформу (`window.WebApp.platform`)
   - Цветовую палитру интерфейса
3. В Mini-App доступно:
   - Просмотр всех синхронизированных сообщений между MAX и Telegram в реальном времени.
   - Установка и просмотр реакций на сообщения (👍, ❤️, 🔥, 👏, 😂, 🚀). При клике на эмодзи в Mini-App реакция зеркалируется в Telegram и MAX!
   - Отправка сообщений сразу в оба чата.

---

## 🛠 Технологический стек

- **TypeScript** & **Node.js**
- **MAX Bot API**: `@maxhub/max-bot-api`
- **Telegram Bot API**: `grammy` (GrammY)
- **MAX WebApp Bridge**: `https://st.max.ru/js/max-web-app.js`
- **Web Server**: Express & CORS
- **Storage**: Логика постоянного хранения с атомарной записью (WAL/JSON)
