// admin-wa-settings page logic — externalized from admin-wa-settings.html (S9+F5 strict CSP).
// NON-deferred, loaded right before </body> (matches original end-of-body timing).
const token = localStorage.getItem('auth_token');

const SETTING_KEYS = [
    'min_delay', 'max_delay',
    'hourly_limit', 'daily_limit',
    'typing_delay_min', 'typing_delay_max',
    'seen_delay_min', 'seen_delay_max',
    'warmup_day1', 'warmup_day2', 'warmup_day3', 'warmup_day4', 'warmup_day5',
    'max_consecutive_failures', 'engine_poll_interval',
    'invisible_markers_enabled'
];

async function loadSettings() {
    try {
        const res = await fetch('/api/wa-marketing/settings', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!res.ok) throw new Error('Failed to load settings');
        const data = await res.json();
        const settings = data.settings || data;

        // Populate fields
        SETTING_KEYS.forEach(key => {
            const el = document.getElementById(key);
            if (!el) return;
            const val = settings[key];
            if (val === undefined || val === null) return;
            if (key === 'invisible_markers_enabled') {
                el.checked = Number(val) === 1;
            } else {
                el.value = val;
            }
        });

        document.getElementById('loadingState').style.display = 'none';
        document.getElementById('settingsContent').style.display = 'block';
    } catch (err) {
        document.getElementById('loadingState').innerHTML =
            '<p style="color:#ef4444; font-size:0.9rem;">Failed to load settings. Please refresh.</p>';
        console.error(err);
    }
}

async function saveAll() {
    const btn = document.getElementById('saveBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
        const body = {};
        SETTING_KEYS.forEach(key => {
            const el = document.getElementById(key);
            if (!el) return;
            if (key === 'invisible_markers_enabled') {
                body[key] = el.checked ? 1 : 0;
            } else {
                body[key] = Number(el.value);
            }
        });

        // Basic validation
        if (body.min_delay >= body.max_delay) {
            showToast('Min delay must be less than max delay', 'error');
            return;
        }
        if (body.typing_delay_min >= body.typing_delay_max) {
            showToast('Typing delay min must be less than max', 'error');
            return;
        }
        if (body.seen_delay_min >= body.seen_delay_max) {
            showToast('Seen delay min must be less than max', 'error');
            return;
        }
        if (body.hourly_limit > body.daily_limit) {
            showToast('Hourly limit cannot exceed daily limit', 'error');
            return;
        }

        const res = await fetch('/api/wa-marketing/settings', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || 'Save failed');
        }

        showToast('Settings saved successfully', 'success');
    } catch (err) {
        showToast(err.message || 'Failed to save settings', 'error');
        console.error(err);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save All Settings';
    }
}

function showToast(msg, type) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast ' + type;
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => t.classList.remove('show'), 3000);
}

// Converted from onclick="saveAll()" on #saveBtn (S9+F5 strict CSP).
document.getElementById('saveBtn').addEventListener('click', saveAll);

loadSettings();
