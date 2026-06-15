// Landing-page session awareness. Externalized from the page inline <script>
// (S9+F5 Phase C batch 2, 2026-06-15) so index.html runs under the enforced strict CSP.
// Verbatim move — no logic change.
    // Session-aware: if already logged in, highlight the relevant card and redirect href
    (function () {
      try {
        var sessions = [
          {
            key: 'auth_token',
            cardId: 'cardStaff',
            resolve: function () {
              try {
                var u = JSON.parse(localStorage.getItem('user') || 'null');
                var role = u && u.role ? String(u.role).toLowerCase() : '';
                var adminRoles = ['admin', 'administrator', 'super_admin', 'manager', 'branch_manager'];
                var staffRoles = ['staff', 'salesperson', 'sales'];
                if (adminRoles.indexOf(role) !== -1) return { label: 'Go to Dashboard →', href: '/dashboard.html' };
                if (staffRoles.indexOf(role) !== -1) return { label: 'Go to Staff Portal →', href: '/staff/dashboard.html' };
                return { label: 'Go to Dashboard →', href: '/dashboard.html' };
              } catch (e) { return null; }
            }
          },
          {
            key: 'painter_token',
            cardId: 'cardPainter',
            resolve: function () { return { label: 'Go to Painter App →', href: '/painter-dashboard.html' }; }
          },
          {
            key: 'customer_token',
            cardId: 'cardCustomer',
            resolve: function () { return { label: 'Go to My Account →', href: '/customer-dashboard.html' }; }
          },
          {
            key: 'engineer_token',
            cardId: 'cardEngineer',
            resolve: function () { return { label: 'Go to Engineer Portal →', href: '/engineer-dashboard.html' }; }
          }
        ];

        sessions.forEach(function (s) {
          if (!localStorage.getItem(s.key)) return;
          var result = s.resolve();
          if (!result) return;
          var card = document.getElementById(s.cardId);
          if (!card) return;
          card.href = result.href;
          card.classList.add('is-active');
          var arrow = card.querySelector('.portal-card-arrow');
          if (arrow) arrow.textContent = result.label;
        });
      } catch (e) { /* storage unavailable — render page without session state */ }
    }());
