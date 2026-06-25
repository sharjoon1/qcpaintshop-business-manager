// Page logic externalized from admin-profile.html inline <script> (S9+F5 Phase E batch 11, 2026-06-25)
// so the page runs under the enforced strict CSP. Verbatim move of all functions; inline on*=
// handlers converted to addEventListener + data-action delegation. No logic changes, no renames.
let currentUser = null;
let profileImageFile = null;
let aadharFile = null;

// ══════════════════════════════
// LOAD PROFILE
// ══════════════════════════════
async function loadProfile() {
    try {
        const authToken = localStorage.getItem('auth_token');
        if (!authToken) { window.location.href = '/login.html'; return; }

        try {
            const meRes = await fetch('/api/auth/me', { headers: { 'Authorization': `Bearer ${authToken}` } });
            if (meRes.ok) {
                const meData = await meRes.json();
                if (meData.success && meData.user) {
                    currentUser = meData.user;
                    localStorage.setItem('user', JSON.stringify(currentUser));
                }
            }
        } catch (e) { console.warn('Could not fetch fresh user data'); }

        if (!currentUser) {
            const storedUser = localStorage.getItem('user');
            if (!storedUser) { window.location.href = '/login.html'; return; }
            currentUser = JSON.parse(storedUser);
        }

        populateForm(currentUser);
        updateCompletionStatus(currentUser);

    } catch (error) {
        console.error('Error loading profile:', error);
        showToast('Failed to load profile', 'error');
    }
}

function populateForm(u) {
    // Header
    const displayName = u.full_name || u.name || u.username || 'User';
    document.getElementById('displayName').textContent = displayName;
    document.getElementById('displayRole').textContent = (u.role || 'Staff').charAt(0).toUpperCase() + (u.role || 'Staff').slice(1);
    document.getElementById('displayEmail').textContent = u.email || '';
    document.getElementById('profileInitial').textContent = displayName.charAt(0).toUpperCase();

    if (u.created_at) {
        document.getElementById('memberSince').textContent = new Date(u.created_at).toLocaleDateString('en-IN', { year: 'numeric', month: 'long' });
    }

    if (u.profile_image_url) {
        document.getElementById('profilePreview').src = u.profile_image_url;
        document.getElementById('profilePreview').classList.remove('hidden');
        document.getElementById('profileInitial').classList.add('hidden');
    }

    // Personal
    document.getElementById('fullName').value = u.full_name || '';
    document.getElementById('username').value = u.username || '';
    document.getElementById('email').value = u.email || '';
    document.getElementById('phone').value = u.phone || '';
    document.getElementById('dateOfBirth').value = u.date_of_birth ? u.date_of_birth.split('T')[0] : '';
    document.getElementById('role').value = (u.role || 'Staff').charAt(0).toUpperCase() + (u.role || 'Staff').slice(1);

    // Address
    document.getElementById('doorNo').value = u.door_no || '';
    document.getElementById('street').value = u.street || '';
    document.getElementById('city').value = u.city || '';
    document.getElementById('state').value = u.state || 'Tamil Nadu';
    document.getElementById('pincode').value = u.pincode || '';

    // Emergency
    document.getElementById('emergencyName').value = u.emergency_contact_name || '';
    document.getElementById('emergencyPhone').value = u.emergency_contact_phone || '';

    // KYC
    document.getElementById('aadharNumber').value = u.aadhar_number || '';
    if (u.aadhar_proof_url) {
        document.getElementById('aadharProofView').classList.remove('hidden');
        document.getElementById('aadharViewLink').href = u.aadhar_proof_url;
        if (u.aadhar_proof_url.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
            document.getElementById('aadharProofImg').src = u.aadhar_proof_url;
            document.getElementById('aadharProofImgContainer').classList.remove('hidden');
        }
    }

    // PAN
    document.getElementById('panNumber').value = u.pan_number || '';
    if (u.pan_proof_url) {
        document.getElementById('panProofView').classList.remove('hidden');
        document.getElementById('panViewLink').href = u.pan_proof_url;
        if (u.pan_proof_url.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
            document.getElementById('panProofImg').src = u.pan_proof_url;
            document.getElementById('panProofImgContainer').classList.remove('hidden');
        }
    }

    // KYC Status Badge
    const kycBadge = document.getElementById('kycStatusBadge');
    if (u.kyc_status === 'complete') {
        kycBadge.textContent = 'Complete';
        kycBadge.className = 'ml-auto text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700';
    } else if (u.kyc_status === 'verified') {
        kycBadge.textContent = 'Verified';
        kycBadge.className = 'ml-auto text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700';
    } else {
        kycBadge.textContent = 'Incomplete';
        kycBadge.className = 'ml-auto text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700';
    }

    // Bank
    document.getElementById('bankAccName').value = u.bank_account_name || '';
    document.getElementById('bankName').value = u.bank_name || '';
    document.getElementById('bankAccNo').value = u.bank_account_number || '';
    document.getElementById('bankIFSC').value = u.bank_ifsc_code || '';
    document.getElementById('bankUPI').value = u.upi_id || '';
}

function updateCompletionStatus(u) {
    let total = 0, filled = 0;

    // Personal (name, email, phone, dob)
    const personalFields = [u.full_name, u.email, u.phone, u.date_of_birth];
    total += personalFields.length;
    filled += personalFields.filter(Boolean).length;
    const personalComplete = personalFields.every(Boolean);

    // Address (door_no, street, city, state, pincode)
    const addressFields = [u.door_no, u.street, u.city, u.state, u.pincode];
    total += addressFields.length;
    filled += addressFields.filter(Boolean).length;
    const addressComplete = addressFields.filter(Boolean).length >= 3;

    // KYC (aadhar + pan)
    const kycFields = [u.aadhar_number, u.aadhar_proof_url, u.pan_number, u.pan_proof_url];
    total += kycFields.length;
    filled += kycFields.filter(Boolean).length;
    const kycComplete = kycFields.every(Boolean);

    // Bank (account_name, bank_name, account_number, ifsc)
    const bankFields = [u.bank_account_name, u.bank_name, u.bank_account_number, u.bank_ifsc_code];
    total += bankFields.length;
    filled += bankFields.filter(Boolean).length;
    const bankComplete = bankFields.every(Boolean);

    const percent = Math.round((filled / total) * 100);
    document.getElementById('completionPercent').textContent = percent + '%';
    document.getElementById('completionBar').style.width = percent + '%';

    setStatus('statusPersonal', personalComplete);
    setStatus('statusAddress', addressComplete);
    setStatus('statusKYC', kycComplete);
    setStatus('statusBank', bankComplete);
}

function setStatus(elId, complete) {
    const el = document.getElementById(elId);
    if (complete) {
        el.className = 'status-badge status-complete';
        el.innerHTML = '<svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>Complete';
    } else {
        el.className = 'status-badge status-incomplete';
        el.innerHTML = 'Incomplete';
    }
}

// ══════════════════════════════
// IMAGE UPLOADS
// ══════════════════════════════
function handleImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { showToast('Please select an image file', 'error'); return; }
    if (file.size > 5 * 1024 * 1024) { showToast('Image must be under 5MB', 'error'); return; }
    profileImageFile = file;
    const reader = new FileReader();
    reader.onload = function(e) {
        document.getElementById('profilePreview').src = e.target.result;
        document.getElementById('profilePreview').classList.remove('hidden');
        document.getElementById('profileInitial').classList.add('hidden');
    };
    reader.readAsDataURL(file);
}

function handleAadharUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
        showToast('Only image or PDF files allowed', 'error'); return;
    }
    if (file.size > 5 * 1024 * 1024) { showToast('File must be under 5MB', 'error'); return; }
    aadharFile = file;
    document.getElementById('aadharUploadText').textContent = file.name;

    if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = function(e) {
            document.getElementById('aadharProofImg').src = e.target.result;
            document.getElementById('aadharProofImgContainer').classList.remove('hidden');
        };
        reader.readAsDataURL(file);
    }
}

let panFile = null;
function handlePanUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
        showToast('Only image or PDF files allowed', 'error'); return;
    }
    if (file.size > 5 * 1024 * 1024) { showToast('File must be under 5MB', 'error'); return; }
    panFile = file;
    document.getElementById('panUploadText').textContent = file.name;

    if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = function(e) {
            document.getElementById('panProofImg').src = e.target.result;
            document.getElementById('panProofImgContainer').classList.remove('hidden');
        };
        reader.readAsDataURL(file);
    }
}

// ══════════════════════════════
// SAVE ALL PROFILE
// ══════════════════════════════
async function saveAllProfile() {
    const btn = document.getElementById('btnSave');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
        const token = localStorage.getItem('auth_token');

        // 1. Upload profile image if changed
        let newProfileUrl = null;
        if (profileImageFile) {
            const formData = new FormData();
            formData.append('profile_image', profileImageFile);
            const uploadRes = await fetch('/api/upload/profile', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });
            if (uploadRes.ok) {
                const uploadResult = await uploadRes.json();
                newProfileUrl = uploadResult.profileUrl;
            }
        }

        // 2. Upload Aadhar proof if changed (endpoint saves to DB directly)
        if (aadharFile) {
            const formData = new FormData();
            formData.append('aadhar_proof', aadharFile);
            const uploadRes = await fetch('/api/upload/aadhar', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });
            if (!uploadRes.ok) {
                showToast('Failed to upload Aadhar proof', 'error');
            }
        }

        // 2b. Upload PAN proof if changed
        if (panFile) {
            const formData = new FormData();
            formData.append('pan_proof', panFile);
            const uploadRes = await fetch('/api/upload/pan-proof', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });
            if (!uploadRes.ok) {
                showToast('Failed to upload PAN proof', 'error');
            }
        }

        // 2c. Validate PAN format if provided
        const panVal = document.getElementById('panNumber').value.trim().toUpperCase();
        if (panVal && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(panVal)) {
            showToast('Invalid PAN format (e.g. ABCDE1234F)', 'error');
            btn.disabled = false;
            btn.textContent = 'Save All Changes';
            return;
        }

        // 3. Validate bank IFSC if bank details provided
        const bankIFSC = document.getElementById('bankIFSC').value.trim().toUpperCase();
        const bankAccName = document.getElementById('bankAccName').value.trim();
        if (bankAccName && bankIFSC && !/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(bankIFSC)) {
            showToast('Invalid IFSC code format', 'error');
            btn.disabled = false;
            btn.textContent = 'Save All Changes';
            return;
        }

        // 4. Build profile data
        const profileData = {
            full_name: document.getElementById('fullName').value.trim(),
            email: document.getElementById('email').value.trim(),
            phone: document.getElementById('phone').value.trim() || null,
            date_of_birth: document.getElementById('dateOfBirth').value || null,
            door_no: document.getElementById('doorNo').value.trim() || null,
            street: document.getElementById('street').value.trim() || null,
            city: document.getElementById('city').value.trim() || null,
            state: document.getElementById('state').value.trim() || null,
            pincode: document.getElementById('pincode').value.trim() || null,
            emergency_contact_name: document.getElementById('emergencyName').value.trim() || null,
            emergency_contact_phone: document.getElementById('emergencyPhone').value.trim() || null,
            aadhar_number: document.getElementById('aadharNumber').value.trim() || null,
            pan_number: panVal || null,
            bank_account_name: bankAccName || null,
            bank_name: document.getElementById('bankName').value.trim() || null,
            bank_account_number: document.getElementById('bankAccNo').value.trim() || null,
            bank_ifsc_code: bankIFSC || null,
            upi_id: document.getElementById('bankUPI').value.trim() || null
        };

        if (newProfileUrl) profileData.profile_image_url = newProfileUrl;

        // 5. Save profile
        const res = await fetch('/api/users/profile/me', {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(profileData)
        });

        if (res.ok) {
            profileImageFile = null;
            aadharFile = null;
            panFile = null;
            showToast('Profile updated successfully!', 'success');
            // Reload fresh data
            currentUser = null;
            await loadProfile();
        } else {
            const error = await res.json();
            showToast(error.error || 'Failed to update profile', 'error');
        }
    } catch (error) {
        console.error('Save error:', error);
        showToast('Network error. Please try again.', 'error');
    }

    btn.disabled = false;
    btn.textContent = 'Save All Changes';
}

// ══════════════════════════════
// CHANGE PASSWORD
// ══════════════════════════════
document.getElementById('passwordForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

    if (newPassword !== confirmPassword) { showToast('New passwords do not match', 'error'); return; }
    if (newPassword.length < 6) { showToast('Password must be at least 6 characters', 'error'); return; }

    try {
        const response = await fetch('/api/users/change-password', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                user_id: currentUser.id,
                current_password: currentPassword,
                new_password: newPassword
            })
        });

        if (response.ok) {
            showToast('Password changed! Please login again.', 'success');
            setTimeout(() => {
                localStorage.removeItem('auth_token');
                localStorage.removeItem('user');
                window.location.href = '/login.html';
            }, 1500);
        } else {
            const error = await response.json();
            showToast(error.error || 'Incorrect current password', 'error');
        }
    } catch (error) {
        showToast('Network error. Please try again.', 'error');
    }
});

// ══════════════════════════════
// TOAST
// ══════════════════════════════
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast toast-${type} show`;
    setTimeout(() => { toast.classList.remove('show'); }, 3000);
}

// ── 2FA Functions ──
async function load2FAStatus() {
    try {
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        if (!['admin', 'manager'].includes(user.role)) return;
        document.getElementById('twoFASection').style.display = 'block';
        const data = await fetch('/api/2fa/status', { headers: getAuthHeaders() }).then(r => r.json());
        const statusEl = document.getElementById('twoFAStatus');
        const actionsEl = document.getElementById('twoFAActions');
        if (data.totp_enabled) {
            statusEl.innerHTML = '<span class="inline-flex items-center gap-1.5 px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">✓ 2FA is enabled</span>';
            actionsEl.innerHTML = `<button data-action="disable-2fa" class="px-4 py-2 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-lg text-sm font-medium transition">Disable 2FA</button>`;
        } else {
            statusEl.innerHTML = '<span class="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-100 text-amber-800 rounded-full text-sm font-medium">⚠ 2FA not enabled</span>';
            actionsEl.innerHTML = `<button data-action="setup-2fa" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold transition">Enable 2FA</button>`;
        }
    } catch (e) { /* non-critical, skip */ }
}

async function setup2FA() {
    const data = await fetch('/api/2fa/setup', { headers: getAuthHeaders() }).then(r => r.json());
    if (!data.success) { showToast(data.error || 'Failed to start setup', 'error'); return; }
    if (data.already_enabled) { showToast('2FA is already enabled'); return; }
    document.getElementById('qrImage').src = data.qr;
    document.getElementById('manualKey').textContent = data.manual_key;
    document.getElementById('verifyTotpInput').value = '';
    document.getElementById('qrError').classList.add('hidden');
    document.getElementById('qrModal').classList.remove('hidden');
    setTimeout(() => document.getElementById('verifyTotpInput').focus(), 200);
}

async function confirmTOTPSetup() {
    const token = document.getElementById('verifyTotpInput').value.trim();
    const errEl = document.getElementById('qrError');
    if (!token || token.length !== 6) { errEl.textContent = 'Enter a 6-digit code.'; errEl.classList.remove('hidden'); return; }
    const data = await fetch('/api/2fa/verify-setup', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, getAuthHeaders()),
        body: JSON.stringify({ token })
    }).then(r => r.json());
    if (data.success) {
        document.getElementById('qrModal').classList.add('hidden');
        showToast('2FA enabled successfully!');
        load2FAStatus();
    } else {
        errEl.textContent = data.error || 'Invalid token. Try again.';
        errEl.classList.remove('hidden');
        document.getElementById('verifyTotpInput').value = '';
    }
}

async function disable2FA() {
    if (!confirm('Disable 2FA for your account?')) return;
    const data = await fetch('/api/2fa/disable', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, getAuthHeaders()),
        body: '{}'
    }).then(r => r.json());
    if (data.success) { showToast('2FA disabled'); load2FAStatus(); }
    else showToast(data.error || 'Failed to disable', 'error');
}

// ── Static handler wiring (externalized from inline on*= attributes; S9+F5 Phase E batch 11, 2026-06-25) ──
// Profile picture file input (was onchange="handleImageUpload(event)")
document.getElementById('profilePicture').addEventListener('change', handleImageUpload);
// Aadhar proof file input (was onchange="handleAadharUpload(event)")
document.getElementById('aadharFile').addEventListener('change', handleAadharUpload);
// PAN proof file input (was onchange="handlePanUpload(event)")
document.getElementById('panFile').addEventListener('change', handlePanUpload);
// Cancel button (was onclick="history.back()")
document.getElementById('cancelBtn').addEventListener('click', () => history.back());
// Save All Changes button (was onclick="saveAllProfile()")
document.getElementById('btnSave').addEventListener('click', saveAllProfile);
// QR modal Verify & Enable 2FA button (was onclick="confirmTOTPSetup()")
document.getElementById('confirmTotpBtn').addEventListener('click', confirmTOTPSetup);
// QR modal Cancel button (was onclick="document.getElementById('qrModal').classList.add('hidden')")
document.getElementById('qrCancelBtn').addEventListener('click', () => document.getElementById('qrModal').classList.add('hidden'));

// Delegated dispatcher for runtime-rendered 2FA buttons (replaces inline
// onclick="setup2FA()" / onclick="disable2FA()" injected via innerHTML). One document-level
// listener routes by data-action.
document.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    if (!action) return;
    if (action === 'setup-2fa') {
        setup2FA();
    } else if (action === 'disable-2fa') {
        disable2FA();
    }
});

// Init
loadProfile();
load2FAStatus();
