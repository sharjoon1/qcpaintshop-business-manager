// Daily Tasks page logic — externalized from staff/daily-tasks.html (S9+F5 strict CSP).
// Verbatim move of the original inline <script> (no logic/renames/escaping changes),
// with runtime inline on*= handlers in the innerHTML templates converted to
// data-action attributes + a single delegated document-level listener. The static
// submit button's onclick is wired via addEventListener below.
let templates = [];
let responses = {};
let materials = [];
let submission = null;

function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// Load tasks
async function loadTasks() {
    try {
        const res = await fetch('/api/daily-tasks/today', { headers: getAuthHeaders() });
        const data = await res.json();

        if (!data.success) throw new Error(data.error);

        templates = data.data.templates;
        materials = data.data.materials || [];
        submission = data.data.submission;

        // Index responses by template_id
        responses = {};
        (data.data.responses || []).forEach(r => {
            responses[r.template_id] = r;
        });

        document.getElementById('loadingState').style.display = 'none';

        // Set header date
        const today = new Date();
        document.getElementById('headerDate').textContent = today.toLocaleDateString('en-IN', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });

        if (submission) {
            document.getElementById('submittedState').style.display = 'block';
        }

        renderTasks();
        updateProgress();

        document.getElementById('tasksContainer').style.display = 'block';
        document.getElementById('submitBtn').style.display = 'block';
    } catch (error) {
        console.error('Error loading tasks:', error);
        document.getElementById('loadingState').innerHTML =
            '<p style="color:#ef4444;text-align:center;padding:40px;">Failed to load tasks. <a href="#" data-action="reload" style="color:#1B5E3B;">Retry</a></p>';
    }
}

function renderTasks() {
    const container = document.getElementById('tasksContainer');
    container.innerHTML = '';

    // Group by section
    const sections = {};
    templates.forEach(t => {
        if (!sections[t.section]) sections[t.section] = [];
        sections[t.section].push(t);
    });

    const sectionLabels = {
        morning: 'Morning Checklist',
        material: 'Material Tracking',
        sales: 'Sales & Quotations',
        outstanding: 'Outstanding Follow-up',
        marketing: 'Marketing & Calls'
    };

    for (const [section, tasks] of Object.entries(sections)) {
        const sectionDiv = document.createElement('div');
        sectionDiv.className = 'task-section';
        sectionDiv.innerHTML = `<div class="section-title">${sectionLabels[section] || section.toUpperCase()}</div>`;

        tasks.forEach(task => {
            sectionDiv.appendChild(renderTaskItem(task));
        });

        container.appendChild(sectionDiv);
    }
}

function renderTaskItem(task) {
    const resp = responses[task.id];
    const div = document.createElement('div');
    div.className = 'task-item';
    div.id = `task-${task.id}`;

    let html = `<div class="task-title">${escapeHtml(task.title)}</div>`;

    if (task.description) {
        html += `<p style="font-size:12px;color:#6b7280;margin-bottom:8px;">${escapeHtml(task.description)}</p>`;
    }

    // Yes/No toggle
    html += `<div class="toggle-group">
        <button class="toggle-btn yes ${resp && resp.answer === 'yes' ? 'active' : ''}" data-action="setAnswer" data-task-id="${task.id}" data-answer="yes">Yes</button>
        <button class="toggle-btn no ${resp && resp.answer === 'no' ? 'active' : ''}" data-action="setAnswer" data-task-id="${task.id}" data-answer="no">No</button>
    </div>`;

    // Photo section (for yes_no_photo)
    if (task.task_type === 'yes_no_photo' || task.photo_required) {
        const photos = resp?.photos || [];
        html += `<div class="photo-section ${resp && resp.answer === 'yes' ? 'show' : ''}" id="photo-section-${task.id}">
            <label class="photo-btn">
                <svg style="width:18px;height:18px;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/>
                    <circle cx="12" cy="13" r="3"/>
                </svg>
                Take Photo
                <input type="file" accept="image/*" capture="environment" style="display:none;" data-action="uploadPhoto" data-task-id="${task.id}">
            </label>
            <div class="photo-preview" id="photos-${task.id}">
                ${photos.map(p => `<img src="${p}" alt="Photo">`).join('')}
            </div>
        </div>`;
    }

    // Detail fields (for yes_no_detail)
    if (task.task_type === 'yes_no_detail' && task.detail_fields) {
        const fields = task.detail_fields;
        const details = resp?.details || {};
        html += `<div class="detail-fields ${resp && resp.answer === 'yes' ? 'show' : ''}" id="detail-fields-${task.id}">`;
        fields.forEach(field => {
            const label = field.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            html += `<input class="detail-input" placeholder="${label}" value="${escapeHtml(details[field] || '')}" data-task="${task.id}" data-field="${field}" data-action="saveDetails">`;
        });
        html += `</div>`;
    }

    // Material received
    if (task.task_type === 'material_received') {
        const respMaterials = resp ? materials.filter(m => m.response_id === resp.id) : [];
        html += `<div class="material-list ${resp && resp.answer === 'yes' ? 'show' : ''}" id="material-list-${task.id}" style="display:${resp && resp.answer === 'yes' ? 'block' : 'none'}">
            <div id="material-entries-${task.id}">
                ${respMaterials.map(m => renderMaterialEntry(m)).join('')}
            </div>
            <button class="add-material-btn" data-action="addMaterial" data-task-id="${task.id}">+ Add Vendor Entry</button>
        </div>`;
    }

    // Reason box (when No is selected)
    if (task.task_type === 'yes_no_detail') {
        html += `<div class="reason-box ${resp && resp.answer === 'no' ? 'show' : ''}" id="reason-box-${task.id}">
            <textarea class="detail-input" placeholder="Reason for No..." style="min-height:60px;resize:vertical;" data-task="${task.id}" data-action="saveReason" data-task-id="${task.id}">${escapeHtml(resp?.reason || '')}</textarea>
        </div>`;
    }

    div.innerHTML = html;
    return div;
}

function renderMaterialEntry(m) {
    return `<div class="material-entry" id="material-${m.id}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <span style="font-weight:600;font-size:14px;">${escapeHtml(m.vendor_name)}</span>
            <button data-action="deleteMaterial" data-material-id="${m.id}" style="background:none;border:none;color:#ef4444;font-size:18px;cursor:pointer;">&times;</button>
        </div>
        ${m.photo_url ? `<img src="${m.photo_url}" style="width:60px;height:60px;object-fit:cover;border-radius:8px;margin-bottom:8px;">` : ''}
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
            <label class="photo-btn" style="flex:1;padding:6px 10px;font-size:12px;">
                <svg style="width:14px;height:14px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><circle cx="12" cy="13" r="3"/></svg>
                Bill Photo
                <input type="file" accept="image/*" capture="environment" style="display:none;" data-action="uploadMaterialPhoto" data-material-id="${m.id}">
            </label>
        </div>
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#6b7280;">
            <input type="checkbox" ${m.bill_on_zoho ? 'checked' : ''} data-action="toggleZoho" data-material-id="${m.id}"> Bill on Zoho
        </label>
    </div>`;
}

// Set answer (Yes/No)
async function setAnswer(templateId, answer) {
    try {
        await fetch(`/api/daily-tasks/respond/${templateId}`, {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ answer })
        });

        // Update local state
        if (!responses[templateId]) responses[templateId] = {};
        responses[templateId].answer = answer;

        // Update UI toggles
        const taskEl = document.getElementById(`task-${templateId}`);
        if (taskEl) {
            taskEl.querySelectorAll('.toggle-btn.yes').forEach(b => b.classList.toggle('active', answer === 'yes'));
            taskEl.querySelectorAll('.toggle-btn.no').forEach(b => b.classList.toggle('active', answer === 'no'));
        }

        // Show/hide dependent sections
        const photoSection = document.getElementById(`photo-section-${templateId}`);
        if (photoSection) photoSection.classList.toggle('show', answer === 'yes');

        const detailFields = document.getElementById(`detail-fields-${templateId}`);
        if (detailFields) detailFields.classList.toggle('show', answer === 'yes');

        const reasonBox = document.getElementById(`reason-box-${templateId}`);
        if (reasonBox) reasonBox.classList.toggle('show', answer === 'no');

        const materialList = document.getElementById(`material-list-${templateId}`);
        if (materialList) materialList.style.display = answer === 'yes' ? 'block' : 'none';

        // If answer is Yes on material_received and no response id yet, reload to get the response id
        const template = templates.find(t => t.id === templateId);
        if (template && template.task_type === 'material_received' && answer === 'yes' && !responses[templateId]?.id) {
            await loadTasks();
        }

        updateProgress();
    } catch (error) {
        showToast('Failed to save', 'error');
    }
}

// Save detail fields
async function saveDetails(templateId) {
    const inputs = document.querySelectorAll(`[data-task="${templateId}"][data-field]`);
    const details = {};
    inputs.forEach(input => {
        details[input.dataset.field] = input.value;
    });

    try {
        await fetch(`/api/daily-tasks/respond/${templateId}`, {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ answer: 'yes', details })
        });
    } catch (error) {
        showToast('Failed to save details', 'error');
    }
}

// Save reason for "No"
async function saveReason(templateId, reason) {
    try {
        await fetch(`/api/daily-tasks/respond/${templateId}`, {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ answer: 'no', reason })
        });
    } catch (error) {
        showToast('Failed to save reason', 'error');
    }
}

// Upload photo
async function uploadPhoto(templateId, input) {
    if (!input.files[0]) return;

    const formData = new FormData();
    formData.append('photo', input.files[0]);
    formData.append('template_id', templateId);

    try {
        const res = await fetch('/api/daily-tasks/upload-photo', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` },
            body: formData
        });
        const data = await res.json();
        if (data.success) {
            const preview = document.getElementById(`photos-${templateId}`);
            if (preview) {
                const img = document.createElement('img');
                img.src = data.photo_url;
                img.alt = 'Photo';
                preview.appendChild(img);
            }
            showToast('Photo uploaded');
        } else {
            showToast(data.error || 'Upload failed', 'error');
        }
    } catch (error) {
        showToast('Failed to upload photo', 'error');
    }
    input.value = '';
}

// Add material entry
async function addMaterial(templateId) {
    const vendorName = prompt('Enter vendor name:');
    if (!vendorName) return;

    const resp = responses[templateId];
    if (!resp || !resp.id) {
        showToast('Please select Yes first', 'error');
        return;
    }

    try {
        const res = await fetch(`/api/daily-tasks/material/${resp.id}`, {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ vendor_name: vendorName })
        });
        const data = await res.json();
        if (data.success) {
            const entriesDiv = document.getElementById(`material-entries-${templateId}`);
            const newMaterial = { id: data.id, vendor_name: vendorName, photo_url: null, bill_on_zoho: false };
            entriesDiv.insertAdjacentHTML('beforeend', renderMaterialEntry(newMaterial));
            showToast('Vendor added');
        }
    } catch (error) {
        showToast('Failed to add vendor', 'error');
    }
}

// Delete material entry
async function deleteMaterial(id) {
    if (!confirm('Remove this entry?')) return;
    try {
        await fetch(`/api/daily-tasks/material/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        const el = document.getElementById(`material-${id}`);
        if (el) el.remove();
        showToast('Entry removed');
    } catch (error) {
        showToast('Failed to remove', 'error');
    }
}

// Upload material photo
async function uploadMaterialPhoto(materialId, input) {
    if (!input.files[0]) return;

    const formData = new FormData();
    formData.append('photo', input.files[0]);

    try {
        const res = await fetch(`/api/daily-tasks/material/${materialId}/photo`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` },
            body: formData
        });
        const data = await res.json();
        if (data.success) {
            showToast('Bill photo uploaded');
            await loadTasks(); // Reload to show photo
        }
    } catch (error) {
        showToast('Failed to upload', 'error');
    }
    input.value = '';
}

// Toggle Zoho checkbox (no endpoint needed - just visual for now)
function toggleZoho(materialId, checked) {
    // Could add an API call here if needed
}

// Update progress ring
function updateProgress() {
    const total = templates.length;
    const completed = Object.values(responses).filter(r => r && r.answer).length;
    const pct = total > 0 ? completed / total : 0;
    const circumference = 150.8;

    document.getElementById('progressCircle').style.strokeDashoffset = circumference * (1 - pct);
    document.getElementById('progressText').textContent = `${completed}/${total}`;
}

// Submit day
async function submitDay() {
    const total = templates.length;
    const completed = Object.values(responses).filter(r => r && r.answer).length;

    if (completed < total) {
        if (!confirm(`You've completed ${completed}/${total} tasks. Submit anyway?`)) return;
    }

    const btn = document.getElementById('submitBtn');
    btn.disabled = true;
    btn.textContent = 'Submitting...';

    try {
        const res = await fetch('/api/daily-tasks/submit-day', {
            method: 'POST',
            headers: getAuthHeaders()
        });
        const data = await res.json();
        if (data.success) {
            showToast('Daily report submitted!');
            document.getElementById('submittedState').style.display = 'block';
        } else {
            showToast(data.error || 'Failed to submit', 'error');
        }
    } catch (error) {
        showToast('Failed to submit', 'error');
    }
    btn.disabled = false;
    btn.textContent = 'Submit Daily Report';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

// ── CSP handler wiring ───────────────────────────────────────────────
// Static submit button (originally onclick="submitDay()").
document.addEventListener('DOMContentLoaded', function () {
    const submitBtn = document.getElementById('submitBtn');
    if (submitBtn) submitBtn.addEventListener('click', submitDay);
});

// Delegated runtime handlers — every interactive element rendered inside the
// innerHTML/insertAdjacentHTML templates above is keyed on data-action.
document.addEventListener('click', function (e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    if (action === 'setAnswer') {
        setAnswer(Number(el.dataset.taskId), el.dataset.answer);
    } else if (action === 'addMaterial') {
        addMaterial(Number(el.dataset.taskId));
    } else if (action === 'deleteMaterial') {
        deleteMaterial(Number(el.dataset.materialId));
    } else if (action === 'reload') {
        e.preventDefault();
        location.reload();
    }
});

document.addEventListener('change', function (e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    if (action === 'uploadPhoto') {
        uploadPhoto(Number(el.dataset.taskId), el);
    } else if (action === 'saveDetails') {
        saveDetails(Number(el.dataset.task));
    } else if (action === 'saveReason') {
        saveReason(Number(el.dataset.taskId), el.value);
    } else if (action === 'uploadMaterialPhoto') {
        uploadMaterialPhoto(Number(el.dataset.materialId), el);
    } else if (action === 'toggleZoho') {
        toggleZoho(Number(el.dataset.materialId), el.checked);
    }
});

// Init
loadTasks();
