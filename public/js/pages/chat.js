// Page logic externalized from chat.html (S9+F5 Phase C, 2026-06-25).
// Verbatim move of the original inline <script> body, plus CSP-clean handler wiring:
//  - static on*= handlers (new-chat button, conv search, sidebar toggle, back btn,
//    msg input keydown/input, send btn, modal close, user search) -> addEventListener.
//  - runtime-injected on*= handlers inside template literals (conv-item click, user-list
//    click + hover) converted to data-action / data-* attributes + delegated listeners.
// No business-logic or escaping changes.

const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
let conversations = [];
let activeConvId = null;
let allUsers = [];
let typingTimeout = null;

// ========================================
// CONVERSATIONS
// ========================================

async function loadConversations() {
    try {
        const r = await fetch('/api/chat/conversations', { headers: getAuthHeaders() });
        const result = await r.json();
        conversations = result.data || [];
        renderConversations();

        // Auto-open from URL
        const params = new URLSearchParams(window.location.search);
        const convId = params.get('conversation');
        if (convId) openConversation(parseInt(convId));
    } catch (err) {
        console.error('Load conversations error:', err);
    }
}

function renderConversations() {
    const list = document.getElementById('convList');
    if (conversations.length === 0) {
        list.innerHTML = '<div class="empty-state" style="padding: 2rem;"><p style="font-size: 0.8125rem;">No conversations yet</p></div>';
        return;
    }

    list.innerHTML = conversations.map(c => {
        const initials = (c.title || '?').split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
        const time = c.last_message_at ? formatTimeAgoChat(c.last_message_at) : '';
        const lastMsg = c.last_message ? (c.last_message.length > 40 ? c.last_message.substring(0, 40) + '...' : c.last_message) : 'No messages yet';
        const isActive = c.id === activeConvId;
        return `<div class="conv-item ${isActive ? 'active' : ''}" data-action="open-conv" data-conv-id="${c.id}" data-name="${(c.title || '').toLowerCase()}">
            <div class="conv-avatar">${initials}</div>
            <div class="conv-info">
                <div class="conv-name">${escHtml(c.title || 'Unknown')}</div>
                <div class="conv-last">${escHtml(lastMsg)}</div>
            </div>
            <div class="conv-meta">
                <span class="conv-time">${time}</span>
                ${c.unread_count > 0 ? `<span class="conv-unread">${c.unread_count}</span>` : ''}
            </div>
        </div>`;
    }).join('');
}

function filterConversations() {
    const q = document.getElementById('convSearch').value.toLowerCase();
    document.querySelectorAll('.conv-item').forEach(el => {
        el.style.display = el.dataset.name.includes(q) ? '' : 'none';
    });
}

// ========================================
// MESSAGE THREAD
// ========================================

async function openConversation(convId) {
    activeConvId = convId;
    const conv = conversations.find(c => c.id === convId);

    // Update UI
    document.getElementById('chatEmptyState').style.display = 'none';
    document.getElementById('chatThread').style.display = 'flex';
    document.getElementById('chatMain').classList.add('visible');
    document.getElementById('chatSidebar').classList.add('hidden');

    if (conv) {
        document.getElementById('threadName').textContent = conv.title || 'Conversation';
        const initials = (conv.title || '?').split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
        document.getElementById('threadAvatar').textContent = initials;
    }

    // Highlight active
    document.querySelectorAll('.conv-item').forEach(el => {
        el.classList.toggle('active', parseInt(el.dataset.convId) === convId);
    });

    // Join socket room
    const socket = typeof getSocket === 'function' ? getSocket() : null;
    if (socket) socket.emit('join_conversation', convId);

    await loadMessages(convId);

    // Mark as read
    fetch(`/api/chat/conversations/${convId}/read`, { method: 'POST', headers: getAuthHeaders() }).catch(() => {});
}

async function loadMessages(convId) {
    try {
        const r = await fetch(`/api/chat/conversations/${convId}/messages`, { headers: getAuthHeaders() });
        const result = await r.json();
        renderMessages(result.data || []);
    } catch (err) {
        console.error('Load messages error:', err);
    }
}

function renderMessages(messages) {
    const list = document.getElementById('msgList');
    if (messages.length === 0) {
        list.innerHTML = '<div class="empty-state" style="padding: 2rem;"><p style="font-size: 0.8125rem;">No messages yet. Start the conversation!</p></div>';
        return;
    }

    list.innerHTML = messages.map(m => {
        const isSent = m.sender_id === currentUser.id;
        const readBy = (m.read_by || []).filter(r => r.user_id !== m.sender_id);
        const readCheck = isSent ? (readBy.length > 0 ? '<span class="msg-read-check" style="color: #93c5fd;">✓✓</span>' : '<span class="msg-read-check" style="opacity:0.5;">✓</span>') : '';
        const time = new Date(m.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
        return `<div class="msg-bubble ${isSent ? 'msg-sent' : 'msg-received'}">
            ${!isSent ? `<div class="msg-sender">${escHtml(m.sender_name || '')}</div>` : ''}
            <div>${escHtml(m.content)}</div>
            <div class="msg-time">${time} ${readCheck}</div>
        </div>`;
    }).join('');

    // Scroll to bottom
    list.scrollTop = list.scrollHeight;
}

async function sendMessage() {
    const input = document.getElementById('msgInput');
    const content = input.value.trim();
    if (!content || !activeConvId) return;

    input.value = '';
    input.style.height = 'auto';
    document.getElementById('sendBtn').disabled = true;

    try {
        const r = await fetch(`/api/chat/conversations/${activeConvId}/messages`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ content })
        });
        const result = await r.json();
        if (result.success) {
            // Message will arrive via socket, but also add immediately
            appendMessage(result.data);
            loadConversations(); // Refresh sidebar
        }
    } catch (err) {
        console.error('Send message error:', err);
    }
}

function appendMessage(m) {
    const list = document.getElementById('msgList');
    // Clear empty state if present
    const empty = list.querySelector('.empty-state');
    if (empty) empty.remove();

    const isSent = m.sender_id === currentUser.id;
    const time = new Date(m.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    const div = document.createElement('div');
    div.className = `msg-bubble ${isSent ? 'msg-sent' : 'msg-received'}`;
    div.innerHTML = `${!isSent ? `<div class="msg-sender">${escHtml(m.sender_name || '')}</div>` : ''}
        <div>${escHtml(m.content)}</div>
        <div class="msg-time">${time}</div>`;
    list.appendChild(div);
    list.scrollTop = list.scrollHeight;
}

function handleMsgKeydown(e) {
    const btn = document.getElementById('sendBtn');
    setTimeout(() => {
        btn.disabled = !document.getElementById('msgInput').value.trim();
    }, 10);
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
}

function handleTyping() {
    const socket = typeof getSocket === 'function' ? getSocket() : null;
    if (!socket || !activeConvId) return;
    socket.emit('typing', { conversation_id: activeConvId, is_typing: true });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        socket.emit('typing', { conversation_id: activeConvId, is_typing: false });
    }, 2000);
}

// ========================================
// NEW CHAT MODAL
// ========================================

function showNewChatModal() {
    document.getElementById('newChatModal').classList.add('show');
    loadUsers();
}

function hideNewChatModal() {
    document.getElementById('newChatModal').classList.remove('show');
}

async function loadUsers() {
    try {
        const r = await fetch('/api/chat/users', { headers: getAuthHeaders() });
        const result = await r.json();
        allUsers = result.data || [];
        renderUsers(allUsers);
    } catch (err) {
        console.error('Load users error:', err);
    }
}

function renderUsers(users) {
    const list = document.getElementById('userList');
    list.innerHTML = users.map(u => {
        const initial = (u.full_name || u.username || '?')[0].toUpperCase();
        return `<div data-action="start-conv" data-user-id="${u.id}" style="padding: 10px 12px; cursor: pointer; display: flex; gap: 10px; align-items: center; border-radius: 8px; transition: background 0.15s;">
            <div class="conv-avatar" style="width: 36px; height: 36px; font-size: 13px;">${initial}</div>
            <div>
                <div style="font-weight: 600; font-size: 0.8125rem; color: #1e293b;">${escHtml(u.full_name || u.username)}</div>
                <div style="font-size: 0.75rem; color: #94a3b8;">${escHtml(u.role || '')}</div>
            </div>
        </div>`;
    }).join('');
}

function filterUsers() {
    const q = document.getElementById('userSearch').value.toLowerCase();
    renderUsers(allUsers.filter(u => (u.full_name || u.username || '').toLowerCase().includes(q)));
}

async function startConversation(userId) {
    try {
        const r = await fetch('/api/chat/conversations', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ type: 'direct', participant_ids: [userId] })
        });
        const result = await r.json();
        if (result.success) {
            hideNewChatModal();
            await loadConversations();
            openConversation(result.data.id);
        }
    } catch (err) {
        console.error('Start conversation error:', err);
    }
}

function backToList() {
    document.getElementById('chatMain').classList.remove('visible');
    document.getElementById('chatSidebar').classList.remove('hidden');
}

// ========================================
// SOCKET EVENTS
// ========================================

window.addEventListener('qc-new-message', function(e) {
    const msg = e.detail;
    if (msg.conversation_id === activeConvId && msg.sender_id !== currentUser.id) {
        appendMessage(msg);
        // Mark as read
        fetch(`/api/chat/conversations/${activeConvId}/read`, { method: 'POST', headers: getAuthHeaders() }).catch(() => {});
    }
    loadConversations(); // Refresh sidebar
});

window.addEventListener('qc-user-typing', function(e) {
    const data = e.detail;
    if (data.conversation_id === activeConvId) {
        const el = document.getElementById('typingIndicator');
        if (data.is_typing) {
            el.textContent = `${data.user_name} is typing...`;
        } else {
            el.textContent = '';
        }
    }
});

window.addEventListener('qc-message-read', function(e) {
    // Could update read receipts in message bubbles
    if (e.detail.conversation_id === activeConvId) {
        loadMessages(activeConvId);
    }
});

// ========================================
// HELPERS
// ========================================

function escHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatTimeAgoChat(dateStr) {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now - d) / 1000);
    if (diff < 60) return 'now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd';
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

// Auto-resize textarea
document.addEventListener('DOMContentLoaded', () => {
    const textarea = document.getElementById('msgInput');
    if (textarea) {
        textarea.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 120) + 'px';
        });
    }
});

// Init
loadConversations();

// ─── CSP-clean handler wiring (S9+F5 Phase C) ───
// Static handlers converted from inline on*= attributes:
//   new-chat button -> id="newChatBtn"
//   conv search input -> id="convSearch"
//   mobile sidebar toggle -> id="chatSidebarToggle"
//   header back button -> id="chatBackBtn"
//   message input -> id="msgInput" (keydown + input)
//   send button -> id="sendBtn"
//   modal close button -> id="newChatCloseBtn"
//   user search input -> id="userSearch"
(function wireChatHandlers() {
    const newChatBtn = document.getElementById('newChatBtn');
    if (newChatBtn) newChatBtn.addEventListener('click', showNewChatModal);

    const convSearch = document.getElementById('convSearch');
    if (convSearch) convSearch.addEventListener('keyup', filterConversations);

    const sidebarToggle = document.getElementById('chatSidebarToggle');
    if (sidebarToggle) sidebarToggle.addEventListener('click', function() {
        var s = document.querySelector('.chat-sidebar,#chatSidebar,#conversationList,.conversation-sidebar');
        if (s) s.classList.toggle('mob-show');
    });

    const backBtn = document.getElementById('chatBackBtn');
    if (backBtn) backBtn.addEventListener('click', backToList);

    const msgInput = document.getElementById('msgInput');
    if (msgInput) {
        msgInput.addEventListener('keydown', handleMsgKeydown);
        msgInput.addEventListener('input', handleTyping);
    }

    const sendBtn = document.getElementById('sendBtn');
    if (sendBtn) sendBtn.addEventListener('click', sendMessage);

    const closeBtn = document.getElementById('newChatCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', hideNewChatModal);

    const userSearch = document.getElementById('userSearch');
    if (userSearch) userSearch.addEventListener('keyup', filterUsers);
})();

// Delegated listeners for runtime-injected handlers (template strings use data-action):
//   data-action="open-conv"   -> openConversation(Number(data-conv-id))
//   data-action="start-conv"  -> startConversation(Number(data-user-id))
//   hover on data-action="start-conv" rows reproduces the original onmouseover/onmouseout
//   background swap.
document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    switch (action) {
        case 'open-conv': {
            const id = Number(el.dataset.convId);
            openConversation(id);
            break;
        }
        case 'start-conv': {
            const id = Number(el.dataset.userId);
            startConversation(id);
            break;
        }
    }
});

document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-action="start-conv"]');
    if (el) el.style.background = '#f8fafc';
});

document.addEventListener('mouseout', (e) => {
    const el = e.target.closest('[data-action="start-conv"]');
    if (el) el.style.background = '';
});
