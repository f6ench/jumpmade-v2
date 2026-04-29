import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '..', 'assets', 'og-image.png');

// Try Bricolage Grotesque first (the page font); fall back to whichever sans
// the system can supply. Resvg renders with whatever fc-match returns.
import { execSync } from 'node:child_process';
let preferredFont = 'Bricolage Grotesque';
try {
  const match = execSync('fc-match -f "%{family}" "Bricolage Grotesque" 2>/dev/null || true', {
    encoding: 'utf8',
  }).trim();
  if (match && match.toLowerCase() !== 'bricolage grotesque') preferredFont = match;
} catch {}

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="glow" cx="85%" cy="-10%" r="55%">
      <stop offset="0%" stop-color="#4F39F6" stop-opacity="0.12"/>
      <stop offset="65%" stop-color="#4F39F6" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="stripe" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#4F39F6"/>
      <stop offset="60%" stop-color="#3B25E0"/>
      <stop offset="100%" stop-color="#4F39F6"/>
    </linearGradient>
  </defs>

  <rect width="1200" height="630" fill="#FFFFFF"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <rect x="0" y="0" width="1200" height="4" fill="url(#stripe)"/>

  <text x="72" y="220" font-family="${preferredFont}" font-size="76" font-weight="700" fill="#0A0A0B" letter-spacing="-2.5">UK plumbers: keep your</text>
  <text x="72" y="310" font-family="${preferredFont}" font-size="76" font-weight="700" fill="#0A0A0B" letter-spacing="-2.5">diary full without</text>
  <text x="72" y="405" font-family="${preferredFont}" font-size="76" font-weight="700" font-style="italic" fill="#4F39F6" letter-spacing="-2.5">chasing leads.</text>

  <line x1="72" y1="425" x2="478" y2="425" stroke="#4F39F6" stroke-width="5" stroke-linecap="round"/>

  <text x="72" y="570" font-family="${preferredFont}" font-size="32" font-weight="700" fill="#0A0A0B" letter-spacing="-0.8">Jumpmade</text>
  <rect x="198" y="552" width="8" height="8" fill="#4F39F6"/>

  <text x="1128" y="570" font-family="${preferredFont}" font-size="22" font-weight="500" fill="#52525B" text-anchor="end">jumpmade.com</text>
</svg>
`;

console.log(`Rendering OG image with font: ${preferredFont}`);

const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: 1200 },
  font: {
    loadSystemFonts: true,
    defaultFontFamily: preferredFont,
  },
});
const pngData = resvg.render().asPng();
writeFileSync(out, pngData);
console.log(`Wrote ${out} (${pngData.length} bytes)`);
