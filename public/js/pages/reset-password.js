// Token-based password reset. Externalized from the page inline <script>
// (S9+F5 Phase C, 2026-06-13) so the page runs under the enforced strict CSP.
const params = new URLSearchParams(location.search);
const token = params.get('token') || '';
const loadingState = document.getElementById('loadingState');
const invalidState = document.getElementById('invalidState');
const resetForm = document.getElementById('resetForm');
const errorMessage = document.getElementById('errorMessage');
const errorText = document.getElementById('errorText');
const successMessage = document.getElementById('successMessage');
const successText = document.getElementById('successText');
const submitBtn = document.getElementById('submitBtn');
const btnText = document.getElementById('btnText');
const btnLoader = document.getElementById('btnLoader');

async function validate() {
    if (!token) {
        loadingState.classList.add('hidden');
        invalidState.classList.remove('hidden');
        return;
    }
    try {
        const r = await fetch('/api/auth/validate-reset-token?token=' + encodeURIComponent(token));
        const data = await r.json();
        loadingState.classList.add('hidden');
        if (r.ok && data.success) {
            resetForm.classList.remove('hidden');
        } else {
            document.getElementById('invalidReason').textContent = data.message || 'This link can be used only once and is valid for 1 hour.';
            invalidState.classList.remove('hidden');
        }
    } catch (e) {
        loadingState.classList.add('hidden');
        invalidState.classList.remove('hidden');
    }
}
validate();

resetForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorMessage.classList.add('hidden');
    successMessage.classList.add('hidden');
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    if (password !== confirmPassword) {
        errorText.textContent = 'Passwords do not match.';
        errorMessage.classList.remove('hidden');
        return;
    }
    btnText.classList.add('hidden');
    btnLoader.classList.remove('hidden');
    submitBtn.disabled = true;
    try {
        const r = await fetch('/api/auth/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, password })
        });
        const data = await r.json();
        if (r.ok && data.success) {
            successText.textContent = data.message + ' Redirecting to login...';
            successMessage.classList.remove('hidden');
            setTimeout(() => { location.href = '/login.html'; }, 2000);
        } else {
            errorText.textContent = data.message || 'Failed to reset password.';
            errorMessage.classList.remove('hidden');
            btnText.classList.remove('hidden');
            btnLoader.classList.add('hidden');
            submitBtn.disabled = false;
        }
    } catch (err) {
        errorText.textContent = 'Network error. Please try again.';
        errorMessage.classList.remove('hidden');
        btnText.classList.remove('hidden');
        btnLoader.classList.add('hidden');
        submitBtn.disabled = false;
    }
});
