// Generates extension/icon{128,48,16}.png — the same magnifier-on-blue mark as
// build/icon.png (scripts/make-icon.mjs), rendered at the sizes the Chrome Web
// Store requires. Pure Node (zlib for PNG IDAT); no image deps.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const lerp = (a, b, t) => a + (b - a) * t;

function renderPng(S) {
  const k = S / 256; // scale factor vs the reference 256px geometry
  const m = 8 * k, r = 46 * k;
  const cx = 104 * k, cy = 104 * k, ring = 58 * k, ringW = Math.max(1.5, 9 * k);
  const h1 = [148 * k, 148 * k], h2 = [208 * k, 208 * k], handleW = Math.max(2, 13 * k);

  function cornerOutside(x, y) {
    const corners = [[m + r, m + r], [S - m - r, m + r], [m + r, S - m - r], [S - m - r, S - m - r]];
    for (const [ccx, ccy] of corners) {
      const inCornerBox = (ccx < S / 2 ? x < ccx : x > ccx) && (ccy < S / 2 ? y < ccy : y > ccy);
      if (inCornerBox && Math.hypot(x - ccx, y - ccy) > r) return true;
    }
    return false;
  }
  const insideRoundRect = (x, y) => x >= m && x < S - m && y >= m && y < S - m && !cornerOutside(x, y);
  function distToSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  const px = Buffer.alloc(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      if (!insideRoundRect(x, y)) { px[i + 3] = 0; continue; }
      const t = y / (S - 1);
      let rr = lerp(91, 58, t), g = lerp(140, 111, t), b = lerp(255, 224, t); // #5b8cff→#3a6fe0
      const onRing = Math.abs(Math.hypot(x - cx, y - cy) - ring) <= ringW;
      const onHandle = distToSeg(x, y, h1[0], h1[1], h2[0], h2[1]) <= handleW;
      if (onRing || onHandle) { rr = g = b = 255; }
      px[i] = rr; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
    }
  }

  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k2 = 0; k2 < 8; k2++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  const crc32 = (buf) => { let c = 0xFFFFFFFF; for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const t = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, crc]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(S * (S * 4 + 1));
  for (let y = 0; y < S; y++) { raw[y * (S * 4 + 1)] = 0; px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4); }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [128, 48, 16]) {
  const png = renderPng(size);
  writeFileSync(`extension/icon${size}.png`, png);
  console.log(`Wrote extension/icon${size}.png (${png.length} B)`);
}
