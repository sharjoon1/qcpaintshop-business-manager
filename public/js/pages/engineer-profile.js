// Engineer profile controller. Externalized from the page inline <script>
// (S9+F5 Phase C batch 2, 2026-06-15) so engineer-profile.html runs under the enforced strict CSP.
// Depends on window.EP (engineer-portal.js, loaded just before). Verbatim move — no logic change.
    (function () {
      function setStatus(status, reason) {
        var formal = {
          'pending': 'Pending Administrator Approval',
          'approved': 'Approved & Active',
          'suspended': 'Suspended',
          'rejected': 'Application Declined'
        };
        var line = document.getElementById('statusLine');
        var label = formal[status] || (status ? (status.charAt(0).toUpperCase() + status.slice(1)) : '—');
        line.innerHTML = '<span style="margin-right:8px;">' + label + '</span><span class="ep-badge s-' + (status || 'pending') + '"><span class="dot"></span>' + EP.statusLabel(status || 'pending') + '</span>';
        if (status === 'rejected' && reason) {
          line.innerHTML += '<div style="font-size:11px;color:var(--ep-red);margin-top:6px;">Reason on record: ' + EP.escapeHTML(reason) + '</div>';
        }
      }

      async function load() {
        try {
          var r = await fetch(EP.API_BASE + '/me/status', { headers: EP.authHeaders() });
          if (EP.handleAuthFail(r)) return;
          var json = await r.json();
          if (!json.success) throw new Error(json.message || 'Failed to load profile');
          var e = json.engineer;
          document.getElementById('acctRef').textContent = e.id ? '#ENG-' + String(e.id).padStart(4, '0') : '—';
          document.getElementById('phone').value = e.phone ? '+91 ' + e.phone : '';
          ['email','full_name','designation','city','company_name','gst_number','address','district','pincode'].forEach(function (k) {
            var el = document.getElementById(k);
            if (el) el.value = e[k] || '';
          });
          setStatus(e.status, e.rejected_reason);
        } catch (err) {
          console.error(err);
          document.getElementById('statusLine').textContent = 'Unable to load — refresh the page.';
        }
      }

      function showMsg(text, kind) {
        var m = document.getElementById('msg');
        m.className = 'ep-notice ' + (kind === 'ok' ? 'ok' : 'err');
        m.textContent = text;
      }

      document.getElementById('qcProfileForm').addEventListener('submit', async function (e) {
        e.preventDefault();
        var btn = document.getElementById('saveBtn');
        btn.disabled = true; btn.textContent = 'Saving…';
        try {
          var payload = {};
          ['email','full_name','designation','city','company_name','gst_number','address','district','pincode'].forEach(function (k) {
            var el = document.getElementById(k);
            payload[k] = el && el.value !== '' ? el.value.trim() : null;
          });
          if (payload.gst_number) payload.gst_number = payload.gst_number.toUpperCase();
          var r = await fetch(EP.API_BASE + '/me', {
            method: 'PUT', headers: EP.authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(payload)
          });
          if (EP.handleAuthFail(r)) return;
          var data = await r.json();
          if (!data.success) throw new Error(data.message || 'Save failed');
          try {
            if (payload.full_name) localStorage.setItem('engineer_name', payload.full_name);
            if (payload.company_name !== null) localStorage.setItem('engineer_company', payload.company_name || '');
          } catch (_) {}
          showMsg('Changes saved successfully. Your profile has been updated on record.', 'ok');
        } catch (err) {
          showMsg(err.message || 'Save unsuccessful. Please retry.', 'err');
        } finally {
          btn.disabled = false; btn.textContent = 'Save Changes';
        }
      });

      document.addEventListener('DOMContentLoaded', load);
    })();
