// Page logic for Daily Tasks Management. Externalized from the admin-daily-tasks.html
// inline <script> (S9+F5 Phase C, 2026-06-25) so the page runs under the enforced strict CSP.
// Verbatim move of all functions; inline on*= handlers converted to addEventListener /
// data-action delegation. No logic changes, no renames, escaping helpers untouched.
        document.addEventListener('navigationLoaded', initPage);
        setTimeout(initPage, 1000);

        let pageInitialized = false;
        let allTemplates = [];
        let allUsers = [];

        function initPage() {
            if (pageInitialized) return;
            pageInitialized = true;
            loadTemplates();
            loadUsers();
            // Set default date
            document.getElementById('responseDate').value = new Date().toISOString().split('T')[0];
        }

        function switchTab(tab) {
            document.getElementById('tabTemplates').classList.toggle('active', tab === 'templates');
            document.getElementById('tabResponses').classList.toggle('active', tab === 'responses');
            document.getElementById('templatesPanel').style.display = tab === 'templates' ? 'block' : 'none';
            document.getElementById('responsesPanel').style.display = tab === 'responses' ? 'block' : 'none';

            if (tab === 'responses') {
                loadResponses();
                loadSummary();
            }
        }

        // ========================================
        // TEMPLATES
        // ========================================

        async function loadTemplates() {
            try {
                const res = await fetch('/api/daily-tasks/templates', { headers: getAuthHeaders() });
                const data = await res.json();
                if (data.success) {
                    allTemplates = data.data;
                    displayTemplates(data.data);
                }
            } catch (error) {
                console.error('Error loading templates:', error);
            }
        }

        function displayTemplates(templates) {
            const tbody = document.getElementById('templatesBody');
            const cardsDiv = document.getElementById('templatesCards');
            const typeLabels = { yes_no: 'Yes/No', yes_no_photo: 'Yes/No + Photo', yes_no_detail: 'Yes/No + Detail', material_received: 'Material' };

            if (templates.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" class="px-3 py-8 text-center text-gray-500">No templates yet. Create your first one!</td></tr>';
                cardsDiv.innerHTML = '<p class="text-center text-gray-500 py-8">No templates yet. Create your first one!</p>';
                return;
            }

            // Desktop table
            tbody.innerHTML = templates.map(t => `
                <tr class="border-b border-gray-100 hover:bg-gray-50">
                    <td class="px-3 py-3 font-semibold text-gray-600">${escapeHtml(t.sort_order)}</td>
                    <td class="px-3 py-3">
                        <span class="badge" style="background:#eff6ff;color:#2563eb;">${escapeHtml(t.section)}</span>
                    </td>
                    <td class="px-3 py-3 font-semibold text-gray-900">${escapeHtml(t.title)}</td>
                    <td class="px-3 py-3 text-gray-600">${typeLabels[t.task_type] || escapeHtml(t.task_type)}</td>
                    <td class="px-3 py-3 text-gray-600">${(t.roles || []).join(', ')}</td>
                    <td class="px-3 py-3">${t.photo_required ? '<span style="color:#10b981;">Yes</span>' : '<span style="color:#9ca3af;">No</span>'}</td>
                    <td class="px-3 py-3">
                        <span class="badge ${t.is_active ? 'badge-active' : 'badge-inactive'}">${t.is_active ? 'Active' : 'Inactive'}</span>
                    </td>
                    <td class="px-3 py-3">
                        <div style="display:flex;gap:4px;">
                            <button class="btn btn-secondary" data-action="editTemplate" data-id="${escapeHtml(t.id)}" style="padding:4px 8px;">Edit</button>
                            <button class="btn btn-danger" data-action="deleteTemplate" data-id="${escapeHtml(t.id)}" style="padding:4px 8px;">${t.is_active ? 'Deactivate' : 'Delete'}</button>
                        </div>
                    </td>
                </tr>
            `).join('');

            // Mobile cards
            cardsDiv.innerHTML = templates.map(t => `
                <div class="template-card">
                    <div class="template-card-header">
                        <div class="template-card-title">${escapeHtml(t.title)}</div>
                        <span class="badge ${t.is_active ? 'badge-active' : 'badge-inactive'}">${t.is_active ? 'Active' : 'Inactive'}</span>
                    </div>
                    <div class="template-card-meta">
                        <span class="badge" style="background:#eff6ff;color:#2563eb;">${escapeHtml(t.section)}</span>
                        <span class="badge" style="background:#f3f4f6;color:#374151;">${typeLabels[t.task_type] || escapeHtml(t.task_type)}</span>
                        ${t.photo_required ? '<span class="badge" style="background:#d1fae5;color:#065f46;">Photo</span>' : ''}
                        <span class="badge" style="background:#faf5ff;color:#7c3aed;">#${escapeHtml(t.sort_order)}</span>
                    </div>
                    <div style="font-size:12px;color:#6b7280;margin-bottom:10px;">Roles: ${(t.roles || []).join(', ')}</div>
                    <div class="template-card-actions">
                        <button class="btn btn-secondary" data-action="editTemplate" data-id="${escapeHtml(t.id)}" style="flex:1;">Edit</button>
                        <button class="btn btn-danger" data-action="deleteTemplate" data-id="${escapeHtml(t.id)}" style="flex:1;">${t.is_active ? 'Deactivate' : 'Delete'}</button>
                    </div>
                </div>
            `).join('');
        }

        function openTemplateModal() {
            document.getElementById('templateModalTitle').textContent = 'Add Template';
            document.getElementById('templateForm').reset();
            document.getElementById('templateId').value = '';
            document.querySelectorAll('.role-checkbox').forEach(cb => { cb.checked = cb.value === 'staff' || cb.value === 'manager'; });
            toggleDetailFieldsInput();
            openModal('templateModal');
        }

        function editTemplate(id) {
            const t = allTemplates.find(tpl => tpl.id === id);
            if (!t) return;

            document.getElementById('templateModalTitle').textContent = 'Edit Template';
            document.getElementById('templateId').value = t.id;
            document.getElementById('tplSection').value = t.section;
            document.getElementById('tplType').value = t.task_type;
            document.getElementById('tplTitle').value = t.title;
            document.getElementById('tplDescription').value = t.description || '';
            document.getElementById('tplSortOrder').value = t.sort_order;
            document.getElementById('tplPhotoRequired').value = t.photo_required ? 'true' : 'false';
            document.getElementById('tplDetailFields').value = (t.detail_fields || []).join(', ');

            document.querySelectorAll('.role-checkbox').forEach(cb => {
                cb.checked = (t.roles || []).includes(cb.value);
            });

            toggleDetailFieldsInput();
            openModal('templateModal');
        }

        async function saveTemplate(e) {
            e.preventDefault();
            const id = document.getElementById('templateId').value;
            const roles = [];
            document.querySelectorAll('.role-checkbox:checked').forEach(cb => roles.push(cb.value));

            const detailFieldsStr = document.getElementById('tplDetailFields').value.trim();
            const detailFields = detailFieldsStr ? detailFieldsStr.split(',').map(f => f.trim()).filter(Boolean) : null;

            const body = {
                section: document.getElementById('tplSection').value,
                title: document.getElementById('tplTitle').value,
                description: document.getElementById('tplDescription').value || null,
                task_type: document.getElementById('tplType').value,
                detail_fields: detailFields,
                roles,
                photo_required: document.getElementById('tplPhotoRequired').value === 'true',
                sort_order: parseInt(document.getElementById('tplSortOrder').value) || 0
            };

            try {
                const url = id ? `/api/daily-tasks/templates/${id}` : '/api/daily-tasks/templates';
                const method = id ? 'PUT' : 'POST';
                const res = await fetch(url, {
                    method,
                    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                const data = await res.json();
                if (data.success) {
                    alert(id ? 'Template updated!' : 'Template created!');
                    closeModal('templateModal');
                    loadTemplates();
                } else {
                    alert(data.error || 'Failed to save');
                }
            } catch (error) {
                alert('Error saving template');
            }
        }

        async function deleteTemplate(id) {
            if (!confirm('Deactivate this template?')) return;
            try {
                await fetch(`/api/daily-tasks/templates/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
                loadTemplates();
            } catch (error) {
                alert('Error deleting template');
            }
        }

        function toggleDetailFieldsInput() {
            const type = document.getElementById('tplType').value;
            document.getElementById('detailFieldsGroup').style.display = type === 'yes_no_detail' ? 'block' : 'none';
        }

        // ========================================
        // RESPONSES
        // ========================================

        async function loadUsers() {
            try {
                const res = await fetch('/api/users?assignable=1', { headers: getAuthHeaders() });
                if (res.ok) {
                    const users = await res.json();
                    allUsers = users;
                    const select = document.getElementById('responseUser');
                    users.forEach(u => {
                        select.add(new Option(`${u.full_name} (${u.username})`, u.id));
                    });
                }
            } catch (error) {
                console.error('Error loading users:', error);
            }
        }

        async function loadResponses() {
            const date = document.getElementById('responseDate').value;
            const userId = document.getElementById('responseUser').value;

            if (!date) return;

            try {
                let url = `/api/daily-tasks/admin/responses?date=${date}`;
                if (userId) url += `&user_id=${userId}`;

                const res = await fetch(url, { headers: getAuthHeaders() });
                const data = await res.json();

                if (data.success) {
                    displayResponses(data.data);
                }

                loadSummary();
            } catch (error) {
                console.error('Error loading responses:', error);
            }
        }

        function displayResponses(responses) {
            const container = document.getElementById('responsesList');

            if (responses.length === 0) {
                container.innerHTML = '<p class="text-gray-500 text-center py-8">No responses found for this date.</p>';
                return;
            }

            // Group by user
            const byUser = {};
            responses.forEach(r => {
                if (!byUser[r.user_id]) {
                    byUser[r.user_id] = { name: r.user_name, username: r.username, responses: [] };
                }
                byUser[r.user_id].responses.push(r);
            });

            let html = '';
            for (const [userId, data] of Object.entries(byUser)) {
                const yesCount = data.responses.filter(r => r.answer === 'yes').length;
                const noCount = data.responses.filter(r => r.answer === 'no').length;
                const totalPhotos = data.responses.reduce((sum, r) => {
                    const photos = r.photos || [];
                    return sum + photos.length;
                }, 0);

                html += `<div class="response-card">
                    <div class="response-header" data-action="toggleResponseBody">
                        <div>
                            <span style="font-weight:700;color:#1f2937;">${escapeHtml(data.name)}</span>
                            <span style="color:#6b7280;font-size:12px;margin-left:8px;">@${escapeHtml(data.username)}</span>
                        </div>
                        <div style="display:flex;gap:6px;align-items:center;">
                            <span class="badge badge-yes">${yesCount} Yes</span>
                            <span class="badge badge-no">${noCount} No</span>
                            ${totalPhotos > 0 ? `<span class="badge" style="background:#eff6ff;color:#2563eb;">${totalPhotos} photos</span>` : ''}
                            <svg style="width:16px;height:16px;color:#9ca3af;transition:transform 0.2s;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
                            </svg>
                        </div>
                    </div>
                    <div class="response-body">`;

                data.responses.forEach(r => {
                    const details = r.details || {};
                    const photos = r.photos || [];
                    const mats = r.materials || [];
                    const typeLabels = { yes_no: 'Yes/No', yes_no_photo: 'Photo', yes_no_detail: 'Detail', material_received: 'Material' };

                    html += `<div style="padding:10px 0;border-bottom:1px solid #f3f4f6;">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                            <div>
                                <span style="font-weight:600;color:#374151;">${escapeHtml(r.template_title)}</span>
                                <span class="badge" style="background:#f3f4f6;color:#6b7280;margin-left:6px;">${escapeHtml(r.section)}</span>
                            </div>
                            <span class="badge ${r.answer === 'yes' ? 'badge-yes' : r.answer === 'no' ? 'badge-no' : 'badge-pending'}">
                                ${r.answer ? r.answer.toUpperCase() : 'Pending'}
                            </span>
                        </div>`;

                    if (r.reason) {
                        html += `<div style="background:#fef3c7;padding:8px 12px;border-radius:8px;font-size:13px;color:#92400e;margin-bottom:6px;">
                            <strong>Reason:</strong> ${escapeHtml(r.reason)}
                        </div>`;
                    }

                    if (Object.keys(details).length > 0) {
                        html += `<div style="background:#f0fdf4;padding:8px 12px;border-radius:8px;font-size:13px;margin-bottom:6px;">`;
                        for (const [key, val] of Object.entries(details)) {
                            html += `<div><strong>${escapeHtml(String(key).replace(/_/g, ' '))}:</strong> ${escapeHtml(val || '-')}</div>`;
                        }
                        html += `</div>`;
                    }

                    if (photos.length > 0) {
                        html += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">`;
                        photos.forEach(p => {
                            html += `<img src="${escapeHtml(p)}" class="photo-thumb" data-action="showPhoto" data-photo="${escapeHtml(p)}">`;
                        });
                        html += `</div>`;
                    }

                    if (mats.length > 0) {
                        html += `<div style="margin-top:8px;">
                            <span style="font-size:12px;font-weight:700;color:#6b7280;">Materials Received:</span>`;
                        mats.forEach(m => {
                            html += `<div style="background:#f9fafb;padding:8px;border-radius:8px;margin-top:4px;display:flex;align-items:center;gap:8px;">
                                ${m.photo_url ? `<img src="${escapeHtml(m.photo_url)}" class="photo-thumb" style="width:50px;height:50px;" data-action="showPhoto" data-photo="${escapeHtml(m.photo_url)}">` : ''}
                                <div>
                                    <div style="font-weight:600;font-size:13px;">${escapeHtml(m.vendor_name)}</div>
                                    <div style="font-size:11px;color:#6b7280;">${m.bill_on_zoho ? 'Bill on Zoho' : 'No Zoho bill'}</div>
                                </div>
                            </div>`;
                        });
                        html += `</div>`;
                    }

                    html += `</div>`;
                });

                html += `</div></div>`;
            }

            container.innerHTML = html;

            // Update stats
            document.getElementById('statTotalResponses').textContent = responses.length;
            document.getElementById('statPhotos').textContent = responses.reduce((sum, r) => sum + (r.photos || []).length, 0);
        }

        async function loadSummary() {
            const date = document.getElementById('responseDate').value;
            if (!date) return;

            try {
                const res = await fetch(`/api/daily-tasks/admin/summary?date=${date}`, { headers: getAuthHeaders() });
                const data = await res.json();
                if (data.success) {
                    document.getElementById('statSubmitted').textContent = data.data.submitted.length;
                    document.getElementById('statNotSubmitted').textContent = data.data.not_submitted.length;
                }
            } catch (error) {
                console.error('Error loading summary:', error);
            }
        }

        function toggleResponseBody(header) {
            const body = header.nextElementSibling;
            body.classList.toggle('open');
            const arrow = header.querySelector('svg');
            if (arrow) arrow.style.transform = body.classList.contains('open') ? 'rotate(180deg)' : '';
        }

        function showPhoto(url) {
            document.getElementById('lightboxImg').src = url;
            document.getElementById('photoLightbox').style.display = 'flex';
        }

        // ========================================
        // UTILS
        // ========================================

        function openModal(id) {
            document.getElementById(id).classList.add('active');
            document.body.style.overflow = 'hidden';
        }

        function closeModal(id) {
            document.getElementById(id).classList.remove('active');
            document.body.style.overflow = 'auto';
        }

        document.querySelectorAll('.modal').forEach(m => {
            m.addEventListener('click', e => { if (e.target === m) closeModal(m.id); });
        });

        function escapeHtml(text) {
            const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
            return text ? String(text).replace(/[&<>"']/g, c => map[c]) : '';
        }

        // Use the global getAuthHeaders from universal-nav-loader.js
        // Do NOT redefine getAuthHeaders here to avoid infinite recursion

        // ========================================
        // STATIC HANDLER WIRING (S9+F5 — replaces inline on*= attributes in markup)
        // ========================================
        document.getElementById('tabTemplates').addEventListener('click', function() { switchTab('templates'); });
        document.getElementById('tabResponses').addEventListener('click', function() { switchTab('responses'); });
        document.getElementById('addTemplateBtn').addEventListener('click', openTemplateModal);
        document.getElementById('responseDate').addEventListener('change', loadResponses);
        document.getElementById('responseUser').addEventListener('change', loadResponses);
        document.getElementById('refreshResponsesBtn').addEventListener('click', loadResponses);
        document.getElementById('templateForm').addEventListener('submit', saveTemplate);
        document.getElementById('tplType').addEventListener('change', toggleDetailFieldsInput);
        document.getElementById('cancelTemplateBtn').addEventListener('click', function() { closeModal('templateModal'); });
        document.getElementById('photoLightbox').addEventListener('click', function() { this.style.display = 'none'; });

        // ========================================
        // DELEGATED RUNTIME HANDLERS (S9+F5 — for elements injected via innerHTML templates)
        // ========================================
        // Template row Edit/Delete buttons (desktop table + mobile cards) and response-header
        // toggles / photo thumbnails are rebuilt on every load, so a single delegated listener
        // keyed on data-action dispatches them. Keeps the markup CSP-clean.
        document.addEventListener('click', function(e) {
            var el = e.target.closest('[data-action]');
            if (!el) return;
            var action = el.dataset.action;
            switch (action) {
                case 'editTemplate': {
                    var id = parseInt(el.dataset.id, 10);
                    if (!Number.isNaN(id)) editTemplate(id);
                    break;
                }
                case 'deleteTemplate': {
                    var id = parseInt(el.dataset.id, 10);
                    if (!Number.isNaN(id)) deleteTemplate(id);
                    break;
                }
                case 'toggleResponseBody':
                    toggleResponseBody(el);
                    break;
                case 'showPhoto':
                    showPhoto(el.dataset.photo);
                    break;
            }
        });
