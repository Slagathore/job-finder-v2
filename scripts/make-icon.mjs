// Generates build/icon.png (256x256 RGBA) and build/icon.ico — a magnifier on a
// blue rounded square. Pure Node (zlib for PNG IDAT); no image deps.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const S = 256;
const lerp = (a, b, t) => a + (b - a) * t;

function cornerOutside(x, y, m, r) {
  const corners = [[m + r, m + r], [S - m - r, m + r], [m + r, S - m - r], [S - m - r, S - m - r]];
  for (const [cx, cy] of corners) {
    const inCornerBox = (cx < S / 2 ? x < cx : x > cx) && (cy < S / 2 ? y < cy : y > cy);
    if (inCornerBox && Math.hypot(x - cx, y - cy) > r) return true;
  }
  return false;
}
function insideRoundRect(x, y, m = 8, r = 46) {
  if (x < m || x >= S - m || y < m || y >= S - m) return false;
  return !cornerOutside(x, y, m, r);
}
function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// ── Build RGBA pixels ────────────────────────────────────────────────
const px = Buffer.alloc(S * S * 4);
const cx = 104, cy = 104, ring = 58, ringW = 9;       // magnifier lens
const h1 = [148, 148], h2 = [208, 208], handleW = 13; // handle
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    if (!insideRoundRect(x, y)) { px[i + 3] = 0; continue; }
    const t = y / (S - 1);
    let r = lerp(91, 58, t), g = lerp(140, 111, t), b = lerp(255, 224, t); // #5b8cff→#3a6fe0
    const onRing = Math.abs(Math.hypot(x - cx, y - cy) - ring) <= ringW;
    const onHandle = distToSeg(x, y, h1[0], h1[1], h2[0], h2[1]) <= handleW;
    if (onRing || onHandle) { r = g = b = 255; }
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
  }
}

// ── Encode PNG ───────────────────────────────────────────────────────
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xFFFFFFFF; for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
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
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
]);

// ── Wrap PNG into an ICO (single 256px entry) ────────────────────────
const ico = Buffer.alloc(22 + png.length);
ico.writeUInt16LE(0, 0); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4);    // header
ico[6] = 0; ico[7] = 0; ico[8] = 0; ico[9] = 0;                              // 256x256, 0 colors
ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12);                          // planes, bpp
ico.writeUInt32LE(png.length, 14); ico.writeUInt32LE(22, 18);                // size, offset
png.copy(ico, 22);

mkdirSync('build', { recursive: true });
writeFileSync('build/icon.png', png);
writeFileSync('build/icon.ico', ico);
console.log(`Wrote build/icon.png (${png.length} B) + build/icon.ico (${ico.length} B)`);
