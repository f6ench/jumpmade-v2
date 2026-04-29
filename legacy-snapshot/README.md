# Legacy jumpmade.com snapshot

Snapshot of the GitHub Pages-hosted jumpmade.com site as it stood on **2026-04-29**, captured immediately before DNS cutover from GitHub Pages to the Hetzner-hosted v1.1 landing page.

**What this is:** archive only. The "AI-Powered Lead Generation" version of Jumpmade. Dark theme, Plus Jakarta Sans + DM Sans, agency-style positioning. Superseded by the v1.1 hand-built landing page in `landing-page/`.

**Why it's preserved:** founder intends to revisit the aesthetic later — typography, motion, dark sections — and remix elements into a future Jumpmade rebuild.

## How to view

```bash
cd jumpmade-v2/legacy-snapshot
python -m http.server 8000
# open http://localhost:8000 in browser
```

Or just open `index.html` directly in a browser (some assets that pull from CDN will still resolve via internet, e.g. Tailwind CDN, Google Fonts).

## Contents

| Path | Bytes | Purpose |
|---|---:|---|
| `index.html` | 22 KB | Single-page site, sections: hero, services, results, about, booking |
| `css/styles.css` | ~6 KB | Custom styles on top of Tailwind CDN |
| `js/main.js` | 3 KB | Smooth scroll, nav, animations |
| `js/particles.js` | 5 KB | Background particle effect |

## External dependencies (not snapshotted)

- Tailwind CSS via CDN — `https://cdn.tailwindcss.com`
- Plus Jakarta Sans + DM Sans — Google Fonts

These will still resolve while those CDNs exist. If they ever 404 in the future, the page will degrade but core copy + structure remain.

## Source repos

Located on GitHub account `f6ench` (not `f6enchie`). Both cloned into this folder.

### `source-jumpmade-com/` — live site source (matches the rendered snapshot)

- Created and pushed 2026-03-27. CNAME points at jumpmade.com.
- Contents: `index.html`, `css/`, `js/`, `CNAME`
- This is byte-for-byte the source for the live site we're cutting over from today.

### `source-jumpmade-site/` — older February version (has more)

- Created 2026-02-23, last pushed 2026-03-21.
- Contents include extras worth reusing:
  - `privacy.html` and `terms.html` — **directly reusable for the v1.1 launch checklist's T&Cs/Privacy gap (audit item A3)**. Adapt copy to the v1.1 offer terms (£300 setup, £250/mo, 6-jobs guarantee, 30-lead condition) and link from new footer.
  - `blog.html` + `blog/` directory — a blog scaffold for if/when content marketing kicks in.
  - Customer logos: `james-plumbing-logo.svg`, `mark-gas-logo.svg`, `one-plumbing-logo.jpeg` — usable for case-study cards once V2 has paying customer data.
  - `index-old.html` — even older homepage version.
  - `test-redesign/` — past redesign experiments.

## Reuse plan for V2

| Asset | V2 use |
|---|---|
| `source-jumpmade-site/privacy.html` | Adapt and host at `jumpmade.com/privacy` once T&Cs page is built (A3) |
| `source-jumpmade-site/terms.html` | Adapt and host at `jumpmade.com/terms` once T&Cs page is built (A3) |
| `source-jumpmade-site/blog/` | Reference if blog ever launches (not in V2 scope per writing moratorium) |
| `source-jumpmade-com/` | Aesthetic reference for future merge — typography (Plus Jakarta + DM Sans), motion, dark sections |
