# Public Landing Page Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the JSON stub at `GET /` and the AI-generated landing page at `public/index.html` with one international-standard, designer-feeling public landing page that matches the locked spec at `docs/superpowers/specs/2026-05-12-public-landing-redesign-design.md`.

**Architecture:** Single static HTML file (`public/index.html`) served by Express's existing `express.static('public')` middleware (already mounted at `server.js:214`). All CSS inline in one `<style>` block — no Tailwind dependency, no build step, no JS framework. Vanilla JS only for nav-on-scroll, scroll-reveal IntersectionObserver, and Leaflet map init. JSON API status moves from `GET /` to `GET /api/status`.

**Tech Stack:** Vanilla HTML/CSS/JS · Google Fonts (Playfair Display, Inter, Noto Serif Tamil) · Leaflet 1.9 (via CDN, for branches map only).

**Files touched:**
- Modify: `server.js` (~line 3671 — relocate JSON handler)
- Replace: `public/index.html` (full rewrite)
- Create: `public/images/landing/hero-room.jpg` (downloaded stock photo)

---

## Task 1: Move JSON status from `/` to `/api/status`

**Files:**
- Modify: `server.js:3671-3701`

- [ ] **Step 1: Open `server.js` and locate the `app.get('/')` handler (~line 3671).**

- [ ] **Step 2: Replace the handler. Use this exact Edit:**

`old_string`:
```js
app.get('/', (req, res) => {
    res.json({
        service: 'Quality Colours Business Manager API',
        version: '2.0.0',
        modules: [
            'auth', 'roles', 'permissions', 'branches', 'users',
            'customers', 'leads', 'products', 'estimates',
            'attendance', 'salary', 'activities', 'tasks', 'settings',
            'zoho-books'
        ],
        endpoints: {
            auth: '/api/auth/*',
            brands: '/api/brands',
            categories: '/api/categories',
            products: '/api/products',
            customers: '/api/customers',
            estimates: '/api/estimates',
            roles: '/api/roles',
            branches: '/api/branches',
            leads: '/api/leads',
            attendance: '/api/attendance',
            salary: '/api/salary',
            activities: '/api/activities',
            tasks: '/api/tasks',
            settings: '/api/settings',
            dashboard: '/api/dashboard/stats',
            zoho: '/api/zoho/*',
            health: '/health'
        }
    });
});
```

`new_string`:
```js
// API status (moved off `/` so Express static can serve public/index.html as the public landing page)
app.get('/api/status', (req, res) => {
    res.json({
        service: 'Quality Colours Business Manager API',
        version: '2.0.0',
        modules: [
            'auth', 'roles', 'permissions', 'branches', 'users',
            'customers', 'leads', 'products', 'estimates',
            'attendance', 'salary', 'activities', 'tasks', 'settings',
            'zoho-books'
        ],
        endpoints: {
            auth: '/api/auth/*',
            brands: '/api/brands',
            categories: '/api/categories',
            products: '/api/products',
            customers: '/api/customers',
            estimates: '/api/estimates',
            roles: '/api/roles',
            branches: '/api/branches',
            leads: '/api/leads',
            attendance: '/api/attendance',
            salary: '/api/salary',
            activities: '/api/activities',
            tasks: '/api/tasks',
            settings: '/api/settings',
            dashboard: '/api/dashboard/stats',
            zoho: '/api/zoho/*',
            health: '/health'
        }
    });
});
```

- [ ] **Step 3: Restart the server.**

```bash
# In a separate terminal that's running the dev server, hit Ctrl+C then:
node server.js
# Or if pm2 is in use:
pm2 restart business-manager
```

- [ ] **Step 4: Verify the route change.**

```bash
curl -s http://localhost:3000/api/status | head -3
# Expected: JSON starting with {"service":"Quality Colours Business Manager API"

curl -sI http://localhost:3000/ | head -2
# Expected: HTTP/1.1 200 OK and Content-Type: text/html (Express static serving the existing public/index.html)
```

- [ ] **Step 5: Verify nothing in the codebase relied on `GET /` returning JSON.**

Run from project root:
```bash
grep -rn "act\.qcpaintshop\.com/'" routes services public/js 2>/dev/null || true
grep -rn "fetch(['\"]/['\"]" routes services public/js 2>/dev/null || true
```
Expected: no results. (If any internal code did `fetch('/')` expecting JSON, update it to `fetch('/api/status')`.)

---

## Task 2: Lay down the new `public/index.html` — full document scaffold + complete CSS

**Files:**
- Replace: `public/index.html`

This is the biggest single task. Once this lands, every subsequent task only inserts HTML *inside* an existing `<section>` — no CSS edits needed beyond this task.

- [ ] **Step 1: Overwrite `public/index.html` with the following exact content.**

(Use the Write tool — the existing file is in git history if rollback is needed.)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#1B5E3B">
  <meta name="description" content="Quality Colours — Authorised paint dealer with five branches across Ramanathapuram district. Free site visit, expert finish, fair pricing.">
  <title>Quality Colours · Ramanathapuram · Paint, properly done.</title>

  <link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192x192.png">
  <link rel="apple-touch-icon" href="/icons/icon-192x192.png">
  <link rel="manifest" href="/manifest.json">

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Inter:wght@300;400;500;600&family=Noto+Serif+Tamil:wght@400;500&display=swap" rel="stylesheet">

  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="">

  <style>
    /* ───────────────────────── Design tokens ───────────────────────── */
    :root {
      --qc-cream: #FBFAF7;
      --qc-green: #1B5E3B;
      --qc-green-dark: #154D31;
      --qc-gold: #D4A24E;
      --qc-ink: #1A1A1A;
      --qc-muted: #666666;
      --qc-rule: #E5E5E5;
      --qc-rule-soft: rgba(26,26,26,0.08);
      --qc-photo-tint: linear-gradient(180deg, rgba(20,15,8,0.35) 0%, rgba(20,15,8,0.15) 40%, rgba(20,15,8,0.7) 100%);

      --serif: 'Playfair Display', Georgia, serif;
      --sans: 'Inter', system-ui, -apple-system, sans-serif;
      --tamil: 'Noto Serif Tamil', 'Noto Sans Tamil', serif;

      --pad-x: clamp(20px, 5vw, 56px);
      --pad-y: clamp(72px, 12vw, 120px);
    }

    /* ───────────────────────── Reset ───────────────────────── */
    *, *::before, *::after { box-sizing: border-box; }
    html { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; scroll-behavior: smooth; }
    body { margin: 0; font-family: var(--sans); color: var(--qc-ink); background: var(--qc-cream); font-size: 16px; line-height: 1.55; font-weight: 400; }
    a { color: inherit; text-decoration: none; }
    img { max-width: 100%; display: block; }
    button { font: inherit; cursor: pointer; border: 0; background: transparent; color: inherit; }

    /* ───────────────────────── Utilities ───────────────────────── */
    .qc-wrap { max-width: 1240px; margin: 0 auto; padding-left: var(--pad-x); padding-right: var(--pad-x); }
    .qc-eyebrow { font-family: var(--sans); font-size: 11px; font-weight: 600; letter-spacing: 2.5px; text-transform: uppercase; color: var(--qc-green); display: inline-flex; align-items: center; gap: 10px; }
    .qc-eyebrow .dot { width: 6px; height: 6px; background: var(--qc-gold); border-radius: 50%; display: inline-block; }
    .qc-section-head { font-family: var(--serif); font-weight: 500; font-size: clamp(36px, 5vw, 56px); line-height: 1.05; letter-spacing: -1.2px; color: var(--qc-ink); margin: 16px 0 12px; }
    .qc-section-head em { font-style: italic; color: var(--qc-green); font-weight: 500; }
    .qc-rule { height: 1px; background: var(--qc-rule-soft); border: 0; margin: 0; }
    .qc-tamil { font-family: var(--tamil); }
    .qc-reveal { opacity: 0; transform: translateY(20px); transition: opacity 0.6s ease-out, transform 0.6s ease-out; }
    .qc-reveal.is-visible { opacity: 1; transform: translateY(0); }
    @media (prefers-reduced-motion: reduce) { .qc-reveal { opacity: 1; transform: none; transition: none; } html { scroll-behavior: auto; } }

    /* ───────────────────────── Nav ───────────────────────── */
    .qc-nav { position: fixed; top: 0; left: 0; right: 0; z-index: 50; transition: background 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease; }
    .qc-nav-inner { display: flex; align-items: center; justify-content: space-between; padding: 18px var(--pad-x); max-width: 1240px; margin: 0 auto; gap: 24px; }
    .qc-nav-logo { font-family: var(--serif); font-weight: 500; font-size: 22px; letter-spacing: -0.3px; color: #fff; line-height: 1; transition: color 0.3s; }
    .qc-nav-logo small { font-family: var(--sans); display: block; font-size: 9px; letter-spacing: 2.2px; opacity: 0.8; font-weight: 500; margin-top: 4px; text-transform: uppercase; }
    .qc-nav-links { display: flex; gap: 32px; }
    .qc-nav-links a { font-size: 13px; font-weight: 500; color: #fff; transition: color 0.3s, opacity 0.2s; opacity: 0.92; }
    .qc-nav-links a:hover { opacity: 1; }
    .qc-nav-cta { font-size: 11px; letter-spacing: 1.5px; font-weight: 600; text-transform: uppercase; padding: 11px 18px; background: var(--qc-cream); color: var(--qc-ink); transition: background 0.2s; }
    .qc-nav-cta:hover { background: #fff; }
    .qc-nav.is-solid { background: var(--qc-cream); border-bottom: 1px solid var(--qc-rule); }
    .qc-nav.is-solid .qc-nav-logo,
    .qc-nav.is-solid .qc-nav-links a { color: var(--qc-ink); }
    .qc-nav.is-solid .qc-nav-cta { background: var(--qc-green); color: #fff; }
    .qc-nav.is-solid .qc-nav-cta:hover { background: var(--qc-green-dark); }
    .qc-nav-mobile-btn { display: none; color: #fff; padding: 8px; }
    .qc-nav.is-solid .qc-nav-mobile-btn { color: var(--qc-ink); }
    .qc-nav-mobile { display: none; padding: 16px var(--pad-x) 20px; background: var(--qc-cream); border-top: 1px solid var(--qc-rule); }
    .qc-nav-mobile.is-open { display: block; }
    .qc-nav-mobile a { display: block; padding: 10px 0; font-size: 15px; font-weight: 500; color: var(--qc-ink); }
    .qc-nav-mobile .qc-nav-cta { display: block; text-align: center; margin-top: 12px; background: var(--qc-green); color: #fff; padding: 14px; }
    @media (max-width: 860px) {
      .qc-nav-links { display: none; }
      .qc-nav-cta { display: none; }
      .qc-nav-mobile-btn { display: inline-flex; }
      .qc-nav.is-solid + .qc-nav-mobile { background: var(--qc-cream); }
    }

    /* ───────────────────────── Hero (V2 Cinematic Full-Bleed) ───────────────────────── */
    .qc-hero { position: relative; min-height: 88vh; background-color: #1a1a1a; background-image: var(--qc-photo-tint), url('/images/landing/hero-room.jpg'); background-size: cover; background-position: center; color: #fff; display: flex; flex-direction: column; justify-content: flex-end; padding: 120px var(--pad-x) 56px; }
    .qc-hero-inner { max-width: 720px; }
    .qc-hero .qc-eyebrow { color: #fff; }
    .qc-hero h1 { font-family: var(--serif); font-weight: 400; font-size: clamp(42px, 7vw, 78px); line-height: 1.02; letter-spacing: -2px; color: #fff; margin: 18px 0 14px; }
    .qc-hero h1 em { font-style: italic; color: var(--qc-gold); font-weight: 400; }
    .qc-hero-tamil { font-family: var(--tamil); font-weight: 400; font-size: clamp(17px, 2vw, 22px); line-height: 1.3; color: rgba(255,255,255,0.85); margin: 0 0 28px; max-width: 540px; }
    .qc-hero-sub { font-family: var(--sans); font-weight: 300; font-size: 15px; line-height: 1.6; color: rgba(255,255,255,0.9); max-width: 460px; margin: 0 0 36px; }
    .qc-hero-ctas { display: flex; flex-wrap: wrap; gap: 18px; align-items: center; }
    .qc-cta-primary { display: inline-flex; align-items: center; gap: 14px; padding: 16px 26px; background: var(--qc-cream); color: var(--qc-ink); font-size: 13px; font-weight: 600; letter-spacing: 0.4px; transition: background 0.2s, transform 0.2s; }
    .qc-cta-primary:hover { background: #fff; transform: translateY(-1px); }
    .qc-cta-primary .ta { font-family: var(--tamil); font-size: 12px; font-weight: 400; color: var(--qc-muted); border-left: 1px solid var(--qc-rule); padding-left: 14px; }
    .qc-cta-ghost { font-family: var(--sans); font-size: 13px; font-weight: 500; color: #fff; border-bottom: 1px solid rgba(255,255,255,0.6); padding-bottom: 3px; transition: border-color 0.2s; }
    .qc-cta-ghost:hover { border-color: #fff; }
    .qc-hero-foot { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 56px; font-family: var(--sans); font-size: 11px; letter-spacing: 1.8px; text-transform: uppercase; color: rgba(255,255,255,0.75); max-width: 1240px; }
    .qc-hero-foot .right { font-family: var(--serif); font-style: italic; font-size: 14px; letter-spacing: 0; text-transform: none; color: var(--qc-gold); }

    /* ───────────────────────── Brand strip ───────────────────────── */
    .qc-brands { padding: clamp(48px, 7vw, 72px) 0; background: var(--qc-cream); border-bottom: 1px solid var(--qc-rule-soft); border-top: 1px solid var(--qc-rule-soft); }
    .qc-brands-eyebrow { text-align: center; display: block; margin-bottom: 28px; color: var(--qc-muted); }
    .qc-brands-row { display: flex; flex-wrap: wrap; justify-content: space-around; align-items: center; gap: 28px 48px; }
    .qc-brand-mark { font-family: var(--serif); font-weight: 500; font-style: italic; font-size: 22px; color: var(--qc-ink); opacity: 0.55; letter-spacing: -0.3px; transition: opacity 0.2s; }
    .qc-brand-mark:hover { opacity: 1; }

    /* ───────────────────────── About + Stats ───────────────────────── */
    .qc-about { padding: var(--pad-y) 0; background: var(--qc-cream); }
    .qc-about-grid { display: grid; grid-template-columns: 1.4fr 1fr; gap: clamp(40px, 6vw, 96px); align-items: start; }
    @media (max-width: 860px) { .qc-about-grid { grid-template-columns: 1fr; } }
    .qc-about-prose p { font-family: var(--sans); font-size: 16px; line-height: 1.7; color: var(--qc-ink); margin: 0 0 18px; max-width: 580px; }
    .qc-stats { display: flex; flex-direction: column; gap: 36px; }
    .qc-stat { border-top: 1px solid var(--qc-rule-soft); padding-top: 18px; }
    .qc-stat:first-child { border-top: 0; padding-top: 0; }
    .qc-stat-num { font-family: var(--serif); font-style: italic; font-weight: 500; font-size: clamp(48px, 6vw, 72px); line-height: 1; color: var(--qc-green); letter-spacing: -2px; }
    .qc-stat-label { font-family: var(--sans); font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: var(--qc-muted); margin-top: 8px; }

    /* ───────────────────────── Services ───────────────────────── */
    .qc-services { padding: var(--pad-y) 0; background: var(--qc-cream); border-top: 1px solid var(--qc-rule-soft); }
    .qc-services-list { margin-top: 48px; }
    .qc-service-row { display: grid; grid-template-columns: 60px 1.5fr 1fr auto; gap: 24px; align-items: baseline; padding: 28px 0; border-top: 1px solid var(--qc-rule-soft); }
    .qc-service-row:last-child { border-bottom: 1px solid var(--qc-rule-soft); }
    .qc-service-num { font-family: var(--sans); font-size: 12px; font-weight: 600; letter-spacing: 2px; color: var(--qc-gold); }
    .qc-service-title { font-family: var(--serif); font-size: clamp(20px, 2.4vw, 26px); font-weight: 500; color: var(--qc-ink); }
    .qc-service-desc { font-family: var(--sans); font-size: 14px; color: var(--qc-muted); line-height: 1.55; }
    .qc-service-link { font-family: var(--sans); font-size: 12px; font-weight: 500; color: var(--qc-green); border-bottom: 1px solid var(--qc-green); padding-bottom: 2px; white-space: nowrap; }
    @media (max-width: 720px) {
      .qc-service-row { grid-template-columns: 44px 1fr; row-gap: 8px; }
      .qc-service-desc { grid-column: 2; }
      .qc-service-link { grid-column: 2; justify-self: start; }
    }

    /* ───────────────────────── Branches ───────────────────────── */
    .qc-branches { padding: var(--pad-y) 0; background: var(--qc-cream); border-top: 1px solid var(--qc-rule-soft); }
    .qc-branches-head { max-width: 720px; margin-bottom: 40px; }
    .qc-map { height: 360px; width: 100%; border-radius: 4px; overflow: hidden; border: 1px solid var(--qc-rule-soft); margin-bottom: 40px; }
    @media (max-width: 720px) { .qc-map { height: 240px; } }
    .qc-branch-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px; }
    @media (max-width: 980px) { .qc-branch-grid { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 600px) { .qc-branch-grid { grid-template-columns: 1fr; } }
    .qc-branch-card { padding: 28px 0 0; border-top: 1px solid var(--qc-rule-soft); }
    .qc-branch-name { font-family: var(--serif); font-weight: 500; font-size: 22px; color: var(--qc-ink); margin: 0 0 10px; }
    .qc-branch-addr { font-family: var(--sans); font-size: 14px; color: var(--qc-ink); line-height: 1.55; margin: 0 0 4px; }
    .qc-branch-addr-ta { font-family: var(--tamil); font-size: 13px; color: var(--qc-muted); line-height: 1.5; margin: 0 0 14px; }
    .qc-branch-phone { font-family: var(--sans); font-size: 14px; color: var(--qc-ink); margin: 0 0 6px; }
    .qc-branch-phone::before { content: '☎ '; color: var(--qc-gold); margin-right: 4px; }
    .qc-branch-hours { font-family: var(--sans); font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--qc-muted); margin: 0 0 14px; }
    .qc-branch-dirs { font-family: var(--sans); font-size: 12px; font-weight: 500; color: var(--qc-green); border-bottom: 1px solid var(--qc-green); padding-bottom: 2px; }

    /* ───────────────────────── Gallery ───────────────────────── */
    .qc-gallery { padding: var(--pad-y) 0; background: var(--qc-cream); border-top: 1px solid var(--qc-rule-soft); }
    .qc-gallery-head { display: flex; justify-content: space-between; align-items: end; margin-bottom: 40px; flex-wrap: wrap; gap: 16px; }
    .qc-gallery-grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 16px; }
    .qc-gallery-item { position: relative; overflow: hidden; border-radius: 4px; aspect-ratio: 4/3; }
    .qc-gallery-item img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.5s ease; opacity: 0.96; }
    .qc-gallery-item:hover img { transform: scale(1.04); opacity: 1; }
    .qc-gallery-item .qc-gal-caption { position: absolute; left: 14px; bottom: 12px; font-family: var(--sans); font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase; color: #fff; background: rgba(0,0,0,0.45); padding: 5px 10px; backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
    .qc-gal-1 { grid-column: span 7; grid-row: span 2; aspect-ratio: 7/6; }
    .qc-gal-2 { grid-column: span 5; }
    .qc-gal-3 { grid-column: span 5; }
    .qc-gal-4 { grid-column: span 4; }
    .qc-gal-5 { grid-column: span 4; }
    .qc-gal-6 { grid-column: span 4; }
    @media (max-width: 860px) {
      .qc-gallery-grid { grid-template-columns: repeat(6, 1fr); }
      .qc-gal-1 { grid-column: span 6; grid-row: span 1; aspect-ratio: 4/3; }
      .qc-gal-2, .qc-gal-3 { grid-column: span 3; }
      .qc-gal-4, .qc-gal-5, .qc-gal-6 { grid-column: span 2; }
    }

    /* ───────────────────────── Design Request ───────────────────────── */
    .qc-design { padding: var(--pad-y) 0; background: var(--qc-ink); color: var(--qc-cream); }
    .qc-design-inner { max-width: 560px; margin: 0 auto; }
    .qc-design .qc-eyebrow { color: var(--qc-gold); }
    .qc-design h2 { font-family: var(--serif); font-style: italic; font-weight: 400; font-size: clamp(32px, 4.5vw, 48px); line-height: 1.08; letter-spacing: -1px; color: var(--qc-cream); margin: 14px 0 14px; }
    .qc-design p.lead { font-family: var(--sans); font-size: 15px; line-height: 1.6; color: rgba(251,250,247,0.78); margin: 0 0 36px; }
    .qc-form { display: flex; flex-direction: column; gap: 20px; }
    .qc-drop { background: rgba(251,250,247,0.04); border: 1px dashed rgba(251,250,247,0.3); padding: 56px 24px; text-align: center; cursor: pointer; transition: background 0.2s, border-color 0.2s; }
    .qc-drop.is-drag { background: rgba(212,162,78,0.08); border-color: var(--qc-gold); border-style: solid; }
    .qc-drop-label { font-family: var(--sans); font-size: 12px; font-weight: 500; letter-spacing: 2px; text-transform: uppercase; color: rgba(251,250,247,0.78); }
    .qc-drop-label::before { content: '📎 '; }
    .qc-drop-hint { font-family: var(--sans); font-size: 11px; color: rgba(251,250,247,0.5); margin-top: 8px; letter-spacing: 0.5px; }
    .qc-input { background: transparent; color: var(--qc-cream); border: 0; border-bottom: 1px solid rgba(251,250,247,0.25); padding: 12px 0; font-family: var(--sans); font-size: 15px; outline: none; transition: border-color 0.2s; width: 100%; }
    .qc-input:focus { border-bottom-color: var(--qc-gold); }
    .qc-input::placeholder { color: rgba(251,250,247,0.4); }
    .qc-textarea { min-height: 88px; resize: vertical; line-height: 1.5; }
    .qc-design-submit { margin-top: 8px; display: inline-flex; align-items: center; gap: 14px; padding: 16px 26px; background: var(--qc-cream); color: var(--qc-ink); font-family: var(--sans); font-size: 13px; font-weight: 600; letter-spacing: 0.4px; align-self: flex-start; transition: background 0.2s; }
    .qc-design-submit:hover { background: #fff; }
    .qc-design-submit .ta { font-family: var(--tamil); font-size: 12px; font-weight: 400; color: var(--qc-muted); border-left: 1px solid var(--qc-rule); padding-left: 14px; }

    /* ───────────────────────── Footer ───────────────────────── */
    .qc-foot { background: var(--qc-ink); color: var(--qc-cream); padding: 72px 0 32px; border-top: 1px solid rgba(212,162,78,0.18); }
    .qc-foot-grid { display: grid; grid-template-columns: 1.4fr 1fr 1fr 1fr; gap: 40px; }
    @media (max-width: 860px) { .qc-foot-grid { grid-template-columns: 1fr 1fr; } }
    @media (max-width: 540px) { .qc-foot-grid { grid-template-columns: 1fr; } }
    .qc-foot h4 { font-family: var(--sans); font-size: 11px; font-weight: 600; letter-spacing: 2px; text-transform: uppercase; color: rgba(251,250,247,0.5); margin: 0 0 18px; }
    .qc-foot a, .qc-foot p { font-family: var(--sans); font-size: 14px; color: rgba(251,250,247,0.85); line-height: 1.8; margin: 0; display: block; transition: color 0.2s; }
    .qc-foot a:hover { color: var(--qc-gold); }
    .qc-foot-brand { font-family: var(--serif); font-weight: 500; font-size: 26px; color: var(--qc-cream); }
    .qc-foot-tagline { font-family: var(--tamil); font-style: italic; font-size: 15px; color: var(--qc-gold); margin-top: 12px !important; line-height: 1.5; }
    .qc-foot-rule { height: 1px; background: rgba(212,162,78,0.18); margin: 56px 0 24px; border: 0; }
    .qc-foot-bottom { display: flex; justify-content: space-between; align-items: center; font-family: var(--sans); font-size: 12px; color: rgba(251,250,247,0.6); flex-wrap: wrap; gap: 12px; }
    .qc-foot-social { display: flex; gap: 18px; }
    .qc-foot-social a { color: rgba(251,250,247,0.7); transition: color 0.2s; }
    .qc-foot-social a:hover { color: var(--qc-gold); }
    .qc-foot-portal { font-size: 11px !important; letter-spacing: 1.5px; text-transform: uppercase; color: var(--qc-gold) !important; }
  </style>
</head>
<body>

  <!-- 1. NAV -->
  <nav class="qc-nav" id="qcNav" aria-label="Main">
    <div class="qc-nav-inner">
      <a href="#" class="qc-nav-logo">Quality Colours.<small>Ramanathapuram · Est 2018</small></a>
      <div class="qc-nav-links">
        <a href="#about">About</a>
        <a href="#services">Services</a>
        <a href="#branches">Branches</a>
        <a href="#gallery">Gallery</a>
        <a href="#brands">Brands</a>
      </div>
      <a href="#design-request" class="qc-nav-cta">Get a Quote</a>
      <button class="qc-nav-mobile-btn" id="qcNavMobileBtn" aria-label="Toggle menu" aria-expanded="false">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
      </button>
    </div>
    <div class="qc-nav-mobile" id="qcNavMobile">
      <a href="#about">About</a>
      <a href="#services">Services</a>
      <a href="#branches">Branches</a>
      <a href="#gallery">Gallery</a>
      <a href="#brands">Brands</a>
      <a href="#design-request" class="qc-nav-cta">Get a Quote</a>
    </div>
  </nav>

  <!-- 2. HERO -->
  <section class="qc-hero" id="hero"></section>

  <!-- 3. BRAND STRIP -->
  <section class="qc-brands" id="brands"></section>

  <!-- 4. ABOUT + STATS -->
  <section class="qc-about" id="about"></section>

  <!-- 5. SERVICES -->
  <section class="qc-services" id="services"></section>

  <!-- 6. BRANCHES -->
  <section class="qc-branches" id="branches"></section>

  <!-- 7. GALLERY -->
  <section class="qc-gallery" id="gallery"></section>

  <!-- 8. DESIGN REQUEST -->
  <section class="qc-design" id="design-request"></section>

  <!-- 9. FOOTER -->
  <footer class="qc-foot"></footer>

  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin="" defer></script>
  <script>
    // === Mobile nav toggle ===
    (function () {
      var btn = document.getElementById('qcNavMobileBtn');
      var sheet = document.getElementById('qcNavMobile');
      if (!btn || !sheet) return;
      btn.addEventListener('click', function () {
        var open = sheet.classList.toggle('is-open');
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      sheet.querySelectorAll('a').forEach(function (a) {
        a.addEventListener('click', function () {
          sheet.classList.remove('is-open');
          btn.setAttribute('aria-expanded', 'false');
        });
      });
    })();

    // === Scroll-aware nav ===
    (function () {
      var nav = document.getElementById('qcNav');
      if (!nav) return;
      function update() {
        if (window.scrollY > 80) nav.classList.add('is-solid');
        else nav.classList.remove('is-solid');
      }
      update();
      window.addEventListener('scroll', update, { passive: true });
    })();

    // === Scroll reveal ===
    (function () {
      if (!('IntersectionObserver' in window)) {
        document.querySelectorAll('.qc-reveal').forEach(function (el) { el.classList.add('is-visible'); });
        return;
      }
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { e.target.classList.add('is-visible'); io.unobserve(e.target); }
        });
      }, { threshold: 0.1, rootMargin: '0px 0px -60px 0px' });
      document.querySelectorAll('.qc-reveal').forEach(function (el) { io.observe(el); });
    })();
  </script>
</body>
</html>
```

- [ ] **Step 2: Open `http://localhost:3000/` in a browser and confirm:**
  - No console errors.
  - Page loads, all 7 section containers exist (empty for now), fonts load.
  - The nav appears, transparent at the top, but logo will be invisible against the empty cream background — that's expected until the hero gets a photo.

- [ ] **Step 3: No commit yet — we'll commit after the page is fully filled in.**

---

## Task 3: Fill in Hero section content

**Files:**
- Modify: `public/index.html` (inside `<section class="qc-hero" id="hero">`)

- [ ] **Step 1: Edit `public/index.html`. Replace the empty `<section class="qc-hero" id="hero"></section>` with:**

```html
  <section class="qc-hero" id="hero">
    <div class="qc-hero-inner qc-reveal">
      <div class="qc-eyebrow"><span class="dot"></span>Authorised dealer · Asian · Berger · Birla · Nippon</div>
      <h1>A finished room <em>says everything.</em></h1>
      <p class="qc-hero-tamil">முடிக்கப்பட்ட அறை எல்லாமே சொல்லும்.</p>
      <p class="qc-hero-sub">Five branches across Ramanathapuram. Trusted paint, expert finish, fair pricing. Free site visit and quote within 24 hours.</p>
      <div class="qc-hero-ctas">
        <a href="#design-request" class="qc-cta-primary">Request a free quote <span class="ta">இலவச மதிப்பீடு</span></a>
        <a href="#gallery" class="qc-cta-ghost">Browse recent work →</a>
      </div>
    </div>
    <div class="qc-hero-foot qc-wrap" style="padding-left:0;padding-right:0;">
      <span>Scroll ↓</span>
      <span class="right">— painted 2,400+ homes since 2018.</span>
    </div>
  </section>
```

- [ ] **Step 2: Verify in browser.** The hero will show with a dark fallback background (`#1a1a1a`) until the photo is downloaded in Task 11. Text should be legible white-on-dark.

---

## Task 4: Fill in Brand strip

**Files:**
- Modify: `public/index.html` (inside `<section class="qc-brands" id="brands">`)

- [ ] **Step 1: Replace the empty `<section class="qc-brands" id="brands">` with:**

```html
  <section class="qc-brands" id="brands">
    <div class="qc-wrap qc-reveal">
      <span class="qc-eyebrow qc-brands-eyebrow">Authorised dealer of <span class="qc-tamil" style="font-weight:400;letter-spacing:0;text-transform:none;font-size:13px;margin-left:6px;opacity:0.7;">அங்கீகரிக்கப்பட்ட விற்பனையாளர்</span></span>
      <div class="qc-brands-row">
        <span class="qc-brand-mark">Asian Paints</span>
        <span class="qc-brand-mark">Berger</span>
        <span class="qc-brand-mark">Birla Opus</span>
        <span class="qc-brand-mark">Nippon</span>
        <span class="qc-brand-mark">Jotun</span>
        <span class="qc-brand-mark">JSW Paints</span>
      </div>
    </div>
  </section>
```

- [ ] **Step 2: Verify in browser.** A thin cream strip below the hero with 6 italic Playfair brand names, low opacity, hairline rules above and below.

---

## Task 5: Fill in About + Stats

**Files:**
- Modify: `public/index.html` (inside `<section class="qc-about" id="about">`)

- [ ] **Step 1: Replace the empty `<section class="qc-about" id="about">` with:**

```html
  <section class="qc-about" id="about">
    <div class="qc-wrap qc-reveal">
      <div class="qc-about-grid">
        <div class="qc-about-prose">
          <div class="qc-eyebrow"><span class="dot"></span>Our story</div>
          <h2 class="qc-section-head">Started by two brothers in 2018.<br/><em>Same standard, every branch.</em></h2>
          <p>Quality Colours began with one shop in Ramanathapuram town. Seven years on, we run five branches across the district — and the people who finish your walls are still the people we trained ourselves.</p>
          <p>We're an authorised dealer for every major Indian paint brand, but we don't sell paint by itself. We pair the right product with the right finish, send an estimator to your site, and stand behind the work. Free quotes, honest pricing, and a phone number that picks up on the second ring.</p>
        </div>
        <div class="qc-stats">
          <div class="qc-stat">
            <div class="qc-stat-num">2,400+</div>
            <div class="qc-stat-label">Homes painted</div>
          </div>
          <div class="qc-stat">
            <div class="qc-stat-num">5</div>
            <div class="qc-stat-label">Branches in the district</div>
          </div>
          <div class="qc-stat">
            <div class="qc-stat-num">7+</div>
            <div class="qc-stat-label">Years in business</div>
          </div>
        </div>
      </div>
    </div>
  </section>
```

- [ ] **Step 2: Verify in browser.** Two-column editorial layout, large italic green numerals on the right, paragraph prose on the left.

---

## Task 6: Fill in Services

**Files:**
- Modify: `public/index.html` (inside `<section class="qc-services" id="services">`)

- [ ] **Step 1: Replace the empty `<section class="qc-services" id="services">` with:**

```html
  <section class="qc-services" id="services">
    <div class="qc-wrap qc-reveal">
      <div class="qc-eyebrow"><span class="dot"></span>What we do</div>
      <h2 class="qc-section-head">Four things, <em>done properly.</em></h2>
      <div class="qc-services-list">
        <div class="qc-service-row">
          <div class="qc-service-num">01</div>
          <div class="qc-service-title">Interior Painting</div>
          <div class="qc-service-desc">Living rooms, bedrooms, kitchens. Surface prep, primer, two-coat finish in your choice of emulsion.</div>
          <a href="#design-request" class="qc-service-link">Get a quote →</a>
        </div>
        <div class="qc-service-row">
          <div class="qc-service-num">02</div>
          <div class="qc-service-title">Exterior &amp; Waterproofing</div>
          <div class="qc-service-desc">Weatherproof finishes that survive monsoon and summer. Crack-fill, waterproof coats, and exterior emulsion.</div>
          <a href="#design-request" class="qc-service-link">Get a quote →</a>
        </div>
        <div class="qc-service-row">
          <div class="qc-service-num">03</div>
          <div class="qc-service-title">Texture &amp; Designer Finishes</div>
          <div class="qc-service-desc">Royale Play, metallic, stucco, designer accent walls. We show you samples on-site before we start.</div>
          <a href="#design-request" class="qc-service-link">Get a quote →</a>
        </div>
        <div class="qc-service-row">
          <div class="qc-service-num">04</div>
          <div class="qc-service-title">Colour Consultation &amp; Visualisation</div>
          <div class="qc-service-desc">Send us a photo of your wall and we'll suggest colour pairings, finishes, and an itemised estimate. No obligation.</div>
          <a href="#design-request" class="qc-service-link">Get a quote →</a>
        </div>
      </div>
    </div>
  </section>
```

- [ ] **Step 2: Verify in browser.** Four numbered editorial rows, hairline dividers between, gold "01–04" markers.

---

## Task 7: Fill in Branches (HTML + Leaflet map init)

**Files:**
- Modify: `public/index.html` (inside `<section class="qc-branches" id="branches">` and append to the existing `<script>`)

- [ ] **Step 1: Replace the empty `<section class="qc-branches" id="branches">` with:**

```html
  <section class="qc-branches" id="branches">
    <div class="qc-wrap qc-reveal">
      <div class="qc-branches-head">
        <div class="qc-eyebrow"><span class="dot"></span>Where we are</div>
        <h2 class="qc-section-head">Five branches <em>across the district.</em></h2>
      </div>
      <div id="qcBranchMap" class="qc-map" role="img" aria-label="Map of Quality Colours branches in Ramanathapuram district"></div>
      <div class="qc-branch-grid">
        <div class="qc-branch-card">
          <h3 class="qc-branch-name">Ramanathapuram</h3>
          <p class="qc-branch-addr">Main Road, Ramanathapuram</p>
          <p class="qc-branch-addr-ta">முதன்மை சாலை, இராமநாதபுரம்</p>
          <p class="qc-branch-phone">+91 74188 31122</p>
          <p class="qc-branch-hours">Mon–Sat · 9:00 – 20:00</p>
          <a class="qc-branch-dirs" href="https://maps.google.com/?q=Ramanathapuram" target="_blank" rel="noopener">Get directions →</a>
        </div>
        <div class="qc-branch-card">
          <h3 class="qc-branch-name">Paramakudi</h3>
          <p class="qc-branch-addr">Bus Stand Road, Paramakudi</p>
          <p class="qc-branch-addr-ta">பேருந்து நிலையம் சாலை, பரமக்குடி</p>
          <p class="qc-branch-phone">+91 74188 31122</p>
          <p class="qc-branch-hours">Mon–Sat · 9:00 – 20:00</p>
          <a class="qc-branch-dirs" href="https://maps.google.com/?q=Paramakudi" target="_blank" rel="noopener">Get directions →</a>
        </div>
        <div class="qc-branch-card">
          <h3 class="qc-branch-name">Mudukulathur</h3>
          <p class="qc-branch-addr">Main Bazaar, Mudukulathur</p>
          <p class="qc-branch-addr-ta">முதன்மை சந்தை, முதுகுளத்தூர்</p>
          <p class="qc-branch-phone">+91 74188 31122</p>
          <p class="qc-branch-hours">Mon–Sat · 9:00 – 20:00</p>
          <a class="qc-branch-dirs" href="https://maps.google.com/?q=Mudukulathur" target="_blank" rel="noopener">Get directions →</a>
        </div>
        <div class="qc-branch-card">
          <h3 class="qc-branch-name">Kamuthi</h3>
          <p class="qc-branch-addr">Main Road, Kamuthi</p>
          <p class="qc-branch-addr-ta">முதன்மை சாலை, காமுதி</p>
          <p class="qc-branch-phone">+91 74188 31122</p>
          <p class="qc-branch-hours">Mon–Sat · 9:00 – 20:00</p>
          <a class="qc-branch-dirs" href="https://maps.google.com/?q=Kamuthi" target="_blank" rel="noopener">Get directions →</a>
        </div>
        <div class="qc-branch-card">
          <h3 class="qc-branch-name">Rameswaram</h3>
          <p class="qc-branch-addr">Temple Road, Rameswaram</p>
          <p class="qc-branch-addr-ta">கோயில் சாலை, ராமேஸ்வரம்</p>
          <p class="qc-branch-phone">+91 74188 31122</p>
          <p class="qc-branch-hours">Mon–Sat · 9:00 – 20:00</p>
          <a class="qc-branch-dirs" href="https://maps.google.com/?q=Rameswaram" target="_blank" rel="noopener">Get directions →</a>
        </div>
      </div>
    </div>
  </section>
```

> **Note:** Phone numbers and addresses above are placeholders that match the established business pattern (`+91 74188 31122` is the UPI/contact number from memory). Confirm with user before production; the layout works with any address content.

- [ ] **Step 2: Append the Leaflet map init to the existing `<script>` block, just before the closing `</script>` tag:**

```js
    // === Leaflet branches map (lazy-init on viewport enter) ===
    (function () {
      var mapEl = document.getElementById('qcBranchMap');
      if (!mapEl) return;
      var branches = [
        { name: 'Ramanathapuram', latlng: [9.3716, 78.8307] },
        { name: 'Paramakudi',     latlng: [9.5481, 78.5905] },
        { name: 'Mudukulathur',   latlng: [9.3539, 78.5076] },
        { name: 'Kamuthi',        latlng: [9.4317, 78.3941] },
        { name: 'Rameswaram',     latlng: [9.2876, 79.3129] }
      ];
      function init() {
        if (typeof L === 'undefined') { setTimeout(init, 120); return; }
        var map = L.map(mapEl, { zoomControl: true, scrollWheelZoom: false, attributionControl: true })
                   .setView([9.40, 78.75], 10);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap',
          maxZoom: 18
        }).addTo(map);
        var icon = L.divIcon({
          className: 'qc-branch-pin',
          html: '<div style="width:14px;height:14px;background:#1B5E3B;border:2px solid #FBFAF7;border-radius:50%;box-shadow:0 0 0 1px rgba(0,0,0,0.15)"></div>',
          iconSize: [14, 14],
          iconAnchor: [7, 7]
        });
        branches.forEach(function (b) {
          L.marker(b.latlng, { icon: icon }).addTo(map).bindPopup('<b>' + b.name + '</b>');
        });
      }
      if ('IntersectionObserver' in window) {
        var io = new IntersectionObserver(function (entries) {
          if (entries.some(function (e) { return e.isIntersecting; })) {
            init();
            io.disconnect();
          }
        }, { rootMargin: '200px' });
        io.observe(mapEl);
      } else {
        init();
      }
    })();
```

- [ ] **Step 3: Verify in browser.** Branches section shows a tile map with 5 green pins, then a 3-column branch card grid below.

---

## Task 8: Fill in Gallery

**Files:**
- Modify: `public/index.html` (inside `<section class="qc-gallery" id="gallery">`)

- [ ] **Step 1: Replace the empty `<section class="qc-gallery" id="gallery">` with:**

```html
  <section class="qc-gallery" id="gallery">
    <div class="qc-wrap qc-reveal">
      <div class="qc-gallery-head">
        <div>
          <div class="qc-eyebrow"><span class="dot"></span>Recent work</div>
          <h2 class="qc-section-head">A finished wall is the <em>only portfolio</em> that matters.</h2>
        </div>
        <a href="#design-request" class="qc-service-link">See all work →</a>
      </div>
      <div class="qc-gallery-grid">
        <figure class="qc-gallery-item qc-gal-1">
          <img src="https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?w=1100&auto=format&fit=crop" alt="Painted living room interior" loading="lazy">
          <figcaption class="qc-gal-caption">Paramakudi · Living room</figcaption>
        </figure>
        <figure class="qc-gallery-item qc-gal-2">
          <img src="https://images.unsplash.com/photo-1615875605825-5eb9bb5d52ac?w=800&auto=format&fit=crop" alt="Painted bedroom wall" loading="lazy">
          <figcaption class="qc-gal-caption">Ramanathapuram · Bedroom</figcaption>
        </figure>
        <figure class="qc-gallery-item qc-gal-3">
          <img src="https://images.unsplash.com/photo-1618219740975-d40978bb7378?w=800&auto=format&fit=crop" alt="Painted kitchen wall" loading="lazy">
          <figcaption class="qc-gal-caption">Mudukulathur · Kitchen</figcaption>
        </figure>
        <figure class="qc-gallery-item qc-gal-4">
          <img src="https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=700&auto=format&fit=crop" alt="House exterior fresh paint" loading="lazy">
          <figcaption class="qc-gal-caption">Kamuthi · Exterior</figcaption>
        </figure>
        <figure class="qc-gallery-item qc-gal-5">
          <img src="https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?w=700&auto=format&fit=crop" alt="Textured accent wall" loading="lazy">
          <figcaption class="qc-gal-caption">Rameswaram · Texture</figcaption>
        </figure>
        <figure class="qc-gallery-item qc-gal-6">
          <img src="https://images.unsplash.com/photo-1582268611958-ebfd161ef9cf?w=700&auto=format&fit=crop" alt="Staircase wall paint" loading="lazy">
          <figcaption class="qc-gal-caption">Paramakudi · Stairwell</figcaption>
        </figure>
      </div>
    </div>
  </section>
```

> **Note:** Gallery uses Unsplash CDN URLs as placeholders. These will be replaced with real Quality Colours job photos from the painter-app library in a follow-up.

- [ ] **Step 2: Verify in browser.** Asymmetric 6-photo grid (1 large + 5 smaller), captions in the bottom-left of each tile.

---

## Task 9: Fill in Design Request form

**Files:**
- Modify: `public/index.html` (inside `<section class="qc-design" id="design-request">`)

- [ ] **Step 1: Replace the empty `<section class="qc-design" id="design-request">` with:**

```html
  <section class="qc-design" id="design-request">
    <div class="qc-wrap qc-reveal">
      <div class="qc-design-inner">
        <div class="qc-eyebrow"><span class="dot" style="background:var(--qc-gold)"></span>Free design request</div>
        <h2>Send us a photo of your space.</h2>
        <p class="lead">We'll suggest colours, finishes, and an itemised quote within 24 hours. No obligation, no follow-up unless you ask.</p>
        <form class="qc-form" id="qcDesignForm" action="/api/design-requests" method="POST" enctype="multipart/form-data" novalidate>
          <label class="qc-drop" id="qcDrop">
            <input type="file" name="photo" id="qcDropInput" accept="image/*" hidden>
            <div class="qc-drop-label">Drop a photo here — or click to upload</div>
            <div class="qc-drop-hint">JPG or PNG · up to 8 MB</div>
          </label>
          <input class="qc-input" type="text" name="name" placeholder="Your name" required autocomplete="name">
          <input class="qc-input" type="tel" name="phone" placeholder="Phone — we'll call back" required autocomplete="tel">
          <textarea class="qc-input qc-textarea" name="notes" placeholder="Notes · குறிப்புகள் (optional)"></textarea>
          <button type="submit" class="qc-design-submit">Submit request <span class="ta">அனுப்பு</span></button>
        </form>
      </div>
    </div>
  </section>
```

- [ ] **Step 2: Append the drop-zone JS to the existing `<script>` block, before `</script>`:**

```js
    // === Design request drop zone ===
    (function () {
      var drop = document.getElementById('qcDrop');
      var input = document.getElementById('qcDropInput');
      if (!drop || !input) return;
      ['dragenter','dragover'].forEach(function (ev) {
        drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('is-drag'); });
      });
      ['dragleave','drop'].forEach(function (ev) {
        drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('is-drag'); });
      });
      drop.addEventListener('drop', function (e) {
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
          input.files = e.dataTransfer.files;
          drop.querySelector('.qc-drop-label').textContent = e.dataTransfer.files[0].name;
        }
      });
      input.addEventListener('change', function () {
        if (input.files && input.files[0]) {
          drop.querySelector('.qc-drop-label').textContent = input.files[0].name;
        }
      });
    })();
```

- [ ] **Step 3: Verify in browser.** Ink-background section with cream paper-feel drop zone, three underline-only inputs, cream pill submit button with Tamil split.

> **Note on the form action:** This plan ships the form pointing at `POST /api/design-requests`. Existing route `routes/website.js` already handles design-request uploads (confirmed in memory). If the existing endpoint is named differently, update the `action` attribute to match — do not write new backend code here. If no backend exists yet, leave the action as-is and add a backend route in a follow-up plan.

---

## Task 10: Fill in Footer

**Files:**
- Modify: `public/index.html` (inside `<footer class="qc-foot">`)

- [ ] **Step 1: Replace the empty `<footer class="qc-foot"></footer>` with:**

```html
  <footer class="qc-foot">
    <div class="qc-wrap qc-reveal">
      <div class="qc-foot-grid">
        <div>
          <div class="qc-foot-brand">Quality Colours.</div>
          <p class="qc-foot-tagline">தரமான வண்ணங்கள், சிறந்த முடிவு.</p>
          <p style="margin-top:18px; font-size:13px; color:rgba(251,250,247,0.6);">Authorised dealer of Asian, Berger, Birla Opus, Nippon, Jotun, JSW Paints.</p>
        </div>
        <div>
          <h4>Contact</h4>
          <a href="tel:+917418831122">+91 74188 31122</a>
          <a href="https://wa.me/917418831122" target="_blank" rel="noopener">WhatsApp</a>
          <a href="mailto:hello@qcpaintshop.com">hello@qcpaintshop.com</a>
        </div>
        <div>
          <h4>Quick links</h4>
          <a href="#branches">Branches</a>
          <a href="#gallery">Gallery</a>
          <a href="#services">Services</a>
          <a href="#design-request">Get a quote</a>
        </div>
        <div>
          <h4>Portals</h4>
          <a href="/customer-login.html" class="qc-foot-portal">Customer portal →</a>
          <a href="/login.html" class="qc-foot-portal">Staff portal →</a>
          <a href="/painter-login.html" class="qc-foot-portal">Painter portal →</a>
        </div>
      </div>
      <hr class="qc-foot-rule">
      <div class="qc-foot-bottom">
        <span>© 2026 Quality Colours · Ramanathapuram. All rights reserved.</span>
        <div class="qc-foot-social" aria-label="Social media">
          <a href="https://wa.me/917418831122" target="_blank" rel="noopener" aria-label="WhatsApp">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M.057 24l1.687-6.163a11.867 11.867 0 01-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 018.413 3.488 11.824 11.824 0 013.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 01-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981z"/></svg>
          </a>
          <a href="https://instagram.com/" target="_blank" rel="noopener" aria-label="Instagram">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
          </a>
          <a href="https://facebook.com/" target="_blank" rel="noopener" aria-label="Facebook">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M9 8h-3v4h3v12h5v-12h3.642l.358-4h-4v-1.667c0-.955.192-1.333 1.115-1.333h2.885v-5h-3.808c-3.596 0-5.192 1.583-5.192 4.615v3.385z"/></svg>
          </a>
        </div>
      </div>
    </div>
  </footer>
```

- [ ] **Step 2: Verify in browser.** Ink footer with 4 columns, Tamil gold tagline under the brand, portal links in the rightmost column, social SVG icons in the bottom row.

---

## Task 11: Download hero photo asset

**Files:**
- Create: `public/images/landing/hero-room.jpg`

- [ ] **Step 1: Create the directory if it doesn't exist.**

```bash
mkdir -p "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/act.qcpaintshop.com/public/images/landing"
```

- [ ] **Step 2: Download a curated stock photo of a freshly-painted Indian-styled interior.**

Pick ONE of the following Unsplash URLs (all CC0, no licensing concerns). Inspect each in a browser tab first; pick the one that best reads as a warm, recently-painted living room with natural light:

```bash
# Candidate A — warm tones, painted accent wall
curl -L -o "public/images/landing/hero-room.jpg" \
  "https://images.unsplash.com/photo-1615875605825-5eb9bb5d52ac?w=2000&q=80&auto=format&fit=crop"

# Candidate B — neutral painted living room, soft light
# curl -L -o "public/images/landing/hero-room.jpg" \
#   "https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?w=2000&q=80&auto=format&fit=crop"

# Candidate C — green-painted feature wall
# curl -L -o "public/images/landing/hero-room.jpg" \
#   "https://images.unsplash.com/photo-1618219740975-d40978bb7378?w=2000&q=80&auto=format&fit=crop"
```

- [ ] **Step 3: Compress with sharp.** (sharp is already a project dependency — see `package.json`.) Run this one-liner from project root:

```bash
node -e "require('sharp')('public/images/landing/hero-room.jpg').resize(1920,null,{withoutEnlargement:true}).jpeg({quality:75,progressive:true}).toFile('public/images/landing/hero-room.optimized.jpg').then(()=>{require('fs').renameSync('public/images/landing/hero-room.optimized.jpg','public/images/landing/hero-room.jpg');console.log('done');});"
```

Expected: file size ≤ 250KB.

- [ ] **Step 4: Verify in browser.** Hero now shows the photo with the dark gradient overlay; headline and Tamil sub-line read cleanly white-on-dark.

---

## Task 12: Smoke test and commit

- [ ] **Step 1: Restart the server if not already running with the new server.js.**

```bash
node server.js
# or: pm2 restart business-manager
```

- [ ] **Step 2: Curl tests.**

```bash
curl -sI http://localhost:3000/ | grep -E "HTTP|Content-Type"
# Expected: HTTP/1.1 200 OK, Content-Type: text/html

curl -s http://localhost:3000/api/status | head -c 80
# Expected: {"service":"Quality Colours Business Manager API","version":"2.0.0"...

# Confirm 404 for old JSON path on root no longer returns JSON
curl -s http://localhost:3000/ | head -c 60
# Expected: starts with <!DOCTYPE html>
```

- [ ] **Step 3: Browser smoke test — desktop.**

Open `http://localhost:3000/` in Chrome at 1440px width and verify:
- Hero photo loads with overlay; headline italic-gold accent reads clearly.
- Nav stays transparent over hero, becomes solid cream below 80px scroll.
- Brand strip shows 6 italic wordmarks.
- About + Stats layout side-by-side, italic green numerals on the right.
- Services list shows 4 numbered rows with hairline dividers.
- Branches map renders with 5 green pins. Cards below render in 3 columns.
- Gallery: 1 large + 5 smaller photos in asymmetric grid.
- Design Request: ink section with paper-feel drop zone, three underline inputs, Tamil-split submit button.
- Footer: 4 columns, portal links visible only in the rightmost column. Social SVGs at the bottom.
- No console errors. No purple. No floating animations. No brand ticker scrolling.

- [ ] **Step 4: Browser smoke test — mobile.**

Use DevTools responsive mode at 390px width:
- Nav collapses to hamburger; tapping opens a cream sheet with links + CTA.
- Hero headline scales down (~42px) but stays legible.
- All sections stack to single column.
- Branches map shrinks to 240px height. Cards become 1-column.
- Gallery becomes 6-col grid with large feature spanning full width.

- [ ] **Step 5: Lighthouse run (Chrome DevTools → Lighthouse → Mobile, Performance + Accessibility).**

Expected:
- Performance ≥ 85 (single hero photo + Leaflet are the largest payloads).
- Accessibility ≥ 95.
- No "Color contrast" failures.
- No "Image elements do not have explicit width and height" failures (figures have aspect-ratio, hero is a background, gallery imgs lazy-load).

If accessibility < 95 or contrast fails, inspect the failing element and adjust opacities in the inline CSS. Most likely culprit: `rgba(255,255,255,0.6)` text on Leaflet attribution — leave as is, that's Leaflet's own UI.

- [ ] **Step 6: Commit.**

```bash
git add server.js public/index.html public/images/landing/hero-room.jpg docs/superpowers/specs/2026-05-12-public-landing-redesign-design.md docs/superpowers/plans/2026-05-12-public-landing-redesign.md
git commit -m "$(cat <<'EOF'
feat(landing): redesign public landing — editorial classic + cinematic hero

Replace AI-generated landing page at `/` with an internationally-standard
editorial-classic design. Cinematic full-bleed hero (Playfair italic + curated
Tamil), cream editorial body sections (About, Services, Branches, Gallery),
ink Design Request form, ink footer with discreet portal links.

API status moves from `GET /` to `GET /api/status` so Express static can
serve `public/index.html` at the root.

Spec: docs/superpowers/specs/2026-05-12-public-landing-redesign-design.md
Plan: docs/superpowers/plans/2026-05-12-public-landing-redesign.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: Confirm commit.**

```bash
git log -1 --stat
# Expected: 1 commit, modifying server.js + public/index.html, adding hero-room.jpg + spec.md + plan.md
```

---

## Spec Coverage Check

| Spec section | Implementing task(s) |
|---|---|
| §2.1 Typography (Playfair, Inter, Noto Serif Tamil) | Task 2 (font preconnect + import + tokens) |
| §2.2 Palette (cream/green/gold/ink) | Task 2 (`:root` CSS variables) |
| §2.3 Motion (scroll-reveal, reduced-motion) | Task 2 (CSS + IntersectionObserver in inline script) |
| §2.4 Photography | Task 8 (gallery placeholders), Task 11 (hero) |
| §2.5 Tamil bilingual rules | Tasks 3, 7, 9, 10 (curated placements) |
| §3.1 Nav | Tasks 2 (CSS + structure) + scroll-aware JS in Task 2 inline script |
| §3.2 Hero | Task 3 |
| §3.3 Brand strip | Task 4 |
| §3.4 About + stats | Task 5 |
| §3.5 Services (4 numbered rows) | Task 6 |
| §3.6 Branches + map | Task 7 |
| §3.7 Gallery (asymmetric grid) | Task 8 |
| §3.8 Design Request | Task 9 |
| §3.9 Footer | Task 10 |
| §4 Routing (`/` → `/api/status`) | Task 1 |
| §7 A11y & perf | Task 12 (Lighthouse run) |

No gaps.

## Out-of-Plan Notes

- Real Quality Colours job photos for the gallery and hero are deferred. The Unsplash + local placeholder set ships v1; replace asset files in `/public/images/landing/` when curated photos are available — no HTML change required.
- The form's `action="/api/design-requests"` assumes an existing backend route. Verify against `routes/website.js`. If the route name differs, update the action in `public/index.html` (one-line change). If no backend exists, the form's UI ships as a no-op — wire up in a follow-up plan.
- The customer-facing `qcpaintshop.com` domain is untouched (different repository, different surface).
