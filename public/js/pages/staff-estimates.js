// Staff-estimates header UI wiring. Externalized from the page inline <script>
// (S9+F5 Phase C batch 2, 2026-06-15) so staff-estimates.html runs under the enforced strict CSP.
// Verbatim move — no logic change.
        document.getElementById('mobileMenuBtn').addEventListener('click', function() {
            document.getElementById('mobileMenu').classList.toggle('hidden');
        });

        document.getElementById('profileBtn').addEventListener('click', function() {
            document.getElementById('profileDropdown').classList.toggle('hidden');
        });
