// OTP-based password reset flow. Externalized from the page inline <script>
// (S9+F5 Phase C, 2026-06-13) so the page runs under the enforced strict CSP.
// Uses escHtml from /js/qc-escape.js (loaded earlier in the page).
let otpId = null;

const errEl = document.getElementById('errorMessage');
function showError(msg) {
    errEl.textContent = msg;
    errEl.classList.remove('hidden');
}
function clearError() {
    errEl.classList.add('hidden');
    errEl.textContent = '';
}

function goToStep(n) {
    ['step1','step2','step3','step4'].forEach((id, idx) => {
        document.getElementById(id).classList.toggle('hidden', idx !== n - 1);
    });
    const captions = {
        1: 'Enter your registered mobile to receive an OTP',
        2: 'Enter the 6-digit code we sent via SMS',
        3: 'Choose a new password for your account',
        4: 'All done!',
    };
    document.getElementById('stepCaption').textContent = captions[n] || '';
    if (n === 4) document.getElementById('footerLinks').classList.add('hidden');
    clearError();
}

// OTP input auto-advance
document.querySelectorAll('.otp-input').forEach((input, idx, arr) => {
    input.addEventListener('input', e => {
        const v = e.target.value.replace(/\D/g, '');
        e.target.value = v;
        if (v && idx < arr.length - 1) arr[idx + 1].focus();
    });
    input.addEventListener('keydown', e => {
        if (e.key === 'Backspace' && !e.target.value && idx > 0) arr[idx - 1].focus();
    });
});
function getOtp() {
    return Array.from(document.querySelectorAll('.otp-input')).map(i => i.value).join('');
}

async function sendOtp() {
    const mobile = document.getElementById('mobile').value.trim();
    if (!/^[6-9]\d{9}$/.test(mobile)) {
        return showError('Enter a valid 10-digit Indian mobile number.');
    }
    const btn = document.getElementById('btnSendOtp');
    btn.disabled = true; btn.textContent = 'Sending...';
    try {
        const res = await fetch('/api/otp/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mobile, purpose: 'Password Reset' }),
        });
        const data = await res.json();
        if (data.success) {
            if (data.data && data.data.otp_id) {
                otpId = data.data.otp_id;
                goToStep(2);
            } else {
                // Generic privacy response — no user with this mobile.
                // Show the same step-2 framing so we don't leak whether
                // the number is registered; verify will simply fail.
                otpId = 0;
                goToStep(2);
            }
            document.getElementById('otpSentMsg').innerHTML =
                `If <strong>${escHtml(mobile)}</strong> is registered, an OTP was sent via SMS.`;
        } else {
            showError(data.error || data.message || 'Could not send OTP. Try again.');
        }
    } catch (e) {
        showError('Network error. Please try again.');
    }
    btn.disabled = false; btn.textContent = 'Send OTP';
}

async function verifyOtp() {
    const otp = getOtp();
    if (otp.length !== 6) return showError('Enter the 6-digit code.');
    if (!otpId) return showError('No OTP request found for this number.');
    const mobile = document.getElementById('mobile').value.trim();
    const btn = document.getElementById('btnVerifyOtp');
    btn.disabled = true; btn.textContent = 'Verifying...';
    try {
        const res = await fetch('/api/otp/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mobile, otp_code: otp, purpose: 'Password Reset' }),
        });
        const data = await res.json();
        if (data.success) {
            otpId = data.data.id;
            goToStep(3);
        } else {
            showError(data.error || data.message || 'Invalid or expired code.');
        }
    } catch (e) {
        showError('Network error. Please try again.');
    }
    btn.disabled = false; btn.textContent = 'Verify Code';
}

async function resetPassword() {
    const password = document.getElementById('password').value;
    const confirm = document.getElementById('passwordConfirm').value;
    if (password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
        return showError('Password must be at least 8 characters with one uppercase letter and one number.');
    }
    if (password !== confirm) return showError('Passwords do not match.');

    const mobile = document.getElementById('mobile').value.trim();
    const btn = document.getElementById('btnReset');
    btn.disabled = true; btn.textContent = 'Resetting...';
    try {
        const res = await fetch('/api/auth/forgot-password-mobile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mobile, otp_id: otpId, password }),
        });
        const data = await res.json();
        if (data.success) {
            goToStep(4);
        } else {
            showError(data.message || 'Reset failed. Try again.');
        }
    } catch (e) {
        showError('Network error. Please try again.');
    }
    btn.disabled = false; btn.textContent = 'Reset Password';
}

document.getElementById('btnSendOtp').addEventListener('click', sendOtp);
document.getElementById('btnVerifyOtp').addEventListener('click', verifyOtp);
document.getElementById('btnBack1').addEventListener('click', () => goToStep(1));
document.getElementById('btnReset').addEventListener('click', resetPassword);

document.getElementById('mobile').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); sendOtp(); }
});
