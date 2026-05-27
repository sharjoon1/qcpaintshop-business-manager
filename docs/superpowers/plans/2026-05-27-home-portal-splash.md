# Home Page Portal Splash Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the full marketing landing page at `public/index.html` with a minimal portal splash screen that shows 4 login cards (Staff, Painter, Customer, Engineer) and is session-aware.

**Architecture:** Single-file replacement — `public/index.html` is fully rewritten. No backend changes. No new routes. Existing design tokens (CSS variables, fonts) are preserved. Session-aware JS is ported from the old page's localStorage detection logic.

**Tech Stack:** Vanilla HTML/CSS/JS · Google Fonts (Playfair Display, Inter, Noto Serif Tamil) · No external runtime dependencies (Leaflet removed)

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| **Modify** | `public/index.html` | Entire page replaced — new splash screen content |

---

### Task 1: Replace `public/index.html` with portal splash screen

**Files:**
- Modify: `public/index.html` (full replacement)

---

- [ ] **Step 1: Open the file and confirm current state**

  Open `public/index.html`. Confirm it contains the old marketing page (sections: `.qc-hero`, `.qc-brands`, `.qc-about`, `.qc-services`, `.qc-branches`, `.qc-gallery`, `.qc-design`, `.qc-foot`). This is what we are replacing.

---

- [ ] **Step 2: Replace entire `public/index.html` with the new splash screen**

  Overwrite `public/index.html` completely with the following content:

  ```html
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="theme-color" content="#1B5E3B">
    <meta name="description" content="Quality Colours Business Portal — Staff, Painter, Customer and Engineer sign-in.">
    <title>Quality Colours · Portal</title>

    <link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192x192.png">
    <link rel="apple-touch-icon" href="/icons/icon-192x192.png">
    <link rel="manifest" href="/manifest.json">

    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;1,400&family=Inter:wght@300;400;500;600&family=Noto+Serif+Tamil:wght@400;500&display=swap" rel="stylesheet">

    <style>
      /* ── Design tokens (same as site-wide) ── */
      :root {
        --qc-cream:      #FBFAF7;
        --qc-green:      #1B5E3B;
        --qc-green-dark: #154D31;
        --qc-gold:       #D4A24E;
        --qc-ink:        #1A1A1A;
        --qc-muted:      #666666;
        --serif: 'Playfair Display', Georgia, serif;
        --sans:  'Inter', system-ui, -apple-system, sans-serif;
        --tamil: 'Noto Serif Tamil', 'Noto Sans Tamil', serif;
      }

      *, *::before, *::after { box-sizing: border-box; }
      html { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
      body {
        margin: 0;
        font-family: var(--sans);
        background: var(--qc-cream);
        color: var(--qc-ink);
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 40px 20px;
      }

      /* Top accent bar */
      body::before {
        content: '';
        position: fixed;
        top: 0; left: 0; right: 0;
        height: 3px;
        background: linear-gradient(90deg, var(--qc-green) 0%, var(--qc-gold) 100%);
      }

      /* ── Splash wrapper ── */
      .splash {
        width: 100%;
        max-width: 640px;
        text-align: center;
      }

      /* ── Brand block ── */
      .brand-sub {
        font-family: var(--sans);
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 2.5px;
        text-transform: uppercase;
        color: var(--qc-muted);
        margin: 0 0 10px;
      }
      .brand-name {
        font-family: var(--serif);
        font-weight: 500;
        font-size: clamp(28px, 5vw, 40px);
        letter-spacing: -0.5px;
        color: var(--qc-green);
        margin: 0 0 10px;
      }
      .brand-tagline {
        font-family: var(--tamil);
        font-size: 15px;
        color: var(--qc-gold);
        margin: 0 0 32px;
        line-height: 1.5;
      }
      .brand-divider {
        width: 36px;
        height: 2px;
        background: var(--qc-gold);
        margin: 0 auto 36px;
        border: 0;
      }

      /* ── Portal section label ── */
      .portal-label {
        font-family: var(--sans);
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 2.2px;
        text-transform: uppercase;
        color: var(--qc-muted);
        margin: 0 0 18px;
      }

      /* ── Portal grid ── */
      .portal-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 14px;
        margin-bottom: 36px;
      }
      @media (max-width: 480px) {
        .portal-grid { grid-template-columns: 1fr; }
      }

      /* ── Portal card ── */
      .portal-card {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        text-align: left;
        padding: 20px 22px;
        background: #fff;
        border: 1px solid rgba(26,26,26,0.08);
        border-left: 3px solid var(--qc-green);
        text-decoration: none;
        color: var(--qc-ink);
        transition: border-left-color 0.18s, box-shadow 0.18s, transform 0.15s;
      }
      .portal-card:hover {
        border-left-color: var(--qc-gold);
        box-shadow: 0 4px 18px rgba(0,0,0,0.07);
        transform: translateY(-2px);
      }
      .portal-card-icon {
        font-size: 20px;
        margin-bottom: 10px;
        line-height: 1;
      }
      .portal-card-title {
        font-family: var(--serif);
        font-weight: 500;
        font-size: 16px;
        color: var(--qc-ink);
        margin: 0 0 5px;
      }
      .portal-card-desc {
        font-family: var(--sans);
        font-size: 12px;
        color: var(--qc-muted);
        line-height: 1.5;
        margin: 0 0 14px;
      }
      .portal-card-arrow {
        font-family: var(--sans);
        font-size: 12px;
        font-weight: 500;
        color: var(--qc-green);
        margin-top: auto;
        transition: color 0.15s;
      }
      .portal-card:hover .portal-card-arrow { color: var(--qc-gold); }

      /* Session-aware: already logged in */
      .portal-card.is-active {
        border-left-color: var(--qc-gold);
        background: #fffdf7;
      }
      .portal-card.is-active .portal-card-arrow {
        color: var(--qc-gold);
        font-weight: 600;
      }

      /* ── Footer ── */
      .splash-foot {
        font-family: var(--sans);
        font-size: 11px;
        color: var(--qc-muted);
        letter-spacing: 0.3px;
      }
    </style>
  </head>
  <body>

    <div class="splash">

      <!-- Brand -->
      <p class="brand-sub">Ramanathapuram · Est 2018</p>
      <h1 class="brand-name">Quality Colours.</h1>
      <p class="brand-tagline">தரமான வண்ணங்கள், சிறந்த முடிவு.</p>
      <hr class="brand-divider">

      <!-- Portal cards -->
      <p class="portal-label">Sign in to your portal</p>
      <div class="portal-grid">

        <a href="/login.html" class="portal-card" id="cardStaff">
          <div class="portal-card-icon">🏢</div>
          <div class="portal-card-title">Staff &amp; Admin</div>
          <div class="portal-card-desc">Branch management, billing, leads &amp; collections</div>
          <div class="portal-card-arrow">Sign in →</div>
        </a>

        <a href="/painter-login.html" class="portal-card" id="cardPainter">
          <div class="portal-card-icon">🎨</div>
          <div class="portal-card-title">Painter Portal</div>
          <div class="portal-card-desc">My jobs, estimates, loyalty points &amp; attendance</div>
          <div class="portal-card-arrow">Sign in →</div>
        </a>

        <a href="/customer-login.html" class="portal-card" id="cardCustomer">
          <div class="portal-card-icon">👤</div>
          <div class="portal-card-title">Customer Portal</div>
          <div class="portal-card-desc">My orders, invoices, estimates &amp; payments</div>
          <div class="portal-card-arrow">Sign in →</div>
        </a>

        <a href="/engineer-login.html" class="portal-card" id="cardEngineer">
          <div class="portal-card-icon">🔧</div>
          <div class="portal-card-title">Engineer Portal</div>
          <div class="portal-card-desc">Site visits, reports &amp; project tracking</div>
          <div class="portal-card-arrow">Sign in →</div>
        </a>

      </div>

      <p class="splash-foot">© 2026 Quality Colours · Ramanathapuram. All rights reserved.</p>
    </div>

    <script>
      // Session-aware: if already logged in, highlight the relevant card and redirect href
      (function () {
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
          card.querySelector('.portal-card-arrow').textContent = result.label;
        });
      }());
    </script>

  </body>
  </html>
  ```

---

- [ ] **Step 3: Verify the page renders correctly in a browser**

  Open `http://localhost:3000` (or whichever port the dev server runs on — check `server.js` for the PORT env var, default is typically 3000).

  **Check these items:**
  - [ ] Page shows "Quality Colours." heading in green serif font
  - [ ] Tamil tagline appears in gold below
  - [ ] 4 portal cards visible in 2×2 grid: Staff & Admin, Painter Portal, Customer Portal, Engineer Portal
  - [ ] Each card has green left border, icon, title, description, "Sign in →" arrow
  - [ ] Hovering a card shifts border to gold and lifts the card slightly
  - [ ] Green-to-gold top accent bar is visible at very top of page
  - [ ] No leftover marketing sections (no hero image, no About, no Services, no Branches map, no Gallery, no footer)

---

- [ ] **Step 4: Verify mobile layout**

  In browser DevTools, set viewport to 375px width (iPhone SE).

  **Check these items:**
  - [ ] 4 cards stack into a single column (not 2 columns)
  - [ ] All card text readable and not overflowing
  - [ ] Brand name and Tamil tagline centered and not clipped

---

- [ ] **Step 5: Verify session-aware behaviour**

  Open DevTools → Application → Local Storage. Set a test value:
  ```
  Key:   painter_token
  Value: test_token_123
  ```
  Reload the page.

  **Expected:** The "Painter Portal" card gets a gold left border (`.is-active` class), and its arrow text changes to **"Go to Painter App →"** with `href` updated to `/painter-dashboard.html`.

  Clear the localStorage key when done:
  ```
  localStorage.removeItem('painter_token')
  ```

---

- [ ] **Step 6: Commit**

  ```bash
  git add public/index.html
  git commit -m "feat(landing): replace marketing page with minimal portal splash screen

  - 4 login cards: Staff/Admin, Painter, Customer, Engineer
  - Session-aware: logged-in users see 'Go to [portal]' on their card
  - Green-to-gold top accent bar, QC design tokens preserved
  - Leaflet and all marketing sections removed

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
  ```

---

### Task 2: Deploy to production

**Files:**
- No file changes — deploy only

- [ ] **Step 1: Push to GitHub**

  ```bash
  git push origin master
  ```

- [ ] **Step 2: SSH deploy**

  ```bash
  ssh hetzner "cd /www/wwwroot/act.qcpaintshop.com && git pull origin master && pm2 restart business-manager"
  ```

  **Expected output:** PM2 shows `business-manager` restarted with status `online`.

- [ ] **Step 3: Verify on production**

  Open `https://act.qcpaintshop.com` in a browser.

  **Check:**
  - [ ] Portal splash screen loads (not the old marketing page)
  - [ ] All 4 portal cards visible
  - [ ] Clicking "Staff & Admin" navigates to `/login.html`
  - [ ] Clicking "Painter Portal" navigates to `/painter-login.html`
  - [ ] Clicking "Customer Portal" navigates to `/customer-login.html`
  - [ ] Clicking "Engineer Portal" navigates to `/engineer-login.html`

---

## Self-Review

**Spec coverage:**
- ✅ All 4 portals shown (Staff, Painter, Customer, Engineer) — Task 1 Step 2
- ✅ Minimal page — no marketing sections — Task 1 Step 2
- ✅ Session-aware logic — Task 1 Step 2 (JS block) + verified in Step 5
- ✅ Mobile responsive — Task 1 Step 4
- ✅ QC design tokens preserved — Task 1 Step 2 (`:root` block)
- ✅ Deployed to production — Task 2

**Placeholder scan:** No TBDs, no TODOs, no vague steps. All code is complete.

**Type consistency:** Single file, no cross-task type dependencies. JS `sessions` array and card IDs (`cardStaff`, `cardPainter`, `cardCustomer`, `cardEngineer`) are consistent between the HTML markup and the script block.
