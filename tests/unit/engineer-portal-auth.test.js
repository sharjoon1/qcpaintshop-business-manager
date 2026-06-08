/**
 * Unit test for the engineer-portal handleAuthFail decision (Cluster C / PAGE-301, PAGE-305).
 *
 * Locks the 401-vs-403 distinction: 401 = invalid/expired session -> log out; 403 = valid
 * session but account not approved -> do NOT log out, so a pending engineer is never bounced
 * into the login loop. Before the fix both statuses triggered logout.
 *
 * Pure node: the engineer-portal IIFE is loaded with minimal browser-global shims (no jsdom).
 * Requiring it runs init() once; we then exercise the exported window.EP.handleAuthFail.
 */

function makeLocalStorage() {
    const m = new Map();
    return {
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => { m.set(k, String(v)); },
        removeItem: (k) => { m.delete(k); },
        _map: m,
    };
}

let EP, win, store;

beforeAll(() => {
    store = makeLocalStorage();
    win = { location: { href: '' }, addEventListener: () => {} };
    const doc = {
        readyState: 'complete',
        body: { dataset: {}, getAttribute: () => null },
        getElementById: () => null,
        querySelectorAll: () => [],
        addEventListener: () => {},
    };
    global.localStorage = store;
    global.window = win;
    global.document = doc;
    // Loading the IIFE runs init() once (authGate redirects to login since there is no token).
    require('../../public/js/engineer-portal.js');
    EP = win.EP;
});

beforeEach(() => {
    store._map.clear();
    win.location.href = '/engineer-dashboard.html';
});

test('exposes handleAuthFail', () => {
    expect(typeof EP.handleAuthFail).toBe('function');
});

test('401 -> logout: clears the session and redirects to login', () => {
    store.setItem('engineer_token', 'abc');
    const handled = EP.handleAuthFail({ status: 401 });
    expect(handled).toBe(true);
    expect(win.location.href).toBe('/engineer-login.html');
    expect(store.getItem('engineer_token')).toBeNull();
});

test('403 -> NOT a logout: session preserved and no redirect (pending stays signed in)', () => {
    store.setItem('engineer_token', 'abc');
    const handled = EP.handleAuthFail({ status: 403 });
    expect(handled).toBe(true);                                  // caller still short-circuits...
    expect(win.location.href).toBe('/engineer-dashboard.html');  // ...but is NOT redirected
    expect(store.getItem('engineer_token')).toBe('abc');         // ...and the token is kept
});

test('200 -> not an auth failure', () => {
    expect(EP.handleAuthFail({ status: 200 })).toBe(false);
});

test('null response -> not an auth failure', () => {
    expect(EP.handleAuthFail(null)).toBe(false);
});
