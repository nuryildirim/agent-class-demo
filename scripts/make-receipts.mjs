// Draws a fake receipt image for every claim in data/demo-claims.json.
//
//   npm run make-receipts
//
// Each receipt is drawn as SVG (a text format for pictures), then the
// `sharp` image library saves it as a PNG in data/receipts/<claim id>.png.
//
// It also prints the receipt total next to the amount the employee
// claimed, so we can check the demo data adds up. Only C12 should differ
// (that mismatch is on purpose).

import { copyFile, readFile } from "node:fs/promises";
import sharp from "sharp";

const data = JSON.parse(await readFile(new URL("../data/demo-claims.json", import.meta.url)));
const outDir = new URL("../data/receipts/", import.meta.url);
const allClaims = [...data.past_claims, ...data.claims];

// Money helpers. We count in cents to avoid floating-point surprises
// (in JavaScript, 0.1 + 0.2 is 0.30000000000000004).
const cents = (dollars) => Math.round(dollars * 100);
const money = (c) => (c / 100).toFixed(2);

function receiptTotalCents(receipt) {
  const items = receipt.items.reduce((sum, [, price]) => sum + cents(price), 0);
  return items + cents(receipt.tax?.[1] ?? 0) + cents(receipt.tip ?? 0);
}

// SVG treats & and < as special characters, so escape them.
const esc = (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;");

function drawReceipt(r) {
  const width = 480;
  const rowHeight = 34;
  const rows = []; // [y, left text, right text, extra attributes]
  let y = 70;

  rows.push([y, esc(r.merchant), null, 'text-anchor="middle" font-size="30" font-weight="bold"']);
  for (const line of r.address) rows.push([(y += 35), esc(line), null, 'text-anchor="middle"']);
  y += 25;
  for (const line of r.meta) rows.push([(y += 30), esc(line), null, ""]);
  y += 20;

  let subtotal = 0;
  for (const [name, price] of r.items) {
    rows.push([(y += rowHeight), esc(name), price.toFixed(2), ""]);
    subtotal += cents(price);
  }

  const lineY = (y += 22);
  rows.push([(y += 40), "Subtotal", money(subtotal), ""]);
  if (r.tax) rows.push([(y += rowHeight), esc(r.tax[0]), r.tax[1].toFixed(2), ""]);
  if (r.tip) rows.push([(y += rowHeight), "Tip", r.tip.toFixed(2), ""]);
  rows.push([(y += 44), "TOTAL USD", money(receiptTotalCents(r)), 'font-weight="bold" font-size="26"']);
  rows.push([(y += 44), esc(r.payment), null, ""]);
  rows.push([(y += 40), "Thank you!", null, 'text-anchor="middle"']);

  const text = rows
    .map(([rowY, left, right, attrs]) => {
      const centered = attrs.includes("middle");
      const leftEl = `<text x="${centered ? width / 2 : 40}" y="${rowY}" ${attrs}>${left}</text>`;
      const rightEl = right
        ? `<text x="440" y="${rowY}" text-anchor="end" ${attrs}>${right}</text>`
        : "";
      return leftEl + rightEl;
    })
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${y + 50}">
  <rect width="100%" height="100%" fill="#fbfaf6"/>
  <g font-family="Courier New, monospace" font-size="22" fill="#222">
    <line x1="40" y1="${lineY}" x2="440" y2="${lineY}" stroke="#222" stroke-dasharray="6 4"/>
    ${text}
  </g>
</svg>`;
}

// Draw the normal receipts first, then copy the duplicates.
const receiptById = Object.fromEntries(allClaims.map((c) => [c.id, c.receipt]));
const pngPath = (id) => new URL(`${id}.png`, outDir).pathname;

for (const claim of allClaims) {
  const r = claim.receipt;
  if (r.copy_of) continue;

  const image = sharp(Buffer.from(drawReceipt(r)));
  if (r.blurry) {
    // Shrink, blur, and darken, like a bad phone photo.
    image.resize({ width: 260 }).blur(3.2).modulate({ brightness: 0.8 });
  }
  await image.png().toFile(pngPath(claim.id));
}

for (const claim of allClaims) {
  if (claim.receipt.copy_of) await copyFile(pngPath(claim.receipt.copy_of), pngPath(claim.id));
}

// Check: does each receipt total match what the employee claimed?
console.log("claim  claimed   receipt   ");
for (const claim of allClaims) {
  const receipt = receiptById[claim.receipt.copy_of ?? claim.id];
  const total = receiptTotalCents(receipt);
  const flag = total === cents(claim.amount) ? "" : "  <-- does not match";
  console.log(`${claim.id.padEnd(5)}  ${claim.amount.toFixed(2).padStart(7)}  ${money(total).padStart(8)}${flag}`);
}
console.log(`\nWrote ${allClaims.length} receipts to data/receipts/`);
