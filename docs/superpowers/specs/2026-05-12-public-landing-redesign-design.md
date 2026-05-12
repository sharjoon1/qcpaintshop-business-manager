# Public Landing Page Redesign — `act.qcpaintshop.com/`

**Date:** 2026-05-12
**Scope:** Replace the AI-generated-looking landing page at `public/index.html` and the JSON API stub at `GET /` with a single international-standard public landing page.
**Files touched:** `public/index.html` (rewrite), `server.js` (root route change), `tailwind.config.js` / `src/tailwind-input.css` (font additions), one new section CSS file or inline `<style>` block.

---

## 1. Goal

A visitor who types `act.qcpaintshop.com` into a browser should land on a page that reads as **designed by a person, for a confident regional paint business** — not as a generic AI-generated marketing template. The page's one job is to convert public visitors into quote requests; staff/customer/painter logins are present but discreet (footer).

**What the page must stop doing:**
- Returning raw JSON at `/`.
- Displaying violet→magenta hero gradient (the single biggest AI tell).
- Stacking gradient cards (green/blue/purple) as the primary visual.
- Running a scrolling brand ticker.
- Floating animations, decorative shimmer.
- Putting Staff Login as a hero-prominent CTA.
- Tamil subtitle reflexively under every English section header.

---

## 2. Visual System

### 2.1 Typography
| Use | Family | Notes |
|---|---|---|
| Display / headlines | **Playfair Display** (400, 500, 600; italic for accent words) | Serif. Italic green-accented run-in for the "memorable" word of each headline. |
| Body, nav, UI | **Inter** (300, 400, 500, 600) | Neutral grotesque body. Avoid 700+ to keep editorial calm. |
| Tamil pairing | **Noto Serif Tamil** (400, 500) | Pairs cleanly with Playfair. Used only where Tamil appears (see §2.5). |
| Mono / utility | system default (no extra font) | None needed. |

Replace the current `Poppins` import entirely. Poppins is the most-used "AI landing page" font and is the strongest single signal that the page was machine-generated.

### 2.2 Palette
| Token | Hex | Role |
|---|---|---|
| `--qc-cream` | `#FBFAF7` | Primary background. Calm, paper-warm. |
| `--qc-green` | `#1B5E3B` | Existing brand green. Primary CTAs, italic headline accents on cream sections. |
| `--qc-gold` | `#D4A24E` | Existing brand gold. Hero italic accent (on photo overlay), small details, hover states. |
| `--qc-ink` | `#1A1A1A` | Body text, logo, neutral type. Not pure black. |
| `--qc-muted` | `#666666` | Secondary text. |
| `--qc-rule` | `#E5E5E5` | 1px section rules, dividers. |
| `--qc-photo-tint` | `linear-gradient(180deg, rgba(20,15,8,0.35) 0%, rgba(20,15,8,0.15) 40%, rgba(20,15,8,0.7) 100%)` | Hero photo overlay for legible text. |

**Removed entirely:** `#667eea`, `#764ba2`, all gradient cards, all purple references in this page (existing admin pages keep their purple — out of scope).

### 2.3 Motion
- **No** floating, no shimmering, no rotating background animations.
- One subtle scroll-reveal (`opacity 0 → 1`, `translateY(20px → 0)`, 600ms, ease-out) on section entry.
- Hover states: 150ms transitions on links/buttons, no scale-up cards.

### 2.4 Photography
- Hero uses one carefully chosen licensed stock photo of a freshly painted Indian-styled interior (warm light, real-room composition — not "stock photo couch on white wall"). Source: Unsplash+ / Pexels Pro / Adobe Stock. Listed candidate slugs in §6.
- Photo applied as full-bleed background of the hero `<section>` with the `--qc-photo-tint` overlay.
- Gallery section uses 6–9 real Quality Colours job photos (or vetted stock as placeholder until painter-app library is curated).
- All photos compressed via `sharp` to ≤ 200KB WebP + JPEG fallback, served from `/public/images/landing/`.

### 2.5 Tamil bilingual rules
Tamil appears only where it earns its place. Section headers stay English-only.

| Surface | Tamil treatment |
|---|---|
| Hero headline | One Tamil sub-line under the English headline, set in Noto Serif Tamil at ~30% smaller size, opacity 0.85. |
| Primary CTAs (Hero, Design Request) | Two-line button: English label, Tamil short equivalent below or beside, separated by a thin rule. |
| Branch addresses | Tamil address line under English address. |
| Footer tagline + business hours | Tamil pairing. |
| **Section headers (Services, Brands, Branches, Gallery)** | **English only.** Removes the "templated subtitle" feel. |
| Body paragraphs | English only. Body Tamil duplication adds clutter and is unnecessary — audience is bilingual. |

---

## 3. Page Structure

**Total: 7 sections** (down from 10). Order top to bottom:

```
┌────────────────────────────────────────────────────┐
│  1. NAV (transparent over hero, solid on scroll)    │
├────────────────────────────────────────────────────┤
│  2. HERO — Cinematic Full-Bleed (V2)                │
│     · full-bleed stock photo + photo-tint overlay   │
│     · Playfair headline w/ gold italic accent       │
│     · Tamil sub-line                                │
│     · 1 primary CTA (Request a Quote) + 1 ghost     │
│     · gold italic foot tagline                      │
├────────────────────────────────────────────────────┤
│  3. BRAND STRIP — static, no animation              │
│     · 5–6 brand wordmarks/logos in a single row     │
│     · grayscale, 1px rule above + below             │
├────────────────────────────────────────────────────┤
│  4. ABOUT + STATS — cream editorial                 │
│     · 2-col: prose left, stats right                │
│     · italic Playfair numerals                      │
├────────────────────────────────────────────────────┤
│  5. SERVICES — editorial list                       │
│     · 4 services, no icons, numbered (01–04)        │
│     · serif title, Inter body, hairline divider     │
├────────────────────────────────────────────────────┤
│  6. BRANCHES — map + cards                          │
│     · OpenStreetMap embed + 5 branch address cards  │
│     · phone, hours, "Get directions" link           │
├────────────────────────────────────────────────────┤
│  7. GALLERY — editorial photo grid                  │
│     · 6 photos in asymmetric grid (not 3×2 uniform) │
│     · category caption per photo (Living / Ext.)    │
│     · "See more" link to full gallery page          │
├────────────────────────────────────────────────────┤
│  8. DESIGN REQUEST — premium upload form            │
│     · cream section, single-column form             │
│     · drop zone styled as paper, not dashed box     │
│     · primary CTA "Submit Design Request"           │
├────────────────────────────────────────────────────┤
│  9. FOOTER — ink background                         │
│     · 4 columns: brand, contact, portals, social    │
│     · portals = small text links (Customer · Staff  │
│       · Painter)                                    │
│     · Tamil tagline above copyright row             │
└────────────────────────────────────────────────────┘
```

### 3.1 Nav (section 1)
- Position: fixed top, transparent over hero, solid cream `#FBFAF7` with thin bottom rule on scroll past 80px.
- Left: `Quality Colours.` (Playfair 500, 20px) + small Inter caps `RAMANATHAPURAM · EST 2018` underneath.
- Center: 5 links — Colours · Services · Branches · Gallery · Brands (Inter 500, 13px, letter-spacing 0).
- Right: `Get a Quote` button — green pill on light nav, cream pill on transparent nav, Inter caps 12px.
- Mobile: hamburger reveals a vertical sheet with the same links + CTA.

### 3.2 Hero (section 2) — V2 Cinematic Full-Bleed
- Section: `min-height: 88vh` desktop, `min-height: 70vh` mobile.
- Background: full-bleed photo (§2.4) with photo-tint gradient overlay.
- Content max-width 720px, anchored to bottom-left of the section with 56px padding (24px mobile).
- Eyebrow: `• Authorised dealer · Asian · Berger · Birla · Nippon` — Inter 11px caps, white, gold dot.
- Headline: Playfair 400 italic for accent word, 70px desktop / 42px mobile, `letter-spacing: -2px`, line-height 1.02.
- Tamil sub: Noto Serif Tamil 400, 20px, opacity 0.85.
- Sub-paragraph: Inter 300, 14.5px, max-width 420px.
- Primary CTA: cream background, ink text, English + Tamil split with thin vertical rule.
- Secondary CTA: white text with underline, "Browse colours →".
- Footer row in section: "SCROLL ↓" (left) + gold italic tagline (right): *— painted 2,400+ homes since 2018.*

**Locked copy:**
- Eyebrow: `Authorised dealer · Asian · Berger · Birla · Nippon`
- Headline: `A finished room` + `says everything.` (italic gold accent)
- Tamil sub: `முடிக்கப்பட்ட அறை எல்லாமே சொல்லும்.`
- Sub-paragraph: `Five branches across Ramanathapuram. Trusted paint, expert finish, fair pricing. Free site visit and quote within 24 hours.`
- Primary CTA: `Request a free quote` / `இலவச மதிப்பீடு`
- Secondary CTA: `Browse colours →`
- Foot tagline: `— painted 2,400+ homes since 2018.`

### 3.3 Brand strip (section 3)
- Section: cream background, 80px vertical padding, 1px ink-10% rule top and bottom.
- Content: row of 6 brand wordmarks (Asian Paints, Berger, Birla Opus, Nippon, Jotun, JSW Paints), grayscale, opacity 0.7, hover 1.0.
- Above the row: tiny Inter caps eyebrow `AUTHORISED DEALER · ௮ங்கீகரிக்கப்பட்ட விற்பனையாளர்`.

### 3.4 About + stats (section 4)
- Section: cream, 120px vertical padding.
- Layout: 2-column desktop (60/40), stacks on mobile.
- Left column (prose):
  - Eyebrow Inter caps green: `OUR STORY`.
  - Playfair 500 heading 48px, 3 lines max: e.g., *"Started by two brothers in 2018. Five branches today. Same standard everywhere."*
  - Two Inter 16px paragraphs.
- Right column (stats):
  - 3 stat blocks stacked, each: Playfair italic 64px numeral in green + Inter caps 11px label below.
  - `2,400+` homes painted · `5` branches in the district · `7+` years in business.

### 3.5 Services (section 5)
- Section: cream, 1px top rule (continuation feel from About).
- Heading: `What we do` — Playfair 48px, left-aligned.
- 4 services rendered as an editorial list:
  - Numbered `01 — 04` Inter caps in gold on the left.
  - Service name (Playfair 24px) + 1-line description (Inter 14px) in the center column.
  - Right column: small Inter link `Learn more →`.
  - Each row separated by a 1px ink-10% horizontal rule.
- Locked at 4 services to preserve editorial rhythm. Initial copy (confirm with you during impl, but ship with these if no edit comes in):
  - `01 — Interior Painting`
  - `02 — Exterior & Waterproofing`
  - `03 — Texture & Designer Finishes`
  - `04 — Colour Consultation & Visualisation`

### 3.6 Branches (section 6)
- Section: cream (consistent with About/Services/Gallery — all editorial body sections share `--qc-cream`; the only tonal flip is the ink Design Request / Footer pair at the bottom).
- Eyebrow Inter caps green: `WHERE WE ARE`.
- Heading: `Five branches across the district.` Playfair 48px.
- Below: OpenStreetMap iframe (Leaflet) showing all 5 branch pins, height 360px desktop / 240px mobile.
- Below the map: branch grid — 5 cards (3 + 2 on desktop, 1-col on mobile). Each card:
  - Branch name (Playfair 22px)
  - Address line 1 (Inter 14px)
  - Address line 2 in Tamil (Noto Serif Tamil 13px, opacity 0.7)
  - Phone (Inter 14px, with phone glyph)
  - Hours (Inter 12px caps muted)
  - "Get directions →" link (green underline)

### 3.7 Gallery (section 7)
- Section: cream.
- Heading: `Recent work.` Playfair 48px.
- 6-photo asymmetric grid (CSS grid with `grid-template-columns: repeat(12, 1fr)` + manual span/row placement):
  - Photo 1: 7 cols, 2 rows (large feature)
  - Photo 2: 5 cols, 1 row
  - Photo 3: 5 cols, 1 row
  - Photos 4–6: 4 cols, 1 row each
- Each photo: subtle 4px rounded corner, hover lifts opacity to 1 (default 0.95). Caption appears in caption row beneath each photo: location · room type in Inter caps 10px (e.g., `PARAMAKUDI · LIVING ROOM`).
- Bottom-right: `See all work →` green link.

### 3.8 Design Request (section 8)
- Section: ink background, cream text (contrast moment, the page's one tonal flip).
- Heading: `Send us a photo of your space.` Playfair italic 48px, cream.
- Sub: `We'll suggest colours, finishes, and an itemised quote. No obligation.` Inter 16px cream-80%.
- Form (single column, max-width 520px, centered):
  - Drop zone: cream paper-feel rectangle, 280px tall, dashed-rule 1px ink-30%, drag-over state goes solid gold. Inside: small Inter caps `DROP A PHOTO HERE — or click to upload`, paperclip glyph. **No purple highlight, no skeleton shimmer.**
  - Name (Inter input, no border on top/sides, only bottom rule — minimalist underline input).
  - Phone (same).
  - Optional Tamil note textarea (label: *Notes / குறிப்புகள்*).
  - Submit button: cream pill with ink text, English + Tamil split. `Submit request · அனுப்பு`.

### 3.9 Footer (section 9)
- Section: ink background, cream type.
- Top row: 4 columns.
  - **Column 1:** `Quality Colours.` Playfair 500 24px + Tamil tagline `தரமான வண்ணங்கள், சிறந்த முடிவு.` (Noto Serif Tamil italic 14px gold).
  - **Column 2:** Contact — main phone, email, WhatsApp.
  - **Column 3:** Quick links — Branches, Gallery, Services, Colours.
  - **Column 4:** *Portals* — three small Inter caps links:
    - `CUSTOMER PORTAL →` → `/customer-login.html`
    - `STAFF PORTAL →` → `/login.html`
    - `PAINTER PORTAL →` → `/painter-login.html`
- 1px gold rule.
- Bottom row: copyright in Inter 12px cream-60% left, social icons (WhatsApp, Instagram, Facebook) right. Plain inline SVGs, no card background, hover opacity only.

---

## 4. Routing

| Route | Current | After |
|---|---|---|
| `GET /` | JSON status response | Static serve `public/index.html` |
| `GET /api/status` | — | JSON status response (moved here) |
| `GET /api` | — | (optional) redirect to `/api/status` or keep 404 |

Code change in `server.js` (~line 3671): delete the `app.get('/')` handler, add `app.get('/api/status', …)` with the same payload. Express static middleware (already mounted on `public/`) will then serve `index.html` at `/`. Verify nothing else relies on `GET /` returning JSON (grep `act.qcpaintshop.com/' ` and `'/'` callers).

---

## 5. Out of Scope

- Customer portal pages (`/customer-login.html`, etc.) — keep as-is.
- Staff portal pages — keep as-is.
- Painter portal pages — keep as-is.
- `qcpaintshop.com` (different domain) — out of scope.
- Existing `404.html` — keep, but later iteration can match this design system.
- Admin pages (color of `#667eea` lives there) — unchanged.
- Full multi-page site (separate `/colours`, `/services`, `/about`, `/gallery`). Sections in this redesign link to in-page anchors; standalone pages are a follow-up.

---

## 6. Asset Sourcing

| Asset | Source | Status |
|---|---|---|
| Hero photo | Unsplash (warm interior, real-room composition) — to curate from 3–5 candidates and license if Unsplash+ used; otherwise CC0 acceptable. | TBD during impl. |
| Gallery photos (6) | Vetted stock initially, replace with real Quality Colours job photos from painter-app library when curated. | Placeholder phase. |
| Brand logos | Each brand's official wordmark, grayscaled. | Use existing `/images/brands/` assets if present; otherwise outline-only marks. |
| Tamil strings | Curated by user (or proposed by spec, confirmed by user before production). | Confirm during impl. |
| Map | OpenStreetMap via Leaflet (already used in admin map pages — reuse setup). | Existing. |

---

## 7. Accessibility & Performance

- Color contrast: cream on green (CTAs) ≥ 7:1, cream on ink (footer) ≥ 12:1 — pass AAA.
- Hero photo text contrast: photo-tint gradient ensures ≥ 4.5:1 against headline. Test with the chosen photo before shipping.
- All photos lazy-loaded except hero (preload).
- Page weight target: ≤ 500KB total (HTML + CSS + 1 hero photo + 6 gallery photos at WebP).
- No JS framework. Vanilla scroll listener for nav state. Leaflet only loaded when branches section enters viewport (IntersectionObserver).
- `prefers-reduced-motion` disables the scroll-reveal animation.

---

## 8. Decisions Log

| # | Decision | Picked | Alternative considered |
|---|---|---|---|
| 1 | Visual direction | Hybrid B + A (Photographic Cinema hero + Color-Forward Editorial body) | A pure (Farrow & Ball), B pure (Asian Paints), C (Stripe minimal) |
| 2 | Photography source | Licensed stock for now | Real job photos, fresh shoot, no photo |
| 3 | Section count | Trim to 7 | Trim moderately, keep all 10 |
| 4 | Login placement | Footer only | Nav dropdown, on-page secondary section |
| 5 | Type + palette | Editorial Classic — Playfair + Inter, cream/green/gold/ink | Confident Sans (Space Grotesk), Indian Heritage (Fraunces + terracotta) |
| 6 | Tamil treatment | Curated English-led | Toggle, sustained dual-language |
| 7 | Root routing | Serve new landing at `/`, move API to `/api/status` | Keep JSON at `/`, landing at `/welcome` |
| 8 | Hero composition | V2 Cinematic Full-Bleed | V1 Editorial Split |

---

## 9. Open Questions

None. All foundational decisions are locked. Asset curation (which exact hero photo, which exact services copy, which exact stats) will happen during implementation with quick user confirmation.
