import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { drawCat } from '../desktop/cat.js';

const exec = promisify(execFile);

// Render the existing code-drawn pet, so the app icon follows the same artwork.
export async function createIcon(directory) {
  const size = 1024;
  const pixels = Buffer.alloc(size * size * 4);
  function paint(x, y, color) {
    const offset = (y * size + x) * 4;
    const alpha = (color[3] ?? 255) / 255;
    const previousAlpha = pixels[offset + 3] / 255;
    const resultAlpha = alpha + previousAlpha * (1 - alpha);
    for (let channel = 0; channel < 3; channel++) {
      pixels[offset + channel] = Math.round((color[channel] * alpha + pixels[offset + channel] * previousAlpha * (1 - alpha)) / resultAlpha);
    }
    pixels[offset + 3] = Math.round(resultAlpha * 255);
  }
  // An inset rounded tile leaves macOS's standard transparent icon margins.
  for (let y = 80; y < 944; y++) {
    for (let x = 80; x < 944; x++) {
      const dx = Math.max(260 - x, 0, x - 763);
      const dy = Math.max(260 - y, 0, y - 763);
      if (dx * dx + dy * dy <= 180 * 180) paint(x, y, [69, 155, 143]);
    }
  }
  const context = {
    fillStyle: '#000000',
    clearRect() {},
    fillRect(x, y, width, height) {
      const color = this.fillStyle.slice(1).match(/../g).map(value => Number.parseInt(value, 16));
      for (let row = 128 + y * 32; row < 128 + (y + height) * 32; row++) {
        for (let col = 128 + x * 32; col < 128 + (x + width) * 32; col++) paint(col, row, color);
      }
    },
  };
  drawCat(context, 0);

  function chunk(type, data) {
    const contents = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(contents));
    return Buffer.concat([length, contents, checksum]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6; // RGBA
  const scanlines = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) pixels.copy(scanlines, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0)),
  ]);
  const iconset = path.join(directory, 'BytePet.iconset');
  await mkdir(iconset, { recursive: true });
  const source = path.join(directory, 'BytePet.png');
  await writeFile(source, png);
  for (const points of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const target = path.join(iconset, `icon_${points}x${points}${scale === 2 ? '@2x' : ''}.png`);
      await exec('/usr/bin/sips', ['--resampleHeightWidth', String(points * scale), String(points * scale), source, '--out', target]);
    }
  }
  const icon = path.join(directory, 'BytePet.icns');
  await exec('/usr/bin/iconutil', ['--convert', 'icns', iconset, '--output', icon]);
  return icon;
}
