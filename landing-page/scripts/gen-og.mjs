import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '..', 'assets', 'og-image.png');

// Inter isn't always installed locally — pick the closest available system sans
// at runtime via fc-match. Falls back to DejaVu Sans / Liberation Sans on most
// Linux boxes; macOS will pick up Inter if installed via Homebrew.
import { execSync } from 'node:child_process';
let preferredFont = 'Inter';
try {
  const match = execSync('fc-match -f "%{family}" Inter 2>/dev/null || true', {
    encoding: 'utf8',
  }).trim();
  if (match && match.toLowerCase() !== 'inter') preferredFont = match;
} catch {}

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#F8F6F1"/>
  <rect x="0" y="0" width="8" height="630" fill="#2350D9"/>

  <text x="80" y="120" font-family="${preferredFont}" font-size="56" font-weight="700" fill="#1A1D21">Jumpmade</text>
  <circle cx="430" cy="118" r="9" fill="#2350D9"/>

  <text x="80" y="280" font-family="${preferredFont}" font-size="74" font-weight="700" fill="#1A1D21">UK plumbers:</text>
  <text x="80" y="370" font-family="${preferredFont}" font-size="74" font-weight="700" fill="#1A1D21">6 extra booked jobs</text>
  <text x="80" y="460" font-family="${preferredFont}" font-size="74" font-weight="700" fill="#1A1D21">in 30 days.</text>

  <text x="80" y="535" font-family="${preferredFont}" font-size="32" font-style="italic" fill="#4A4F57">£300 setup &#183; £250/month &#183; Live in 7 days</text>
  <text x="80" y="578" font-family="${preferredFont}" font-size="32" font-style="italic" fill="#4A4F57">Or every penny back.</text>

  <text x="1080" y="605" font-family="${preferredFont}" font-size="26" font-weight="500" fill="#2350D9" text-anchor="end">jumpmade.com</text>
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
