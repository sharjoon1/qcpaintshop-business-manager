// Engineer OTP login controller. Externalized from the page inline <script>
// (S9+F5 Phase C batch 2, 2026-06-15) so engineer-login.html runs under the enforced strict CSP.
// Verbatim move — no logic change.
    (function () {
      var phoneEl = document.getElementById('phone');
      var sendBtn = document.getElementById('sendBtn');
      var verifyBtn = document.getElementById('verifyBtn');
      var phoneStep = document.getElementById('phoneStep');
      var otpStep = document.getElementById('otpStep');
      var phoneErr = document.getElementById('phoneErr');
      var otpErr = document.getElementById('otpErr');
      var otpHint = document.getElementById('otpHint');
      var otpInputs = document.querySelectorAll('.ep-otp-row input');
      var currentPhone = '';

      function showErr(el, msg) { el.textContent = msg; el.style.display = ''; }
      function clearErr(el) { el.textContent = ''; el.style.display = 'none'; }

      phoneEl.addEventListener('input', function () { this.value = this.value.replace(/[^0-9]/g, '').slice(0, 10); });
      sendBtn.addEventListener('click', sendOtp);
      phoneEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') sendOtp(); });

      async function sendOtp() {
        clearErr(phoneErr);
        var phone = phoneEl.value.trim();
        if (!/^[6-9]\d{9}$/.test(phone)) { showErr(phoneErr, 'Please enter a valid 10-digit Indian mobile number.'); return; }
        sendBtn.disabled = true; sendBtn.textContent = 'Dispatching OTP…';
        try {
          var r = await fetch('/api/engineers/send-otp', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: phone })
          });
          var data = await r.json();
          if (r.status === 404 && data.code === 'NOT_REGISTERED') {
            showErr(phoneErr, 'No engineer account is associated with this number. Please apply for an Engineer Account first.');
            return;
          }
          if (!r.ok || !data.success) throw new Error(data.message || 'OTP dispatch failed.');
          currentPhone = phone;
          phoneStep.style.display = 'none';
          otpStep.style.display = '';
          var statusHint = data.status === 'approved' ? '' : ' (Account status: ' + data.status + '.)';
          otpHint.textContent = 'A 6-digit OTP has been dispatched to +91 ' + phone + '.' + statusHint + ' Valid for 10 minutes.';
          setTimeout(function () { otpInputs[0].focus(); }, 50);
        } catch (e) {
          showErr(phoneErr, e.message || 'Connection error. Please retry.');
        } finally {
          sendBtn.disabled = false; sendBtn.textContent = 'Request OTP';
        }
      }

      otpInputs.forEach(function (inp, idx) {
        inp.addEventListener('input', function (e) {
          e.target.value = e.target.value.replace(/[^0-9]/g, '').slice(0, 1);
          if (e.target.value && idx < otpInputs.length - 1) otpInputs[idx + 1].focus();
        });
        inp.addEventListener('keydown', function (e) {
          if (e.key === 'Backspace' && !inp.value && idx > 0) otpInputs[idx - 1].focus();
          if (e.key === 'Enter') verifyOtp();
        });
        inp.addEventListener('paste', function (e) {
          var data = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 6);
          if (!data) return;
          e.preventDefault();
          for (var i = 0; i < data.length && idx + i < otpInputs.length; i++) otpInputs[idx + i].value = data[i];
          otpInputs[Math.min(idx + data.length, otpInputs.length - 1)].focus();
        });
      });

      verifyBtn.addEventListener('click', verifyOtp);

      async function verifyOtp() {
        clearErr(otpErr);
        var otp = Array.prototype.map.call(otpInputs, function (i) { return i.value; }).join('');
        if (otp.length !== 6) { showErr(otpErr, 'Please enter the complete 6-digit OTP.'); return; }
        verifyBtn.disabled = true; verifyBtn.textContent = 'Authenticating…';
        try {
          var r = await fetch('/api/engineers/verify-otp', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: currentPhone, otp: otp })
          });
          var data = await r.json();
          if (!r.ok || !data.success) throw new Error(data.message || 'Invalid OTP.');
          var eng = data.engineer || {};
          try {
            localStorage.setItem('engineer_token', data.token || '');
            localStorage.setItem('engineer_id', eng.id || '');
            localStorage.setItem('engineer_phone', eng.phone || currentPhone);
            localStorage.setItem('engineer_name', eng.full_name || 'Engineer');
            localStorage.setItem('engineer_company', eng.company_name || '');
            localStorage.setItem('engineer_status', eng.status || 'pending');
            localStorage.setItem('engineer_logged_in', 'true');
          } catch (_) {}
          if (eng.status === 'rejected' || eng.status === 'suspended') {
            showErr(otpErr, 'This account is currently ' + eng.status + '. Please contact the relationship manager.');
            verifyBtn.disabled = false; verifyBtn.textContent = 'Verify & Sign In';
            return;
          }
          window.location.href = '/engineer-dashboard.html';
        } catch (e) {
          showErr(otpErr, e.message || 'Authentication failed. Please try again.');
        } finally {
          verifyBtn.disabled = false; verifyBtn.textContent = 'Verify & Sign In';
        }
      }

      document.getElementById('changeNumber').addEventListener('click', function (e) {
        e.preventDefault();
        otpStep.style.display = 'none';
        phoneStep.style.display = '';
        otpInputs.forEach(function (i) { i.value = ''; });
        clearErr(otpErr);
        phoneEl.focus();
      });
      document.getElementById('resendOtp').addEventListener('click', function (e) { e.preventDefault(); sendOtp(); });
    })();
