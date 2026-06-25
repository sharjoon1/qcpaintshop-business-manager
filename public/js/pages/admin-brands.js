// Page logic externalized from admin-brands.html inline <script> (S9+F5 Phase E batch 10, 2026-06-25)
// so the page runs under the enforced strict CSP. Verbatim move of all functions; inline on*=
// handlers converted to addEventListener + data-action delegation. No logic changes, no renames,
// escaping helpers untouched.
let brands = [];
let editingBrandId = null;

function esc(s){if(s==null)return '';const d=document.createElement('div');d.textContent=String(s);return d.innerHTML;}

function getAuthHeaders() {
    const token = localStorage.getItem('auth_token');
    return {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
    };
}

// Load brands
async function loadBrands() {
    try {
        const response = await fetch('/api/brands', { headers: getAuthHeaders() });
        brands = await response.json();

        document.getElementById('loadingState').classList.add('hidden');

        if (brands.length === 0) {
            document.getElementById('emptyState').classList.remove('hidden');
            document.getElementById('brandsTable').classList.add('hidden');
        } else {
            document.getElementById('emptyState').classList.add('hidden');
            document.getElementById('brandsTable').classList.remove('hidden');
            renderBrands();
        }
    } catch (error) {
        console.error('Error loading brands:', error);
        alert('Failed to load brands');
    }
}

// Fallback src for brand logos whose remote image fails to load (was onerror="this.src=...").
const BRAND_LOGO_FALLBACK = 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22><text y=%2220%22 font-size=%2220%22>🏷️</text></svg>';

// Render brands table
function renderBrands() {
    const tbody = document.getElementById('brandsBody');
    tbody.innerHTML = brands.map(brand => `
        <tr class="hover:bg-gray-50">
            <td class="px-4 py-3 text-sm font-medium text-gray-900">${brand.id}</td>
            <td class="px-4 py-3 text-sm font-semibold text-gray-900">${esc(brand.name)}</td>
            <td class="px-4 py-3 text-sm">
                ${brand.logo_url
                    ? `<img src="${esc(brand.logo_url)}" alt="${esc(brand.name)}" class="brand-logo h-8 w-auto object-contain">`
                    : '<span class="text-gray-400">No logo</span>'
                }
            </td>
            <td class="px-4 py-3">
                <span class="px-3 py-1 text-xs font-semibold rounded-full ${
                    brand.status === 'active'
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-800'
                }">
                    ${brand.status === 'active' ? '● Active' : '○ Inactive'}
                </span>
            </td>
            <td class="px-4 py-3 text-center">
                <button data-action="edit-brand" data-id="${brand.id}" class="text-blue-600 hover:text-blue-800 font-semibold text-sm mr-3">
                    Edit
                </button>
                <button data-action="delete-brand" data-id="${brand.id}" class="text-red-600 hover:text-red-800 font-semibold text-sm">
                    Delete
                </button>
            </td>
        </tr>
    `).join('');
}

// Open add modal
function openAddModal() {
    editingBrandId = null;
    document.getElementById('modalTitle').textContent = 'Add New Brand';
    document.getElementById('brandForm').reset();
    document.getElementById('brandId').value = '';
    document.getElementById('brandStatus').value = 'active';
    document.getElementById('brandModal').classList.remove('hidden');
}

// Edit brand
function editBrand(id) {
    const brand = brands.find(b => b.id === id);
    if (!brand) return;

    editingBrandId = id;
    document.getElementById('modalTitle').textContent = 'Edit Brand';
    document.getElementById('brandId').value = brand.id;
    document.getElementById('brandName').value = brand.name;
    document.getElementById('brandLogo').value = brand.logo_url || '';
    document.getElementById('brandStatus').value = brand.status;
    document.getElementById('brandModal').classList.remove('hidden');
}

// Close modal
function closeModal() {
    document.getElementById('brandModal').classList.add('hidden');
    document.getElementById('brandForm').reset();
    editingBrandId = null;
}

// Save brand
async function saveBrand(event) {
    event.preventDefault();

    const token = localStorage.getItem('auth_token');
    if (!token) {
        alert('❌ Not authenticated. Please login again.');
        window.location.href = '/login.html';
        return;
    }

    const brandData = {
        name: document.getElementById('brandName').value.trim(),
        logo_url: document.getElementById('brandLogo').value.trim() || null,
        status: document.getElementById('brandStatus').value
    };

    try {
        let response;
        if (editingBrandId) {
            // Update
            response = await fetch(`/api/brands/${editingBrandId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(brandData)
            });
        } else {
            // Create
            response = await fetch('/api/brands', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(brandData)
            });
        }

        const result = await response.json();

        if (response.ok && result.success) {
            alert(`✅ Brand ${editingBrandId ? 'updated' : 'created'} successfully!`);
            closeModal();
            loadBrands();
        } else {
            const errorMsg = result.error || result.message || 'Failed to save brand';
            console.error('Save brand error:', result);
            alert(`❌ Error: ${errorMsg}`);
        }
    } catch (error) {
        console.error('Error saving brand:', error);
        alert(`❌ Failed to save brand: ${error.message}`);
    }
}

// Delete brand
async function deleteBrand(id) {
    if (!confirm('⚠️ Are you sure you want to delete this brand?')) return;

    try {
        const token = localStorage.getItem('auth_token');
        const response = await fetch(`/api/brands/${id}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const result = await response.json();

        if (response.ok && result.success) {
            alert('✅ Brand deleted successfully!');
            loadBrands();
        } else {
            alert(`❌ Failed to delete brand: ${result.error || result.message}`);
        }
    } catch (error) {
        console.error('Error deleting brand:', error);
        alert('❌ Failed to delete brand. Please try again.');
    }
}

// ── Static handler wiring (externalized from inline on*= attributes; S9+F5 Phase E batch 10, 2026-06-25) ──
// Header "Add Brand" button (was onclick="openAddModal()")
document.getElementById('addBrandBtn').addEventListener('click', openAddModal);
// Empty-state "Add Brand" button (was onclick="openAddModal()")
document.getElementById('addBrandEmptyBtn').addEventListener('click', openAddModal);
// Modal close × button (was onclick="closeModal()")
document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
// Modal Cancel button (was onclick="closeModal()")
document.getElementById('modalCancelBtn').addEventListener('click', closeModal);
// Brand form save (was onsubmit="saveBrand(event)")
document.getElementById('brandForm').addEventListener('submit', saveBrand);

// Delegated dispatcher for runtime-rendered table buttons (replaces inline
// onclick="editBrand(...)" / onclick="deleteBrand(...)"). One document-level listener
// routes by data-action.
document.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    if (!action) return;
    if (action === 'edit-brand') {
        editBrand(btn.getAttribute('data-id'));
    } else if (action === 'delete-brand') {
        deleteBrand(btn.getAttribute('data-id'));
    }
});

// Delegated dispatcher for runtime-rendered brand logo <img> fallback (replaces inline
// onerror="this.src='data:image/svg+xml,...'"). Swaps the broken image src for the fallback once.
document.addEventListener('error', function (e) {
    const img = e.target;
    if (img && img.tagName === 'IMG' && img.classList.contains('brand-logo')) {
        img.src = BRAND_LOGO_FALLBACK;
    }
}, true);

// Initialize
loadBrands();
