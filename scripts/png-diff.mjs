#!/usr/bin/env node
// Compare two screenshots pixel by pixel (8-bit RGB/RGBA PNGs, as Chrome saves them; no npm
// dependencies). Prints JSON: how many pixels differ by more than `--threshold` on any channel, their
// share, the box they fall in, and the largest difference. `--out diff.png` writes them in red over a
// dimmed copy of the first. Exit code 1 when any pixel differs.
//
//   node scripts/png-diff.mjs before.png after.png [--threshold 24] [--out diff.png]
//
// Traffic, rain and anything animated differ between two runs: judge by where the box is.
import { readFileSync, writeFileSync } from 'node:fs';
import { crc32, deflateSync, inflateSync } from 'node:zlib';

const [a, b] = process.argv.slice(2).filter((x, i, all) => !x.startsWith('--') && !all[i - 1]?.startsWith('--'));
const opt = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
if (!a || !b) {
  console.error('usage: node scripts/png-diff.mjs a.png b.png [--threshold 24] [--out diff.png]');
  process.exit(2);
}

/** Decode a non-interlaced 8-bit RGB or RGBA PNG to RGBA. */
function decode(file) {
  const buf = readFileSync(file);
  let pos = 8;
  let width = 0, height = 0, type = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const name = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (name === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      type = data[9];
      if (data[8] !== 8 || (type !== 2 && type !== 6) || data[12] !== 0) throw new Error(`${file}: only 8-bit, non-interlaced RGB/RGBA`);
    } else if (name === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const bpp = type === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? px[y * stride + x - bpp] : 0;
      const up = y ? px[(y - 1) * stride + x] : 0;
      const ul = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += left;
      else if (f === 2) v += up;
      else if (f === 3) v += (left + up) >> 1;
      else if (f === 4) {
        const p = left + up - ul;
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - ul);
        v += pa <= pb && pa <= pc ? left : pb <= pc ? up : ul;
      }
      px[y * stride + x] = v & 255;
    }
  }
  const rgba = Buffer.alloc(width * height * 4, 255);
  for (let i = 0; i < width * height; i++) for (let c = 0; c < bpp; c++) rgba[i * 4 + c] = px[i * bpp + c];
  return { width, height, rgba };
}

/** Encode RGBA as a PNG (no filtering). */
function encode(width, height, rgba) {
  const chunk = (name, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(name, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const A = decode(a);
const B = decode(b);
if (A.width !== B.width || A.height !== B.height) {
  console.log(JSON.stringify({ error: `sizes differ: ${A.width}×${A.height} vs ${B.width}×${B.height}` }));
  process.exit(1);
}
const threshold = Number(opt('threshold', 24));
const out = opt('out');
const diff = out ? Buffer.alloc(A.rgba.length) : null;
let differing = 0, maxDelta = 0;
let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
for (let i = 0; i < A.width * A.height; i++) {
  let d = 0;
  for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(A.rgba[i * 4 + c] - B.rgba[i * 4 + c]));
  maxDelta = Math.max(maxDelta, d);
  const hit = d > threshold;
  if (hit) {
    differing++;
    const x = i % A.width, y = Math.floor(i / A.width);
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  if (diff) {
    const grey = (A.rgba[i * 4] + A.rgba[i * 4 + 1] + A.rgba[i * 4 + 2]) / 12;
    diff[i * 4] = hit ? 255 : grey;
    diff[i * 4 + 1] = hit ? 0 : grey;
    diff[i * 4 + 2] = hit ? 0 : grey;
    diff[i * 4 + 3] = 255;
  }
}
if (diff) writeFileSync(out, encode(A.width, A.height, diff));
console.log(JSON.stringify({
  size: `${A.width}×${A.height}`,
  differing,
  share: +(differing / (A.width * A.height)).toFixed(5),
  box: differing ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null,
  maxDelta,
  ...(out ? { out } : {}),
}));
process.exit(differing ? 1 : 0);
