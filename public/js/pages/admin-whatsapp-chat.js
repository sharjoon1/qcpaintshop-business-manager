// Page logic for WhatsApp Chat. Externalized from admin-whatsapp-chat.html inline <script>
// (S9+F5 Phase C, 2026-06-25) so the page runs under the enforced strict CSP.
// Verbatim move of all functions; inline on*= handlers converted to addEventListener /
// data-action delegation. No logic changes, no renames, escaping helpers untouched.
const API = '/api/whatsapp-chat';
const token = localStorage.getItem('auth_token');
const user = JSON.parse(localStorage.getItem('user') || '{}');
const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

let currentPhone = null;
let currentBranchId = null;
let currentContact = null;
let conversations = [];
let oldestMsgId = null;
let loadingMore = false;
let searchTimer = null;

// ========================================
// INIT
// ========================================
async function init() {
    await loadBranches();
    await loadConversations();
    loadStats();
    initSocket();
}

async function loadBranches() {
    try {
        const res = await fetch('/api/branches', { headers });
        const data = await res.json();
        const select = document.getElementById('branchFilter');
        (data.branches || data).forEach(b => {
            select.insertAdjacentHTML('beforeend', `<option value="${b.id}">${b.name}</option>`);
        });
    } catch (e) { console.error('Load branches error:', e); }
}

// ========================================
// CONVERSATIONS
// ========================================
async function loadConversations() {
    const branchId = document.getElementById('branchFilter').value;
    const search = document.getElementById('searchInput').value;
    const params = new URLSearchParams({ limit: 100 });
    if (branchId) params.set('branch_id', branchId);
    if (search) params.set('search', search);

    try {
        const res = await fetch(`${API}/conversations?${params}`, { headers });
        const data = await res.json();
        conversations = data.conversations || [];
        renderConversations();
    } catch (e) {
        console.error('Load conversations error:', e);
        document.getElementById('convList').innerHTML = '<div style="padding:20px;color:#ef4444;text-align:center;">Failed to load</div>';
    }
}

function renderConversations() {
    const list = document.getElementById('convList');
    if (conversations.length === 0) {
        list.innerHTML = '<div style="text-align:center;padding:40px;color:#8696a0;">No conversations yet</div>';
        return;
    }

    list.innerHTML = conversations.map(c => {
        const name = c.saved_name || c.pushname || formatPhone(c.phone_number);
        const initial = (name[0] || '?').toUpperCase();
        const isActive = currentPhone === c.phone_number && currentBranchId == c.branch_id;
        const timeStr = c.last_message_at ? formatTime(c.last_message_at) : '';
        let preview = '';
        if (c.last_message_type && c.last_message_type !== 'text') {
            const icons = { image: '📷 Photo', video: '🎥 Video', audio: '🎵 Audio', document: '📄 Document', sticker: '🏷️ Sticker', location: '📍 Location', contact: '👤 Contact' };
            preview = icons[c.last_message_type] || c.last_message_type;
        } else {
            preview = c.last_message || '';
        }
        if (c.last_direction === 'out') preview = '<span class="direction-icon">↩</span> ' + preview;
        const pin = c.is_pinned ? '<span class="pin-icon">📌</span>' : '';
        const isGeneral = c.branch_id == 0;
        const isAdmin = c.branch_id == -1;
        const accountBadge = isAdmin
            ? '<span class="conv-account admin">Admin</span>'
            : isGeneral
            ? '<span class="conv-account general">General</span>'
            : (c.branch_name ? `<span class="conv-account branch">${escHtml(c.branch_name)}</span>` : '');

        return `<div class="conv-item${isActive ? ' active' : ''}" data-action="openChat" data-phone="${c.phone_number}" data-branch="${c.branch_id}">
            <div class="conv-avatar">${initial}</div>
            <div class="conv-info">
                <div class="conv-name">${escHtml(name)} ${pin}</div>
                <div class="conv-preview">${preview}</div>
                ${accountBadge}
            </div>
            <div class="conv-meta">
                <div class="conv-time${c.unread_count > 0 ? ' has-unread' : ''}">${timeStr}</div>
                ${c.unread_count > 0 ? `<div class="conv-unread">${c.unread_count}</div>` : ''}
            </div>
        </div>`;
    }).join('');
}

function debounceSearch() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadConversations(), 300);
}

// ========================================
// OPEN CHAT
// ========================================
async function openChat(phone, branchId) {
    currentPhone = phone;
    currentBranchId = branchId;
    oldestMsgId = null;

    // Find contact data
    currentContact = conversations.find(c => c.phone_number === phone && c.branch_id == branchId) || {};

    // Update header
    const name = currentContact.saved_name || currentContact.pushname || formatPhone(phone);
    const accountLabel = branchId == -1 ? 'Admin WhatsApp' : branchId == 0 ? 'General WhatsApp' : (currentContact.branch_name || '');
    document.getElementById('chatAvatar').textContent = (name[0] || '?').toUpperCase();
    document.getElementById('chatName').textContent = name;
    document.getElementById('chatPhone').innerHTML = '+' + phone + (accountLabel ? ` · <span class="chat-header-account">via ${escHtml(accountLabel)}</span>` : '');

    // Update pin/mute buttons
    updateContactButtons();

    // Show chat panel
    document.getElementById('chatEmpty').style.display = 'none';
    document.getElementById('chatActive').style.display = 'flex';
    document.getElementById('chatPanel').classList.add('mobile-show');

    // Mark active in list
    document.querySelectorAll('.conv-item').forEach(el => el.classList.remove('active'));
    const activeEl = document.querySelector(`.conv-item[data-phone="${phone}"][data-branch="${branchId}"]`);
    if (activeEl) activeEl.classList.add('active');

    // Load messages
    await loadMessages();

    // Mark as read
    markRead();

    // Focus input
    document.getElementById('msgInput').focus();
}

async function loadMessages(loadMore = false) {
    const params = new URLSearchParams({ branch_id: currentBranchId, limit: 50 });
    if (loadMore && oldestMsgId) params.set('before_id', oldestMsgId);

    try {
        const res = await fetch(`${API}/conversations/${currentPhone}/messages?${params}`, { headers });
        const data = await res.json();
        const msgs = data.messages || [];

        if (msgs.length > 0) {
            oldestMsgId = msgs[0].id;
        }

        if (loadMore) {
            prependMessages(msgs, data.has_more);
        } else {
            renderMessages(msgs, data.has_more);
            scrollToBottom();
        }
    } catch (e) {
        console.error('Load messages error:', e);
    }
}

function renderMessages(msgs, hasMore) {
    const container = document.getElementById('chatMessages');
    let html = '';

    if (hasMore) {
        html += '<div class="load-more"><button data-action="loadOlder">Load older messages</button></div>';
    }

    html += buildMessageHtml(msgs);
    container.innerHTML = html;
}

function prependMessages(msgs, hasMore) {
    const container = document.getElementById('chatMessages');
    let html = '';
    if (hasMore) {
        html += '<div class="load-more"><button data-action="loadOlder">Load older messages</button></div>';
    }
    html += buildMessageHtml(msgs);

    // Remove existing load-more button
    const existing = container.querySelector('.load-more');
    if (existing) existing.remove();

    container.insertAdjacentHTML('afterbegin', html);
    loadingMore = false;
}

function buildMessageHtml(msgs) {
    let html = '';
    let lastDate = '';

    msgs.forEach(msg => {
        const msgDate = new Date(msg.timestamp).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        if (msgDate !== lastDate) {
            html += `<div class="date-separator"><span>${msgDate}</span></div>`;
            lastDate = msgDate;
        }
        html += renderBubble(msg);
    });

    return html;
}

function renderBubble(msg) {
    const dir = msg.direction;
    const time = new Date(msg.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    let content = '';

    // Sender name for incoming
    if (dir === 'in' && msg.sender_name) {
        content += `<div class="msg-sender">${escHtml(msg.sender_name)}</div>`;
    }

    // Media content — media_url is inbound (sender-influenced): allowlist the URL scheme and
    // escape it into attributes; the lightbox opens via delegation (data-lightbox), not inline onclick.
    const mu = safeMediaUrl(msg.media_url);
    if (msg.message_type === 'image' && msg.media_url) {
        content += `<div class="msg-media"><img src="${escHtml(mu)}" loading="lazy" data-lightbox="${escHtml(mu)}" alt="Image"></div>`;
        if (msg.caption) content += `<div class="msg-caption">${escHtml(msg.caption)}</div>`;
    } else if (msg.message_type === 'video' && msg.media_url) {
        content += `<div class="msg-media"><video controls preload="metadata" src="${escHtml(mu)}"></video></div>`;
        if (msg.caption) content += `<div class="msg-caption">${escHtml(msg.caption)}</div>`;
    } else if (msg.message_type === 'audio' && msg.media_url) {
        content += `<div class="msg-media"><audio controls preload="metadata" src="${escHtml(mu)}"></audio></div>`;
    } else if (msg.message_type === 'document' && msg.media_url) {
        const fname = msg.media_filename || 'Document';
        content += `<a class="msg-doc" href="${escHtml(mu)}" download="${escHtml(fname)}" target="_blank">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            <span>${escHtml(fname)}</span></a>`;
        if (msg.caption) content += `<div class="msg-caption">${escHtml(msg.caption)}</div>`;
    } else if (msg.message_type === 'sticker') {
        if (msg.media_url) content += `<div class="msg-media"><img src="${escHtml(mu)}" style="max-width:150px" alt="Sticker"></div>`;
        else content += `<div class="msg-text" style="font-style:italic;color:#8696a0;">Sticker</div>`;
    } else if (msg.message_type === 'location') {
        content += `<div class="msg-text" style="font-style:italic;">📍 Location shared</div>`;
    } else if (msg.message_type === 'contact') {
        content += `<div class="msg-text" style="font-style:italic;">👤 Contact shared</div>`;
    } else {
        content += `<div class="msg-text">${linkify(escHtml(msg.body || ''))}</div>`;
    }

    // Footer with time, source, status
    let footer = `<span class="msg-time">${time}</span>`;
    if (dir === 'out' && msg.source && msg.source !== 'admin_reply' && msg.source !== 'incoming') {
        footer += `<span class="msg-source">${msg.source}</span>`;
    }
    if (dir === 'out') {
        footer += statusIcon(msg.status);
    }

    return `<div class="msg-bubble ${dir}" data-msg-id="${msg.whatsapp_msg_id || ''}" data-id="${msg.id}">
        ${content}
        <div class="msg-footer">${footer}</div>
    </div>`;
}

function statusIcon(status) {
    if (status === 'read') return `<span class="msg-status read"><svg viewBox="0 0 16 11"><path d="M11.071.653a.457.457 0 00-.304-.102.493.493 0 00-.381.178l-6.19 7.636-2.011-2.095a.463.463 0 00-.659.003.423.423 0 00-.003.64l2.358 2.46a.465.465 0 00.349.154h.046a.468.468 0 00.34-.186l6.536-8.075a.422.422 0 00-.081-.613z" fill="currentColor"/><path d="M15.071.653a.457.457 0 00-.304-.102.493.493 0 00-.381.178l-6.19 7.636-1.2-1.25-.648.8 1.505 1.57a.465.465 0 00.349.154h.046a.468.468 0 00.34-.186l6.536-8.075a.422.422 0 00-.053-.725z" fill="currentColor"/></svg></span>`;
    if (status === 'delivered') return `<span class="msg-status delivered"><svg viewBox="0 0 16 11"><path d="M11.071.653a.457.457 0 00-.304-.102.493.493 0 00-.381.178l-6.19 7.636-2.011-2.095a.463.463 0 00-.659.003.423.423 0 00-.003.64l2.358 2.46a.465.465 0 00.349.154h.046a.468.468 0 00.34-.186l6.536-8.075a.422.422 0 00-.081-.613z" fill="currentColor"/><path d="M15.071.653a.457.457 0 00-.304-.102.493.493 0 00-.381.178l-6.19 7.636-1.2-1.25-.648.8 1.505 1.57a.465.465 0 00.349.154h.046a.468.468 0 00.34-.186l6.536-8.075a.422.422 0 00-.053-.725z" fill="currentColor"/></svg></span>`;
    if (status === 'sent') return `<span class="msg-status sent"><svg viewBox="0 0 16 11"><path d="M11.071.653a.457.457 0 00-.304-.102.493.493 0 00-.381.178l-6.19 7.636-2.011-2.095a.463.463 0 00-.659.003.423.423 0 00-.003.64l2.358 2.46a.465.465 0 00.349.154h.046a.468.468 0 00.34-.186l6.536-8.075a.422.422 0 00-.081-.613z" fill="currentColor"/></svg></span>`;
    if (status === 'failed') return `<span class="msg-status failed"><svg viewBox="0 0 16 11"><path d="M8 1L1 10h14L8 1z" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="8" y1="4" x2="8" y2="7" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="9" r="0.5" fill="currentColor"/></svg></span>`;
    return '';
}

// ========================================
// SEND
// ========================================
async function sendReply() {
    const input = document.getElementById('msgInput');
    const message = input.value.trim();
    if (!message || !currentPhone || !currentBranchId) return;

    input.value = '';
    autoResize(input);

    // Optimistic render
    const now = new Date();
    appendBubble({
        direction: 'out', message_type: 'text', body: message,
        timestamp: now.toISOString(), status: 'pending', source: 'admin_reply'
    });

    try {
        await fetch(`${API}/conversations/${currentPhone}/send`, {
            method: 'POST', headers,
            body: JSON.stringify({ branch_id: currentBranchId, message })
        });
    } catch (e) {
        console.error('Send error:', e);
    }
}

async function sendMediaFile() {
    const fileInput = document.getElementById('fileInput');
    const file = fileInput.files[0];
    if (!file || !currentPhone || !currentBranchId) return;

    const caption = prompt('Caption (optional):') || '';

    const formData = new FormData();
    formData.append('media', file);
    formData.append('branch_id', currentBranchId);
    if (caption) formData.append('caption', caption);

    // Optimistic render
    const now = new Date();
    const msgType = file.type.startsWith('image/') ? 'image' : 'document';
    appendBubble({
        direction: 'out', message_type: msgType, body: null,
        media_url: URL.createObjectURL(file), caption,
        media_filename: file.name,
        timestamp: now.toISOString(), status: 'pending', source: 'admin_reply'
    });

    try {
        await fetch(`${API}/conversations/${currentPhone}/send-media`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
    } catch (e) {
        console.error('Send media error:', e);
    }

    fileInput.value = '';
}

function appendBubble(msg) {
    const container = document.getElementById('chatMessages');
    container.insertAdjacentHTML('beforeend', renderBubble(msg));
    scrollToBottom();
}

// ========================================
// MARK READ
// ========================================
async function markRead() {
    if (!currentPhone || !currentBranchId) return;
    try {
        await fetch(`${API}/conversations/${currentPhone}/read`, {
            method: 'PUT', headers,
            body: JSON.stringify({ branch_id: currentBranchId })
        });
        // Update conversation list
        const conv = conversations.find(c => c.phone_number === currentPhone && c.branch_id == currentBranchId);
        if (conv) {
            conv.unread_count = 0;
            renderConversations();
        }
        loadStats();
    } catch (e) { console.error('Mark read error:', e); }
}

// ========================================
// CONTACT ACTIONS
// ========================================
function updateContactButtons() {
    const pinBtn = document.getElementById('pinBtn');
    const muteBtn = document.getElementById('muteBtn');
    pinBtn.textContent = currentContact?.is_pinned ? 'Unpin' : 'Pin';
    pinBtn.classList.toggle('active', !!currentContact?.is_pinned);
    muteBtn.textContent = currentContact?.is_muted ? 'Unmute' : 'Mute';
    muteBtn.classList.toggle('active', !!currentContact?.is_muted);
}

async function togglePin() {
    const newVal = currentContact?.is_pinned ? 0 : 1;
    await updateContact({ is_pinned: newVal });
    if (currentContact) currentContact.is_pinned = newVal;
    updateContactButtons();
    loadConversations();
}

async function toggleMute() {
    const newVal = currentContact?.is_muted ? 0 : 1;
    await updateContact({ is_muted: newVal });
    if (currentContact) currentContact.is_muted = newVal;
    updateContactButtons();
}

async function editContactName() {
    const current = currentContact?.saved_name || '';
    const name = prompt('Contact name:', current);
    if (name === null) return;
    await updateContact({ saved_name: name });
    if (currentContact) currentContact.saved_name = name;
    document.getElementById('chatName').textContent = name || currentContact?.pushname || formatPhone(currentPhone);
    loadConversations();
}

async function updateContact(data) {
    try {
        await fetch(`${API}/contacts/${currentPhone}`, {
            method: 'PUT', headers,
            body: JSON.stringify({ branch_id: currentBranchId, ...data })
        });
    } catch (e) { console.error('Update contact error:', e); }
}

// ========================================
// SCROLL & LOAD MORE
// ========================================
function scrollToBottom() {
    const el = document.getElementById('chatMessages');
    setTimeout(() => { el.scrollTop = el.scrollHeight; }, 50);
}

function handleScroll() {
    const el = document.getElementById('chatMessages');
    if (el.scrollTop < 50 && !loadingMore && oldestMsgId) {
        loadOlder();
    }
}

async function loadOlder() {
    if (loadingMore) return;
    loadingMore = true;
    await loadMessages(true);
}

// ========================================
// STATS
// ========================================
async function loadStats() {
    try {
        const branchId = document.getElementById('branchFilter').value;
        const params = branchId ? `?branch_id=${branchId}` : '';
        const res = await fetch(`${API}/stats${params}`, { headers });
        const data = await res.json();
        document.getElementById('statConv').textContent = data.total_conversations || 0;
        document.getElementById('statUnread').textContent = data.unread_count || 0;
        document.getElementById('statToday').textContent = data.messages_today || 0;
    } catch (e) { console.error('Stats error:', e); }
}

// ========================================
// SOCKET.IO
// ========================================
function initSocket() {
    if (typeof initSocketConnection !== 'function') return;
    const socket = initSocketConnection();
    if (!socket) return;

    socket.emit('join_whatsapp_chat_admin');

    // Incoming message
    socket.on('whatsapp_message_incoming', (data) => {
        // Update conversation list
        updateConvFromSocket(data);

        // If current chat, append bubble
        if (currentPhone === data.phone_number && currentBranchId == data.branch_id) {
            appendBubble({
                direction: 'in',
                message_type: data.message_type,
                body: data.body,
                media_url: data.media_url,
                media_mime_type: data.media_mime_type,
                media_filename: data.media_filename,
                caption: data.caption,
                sender_name: data.sender_name,
                timestamp: data.timestamp,
                status: 'delivered'
            });
            markRead();
        }

        loadStats();
    });

    // Outbound message sent (from this or another admin)
    socket.on('whatsapp_message_sent', (data) => {
        updateConvFromSocket(data);
        // If current chat and not already rendered (from optimistic), we could refresh
        // For simplicity, optimistic render handles own messages
        if (currentPhone === data.phone_number && currentBranchId == data.branch_id) {
            // Reload to sync (only if sent from another admin session)
            // We skip this to avoid duplicate renders from optimistic
        }
    });

    // Status update (delivery/read receipts)
    socket.on('whatsapp_message_status', (data) => {
        const el = document.querySelector(`.msg-bubble[data-msg-id="${data.whatsapp_msg_id}"]`);
        if (el) {
            const statusEl = el.querySelector('.msg-status');
            if (statusEl) {
                statusEl.className = 'msg-status ' + data.status;
                statusEl.innerHTML = statusIcon(data.status).replace(/<span[^>]*>|<\/span>/g, '');
            }
        }
    });
}

function updateConvFromSocket(data) {
    const idx = conversations.findIndex(c => c.phone_number === data.phone_number && c.branch_id == data.branch_id);
    if (idx >= 0) {
        conversations[idx].last_message_at = data.timestamp;
        conversations[idx].last_message = data.body;
        conversations[idx].last_message_type = data.message_type;
        conversations[idx].last_direction = data.direction;
        if (data.direction === 'in' && !(currentPhone === data.phone_number && currentBranchId == data.branch_id)) {
            conversations[idx].unread_count = (conversations[idx].unread_count || 0) + 1;
        }
        // Move to top (after pinned)
        const conv = conversations.splice(idx, 1)[0];
        const pinnedCount = conversations.filter(c => c.is_pinned).length;
        conversations.splice(conv.is_pinned ? 0 : pinnedCount, 0, conv);
    } else {
        // New conversation — reload
        loadConversations();
        return;
    }
    renderConversations();
}

// ========================================
// MOBILE
// ========================================
function closeChat() {
    document.getElementById('chatPanel').classList.remove('mobile-show');
    currentPhone = null;
    currentBranchId = null;
}

// ========================================
// LIGHTBOX
// ========================================
// Allow only http(s)/relative media URLs (blocks dangerous schemes like data: or the js-URI scheme from inbound media).
function safeMediaUrl(u) {
    u = String(u == null ? '' : u);
    return (/^https?:\/\//i.test(u) || (u.charAt(0) === '/' && u.charAt(1) !== '/')) ? u : '';
}
// Open the lightbox via event delegation instead of an inline onclick on each <img>.
document.addEventListener('click', function(e) {
    const img = e.target.closest('[data-lightbox]');
    if (img) openLightbox(img.getAttribute('data-lightbox'));
});
function openLightbox(url) {
    document.getElementById('lightboxImg').src = safeMediaUrl(url);
    document.getElementById('lightbox').classList.add('show');
}
function closeLightbox() {
    document.getElementById('lightbox').classList.remove('show');
}

// ========================================
// HELPERS
// ========================================
function formatPhone(phone) {
    if (!phone) return '';
    if (phone.startsWith('91') && phone.length === 12) {
        return '+91 ' + phone.substring(2, 7) + ' ' + phone.substring(7);
    }
    return '+' + phone;
}

function formatTime(dateStr) {
    const d = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now - d) / 86400000);

    if (diffDays === 0) {
        return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    } else if (diffDays === 1) {
        return 'Yesterday';
    } else if (diffDays < 7) {
        return d.toLocaleDateString('en-IN', { weekday: 'short' });
    } else {
        return d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: '2-digit' });
    }
}

function escHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function linkify(text) {
    return text.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" style="color:#039be5;text-decoration:underline;">$1</a>');
}

function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 100) + 'px';
}

// ── Static handler wiring (externalized from inline on*= attributes; S9+F5 Phase C, 2026-06-25) ──
document.addEventListener('DOMContentLoaded', function() {
    // branchFilter onchange -> loadConversations
    document.getElementById('branchFilter').addEventListener('change', loadConversations);
    // searchInput oninput -> debounceSearch
    document.getElementById('searchInput').addEventListener('input', debounceSearch);
    // chat-header-back onclick -> closeChat
    document.querySelector('.chat-header-back').addEventListener('click', closeChat);
    // pin/mute/edit contact buttons
    document.getElementById('pinBtn').addEventListener('click', togglePin);
    document.getElementById('muteBtn').addEventListener('click', toggleMute);
    document.getElementById('editNameBtn').addEventListener('click', editContactName);
    // chatMessages onscroll -> handleScroll
    document.getElementById('chatMessages').addEventListener('scroll', handleScroll);
    // attach-btn onclick -> open file picker
    document.querySelector('.attach-btn').addEventListener('click', function() {
        document.getElementById('fileInput').click();
    });
    // fileInput onchange -> sendMediaFile
    document.getElementById('fileInput').addEventListener('change', sendMediaFile);
    // msgInput onkeydown (Enter to send) + oninput (auto-resize)
    const msgInput = document.getElementById('msgInput');
    msgInput.addEventListener('keydown', function(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendReply();
        }
    });
    msgInput.addEventListener('input', function() { autoResize(this); });
    // send-btn onclick -> sendReply
    document.getElementById('sendBtn').addEventListener('click', sendReply);
    // lightbox onclick -> closeLightbox
    document.getElementById('lightbox').addEventListener('click', closeLightbox);

    // Delegated runtime handler for elements rebuilt inside innerHTML:
    //   - conv-item (data-action="openChat") with data-phone / data-branch
    //   - load-more button (data-action="loadOlder")
    document.addEventListener('click', function(e) {
        var el = e.target.closest('[data-action]');
        if (!el) return;
        var action = el.dataset.action;
        switch (action) {
            case 'openChat': {
                var phone = el.dataset.phone;
                var branchId = el.dataset.branch;
                if (phone != null && branchId != null) openChat(phone, Number(branchId));
                break;
            }
            case 'loadOlder':
                loadOlder();
                break;
        }
    });
});

// Start
init();
