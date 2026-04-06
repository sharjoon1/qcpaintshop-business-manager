# Painter Card Enterprise Redesign — Design Spec

**Date:** 2026-04-06
**Status:** Approved
**Scope:** Redesign visiting card + ID card from basic to enterprise-level modern corporate style

---

## 1. Visiting Card (1400×800) — Painter → Customer

### Layout: Photo-first, modern corporate
- **Header (height ~140px):** Green gradient (dark→green), company logo left, "QUALITY COLOURS" + "The Branded Paint Showroom" text
- **Body:** Photo left-aligned (280px circle with level-colored ring), details right
  - Name: large (56px), bold, level-colored underline
  - Specialization text (32px, green)
  - Experience years (24px, grey) — if available
  - Phone in subtle pill shape with phone icon
  - City with location pin icon
- **QR code:** Bottom-right (160px), subtle border
- **Level badge:** Right of name, colored pill
- **Footer (~60px):** Green gradient, "QC PAINTERS PROGRAM" left, referral code center, tagline right

### Level-based visual differentiation
- Photo ring color matches level
- Name underline gradient matches level
- Outer border accent tint matches level
- Level badge pill color matches level

---

## 2. ID Card (800×1200) — Painter → Other Painters (Referral)

### Layout: QR + Referral code dominant
- **Header (~150px):** Green gradient, logo + "QUALITY COLOURS" + "QC Painters Program"
- **Photo:** Centered, 200px circle with level-colored ring
- **Name:** Centered, large (48px), bold
- **Level badge:** Below name
- **Phone:** Centered with icon
- **QR Code:** Large (220px), centered, prominent — main focus of card
- **"SCAN TO JOIN" label** above QR
- **Referral code box:** Gold-bordered highlighted box, large code text (44px)
- **Footer (~70px):** Green gradient, "Join & earn loyalty rewards!" CTA

### Share message (when ID card is shared from app)
```
🎨 Join QC Painters Loyalty Program!

Earn points on every paint purchase.
Use my referral code: {CODE}

Register here: https://act.qcpaintshop.com/painter-register.html?ref={CODE}
```

---

## 3. Level Color Mapping (both cards)

| Level | Photo Ring | Accent/Underline | Border Tint | Badge |
|-------|-----------|-----------------|-------------|-------|
| Bronze | #CD7F32 | #CD7F32 solid | #CD7F32 | Brown pill |
| Silver | #9CA3AF | silver gradient (#9CA3AF→#D1D5DB) | #9CA3AF | Silver pill |
| Gold | #D4A24E | gold gradient (#D4A24E→#b8860b) | #D4A24E | Gold pill |
| Diamond | #3B82F6 | blue gradient (#3B82F6→#1D4ED8) | #3B82F6 | Blue pill |

---

## 4. Technical Approach

- **File:** `services/painter-card-generator.js` — complete rewrite
- **Tech:** Same stack — Sharp + SVG, QRCode buffer
- **Functions:** `generateCard(painter, pool)` + `generateIdCard(painter, pool)` — same exports, no API changes
- **Sizes:** Visiting 1400×800, ID 800×1200 — unchanged
- **Output:** PNG to `public/uploads/painter-cards/` — unchanged
- **Dependencies:** Sharp, qrcode — no new deps

---

## 5. Design Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Style | Modern corporate | Professional, print-friendly, brand-aligned |
| Layout (visiting) | Photo-first left | Personal connection, WhatsApp thumbnail visibility |
| Layout (ID) | QR+code dominant | Purpose is referral sharing |
| Level differentiation | Border/accent colors | Aspirational without full theme complexity |
| ID card purpose | Painter→Painter referral | QR + referral code for easy joining |
