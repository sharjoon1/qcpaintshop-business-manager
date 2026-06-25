// Page logic for Admin Settings. Externalized from the admin-settings.html inline <script>
// (S9+F5 Phase C, 2026-06-25) so the page runs under the enforced strict CSP.
// Verbatim move of all functions; inline on*= handlers converted to addEventListener /
// data-action delegation. No logic changes, no renames, escaping helpers untouched.

// Get auth token
function getAuthToken() {
    return localStorage.getItem('auth_token');
}

// Tab switching
function showTab(tabName) {
    // Hide all tabs
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.add('hidden');
    });

    // Remove active state from all buttons
    document.querySelectorAll('.tab-button').forEach(button => {
        button.classList.remove('border-purple-600', 'text-purple-600');
        button.classList.add('border-transparent', 'text-gray-600');
    });

    // Show selected tab
    document.getElementById(`content-${tabName}`).classList.remove('hidden');

    // Add active state to selected button
    const activeButton = document.getElementById(`tab-${tabName}`);
    activeButton.classList.remove('border-transparent', 'text-gray-600');
    activeButton.classList.add('border-purple-600', 'text-purple-600');
}

// Handle logo upload
async function handleLogoUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        alert('❌ Please select an image file');
        return;
    }

    // Show preview immediately (temporary)
    const reader = new FileReader();
    reader.onload = (e) => {
        document.getElementById('logoPreview').src = e.target.result;
        document.getElementById('logoPreview').classList.remove('hidden');
        document.getElementById('logoPlaceholder').classList.add('hidden');
    };
    reader.readAsDataURL(file);

    // Upload file to server
    const formData = new FormData();
    formData.append('logo', file);

    try {
        const token = getAuthToken();
        const response = await fetch('/api/upload/logo', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });

        const data = await response.json();
        console.log('Logo upload response:', data);

        if (response.ok && data.success) {
            // Update preview with server URL
            const logoPreview = document.getElementById('logoPreview');
            logoPreview.src = data.logoUrl;
            logoPreview.dataset.logoUrl = data.logoUrl;
            logoPreview.classList.remove('hidden');
            document.getElementById('logoPlaceholder').classList.add('hidden');

            console.log('Logo saved to:', data.logoUrl);
            alert('✅ Logo uploaded successfully!');
        } else {
            alert(`❌ Failed to upload logo: ${data.error || 'Unknown error'}`);
            console.error('Logo upload failed:', data);
        }
    } catch (error) {
        console.error('Logo upload error:', error);
        alert('❌ Error uploading logo. Please try again.');
    }
}

// Load settings on page load
async function loadSettings() {
    try {
        const token = getAuthToken();
        const response = await fetch('/api/settings', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        if (response.status === 403) {
            alert('Access denied. Only administrators can access Company Settings.');
            window.location.href = '/staff/dashboard.html';
            return;
        }
        const settings = await response.json();

        console.log('Loaded settings:', settings);

        // Populate business info
        if (settings.business_name) document.getElementById('businessName').value = settings.business_name;
        if (settings.business_type) document.getElementById('businessType').value = settings.business_type;
        if (settings.business_address) document.getElementById('businessAddress').value = settings.business_address;
        if (settings.business_phone) document.getElementById('businessPhone').value = settings.business_phone;
        if (settings.business_email) document.getElementById('businessEmail').value = settings.business_email;

        // Load logo if exists
        if (settings.business_logo) {
            const logoPreview = document.getElementById('logoPreview');
            logoPreview.src = settings.business_logo;
            logoPreview.dataset.logoUrl = settings.business_logo; // Store the server path
            logoPreview.classList.remove('hidden');
            document.getElementById('logoPlaceholder').classList.add('hidden');
            console.log('Logo loaded from settings:', settings.business_logo);
        } else {
            console.log('No logo found in settings');
        }

        // Populate tax settings
        if (settings.gst_number) document.getElementById('gstNumber').value = settings.gst_number;
        if (settings.pan_number) document.getElementById('panNumber').value = settings.pan_number;
        if (settings.enable_gst) document.getElementById('enableGST').checked = settings.enable_gst === 'true';
        if (settings.cgst_rate) document.getElementById('cgstRate').value = settings.cgst_rate;
        if (settings.sgst_rate) document.getElementById('sgstRate').value = settings.sgst_rate;
        if (settings.igst_rate) document.getElementById('igstRate').value = settings.igst_rate;

        // Populate estimate settings
        if (settings.estimate_prefix) document.getElementById('estimatePrefix').value = settings.estimate_prefix;
        if (settings.estimate_validity) document.getElementById('estimateValidity').value = settings.estimate_validity;
        if (settings.estimate_terms) document.getElementById('termsConditions').value = settings.estimate_terms;
        if (settings.show_brand_logo) document.getElementById('showBrandLogo').checked = settings.show_brand_logo === 'true';

    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

// Form submissions
document.getElementById('businessForm').addEventListener('submit', async function(e) {
    e.preventDefault();

    const logoPreview = document.getElementById('logoPreview');
    // ONLY use dataset.logoUrl (server path), never use data URL
    const logoUrl = logoPreview.dataset.logoUrl || null;

    const businessData = {
        business_name: document.getElementById('businessName').value,
        business_type: document.getElementById('businessType').value,
        business_address: document.getElementById('businessAddress').value,
        business_phone: document.getElementById('businessPhone').value,
        business_email: document.getElementById('businessEmail').value,
        business_logo: logoUrl
    };

    console.log('Saving business data:', businessData);
    console.log('Logo URL being saved:', logoUrl);

    try {
        const token = getAuthToken();
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(businessData)
        });

        const result = await response.json();
        console.log('Save response:', result);

        if (response.ok && result.success) {
            alert('✅ Business information saved successfully!');
            // Reload settings to show saved data
            await loadSettings();
        } else {
            alert(`❌ Failed to save business information: ${result.error || result.message}`);
        }
    } catch (error) {
        console.error('Error saving business info:', error);
        alert('❌ Error saving business information');
    }
});

document.getElementById('taxForm').addEventListener('submit', async function(e) {
    e.preventDefault();

    const taxData = {
        gst_number: document.getElementById('gstNumber').value,
        pan_number: document.getElementById('panNumber').value,
        enable_gst: document.getElementById('enableGST').checked ? 'true' : 'false',
        cgst_rate: document.getElementById('cgstRate').value,
        sgst_rate: document.getElementById('sgstRate').value,
        igst_rate: document.getElementById('igstRate').value
    };

    try {
        const token = getAuthToken();
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(taxData)
        });

        if (response.ok) {
            alert('✅ Tax settings saved successfully!');
        } else {
            alert('❌ Failed to save tax settings');
        }
    } catch (error) {
        console.error('Error saving tax settings:', error);
        alert('❌ Error saving tax settings');
    }
});

document.getElementById('estimateForm').addEventListener('submit', async function(e) {
    e.preventDefault();

    const estimateData = {
        estimate_prefix: document.getElementById('estimatePrefix').value,
        estimate_validity: document.getElementById('estimateValidity').value,
        estimate_terms: document.getElementById('termsConditions').value,
        show_brand_logo: document.getElementById('showBrandLogo').checked ? 'true' : 'false'
    };

    try {
        const token = getAuthToken();
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(estimateData)
        });

        if (response.ok) {
            alert('✅ Estimate settings saved successfully!');
        } else {
            alert('❌ Failed to save estimate settings');
        }
    } catch (error) {
        console.error('Error saving estimate settings:', error);
        alert('❌ Error saving estimate settings');
    }
});

// Check authentication
if (!localStorage.getItem('auth_token')) {
    window.location.href = '/login.html';
}

// Load settings on page load
loadSettings();

// ── Static handler wiring (externalized from inline on*= attributes; S9+F5 Phase C, 2026-06-25) ──
// Tab buttons: original markup was onclick="showTab('<name>')". Each .tab-button now carries
// data-tab="<name>"; a single delegated listener dispatches to showTab().
document.addEventListener('click', function(e) {
    const btn = e.target.closest('.tab-button[data-tab]');
    if (!btn) return;
    showTab(btn.dataset.tab);
});
// Logo file input: original was onchange="handleLogoUpload(event)".
document.getElementById('businessLogo').addEventListener('change', handleLogoUpload);
