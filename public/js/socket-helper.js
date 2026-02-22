/**
 * Socket.io Client Helper for QC Paint Shop
 * Auto-connects with auth token, handles real-time events
 */

let qcSocket = null;
window.qcSocket = null; // Expose on window for cross-script access

function initSocket() {
    if (qcSocket && qcSocket.connected) return qcSocket;

    const token = localStorage.getItem('auth_token');
    if (!token) return null;

    // Check if socket.io client is loaded
    if (typeof io === 'undefined') {
        console.warn('Socket.io client not loaded');
        return null;
    }

    qcSocket = io({
        auth: { token },
        reconnection: true,
        reconnectionDelay: 2000,
        reconnectionAttempts: 10,
        transports: ['websocket', 'polling']
    });
    window.qcSocket = qcSocket; // Keep window ref in sync

    qcSocket.on('connect', () => {
        console.log('Socket connected');
    });

    qcSocket.on('disconnect', (reason) => {
        console.log('Socket disconnected:', reason);
    });

    qcSocket.on('connect_error', (err) => {
        console.warn('Socket connection error:', err.message);
        if (err.message === 'Invalid session' || err.message === 'Authentication required') {
            // Don't retry if auth failed
            qcSocket.disconnect();
        }
    });

    // Notification event -> dispatch custom event for header bell
    qcSocket.on('notification', (data) => {
        window.dispatchEvent(new CustomEvent('qc-notification', { detail: data }));
    });

    // Chat events
    qcSocket.on('new_message', (data) => {
        window.dispatchEvent(new CustomEvent('qc-new-message', { detail: data }));
    });

    qcSocket.on('user_typing', (data) => {
        window.dispatchEvent(new CustomEvent('qc-user-typing', { detail: data }));
    });

    qcSocket.on('message_read', (data) => {
        window.dispatchEvent(new CustomEvent('qc-message-read', { detail: data }));
    });

    return qcSocket;
}

function getSocket() {
    return qcSocket;
}

// Auto-init when DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSocket);
} else {
    initSocket();
}
