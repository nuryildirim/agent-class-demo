// Generates fake receipt images for testing. No real data is used.
//
//   npm run make-receipts
//
// It draws a receipt as SVG, then uses the `sharp` image library to save it
// as a PNG. It also saves a deliberately blurry copy, so we can see how the
// model behaves when a receipt is hard to read.

import sharp from "sharp";

const lines = [
  ["Grilled salmon", "28.00"],
  ["Caesar salad", "14.50"],
  ["Sparkling water x2", "9.00"],
  ["Espresso", "4.50"],
];
const subtotal = "56.00";
const tax = "4.62";
const tip = "10.00";
const total = "70.62";

const width = 480;
const rowHeight = 34;
const top = 250;

const itemRows = lines
  .map(
    ([name, price], i) => `
    <text x="40" y="${top + i * rowHeight}">${name}</text>
    <text x="440" y="${top + i * rowHeight}" text-anchor="end">${price}</text>`
  )
  .join("");

const afterItems = top + lines.length * rowHeight + 20;

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${afterItems + 260}">
  <rect width="100%" height="100%" fill="#fbfaf6"/>
  <g font-family="Courier New, monospace" font-size="22" fill="#222">
    <text x="240" y="70" text-anchor="middle" font-size="30" font-weight="bold">HARBOR LIGHT BISTRO</text>
    <text x="240" y="105" text-anchor="middle">412 Water Street, Portland ME</text>
    <text x="240" y="135" text-anchor="middle">Tel (207) 555-0148</text>
    <text x="40" y="190">Date: 2026-10-14   19:42</text>
    <text x="40" y="218">Server: Dana   Table: 12   Guests: 2</text>
    ${itemRows}
    <line x1="40" y1="${afterItems}" x2="440" y2="${afterItems}" stroke="#222" stroke-dasharray="6 4"/>
    <text x="40" y="${afterItems + 40}">Subtotal</text>
    <text x="440" y="${afterItems + 40}" text-anchor="end">${subtotal}</text>
    <text x="40" y="${afterItems + 74}">Tax 8.25%</text>
    <text x="440" y="${afterItems + 74}" text-anchor="end">${tax}</text>
    <text x="40" y="${afterItems + 108}">Tip</text>
    <text x="440" y="${afterItems + 108}" text-anchor="end">${tip}</text>
    <text x="40" y="${afterItems + 152}" font-weight="bold" font-size="26">TOTAL USD</text>
    <text x="440" y="${afterItems + 152}" text-anchor="end" font-weight="bold" font-size="26">${total}</text>
    <text x="40" y="${afterItems + 196}">VISA ****4417   APPROVED</text>
    <text x="240" y="${afterItems + 236}" text-anchor="middle">Thank you!</text>
  </g>
</svg>`;

const outDir = new URL("../data/receipts/", import.meta.url);

await sharp(Buffer.from(svg)).png().toFile(new URL("meal-clear.png", outDir).pathname);

// Blurry version: shrink, blur, and darken a little, like a bad phone photo.
await sharp(Buffer.from(svg))
  .resize({ width: 300 })
  .blur(2.2)
  .modulate({ brightness: 0.85 })
  .png()
  .toFile(new URL("meal-blurry.png", outDir).pathname);

console.log("Wrote data/receipts/meal-clear.png and data/receipts/meal-blurry.png");
