// Generates build/icon.png (1024x1024 RGBA) and build/icon.ico (256px) — a
// magnifier on a blue rounded square. Pure Node (zlib for PNG IDAT); no deps.
//
// PNG is 1024 because macOS packaging requires >= 512x512 (it derives the .icns
// from this). ICO stays 256, which is the format's maximum.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const lerp = (a, b, t) => a + (b - a) * t;

/** Render the icon at an arbitrary square size; all geometry scales from the
 *  original 256px design so the artwork is identical at every resolution. */
function renderPng(S) {
  const k = S / 256; // design-space scale factor
  const m = 8 * k, rad = 46 * k;
  const cx = 104 * k, cy = 104 * k, ring = 58 * k, ringW = 9 * k;
  const h1 = [148 * k, 148 * k], h2 = [208 * k, 208 * k], handleW = 13 * k;

  const cornerOutside = (x, y) => {
    const corners = [[m + rad, m + rad], [S - m - rad, m + rad], [m + rad, S - m - rad], [S - m - rad, S - m - rad]];
    for (const [ccx, ccy] of corners) {
      const inCornerBox = (ccx < S / 2 ? x < ccx : x > ccx) && (ccy < S / 2 ? y < ccy : y > ccy);
      if (inCornerBox && Math.hypot(x - ccx, y - ccy) > rad) return true;
    }
    return false;
  };
  const insideRoundRect = (x, y) => {
    if (x < m || x >= S - m || y < m || y >= S - m) return false;
    return !cornerOutside(x, y);
  };
  const distToSeg = (px_, py, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px_ - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px_ - (ax + t * dx), py - (ay + t * dy));
  };

  const px = Buffer.alloc(S * S * 4);
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
  return encodePng(px, S);
}

// ── PNG encoding ─────────────────────────────────────────────────────
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
function encodePng(px, S) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc(S * (S * 4 + 1));
  for (let y = 0; y < S; y++) {
    raw[y * (S * 4 + 1)] = 0;
    px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Emit ─────────────────────────────────────────────────────────────
const pngLarge = renderPng(1024);   // mac (>=512 required) + linux
const png256 = renderPng(256);      // ICO payload (256 is the ICO maximum)

const ico = Buffer.alloc(22 + png256.length);
ico.writeUInt16LE(0, 0); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4);   // header: icon, 1 image
ico[6] = 0; ico[7] = 0; ico[8] = 0; ico[9] = 0;                              // 0 => 256x256, 0 colors
ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12);                         // planes, bpp
ico.writeUInt32LE(png256.length, 14); ico.writeUInt32LE(22, 18);             // size, offset
png256.copy(ico, 22);

mkdirSync('build', { recursive: true });
writeFileSync('build/icon.png', pngLarge);
writeFileSync('build/icon.ico', ico);
console.log(`Wrote build/icon.png 1024px (${pngLarge.length} B) + build/icon.ico 256px (${ico.length} B)`);
