/**
 * Generate Sidekick extension icons as PNG files.
 * Browser window with side panel and pencil icon.
 */
import { writeFileSync } from 'fs';

function createPNG(size) {
  const pixels = new Uint8Array(size * size * 4);

  // Colors
  const frame = { r: 88, g: 101, b: 116 };
  const frameDark = { r: 72, g: 84, b: 98 };
  const white = { r: 255, g: 255, b: 255 };
  const titleBar = { r: 235, g: 238, b: 242 };
  const dot = { r: 180, g: 188, b: 198 };
  const blue = { r: 56, g: 139, b: 253 };
  const blueDark = { r: 40, g: 110, b: 220 };

  function setPixel(x, y, c) {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const i = (iy * size + ix) * 4;
    pixels[i] = c.r; pixels[i+1] = c.g; pixels[i+2] = c.b; pixels[i+3] = 255;
  }

  function fillRect(x0, y0, w, h, c) {
    for (let y = Math.floor(y0); y < Math.floor(y0 + h) && y < size; y++) {
      for (let x = Math.floor(x0); x < Math.floor(x0 + w) && x < size; x++) {
        if (x >= 0 && y >= 0) setPixel(x, y, c);
      }
    }
  }

  function inRoundedRect(px, py, x0, y0, w, h, r) {
    if (px < x0 || px >= x0 + w || py < y0 || py >= y0 + h) return false;
    if (px < x0 + r && py < y0 + r) return (px - x0 - r) ** 2 + (py - y0 - r) ** 2 <= r * r;
    if (px > x0 + w - r && py < y0 + r) return (px - x0 - w + r) ** 2 + (py - y0 - r) ** 2 <= r * r;
    if (px < x0 + r && py > y0 + h - r) return (px - x0 - r) ** 2 + (py - y0 - h + r) ** 2 <= r * r;
    if (px > x0 + w - r && py > y0 + h - r) return (px - x0 - w + r) ** 2 + (py - y0 - h + r) ** 2 <= r * r;
    return true;
  }

  function fillRoundedRect(x0, y0, w, h, r, c) {
    for (let y = Math.floor(y0); y < Math.ceil(y0 + h) && y < size; y++) {
      for (let x = Math.floor(x0); x < Math.ceil(x0 + w) && x < size; x++) {
        if (x >= 0 && y >= 0 && inRoundedRect(x, y, x0, y0, w, h, r)) {
          setPixel(x, y, c);
        }
      }
    }
  }

  function fillCircle(cx, cy, r, c) {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) {
          setPixel(x, y, c);
        }
      }
    }
  }

  function fillRotatedRect(cx, cy, w, h, angle, c) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const maxR = Math.max(w, h);
    for (let dy = -maxR; dy <= maxR; dy++) {
      for (let dx = -maxR; dx <= maxR; dx++) {
        const lx = dx * cos + dy * sin;
        const ly = -dx * sin + dy * cos;
        if (lx >= -w/2 && lx <= w/2 && ly >= -h/2 && ly <= h/2) {
          setPixel(Math.round(cx + dx), Math.round(cy + dy), c);
        }
      }
    }
  }

  const s = size;
  const pad = s * 0.08;
  const outerR = s * 0.18;

  // Outer frame
  const fx = pad, fy = pad, fw = s - 2*pad, fh = s - 2*pad;
  fillRoundedRect(fx, fy, fw, fh, outerR, frame);

  // Inner browser window
  const border = s * 0.06;
  const ix = fx + border, iy = fy + border;
  const iw = fw - 2*border, ih = fh - 2*border;
  const innerR = Math.max(1, outerR - border);
  fillRoundedRect(ix, iy, iw, ih, innerR, white);

  // Title bar
  const tbH = s * 0.10;
  fillRect(ix, iy, iw, tbH, titleBar);
  for (let y = Math.floor(iy); y < Math.floor(iy + innerR) && y < size; y++) {
    for (let x = Math.floor(ix); x < Math.ceil(ix + iw) && x < size; x++) {
      if (!inRoundedRect(x, y, ix, iy, iw, ih, innerR)) {
        if (inRoundedRect(x, y, fx, fy, fw, fh, outerR)) {
          setPixel(x, y, frame);
        }
      }
    }
  }

  // Three dots
  const dotR = Math.max(1, s * 0.018);
  const dotY = iy + tbH * 0.5;
  const dotStartX = ix + s * 0.06;
  const dotGap = s * 0.045;
  for (let d = 0; d < 3; d++) {
    fillCircle(dotStartX + d * dotGap, dotY, dotR, dot);
  }

  // Side panel (blue)
  const spW = s * 0.12;
  const spX = ix + iw - spW;
  const spY = iy + tbH;
  const spH = ih - tbH;
  fillRect(spX, spY, spW, spH, blue);

  // Side panel inner line
  const lineW = Math.max(1, s * 0.015);
  const lineX = spX + spW * 0.35;
  const linePad = s * 0.04;
  fillRoundedRect(lineX, spY + linePad, lineW, spH - 2*linePad, lineW/2, { r: 100, g: 175, b: 255 });

  // Clean bottom-right corner
  for (let y = Math.floor(iy + ih - innerR); y < Math.ceil(iy + ih); y++) {
    for (let x = Math.floor(spX); x < Math.ceil(ix + iw); x++) {
      if (!inRoundedRect(x, y, ix, iy, iw, ih, innerR)) {
        if (inRoundedRect(x, y, fx, fy, fw, fh, outerR)) {
          setPixel(x, y, frame);
        }
      }
    }
  }

  // Side panel left border
  fillRect(spX, spY, Math.max(1, s * 0.01), spH, blueDark);

  // Pencil icon
  const contentW = iw - spW;
  const contentCx = ix + contentW * 0.5;
  const contentCy = iy + tbH + (ih - tbH) * 0.5;
  const pencilLen = s * 0.22;
  const pencilW = s * 0.05;
  const angle = -Math.PI / 4;

  fillRotatedRect(contentCx, contentCy, pencilW, pencilLen, angle, blue);

  // Pencil tip
  const tipDist = pencilLen / 2 + s * 0.03;
  const tipX = contentCx + Math.sin(angle) * tipDist;
  const tipY = contentCy + Math.cos(angle) * tipDist;
  const tipR = s * 0.025;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  for (let dy = -tipR * 2; dy <= tipR * 2; dy++) {
    for (let dx = -tipR * 2; dx <= tipR * 2; dx++) {
      const lx = dx * cos + dy * sin;
      const ly = -dx * sin + dy * cos;
      if (ly >= 0 && ly <= tipR * 2 && Math.abs(lx) <= pencilW/2 * (1 - ly / (tipR * 2))) {
        setPixel(Math.round(tipX + dx), Math.round(tipY + dy), blueDark);
      }
    }
  }

  // Pencil cap
  const capDist = pencilLen / 2 + s * 0.015;
  const capX = contentCx - Math.sin(angle) * capDist;
  const capY = contentCy - Math.cos(angle) * capDist;
  fillRotatedRect(capX, capY, pencilW * 1.1, s * 0.03, angle, frameDark);

  // Transparent outside
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!inRoundedRect(x, y, fx, fy, fw, fh, outerR)) {
        const i = (y * size + x) * 4;
        pixels[i] = 0; pixels[i+1] = 0; pixels[i+2] = 0; pixels[i+3] = 0;
      }
    }
  }

  return encodePNG(size, size, pixels);
}

function encodePNG(width, height, pixels) {
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c;
  }

  function crc32(buf) {
    let crc = -1;
    for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
    return (crc ^ -1) >>> 0;
  }

  function adler32(buf) {
    let a = 1, b = 0;
    for (let i = 0; i < buf.length; i++) { a = (a + buf[i]) % 65521; b = (b + a) % 65521; }
    return ((b << 16) | a) >>> 0;
  }

  const rawData = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width * 4)] = 0;
    rawData.set(pixels.slice(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1);
  }

  const blocks = [];
  for (let i = 0; i < rawData.length; i += 65535) {
    const end = Math.min(i + 65535, rawData.length);
    const block = rawData.slice(i, end);
    const header = new Uint8Array(5);
    header[0] = end === rawData.length ? 1 : 0;
    header[1] = block.length & 0xff; header[2] = (block.length >> 8) & 0xff;
    header[3] = ~block.length & 0xff; header[4] = (~block.length >> 8) & 0xff;
    blocks.push(header, block);
  }

  const adler = adler32(rawData);
  const deflated = new Uint8Array(2 + blocks.reduce((s, b) => s + b.length, 0) + 4);
  deflated[0] = 0x78; deflated[1] = 0x01;
  let offset = 2;
  for (const b of blocks) { deflated.set(b, offset); offset += b.length; }
  deflated[offset] = (adler >> 24) & 0xff; deflated[offset+1] = (adler >> 16) & 0xff;
  deflated[offset+2] = (adler >> 8) & 0xff; deflated[offset+3] = adler & 0xff;

  function makeChunk(type, data) {
    const chunk = new Uint8Array(4 + type.length + data.length + 4);
    chunk[0] = (data.length >> 24) & 0xff; chunk[1] = (data.length >> 16) & 0xff;
    chunk[2] = (data.length >> 8) & 0xff; chunk[3] = data.length & 0xff;
    for (let i = 0; i < type.length; i++) chunk[4 + i] = type.charCodeAt(i);
    chunk.set(data, 4 + type.length);
    const crc = crc32(chunk.slice(4, 4 + type.length + data.length));
    const e = 4 + type.length + data.length;
    chunk[e] = (crc >> 24) & 0xff; chunk[e+1] = (crc >> 16) & 0xff;
    chunk[e+2] = (crc >> 8) & 0xff; chunk[e+3] = crc & 0xff;
    return chunk;
  }

  const hdr = new Uint8Array(13);
  hdr[0] = (width >> 24) & 0xff; hdr[1] = (width >> 16) & 0xff;
  hdr[2] = (width >> 8) & 0xff; hdr[3] = width & 0xff;
  hdr[4] = (height >> 24) & 0xff; hdr[5] = (height >> 16) & 0xff;
  hdr[6] = (height >> 8) & 0xff; hdr[7] = height & 0xff;
  hdr[8] = 8; hdr[9] = 6; hdr[10] = 0; hdr[11] = 0; hdr[12] = 0;

  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks = [sig, makeChunk('IHDR', hdr), makeChunk('IDAT', deflated), makeChunk('IEND', new Uint8Array(0))];
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const png = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) { png.set(c, pos); pos += c.length; }
  return Buffer.from(png);
}

const sizes = [16, 48, 128];
for (const size of sizes) {
  const png = createPNG(size);
  const path = `public/icons/icon${size}.png`;
  writeFileSync(path, png);
  console.log(`Generated ${path} (${png.length} bytes)`);
}
