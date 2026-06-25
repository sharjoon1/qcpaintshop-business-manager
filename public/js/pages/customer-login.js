let customerPhone = '';
let resendInterval = null;

// Phone input cleanup
document.getElementById('phone').addEventListener('input', function() {
    this.value = this.value.replace(/[^0-9]/g, '').slice(0, 10);
});

// Send OTP
document.getElementById('phoneForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const phone = document.getElementById('phone').value;
    if (!/^[6-9]\d{9}$/.test(phone)) {
        showError('phoneError', 'Please enter a valid 10-digit mobile number');
        return;
    }

    const btn = document.getElementById('sendOtpBtn');
    btn.disabled = true;
    btn.textContent = 'Sending...';
    hideError('phoneError');

    try {
        const r = await fetch('/api/customer/auth/send-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone })
        });
        const result = await r.json();
        if (result.success) {
            customerPhone = phone;
            document.getElementById('otpPhoneDisplay').textContent = '+91 ' + phone;
            document.getElementById('phoneStep').classList.add('hidden');
            document.getElementById('otpStep').classList.remove('hidden');
            startResendTimer();
            document.querySelector('[data-otp="0"]').focus();
        } else {
            showError('phoneError', result.message || 'Failed to send OTP');
        }
    } catch (err) {
        showError('phoneError', 'Network error. Please try again.');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Send OTP';
    }
});

// OTP input auto-advance
document.querySelectorAll('.otp-input').forEach((input, idx) => {
    input.addEventListener('input', function() {
        this.value = this.value.replace(/[^0-9]/g, '');
        if (this.value && idx < 5) {
            document.querySelector(`[data-otp="${idx + 1}"]`).focus();
        }
        if (idx === 5 && this.value) verifyOTP();
    });
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Backspace' && !this.value && idx > 0) {
            document.querySelector(`[data-otp="${idx - 1}"]`).focus();
        }
    });
    input.addEventListener('paste', function(e) {
        e.preventDefault();
        const paste = (e.clipboardData.getData('text') || '').replace(/[^0-9]/g, '').slice(0, 6);
        paste.split('').forEach((char, i) => {
            const el = document.querySelector(`[data-otp="${i}"]`);
            if (el) el.value = char;
        });
        if (paste.length === 6) verifyOTP();
    });
});

// Verify OTP
async function verifyOTP() {
    const otp = Array.from(document.querySelectorAll('.otp-input')).map(i => i.value).join('');
    if (otp.length !== 6) {
        showError('otpError', 'Please enter the complete 6-digit OTP');
        return;
    }

    const btn = document.getElementById('verifyBtn');
    btn.disabled = true;
    btn.textContent = 'Verifying...';
    hideError('otpError');

    try {
        const r = await fetch('/api/customer/auth/verify-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: customerPhone, otp })
        });
        const result = await r.json();
        if (result.success) {
            localStorage.setItem('customer_phone', customerPhone);
            localStorage.setItem('customer_name', result.data.name || 'Customer');
            localStorage.setItem('customer_token', result.data.token || '');
            localStorage.setItem('customer_id', result.data.customer_id || '');
            window.location.href = 'customer-dashboard.html';
        } else {
            showError('otpError', result.message || 'Invalid OTP');
        }
    } catch (err) {
        showError('otpError', 'Network error. Please try again.');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Verify & Login';
    }
}

function backToPhone() {
    document.getElementById('otpStep').classList.add('hidden');
    document.getElementById('phoneStep').classList.remove('hidden');
    clearInterval(resendInterval);
}

async function resendOTP() {
    try {
        await fetch('/api/customer/auth/send-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: customerPhone })
        });
        startResendTimer();
    } catch {}
}

function startResendTimer() {
    let seconds = 30;
    const btn = document.getElementById('resendBtn');
    const timer = document.getElementById('resendTimer');
    btn.disabled = true;
    clearInterval(resendInterval);
    resendInterval = setInterval(() => {
        seconds--;
        timer.textContent = seconds;
        if (seconds <= 0) {
            clearInterval(resendInterval);
            btn.disabled = false;
            btn.innerHTML = 'Resend OTP';
        }
    }, 1000);
}

function showError(id, msg) {
    const el = document.getElementById(id);
    el.textContent = msg;
    el.classList.remove('hidden');
}

function hideError(id) {
    document.getElementById(id).classList.add('hidden');
}

// Auto-redirect if already logged in
if (localStorage.getItem('customer_token')) {
    window.location.href = 'customer-dashboard.html';
}

// --- Wiring for former inline on*= handlers ---
// "Change number" button (was onclick="backToPhone()")
document.getElementById('backToPhoneBtn').addEventListener('click', backToPhone);
// "Verify & Login" button (was onclick="verifyOTP()")
document.getElementById('verifyBtn').addEventListener('click', verifyOTP);
// "Resend OTP" button (was onclick="resendOTP()")
document.getElementById('resendBtn').addEventListener('click', resendOTP);
