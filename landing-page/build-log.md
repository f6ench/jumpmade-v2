# build-log

Append-only log of phase outcomes. Newest entries at the bottom.

## 2026-04-27 — initial hand-built landing page

**Phases 1–8 complete locally. Phases 0 (audit) and 9–11 (deploy + DNS + verify)
blocked on founder-supplied VPS / DNS info.**

### Phase 1 — scaffold

- `landing-page/` created under repo root. (Charter cap 10 root files; 4 root
  `.md` files plus this folder still well under the cap.)
- npm init, single dev dep `tailwindcss@^3.4.19`. Added `@resvg/resvg-js` for
  the one-off OG image render — not pulled in at runtime.
- `tailwind.config.js` carries the design-system theme: charcoal/cream palette,
  blue accent, Inter font stack, `prose` 640px max-width.

### Phase 2 — semantic HTML

- `index.html` written with all 9 anchored sections (Hero + 2–9). Copy mirrored
  verbatim from `../offer/landing-page-copy.md` (`**Note for ops**` blocks at
  copy-doc lines 78 and 88 omitted, "Voice/tone notes," "Launch operational
  items," "WhatsApp + Calendly configuration," and "What changed vs v1"
  internal sections all omitted).
- 5 occurrences of literal `[phone]` (3 × `wa.me/[phone]`, 2 × `call [phone]`).
- 2 × email link to `josephfrench@jumpmade.com`.

### Phases 3–6 — type / colour / rhythm / desktop adapt

Built into `styles/input.css`:

- Palette: `#F8F6F1` cream bg, `#FFFFFF` surface, `#1A1D21` charcoal ink,
  `#2350D9` accent blue, `#1B3FA8` hover, `#4A4F57` muted, `#E8E3D9` border.
- Inter via Google Fonts (preconnect + `display=swap`).
- H1 uses `clamp(2rem, 8vw, 2.75rem)` mobile and `clamp(2.75rem, 4.5vw,
  3.75rem)` desktop. H2 `clamp(1.5rem, 5vw, 2rem)`.
- Section padding `3.5rem` mobile, `6rem` desktop.
- Single-column `prose-block` capped at 640px.
- Sections alternate cream / surface backgrounds — no horizontal rules.
- Custom bullet markers (steel-blue dots).
- Section 4 scope statement rendered as a `.scope-callout` card (4px blue
  left-border, surface bg).
- Section 5 (Guarantee) in a `.guarantee-card` with subtle elevation.
- Section 9 (Final CTA) inverse — charcoal bg, cream text, blue button.
- CTA buttons full-width on mobile, `inline-block` on desktop.

### Phase 5 — wordmark + sticky header

- "Jumpmade" text-only wordmark in Inter 700, tracking -0.02em.
- Sticky header on cream; `.is-scrolled` toggle adds bottom border + shadow
  past 4 px of scroll (small inline JS).
- Right-side header CTA links directly to `wa.me/[phone]` (not `#cta`) so a
  deep-scrolled visitor can convert without scrolling back.

### Phase 7 — polish

- A11y: skip-link to `#hero`, focus-visible blue outline on every interactive
  element, semantic `<header>`/`<main>`/`<section>`/`<footer>`,
  `prefers-reduced-motion` honoured (no smooth scroll, animations dampened).
- Meta: `<title>`, description, `theme-color`, OG tags (`og:type`, `og:url`,
  `og:title`, `og:description`, `og:image` 1200×630), `twitter:card=summary_large_image`.
- Favicon: text-only "J" wordmark on charcoal with blue accent dot
  (`assets/favicon.svg`).
- OG image: generated via `scripts/gen-og.mjs` using `@resvg/resvg-js`. Uses
  `fc-match Inter` to pick the closest available system font — falls back to
  DejaVu Sans on this build sandbox; will pick up Inter on the founder's
  machine if installed via Homebrew/system. Final image 1200×630 PNG, 47 KB.
  Regenerate any time with `node scripts/gen-og.mjs`.

### Phase 8 — production build

- `npm run build` → `dist/output.css` is **10.8 KB** minified. Target was
  ≤30 KB. ✓

### Outstanding (blocked on founder)

- **Phase 0 audit:** need Hetzner VPS IP + SSH user, plus `dig` output for
  `jumpmade.com` and `firstquotesystem.co.uk` (NS + A records). Drives whether
  Caddy needs installing fresh or whether something is already on `:80/:443`.
- **Phase 9 deploy:** runs as soon as Phase 0 lands.
- **Phase 10 DNS cutover:** founder runs at the registrar (Cloudflare or
  Namecheap, TBD by Phase 0 dig output).
- **Phase 11 verify:** post-deploy curl + Lighthouse + real-device check.

### 2026-04-28 (planned) — `[phone]` placeholder swap

When the WhatsApp Business SIM arrives, find/replace 5 lines in `index.html`
containing `[phone]` → real E.164 number, then re-run `./deploy.sh`. Append a
short note here logging the swap timestamp + verification.
