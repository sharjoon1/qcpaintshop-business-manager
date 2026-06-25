    const API = '/api/painters';
    let originalData = {};
    let uploading = false;
    let isDirty = false;

    function painterHeaders() {
        return {
            'Content-Type': 'application/json',
            'X-Painter-Token': localStorage.getItem('painter_token') || ''
        };
    }

    // Check auth
    if (!localStorage.getItem('painter_token')) {
        window.location.href = '/painter-login.html';
    }

    // ============ Toast ============
    function showToast(msg, type) {
        const toast = document.createElement('div');
        toast.className = 'fixed top-4 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-lg text-sm font-medium z-[200] '
            + (type === 'error' ? 'bg-red-600' : 'bg-emerald-600') + ' text-white shadow-lg';
        toast.style.transform = 'translateX(-50%)';
        toast.textContent = msg;
        document.body.appendChild(toast);
        setTimeout(function() { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; }, 2500);
        setTimeout(function() { toast.remove(); }, 3000);
    }

    // ============ Avatar Helpers ============
    function getInitials(name) {
        if (!name) return '?';
        const parts = name.trim().split(/\s+/);
        if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
        return parts[0].substring(0, 2).toUpperCase();
    }

    function setAvatar(photoUrl, name) {
        const img = document.getElementById('avatarImg');
        const initials = document.getElementById('avatarInitials');
        if (photoUrl) {
            img.src = photoUrl;
            img.style.display = 'block';
            initials.style.display = 'none';
            img.onerror = function() {
                this.style.display = 'none';
                initials.style.display = 'flex';
            };
        } else {
            img.style.display = 'none';
            initials.style.display = 'flex';
            initials.textContent = getInitials(name);
        }
    }

    // ============ Load Profile ============
    async function loadProfile() {
        try {
            const res = await fetch(`${API}/me`, { headers: painterHeaders() });
            if (res.status === 401) {
                localStorage.removeItem('painter_token');
                localStorage.removeItem('painter');
                window.location.href = '/painter-login.html';
                return;
            }
            const data = await res.json();
            if (!data.success) throw new Error(data.message);

            const p = data.painter;
            originalData = {
                email: p.email || '',
                experience_years: p.experience_years != null ? String(p.experience_years) : '',
                specialization: p.specialization || '',
                city: p.city || '',
                district: p.district || '',
                pincode: p.pincode || '',
                address: p.address || ''
            };

            // Read-only fields
            document.getElementById('fieldName').value = p.full_name || '';
            document.getElementById('fieldPhone').value = p.phone || '';

            // Editable fields
            document.getElementById('fieldEmail').value = originalData.email;
            document.getElementById('fieldExperience').value = originalData.experience_years;
            document.getElementById('fieldSpecialization').value = originalData.specialization;
            document.getElementById('fieldCity').value = originalData.city;
            document.getElementById('fieldDistrict').value = originalData.district;
            document.getElementById('fieldPincode').value = originalData.pincode;
            document.getElementById('fieldAddress').value = originalData.address;

            // Account info
            document.getElementById('fieldReferralCode').textContent = p.referral_code || '---';
            if (p.created_at) {
                const d = new Date(p.created_at);
                document.getElementById('fieldMemberSince').value = d.toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
            }

            // Avatar
            setAvatar(p.profile_photo, p.full_name);

            // Header name
            document.getElementById('painterNameHeader').textContent = p.full_name || 'Painter';

            // Enable save tracking
            trackChanges();
        } catch (err) {
            console.error('Load profile error:', err);
            showToast('Failed to load profile', 'error');
        }
    }

    // ============ Track Changes ============
    function getCurrentData() {
        return {
            email: document.getElementById('fieldEmail').value.trim(),
            experience_years: document.getElementById('fieldExperience').value.trim(),
            specialization: document.getElementById('fieldSpecialization').value,
            city: document.getElementById('fieldCity').value.trim(),
            district: document.getElementById('fieldDistrict').value.trim(),
            pincode: document.getElementById('fieldPincode').value.trim(),
            address: document.getElementById('fieldAddress').value.trim()
        };
    }

    function getChangedFields() {
        const current = getCurrentData();
        const changed = {};
        for (const key of Object.keys(current)) {
            if (current[key] !== originalData[key]) {
                changed[key] = current[key];
            }
        }
        // Convert experience_years to number if present
        if (changed.experience_years !== undefined) {
            changed.experience_years = changed.experience_years ? parseInt(changed.experience_years, 10) : null;
        }
        return changed;
    }

    function checkDirty() {
        const changed = getChangedFields();
        const hasChanges = Object.keys(changed).length > 0;
        document.getElementById('saveBtn').disabled = !hasChanges;
    }

    function trackChanges() {
        const editableIds = ['fieldEmail', 'fieldExperience', 'fieldSpecialization', 'fieldCity', 'fieldDistrict', 'fieldPincode', 'fieldAddress'];
        editableIds.forEach(function(id) {
            const el = document.getElementById(id);
            el.addEventListener('input', checkDirty);
            el.addEventListener('change', checkDirty);
        });
        // Unsaved-changes guard
        document.querySelectorAll('input,select,textarea').forEach(function(el) {
            el.addEventListener('change', function() { isDirty = true; });
        });
        window.onbeforeunload = function() { return isDirty ? 'Unsaved changes. Leave?' : null; };
    }

    // ============ Save Profile ============
    async function saveProfile() {
        const changed = getChangedFields();
        if (Object.keys(changed).length === 0) return;

        const btn = document.getElementById('saveBtn');
        const btnText = document.getElementById('saveBtnText');
        btn.disabled = true;
        btnText.textContent = 'Saving...';

        try {
            const res = await fetch(`${API}/me`, {
                method: 'PUT',
                headers: painterHeaders(),
                body: JSON.stringify(changed)
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.message);

            // Update originalData with saved values
            const current = getCurrentData();
            Object.assign(originalData, current);

            isDirty = false;
            showToast('Profile updated successfully!');
            btn.disabled = true;
        } catch (err) {
            console.error('Save profile error:', err);
            showToast('Failed to save: ' + (err.message || 'Unknown error'), 'error');
            btn.disabled = false;
        } finally {
            btnText.textContent = 'Save Changes';
            // Re-apply i18n
            if (window.painterI18n) painterI18n.applyTranslations();
        }
    }

    // ============ Photo Upload ============
    function compressAndUpload(file) {
        const img = new Image();
        img.onload = function() {
            const c = document.createElement('canvas'), max = 800;
            let w = img.width, h = img.height;
            if (w > max) { h = h * max / w; w = max; }
            if (h > max) { w = w * max / h; h = max; }
            c.width = w; c.height = h;
            c.getContext('2d').drawImage(img, 0, 0, w, h);
            URL.revokeObjectURL(img.src);
            c.toBlob(function(b) {
                const fd = new FormData();
                fd.append('photo', b, 'photo.jpg');
                uploadPhoto(fd);
            }, 'image/jpeg', 0.82);
        };
        img.src = URL.createObjectURL(file);
    }

    async function uploadPhoto(formData) {
        const wrapper = document.getElementById('avatarWrapper');
        const loadingEl = document.createElement('div');
        loadingEl.className = 'avatar-loading';
        loadingEl.innerHTML = '<div class="spinner"></div>';
        wrapper.appendChild(loadingEl);

        try {
            const res = await fetch(`${API}/me/profile-photo`, {
                method: 'PUT',
                headers: { 'X-Painter-Token': localStorage.getItem('painter_token') || '' },
                body: formData
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.message);

            // Update avatar display
            setAvatar(data.photo_url, document.getElementById('fieldName').value);
            showToast('Photo updated!');
        } catch (err) {
            console.error('Photo upload error:', err);
            showToast('Failed to upload photo', 'error');
        } finally {
            loadingEl.remove();
        }
    }

    document.getElementById('photoInput').addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;

        // Validate file type
        if (!file.type.startsWith('image/')) {
            showToast('Please select an image file', 'error');
            return;
        }

        // Validate file size (5MB max)
        if (file.size > 5 * 1024 * 1024) {
            showToast('Image must be under 5MB', 'error');
            return;
        }

        // Reset file input for re-selection
        e.target.value = '';

        compressAndUpload(file);
    });

    // ============ Init ============
    loadProfile();

    // ============ Static handler wiring (replaces former inline on*= attributes) ============
    // langToggle: onclick="painterI18n.toggleLanguage()"
    document.getElementById('langToggle').addEventListener('click', function() {
        if (window.painterI18n) painterI18n.toggleLanguage();
    });

    // avatarCircle: onclick="document.getElementById('photoInput').click()"
    document.getElementById('avatarCircle').addEventListener('click', function() {
        document.getElementById('photoInput').click();
    });

    // avatarCamera: onclick="document.getElementById('photoInput').click()"
    document.getElementById('avatarCamera').addEventListener('click', function() {
        document.getElementById('photoInput').click();
    });

    // avatarImg: onerror="this.style.display='none'; document.getElementById('avatarInitials').style.display='flex';"
    document.getElementById('avatarImg').addEventListener('error', function() {
        this.style.display = 'none';
        document.getElementById('avatarInitials').style.display = 'flex';
    });

    // saveBtn: onclick="saveProfile()"
    document.getElementById('saveBtn').addEventListener('click', saveProfile);
