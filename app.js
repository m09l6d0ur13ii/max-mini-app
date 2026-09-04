// MAX WebApp Bridge Client Script (Dual-Mode: GitHub Pages & Backend Server)
const QUICK_EMOJIS = ['👍', '❤️', '🔥', '👏', '😂', '🚀'];
const DEFAULT_TG_TOKEN = '8722331145:AAFRH6ngx8FA5pVdegOjpA_5b65jIyia50k';

let currentUser = 'MAX User';
let isWebApp = false;
let isBackendMode = false;

// Config state
const state = {
  tgToken: localStorage.getItem('cfg_tg_token') || DEFAULT_TG_TOKEN,
  tgChatId: localStorage.getItem('cfg_tg_chat_id') || '',
  maxToken: localStorage.getItem('cfg_max_token') || '',
  maxChatId: localStorage.getItem('cfg_max_chat_id') || '',
  messages: [],
  stats: {
    total: 0,
    tg: 0,
    max: 0,
    reactions: 0,
  },
};

// 1. Initialize
async function init() {
  initMaxBridge();
  initSettingsUI();
  await checkBackendMode();
  await refreshData();

  // Periodic polling
  setInterval(refreshData, 3500);
}

// 2. MAX WebApp Bridge setup
function initMaxBridge() {
  if (typeof window.WebApp !== 'undefined') {
    isWebApp = true;
    console.log('[MAX Bridge] window.WebApp active');

    const platformEl = document.getElementById('platform-name');
    if (platformEl && window.WebApp.platform) {
      platformEl.textContent = `MAX App (${window.WebApp.platform} v${window.WebApp.version || ''})`;
    }

    if (window.WebApp.initDataUnsafe) {
      const u = window.WebApp.initDataUnsafe.user;
      if (u) {
        currentUser = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || 'Пользователь MAX';
        const nameEl = document.getElementById('user-name');
        if (nameEl) nameEl.textContent = currentUser;

        if (u.photo_url) {
          const avatarEl = document.getElementById('user-avatar');
          if (avatarEl) {
            avatarEl.innerHTML = `<img src="${u.photo_url}" style="width:20px;height:20px;border-radius:50%;object-fit:cover;" />`;
          }
        }
      }

      // If chat ID exists in initData
      const chat = window.WebApp.initDataUnsafe.chat;
      if (chat && chat.id && !state.maxChatId) {
        state.maxChatId = String(chat.id);
        localStorage.setItem('cfg_max_chat_id', state.maxChatId);
      }
    }

    if (typeof window.WebApp.enableClosingConfirmation === 'function') {
      try {
        window.WebApp.enableClosingConfirmation();
      } catch (e) {}
    }

    if (window.WebApp.MainButton) {
      window.WebApp.MainButton.setText('🔄 ОБНОВИТЬ СООБЩЕНИЯ');
      window.WebApp.MainButton.show();
      window.WebApp.MainButton.onClick(refreshData);
    }
  } else {
    console.log('[MAX Bridge] Running in browser / GitHub Pages');
  }
}

// 3. Detect Backend vs GitHub Pages
async function checkBackendMode() {
  const badge = document.getElementById('mode-badge');
  try {
    const res = await fetch('/api/status', { method: 'GET', signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const data = await res.json();
      isBackendMode = true;
      if (badge) badge.textContent = '🟢 Режим: Серверный шлюз (Node.js API)';
      return;
    }
  } catch (err) {
    // Backend not running -> GitHub Pages direct mode
  }

  isBackendMode = false;
  if (badge) badge.textContent = '🌐 Режим: GitHub Pages (Прямое подключение к API)';
}

// 4. Refresh data based on mode
async function refreshData() {
  if (isBackendMode) {
    await refreshBackendData();
  } else {
    await refreshGitHubPagesData();
  }
}

// Backend mode loaders
async function refreshBackendData() {
  try {
    const [statusRes, msgsRes] = await Promise.all([
      fetch('/api/status'),
      fetch('/api/messages?limit=40'),
    ]);

    const statusData = await statusRes.json();
    const msgsData = await msgsRes.json();

    if (statusData.stats) {
      updateStatsUI({
        total: statusData.stats.totalMessagesSynced || 0,
        tg: statusData.stats.fromTelegramCount || 0,
        max: statusData.stats.fromMaxCount || 0,
        reactions: statusData.stats.reactionsSyncedCount || 0,
      });
    }

    if (msgsData.messages) {
      state.messages = msgsData.messages;
      renderMessages(state.messages);
    }
  } catch (err) {
    console.warn('[Backend] Refresh error:', err);
  }
}

// GitHub Pages mode loaders (directly calls Telegram API)
async function refreshGitHubPagesData() {
  if (!state.tgToken) return;

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${state.tgToken}/getUpdates?limit=25&allowed_updates=["message","edited_message","message_reaction"]`
    );
    const data = await res.json();

    if (data.ok && Array.isArray(data.result)) {
      const parsedMessages = [];
      let tgCount = 0;
      let reactionCount = 0;

      for (const item of data.result) {
        if (item.message) {
          const m = item.message;
          tgCount++;

          // Auto-save group chat ID if not set
          if (!state.tgChatId && m.chat && (m.chat.type === 'group' || m.chat.type === 'supergroup')) {
            state.tgChatId = String(m.chat.id);
            localStorage.setItem('cfg_tg_chat_id', state.tgChatId);
            const input = document.getElementById('cfg-tg-chat');
            if (input) input.value = state.tgChatId;
          }

          const senderName = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' ') || m.from?.username || 'Пользователь TG';
          parsedMessages.push({
            id: `tg_${m.message_id}`,
            source: 'telegram',
            tgChatId: m.chat.id,
            tgMessageId: m.message_id,
            authorName: senderName,
            text: m.text || m.caption || (m.photo ? '[Фотография]' : '[Медиа]'),
            hasMedia: !!m.photo,
            createdAt: m.date * 1000,
            reactions: [],
          });
        }
      }

      // Add local cached messages sent from WebApp
      const localMsgs = JSON.parse(localStorage.getItem('webapp_sent_msgs') || '[]');
      const combined = [...localMsgs, ...parsedMessages].slice(-50).reverse();

      state.messages = combined;
      renderMessages(combined);

      updateStatsUI({
        total: combined.length,
        tg: tgCount,
        max: localMsgs.length,
        reactions: reactionCount,
      });
    }
  } catch (err) {
    console.warn('[GitHub Pages] Fetch error:', err);
  }
}

function updateStatsUI(stats) {
  document.getElementById('stat-total').textContent = stats.total;
  document.getElementById('stat-tg').textContent = stats.tg;
  document.getElementById('stat-max').textContent = stats.max;
  document.getElementById('stat-reactions').textContent = stats.reactions;
}

// 5. Render Messages
function renderMessages(messages) {
  const container = document.getElementById('messages-list');
  if (!container) return;

  if (messages.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        Нет синхронизированных сообщений.<br>
        Отправьте сообщение в чат Telegram или введите сообщение выше!
      </div>`;
    return;
  }

  container.innerHTML = messages
    .map((msg) => {
      const platformClass = msg.source || 'webapp';
      const platformLabel = msg.source === 'telegram' ? '✈️ Telegram' : msg.source === 'max' ? '🌐 MAX' : '📱 WebApp';
      const timeStr = new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      // Reactions bubbles
      const reactionsHtml = (msg.reactions || [])
        .map(
          (r) =>
            `<span class="reaction-bubble" onclick="sendReaction('${msg.id}', '${r.emoji}')" title="${(r.users || []).join(', ')}">
              ${r.emoji} <b>${(r.users || []).length}</b>
            </span>`
        )
        .join('');

      // Quick emojis buttons
      const quickEmojisHtml = QUICK_EMOJIS.map(
        (emoji) => `<button class="quick-emoji-btn" onclick="sendReaction('${msg.id}', '${emoji}')">${emoji}</button>`
      ).join('');

      const mediaHtml =
        msg.hasMedia && msg.mediaUrl
          ? `<img src="${msg.mediaUrl}" class="message-media-img" loading="lazy" alt="Media" onerror="this.style.display='none'" />`
          : '';

      return `
        <div class="message-item" id="msg-${msg.id}">
          <div class="message-header">
            <span class="platform-tag ${platformClass}">${platformLabel}</span>
            <span class="message-author">${escapeHtml(msg.authorName || 'Аноним')}</span>
            <span class="message-time">${timeStr}</span>
          </div>
          ${mediaHtml}
          <div class="message-content">${escapeHtml(msg.text || '')}</div>
          <div class="reactions-bar">
            ${reactionsHtml}
            <div class="add-reaction-dropdown">
              ${quickEmojisHtml}
            </div>
          </div>
        </div>
      `;
    })
    .join('');
}

// 6. Send Reaction (Dual-Mode)
async function sendReaction(messageId, emoji) {
  if (isBackendMode) {
    try {
      const res = await fetch('/api/react', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageId,
          emoji,
          user: currentUser,
        }),
      });
      const data = await res.json();
      if (data.success) {
        refreshData();
      }
    } catch (err) {
      console.error('[Reaction] Backend error:', err);
    }
  } else {
    // GitHub Pages Direct Telegram API
    const msg = state.messages.find((m) => m.id === messageId);
    if (!msg || !msg.tgMessageId || !msg.tgChatId) {
      alert(`Реакция сохранена в приложении: ${emoji}`);
      return;
    }

    try {
      const res = await fetch(`https://api.telegram.org/bot${state.tgToken}/setMessageReaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: msg.tgChatId,
          message_id: msg.tgMessageId,
          reaction: [{ type: 'emoji', emoji }],
        }),
      });
      const resData = await res.json();
      if (resData.ok) {
        alert(`Реакция ${emoji} успешно установлена в Telegram!`);
      } else {
        alert(`Ошибка Telegram: ${resData.description}`);
      }
    } catch (err) {
      console.error('[Reaction] Direct TG API error:', err);
    }
  }
}

// 7. Send Message (Dual-Mode)
async function sendMessage() {
  const input = document.getElementById('send-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;

  const btn = document.getElementById('send-btn');
  if (btn) btn.disabled = true;

  if (isBackendMode) {
    try {
      const res = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          senderName: currentUser,
        }),
      });
      if (res.ok) {
        input.value = '';
        setTimeout(refreshData, 500);
      }
    } catch (err) {
      console.error('[Send] Backend error:', err);
    } finally {
      if (btn) btn.disabled = false;
    }
  } else {
    // GitHub Pages Direct Mode: Send to Telegram group and MAX
    let sentToTg = false;
    let sentToMax = false;

    // Send to Telegram
    if (state.tgToken && state.tgChatId) {
      try {
        const res = await fetch(`https://api.telegram.org/bot${state.tgToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: state.tgChatId,
            text: `[MAX WebApp] 👤 ${currentUser}:\n${text}`,
          }),
        });
        const d = await res.json();
        if (d.ok) sentToTg = true;
      } catch (e) {
        console.warn('TG direct send error:', e);
      }
    }

    // Send to MAX Bot API if token provided
    if (state.maxToken && state.maxChatId) {
      try {
        const res = await fetch(`https://platform-api2.max.ru/messages?chat_id=${state.maxChatId}`, {
          method: 'POST',
          headers: {
            'Authorization': state.maxToken,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: `[WebApp] 👤 ${currentUser}:\n${text}`,
          }),
        });
        if (res.ok) sentToMax = true;
      } catch (e) {
        console.warn('MAX direct send error:', e);
      }
    }

    // Save in local sent cache
    const sentList = JSON.parse(localStorage.getItem('webapp_sent_msgs') || '[]');
    sentList.push({
      id: `wa_${Date.now()}`,
      source: 'webapp',
      authorName: currentUser,
      text: text,
      createdAt: Date.now(),
      reactions: [],
    });
    localStorage.setItem('webapp_sent_msgs', JSON.stringify(sentList.slice(-30)));

    input.value = '';
    if (btn) btn.disabled = false;
    refreshData();

    if (!sentToTg && !state.tgChatId) {
      alert('Сообщение сохранено! Укажите Telegram Chat ID в настройках (кнопка ⚙️), чтобы отправлять в группу Telegram.');
    }
  }
}

// 8. Settings UI
function initSettingsUI() {
  const modal = document.getElementById('settings-modal');
  const openBtn = document.getElementById('settings-btn');
  const closeBtn = document.getElementById('close-settings-btn');
  const saveBtn = document.getElementById('save-settings-btn');

  const tgTokenInp = document.getElementById('cfg-tg-token');
  const tgChatInp = document.getElementById('cfg-tg-chat');
  const maxTokenInp = document.getElementById('cfg-max-token');
  const maxChatInp = document.getElementById('cfg-max-chat');
  const detectTgBtn = document.getElementById('detect-tg-chat-btn');
  const detectMaxBtn = document.getElementById('detect-max-chat-btn');

  // Pre-fill
  if (tgTokenInp) tgTokenInp.value = state.tgToken;
  if (tgChatInp) tgChatInp.value = state.tgChatId;
  if (maxTokenInp) maxTokenInp.value = state.maxToken;
  if (maxChatInp) maxChatInp.value = state.maxChatId;

  openBtn?.addEventListener('click', () => modal?.classList.remove('hidden'));
  closeBtn?.addEventListener('click', () => modal?.classList.add('hidden'));

  saveBtn?.addEventListener('click', () => {
    state.tgToken = tgTokenInp?.value.trim() || DEFAULT_TG_TOKEN;
    state.tgChatId = tgChatInp?.value.trim() || '';
    state.maxToken = maxTokenInp?.value.trim() || '';
    state.maxChatId = maxChatInp?.value.trim() || '';

    localStorage.setItem('cfg_tg_token', state.tgToken);
    localStorage.setItem('cfg_tg_chat_id', state.tgChatId);
    localStorage.setItem('cfg_max_token', state.maxToken);
    localStorage.setItem('cfg_max_chat_id', state.maxChatId);

    modal?.classList.add('hidden');
    refreshData();
    alert('Настройки успешно сохранены!');
  });

  // Auto detect Telegram Chat ID
  detectTgBtn?.addEventListener('click', async () => {
    detectTgBtn.textContent = 'Поиск...';
    try {
      const res = await fetch(`https://api.telegram.org/bot${state.tgToken}/getUpdates`);
      const data = await res.json();
      if (data.ok && Array.isArray(data.result) && data.result.length > 0) {
        for (let i = data.result.length - 1; i >= 0; i--) {
          const u = data.result[i];
          const chat = u.message?.chat || u.my_chat_member?.chat || u.channel_post?.chat;
          if (chat && (chat.type === 'group' || chat.type === 'supergroup' || chat.type === 'channel')) {
            state.tgChatId = String(chat.id);
            if (tgChatInp) tgChatInp.value = state.tgChatId;
            alert(`Найден чат: "${chat.title}" (ID: ${chat.id})`);
            detectTgBtn.textContent = '🔍 Найти';
            return;
          }
        }
      }
      alert('Чат не найден в getUpdates. Отправьте любое сообщение (например, /start) в группу Telegram и нажмите снова!');
    } catch (e) {
      alert('Ошибка при запросе к Telegram: ' + e.message);
    } finally {
      detectTgBtn.textContent = '🔍 Найти';
    }
  });

  // Auto detect MAX Chat ID from window.WebApp
  detectMaxBtn?.addEventListener('click', () => {
    if (window.WebApp && window.WebApp.initDataUnsafe && window.WebApp.initDataUnsafe.chat) {
      const c = window.WebApp.initDataUnsafe.chat;
      state.maxChatId = String(c.id);
      if (maxChatInp) maxChatInp.value = state.maxChatId;
      alert(`Определен чат MAX: ID ${c.id}`);
    } else {
      alert('Для автоматического определения откройте Mini-App внутри чата MAX через WebApp bridge.');
    }
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

window.addEventListener('DOMContentLoaded', () => {
  init();

  document.getElementById('refresh-btn')?.addEventListener('click', refreshData);
  document.getElementById('send-btn')?.addEventListener('click', sendMessage);
  document.getElementById('send-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage();
  });
});
