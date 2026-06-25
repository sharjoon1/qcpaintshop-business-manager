// Externalized from estimate-settings.html inline <script> (S9+F5 Phase C, 2026-06-25) so the page
// runs under the enforced strict CSP (script-src 'self', script-src-attr 'none'). Loaded as a
// NON-deferred classic script before </body>, same timing as the original inline page-logic block.
// Verbatim move of all functions/logic — no renames, no escaping changes. The two former inline
// onclick="saveSettings()"/onclick="resetSettings()" handlers on the Save/Reset buttons are now
// wired here via addEventListener by id (buttons gained id="save-settings-btn"/id="reset-settings-btn").

// Load settings
function loadSettings() {
    const settings = JSON.parse(localStorage.getItem('estimate_settings') || '{}');

    document.getElementById('col-qty').checked = settings.show_qty !== false;
    document.getElementById('col-mix').checked = settings.show_mix !== false;
    document.getElementById('col-breakdown').checked = settings.show_breakdown !== false;
    document.getElementById('col-color').checked = settings.show_color !== false;

    const gstDisplay = settings.gst_display || 'inclusive';
    document.querySelector(`input[value="${gstDisplay}"]`).checked = true;

    updatePreview();
}

// Update preview
function updatePreview() {
    const showQty = document.getElementById('col-qty').checked;
    const showMix = document.getElementById('col-mix').checked;
    const showBreakdown = document.getElementById('col-breakdown').checked;
    const showColor = document.getElementById('col-color').checked;

    // Toggle column visibility in preview
    togglePreviewColumn('qty', showQty);
    togglePreviewColumn('mix', showMix);
    togglePreviewColumn('breakdown', showBreakdown);
    togglePreviewColumn('color', showColor);
}

function togglePreviewColumn(col, show) {
    const header = document.getElementById(`preview-${col}`);
    const value = document.getElementById(`preview-${col}-val`);

    if (show) {
        header.classList.remove('hidden');
        value.classList.remove('hidden');
    } else {
        header.classList.add('hidden');
        value.classList.add('hidden');
    }
}

// Save settings
function saveSettings() {
    const settings = {
        show_qty: document.getElementById('col-qty').checked,
        show_mix: document.getElementById('col-mix').checked,
        show_breakdown: document.getElementById('col-breakdown').checked,
        show_color: document.getElementById('col-color').checked,
        gst_display: document.querySelector('input[name="gst-display"]:checked').value
    };

    localStorage.setItem('estimate_settings', JSON.stringify(settings));
    alert('Settings saved! They will apply to all estimates.');
    history.back();
}

// Reset settings
function resetSettings() {
    if (confirm('Reset to default settings?')) {
        localStorage.removeItem('estimate_settings');
        loadSettings();
        alert('Settings reset to default');
    }
}

// Listen to changes
document.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
    checkbox.addEventListener('change', updatePreview);
});

// Wire the former inline onclick handlers (S9+F5: inline on*= -> addEventListener by id)
document.getElementById('save-settings-btn').addEventListener('click', saveSettings);
document.getElementById('reset-settings-btn').addEventListener('click', resetSettings);

// Load on page load
loadSettings();
