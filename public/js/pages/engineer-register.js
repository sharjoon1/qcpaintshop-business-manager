// Engineer registration controller. Externalized from the page inline <script>
// (S9+F5 Phase C batch 2, 2026-06-15) so engineer-register.html runs under the enforced strict CSP.
// Verbatim move — no logic change. (Top-level vars were global as inline; remain global as a
// classic external script — identical scope/behavior.)
    var form = document.getElementById('qcEngForm');
    var submitBtn = document.getElementById('submitBtn');
    var msgEl = document.getElementById('msg');
    var phoneEl = document.getElementById('phone');
    var errPhoneEl = document.getElementById('err_phone');

    phoneEl.addEventListener('input', function () {
      this.value = this.value.replace(/[^0-9]/g, '').slice(0, 10);
      errPhoneEl.textContent = '';
    });

    function showMsg(text, kind) {
      msgEl.className = 'ep-notice ' + (kind === 'ok' ? 'ok' : 'err');
      msgEl.textContent = text;
    }

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      msgEl.className = ''; msgEl.textContent = ''; errPhoneEl.textContent = '';
      var phone = phoneEl.value.trim();
      if (!/^[6-9]\d{9}$/.test(phone)) {
        errPhoneEl.textContent = 'Please enter a valid 10-digit Indian mobile number commencing with 6, 7, 8 or 9.';
        phoneEl.focus();
        return;
      }
      var name = document.getElementById('full_name').value.trim();
      if (!name) { showMsg('Full name is required to proceed.', 'err'); return; }

      var payload = {
        full_name: name,
        phone: phone,
        email: document.getElementById('email').value.trim() || null,
        company_name: document.getElementById('company_name').value.trim() || null,
        designation: document.getElementById('designation').value.trim() || null,
        gst_number: (document.getElementById('gst_number').value || '').toUpperCase().trim() || null,
        address: document.getElementById('address').value.trim() || null,
        city: document.getElementById('city').value.trim() || null
      };

      submitBtn.disabled = true; submitBtn.textContent = 'Submitting application…';
      try {
        var r = await fetch('/api/engineers/register', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        var data = await r.json();
        if (!r.ok || !data.success) throw new Error(data.message || 'Application submission failed.');
        document.getElementById('formWrap').style.display = 'none';
        document.getElementById('successWrap').style.display = 'block';
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (err) {
        showMsg(err.message || 'Connection error. Please retry.', 'err');
        submitBtn.disabled = false; submitBtn.textContent = 'Submit Application';
      }
    });
