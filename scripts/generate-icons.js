/**
 * Generate Sidekick extension icons as PNG files.
 * Modern rounded square with a clean bold "S".
 */
import { writeFileSync } from 'fs';

function createPNG(size) {
  const pixels = new Uint8Array(size * size * 4);

  const pad = 0.06;
  const radius = 0.22;

  const c1 = { r: 79, g: 70, b: 229 };
  const c2 = { r: 56, g: 139, b: 253 };

  function lerp(a, b, t) { return a + (b - a) * t; }

  function inRoundedRect(nx, ny) {
    const x0 = pad, y0 = pad, x1 = 1 - pad, y1 = 1 - pad;
    if (nx < x0 || nx > x1 || ny < y0 || ny > y1) return false;
    const cr = radius;
    if (nx < x0 + cr && ny < y0 + cr) {
      return (nx - x0 - cr) ** 2 + (ny - y0 - cr) ** 2 <= cr * cr;
    }
    if (nx > x1 - cr && ny < y0 + cr) {
      return (nx - x1 + cr) ** 2 + (ny - y0 - cr) ** 2 <= cr * cr;
    }
    if (nx < x0 + cr && ny > y1 - cr) {
      return (nx - x0 - cr) ** 2 + (ny - y1 + cr) ** 2 <= cr * cr;
    }
    if (nx > x1 - cr && ny > y1 - cr) {
      return (nx - x1 + cr) ** 2 + (ny - y1 + cr) ** 2 <= cr * cr;
    }
    return true;
  }

  // Sample a cubic bezier at parameter t
  function bezierPoint(p0, p1, p2, p3, t) {
    const u = 1 - t;
    return {
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    };
  }

  // Approximate minimum distance from point to cubic bezier
  function distToBezier(px, py, p0, p1, p2, p3, samples) {
    let minDist = Infinity;
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const pt = bezierPoint(p0, p1, p2, p3, t);
      const d = Math.hypot(px - pt.x, py - pt.y);
      if (d < minDist) minDist = d;
    }
    return minDist;
  }

  // Define the S as two bezier curves
  // Top half of S: starts at right, curves up-left, ends at center-right going left
  const s1 = [
    { x: 0.63, y: 0.30 },  // start: top right
    { x: 0.63, y: 0.18 },  // control: pulls up
    { x: 0.30, y: 0.18 },  // control: pulls left
    { x: 0.30, y: 0.35 },  // end: center left
  ];

  // Middle connector
  const s2 = [
    { x: 0.30, y: 0.35 },  // start
    { x: 0.30, y: 0.46 },  // control
    { x: 0.70, y: 0.54 },  // control
    { x: 0.70, y: 0.65 },  // end
  ];

  // Bottom half of S: from center-left going right, curves down-right
  const s3 = [
    { x: 0.70, y: 0.65 },  // start: center right
    { x: 0.70, y: 0.82 },  // control: pulls down
    { x: 0.37, y: 0.82 },  // control: pulls right
    { x: 0.37, y: 0.70 },  // end: bottom left
  ];

  const strokeWidth = 0.075;
  const sampleCount = 60;

  // Pre-compute S distances for each pixel
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const nx = (x + 0.5) / size;
      const ny = (y + 0.5) / size;

      if (!inRoundedRect(nx, ny)) {
        pixels[i] = pixels[i + 1] = pixels[i + 2] = pixels[i + 3] = 0;
        continue;
      }

      // Gradient
      const t = Math.min(1, Math.max(0, (nx + ny - 0.12) / 1.76));
      let r = lerp(c1.r, c2.r, t);
      let g = lerp(c1.g, c2.g, t);
      let b = lerp(c1.b, c2.b, t);

      // Top highlight
      const normY = (ny - pad) / (1 - 2 * pad);
      if (normY < 0.2) {
        const hl = (0.2 - normY) / 0.2 * 0.08;
        r = Math.min(255, r + hl * 255);
        g = Math.min(255, g + hl * 255);
        b = Math.min(255, b + hl * 255);
      }

      // Distance to S
      const d1 = distToBezier(nx, ny, s1[0], s1[1], s1[2], s1[3], sampleCount);
      const d2 = distToBezier(nx, ny, s2[0], s2[1], s2[2], s2[3], sampleCount);
      const d3 = distToBezier(nx, ny, s3[0], s3[1], s3[2], s3[3], sampleCount);
      const sDist = Math.min(d1, d2, d3);

      if (sDist < strokeWidth) {
        const edge = strokeWidth - sDist;
        const aa = Math.min(1, edge * size * 0.7);
        r = lerp(r, 255, aa);
        g = lerp(g, 255, aa);
        b = lerp(b, 255, aa);
      }

      pixels[i] = Math.round(r);
      pixels[i + 1] = Math.round(g);
      pixels[i + 2] = Math.round(b);
      pixels[i + 3] = 255;
    }
  }

  return encodePNG(size, size, pixels);
}

function encodePNG(width, height, pixels) {
  function crc32(buf) {
    let crc = -1;
    for (let i = 0; i < buf.length; i++) {
      crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
    }
    return (crc ^ -1) >>> 0;
  }

  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c;
  }

  function adler32(buf) {
    let a = 1, b = 0;
    for (let i = 0; i < buf.length; i++) {
      a = (a + buf[i]) % 65521;
      b = (b + a) % 65521;
    }
    return ((b << 16) | a) >>> 0;
  }

  const rawData = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width * 4)] = 0;
    rawData.set(pixels.slice(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1);
  }

  const blocks = [];
  const BLOCK_SIZE = 65535;
  for (let i = 0; i < rawData.length; i += BLOCK_SIZE) {
    const end = Math.min(i + BLOCK_SIZE, rawData.length);
    const isLast = end === rawData.length;
    const block = rawData.slice(i, end);
    const header = new Uint8Array(5);
    header[0] = isLast ? 1 : 0;
    header[1] = block.length & 0xff;
    header[2] = (block.length >> 8) & 0xff;
    header[3] = ~block.length & 0xff;
    header[4] = (~block.length >> 8) & 0xff;
    blocks.push(header, block);
  }

  const adler = adler32(rawData);
  const deflated = new Uint8Array(2 + blocks.reduce((s, b) => s + b.length, 0) + 4);
  deflated[0] = 0x78;
  deflated[1] = 0x01;
  let offset = 2;
  for (const b of blocks) {
    deflated.set(b, offset);
    offset += b.length;
  }
  deflated[offset] = (adler >> 24) & 0xff;
  deflated[offset + 1] = (adler >> 16) & 0xff;
  deflated[offset + 2] = (adler >> 8) & 0xff;
  deflated[offset + 3] = adler & 0xff;

  function makeChunk(type, data) {
    const chunk = new Uint8Array(4 + type.length + data.length + 4);
    const len = data.length;
    chunk[0] = (len >> 24) & 0xff;
    chunk[1] = (len >> 16) & 0xff;
    chunk[2] = (len >> 8) & 0xff;
    chunk[3] = len & 0xff;
    for (let i = 0; i < type.length; i++) chunk[4 + i] = type.charCodeAt(i);
    chunk.set(data, 4 + type.length);
    const crc = crc32(chunk.slice(4, 4 + type.length + data.length));
    const end = 4 + type.length + data.length;
    chunk[end] = (crc >> 24) & 0xff;
    chunk[end + 1] = (crc >> 16) & 0xff;
    chunk[end + 2] = (crc >> 8) & 0xff;
    chunk[end + 3] = crc & 0xff;
    return chunk;
  }

  const ihdr = new Uint8Array(13);
  ihdr[0] = (width >> 24) & 0xff;
  ihdr[1] = (width >> 16) & 0xff;
  ihdr[2] = (width >> 8) & 0xff;
  ihdr[3] = width & 0xff;
  ihdr[4] = (height >> 24) & 0xff;
  ihdr[5] = (height >> 16) & 0xff;
  ihdr[6] = (height >> 8) & 0xff;
  ihdr[7] = height & 0xff;
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', deflated);
  const iendChunk = makeChunk('IEND', new Uint8Array(0));

  const png = new Uint8Array(signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length);
  let pos = 0;
  png.set(signature, pos); pos += signature.length;
  png.set(ihdrChunk, pos); pos += ihdrChunk.length;
  png.set(idatChunk, pos); pos += idatChunk.length;
  png.set(iendChunk, pos);

  return Buffer.from(png);
}

const sizes = [16, 48, 128];
for (const size of sizes) {
  const png = createPNG(size);
  const path = `public/icons/icon${size}.png`;
  writeFileSync(path, png);
  console.log(`Generated ${path} (${png.length} bytes)`);
}
