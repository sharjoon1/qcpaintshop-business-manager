(function () {
      function hydrate() {
        var name = localStorage.getItem('engineer_name') || '';
        var phone = localStorage.getItem('engineer_phone') || '';
        var company = localStorage.getItem('engineer_company') || '';
        document.getElementById('engName').value = name;
        document.getElementById('engPhone').value = phone ? '+91 ' + phone : '';
        if (company) document.getElementById('engCompany').value = company;
        else document.getElementById('companyFieldWrap').style.display = 'none';
      }
      function showMsg(text, kind) {
        var m = document.getElementById('msg');
        m.className = 'ep-notice ' + (kind === 'ok' ? 'ok' : 'err');
        m.textContent = text;
      }
      function clearMsg() { var m = document.getElementById('msg'); m.className = ''; m.textContent = ''; }

      document.getElementById('qcQuoteForm').addEventListener('submit', async function (e) {
        e.preventDefault();
        clearMsg();
        var btn = document.getElementById('submitBtn');
        var payload = {
          project_name: document.getElementById('project_name').value.trim(),
          location: document.getElementById('location').value.trim(),
          property_type: document.getElementById('property_type').value,
          project_type: document.getElementById('project_type').value,
          area_sqft: parseInt(document.getElementById('area_sqft').value, 10),
          preferred_brand: document.getElementById('preferred_brand').value || null,
          timeline: document.getElementById('timeline').value || null,
          budget_range: document.getElementById('budget_range').value || null,
          additional_notes: document.getElementById('additional_notes').value.trim() || null,
          site_visit: document.getElementById('site_visit').checked
        };
        if (!payload.project_name) { showMsg('A project name is required to proceed.', 'err'); return; }
        if (!payload.location) { showMsg('A site address is required to proceed.', 'err'); return; }
        if (!Number.isFinite(payload.area_sqft) || payload.area_sqft <= 0) {
          showMsg('Please furnish an approximate paintable area in square feet.', 'err'); return;
        }

        btn.disabled = true; btn.textContent = 'Submitting...';
        try {
          var r = await fetch(EP.API_BASE + '/me/quotes', {
            method: 'POST', headers: EP.authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(payload)
          });
          if (EP.handleAuthFail(r)) return;
          var data = await r.json();
          if (!data.success) throw new Error(data.message || 'Submission unsuccessful.');
          document.getElementById('formWrap').style.display = 'none';
          document.getElementById('successRefNum').textContent = data.request_number || '—';
          document.getElementById('successWrap').style.display = 'block';
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (err) {
          showMsg(err.message || 'Connection error. Please retry.', 'err');
        } finally {
          btn.disabled = false; btn.textContent = 'Submit Quotation Request';
        }
      });

      document.addEventListener('DOMContentLoaded', function () { hydrate(); EP.loadMe(); });

      // Wiring for former static onclick on the "Submit Another" anchor
      var anotherBtn = document.getElementById('submitAnother');
      if (anotherBtn) anotherBtn.addEventListener('click', function (e) { e.preventDefault(); window.location.reload(); });
    })();
