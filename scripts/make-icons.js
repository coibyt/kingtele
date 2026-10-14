'use strict';
/**
 * Tạo biểu tượng ứng dụng (PNG) không cần thư viện ngoài: nền gradient + máy bay giấy trắng.
 * Chạy: node scripts/make-icons.js  ->  public/assets/icons/*.png
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const out = path.join(__dirname, '..', 'public', 'assets', 'icons');
fs.mkdirSync(out, { recursive: true });

// ---- PNG encoder tối giản (RGBA 8-bit) ----
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---- hình vẽ ----
const C1 = [0x2a, 0xab, 0xee], C2 = [0x63, 0x66, 0xf1];
const PLANE = [[22, 2], [15, 22], [11, 13], [2, 9]];  // máy bay giấy (lưới 24x24, giống biểu tượng "send")
const FOLD = [[22, 2], [11, 13]];                      // nếp gấp

const inPoly = (x, y, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const distSeg = (px, py, [ax, ay], [bx, by]) => {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};
const lerp = (a, b, t) => a + (b - a) * t;

/** opts: size, radius (0..0.5, 0 = vuông), glyph (tỉ lệ máy bay so với khung) */
function render({ size, radius, glyph }) {
  const SS = 3, buf = Buffer.alloc(size * size * 4);
  const k = glyph / 20; // 20 = chiều lớn nhất của máy bay trên lưới 24
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let cover = 0, plane = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (px + (sx + 0.5) / SS) / size, v = (py + (sy + 0.5) / SS) / size;
          let inside = true;
          if (radius > 0) {
            const qx = Math.abs(u - 0.5) - (0.5 - radius), qy = Math.abs(v - 0.5) - (0.5 - radius);
            inside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) <= radius;
          }
          if (!inside) continue;
          cover++;
          const gx = (u - 0.5) / k + 12, gy = (v - 0.5) / k + 12;
          if (inPoly(gx, gy, PLANE) && distSeg(gx, gy, FOLD[0], FOLD[1]) > 0.55) plane++;
        }
      }
      const n = SS * SS, i = (py * size + px) * 4;
      const t = (px + py) / (2 * size);
      const bg = [lerp(C1[0], C2[0], t), lerp(C1[1], C2[1], t), lerp(C1[2], C2[2], t)];
      const pc = cover ? plane / cover : 0;
      buf[i] = Math.round(lerp(bg[0], 255, pc)); buf[i + 1] = Math.round(lerp(bg[1], 255, pc)); buf[i + 2] = Math.round(lerp(bg[2], 255, pc));
      buf[i + 3] = Math.round((cover / n) * 255);
    }
  }
  return encodePng(size, size, buf);
}

const files = {
  'icon-192.png': { size: 192, radius: 0.22, glyph: 0.52 },
  'icon-512.png': { size: 512, radius: 0.22, glyph: 0.52 },
  'icon-maskable-512.png': { size: 512, radius: 0, glyph: 0.4 },  // toàn khung, chữ nằm trong vùng an toàn 80%
  'apple-touch-icon.png': { size: 180, radius: 0, glyph: 0.5 },    // iOS tự bo góc
};
for (const [name, opts] of Object.entries(files)) {
  fs.writeFileSync(path.join(out, name), render(opts));
  console.log('đã tạo', name);
}
