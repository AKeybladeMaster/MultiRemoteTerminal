import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const size = 256;
const pixels = Buffer.alloc(size * size * 4);
const colors = {
  background: [20, 34, 49],
  border: [105, 177, 213],
  panel: [27, 50, 69],
  header: [36, 66, 87],
  cyan: [98, 205, 230],
  amber: [232, 181, 103],
  red: [216, 127, 113],
  green: [120, 192, 148],
  white: [232, 241, 245],
  muted: [104, 143, 164]
};

function pixel(x, y, color) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const offset = (y * size + x) * 4;
  pixels[offset] = color[2];
  pixels[offset + 1] = color[1];
  pixels[offset + 2] = color[0];
  pixels[offset + 3] = 255;
}

function roundedRectangle(x, y, width, height, radius, color) {
  for (let currentY = y; currentY < y + height; currentY++) {
    for (let currentX = x; currentX < x + width; currentX++) {
      const centerX = currentX < x + radius ? x + radius : currentX >= x + width - radius ? x + width - radius - 1 : currentX;
      const centerY = currentY < y + radius ? y + radius : currentY >= y + height - radius ? y + height - radius - 1 : currentY;
      const dx = currentX - centerX;
      const dy = currentY - centerY;
      if (dx * dx + dy * dy <= radius * radius) pixel(currentX, currentY, color);
    }
  }
}

function circle(centerX, centerY, radius, color) {
  for (let y = centerY - radius; y <= centerY + radius; y++) {
    for (let x = centerX - radius; x <= centerX + radius; x++) {
      const dx = x - centerX;
      const dy = y - centerY;
      if (dx * dx + dy * dy <= radius * radius) pixel(x, y, color);
    }
  }
}

function line(startX, startY, endX, endY, thickness, color) {
  const dx = endX - startX;
  const dy = endY - startY;
  const lengthSquared = dx * dx + dy * dy;
  const radius = thickness / 2;
  for (let y = Math.floor(Math.min(startY, endY) - radius); y <= Math.ceil(Math.max(startY, endY) + radius); y++) {
    for (let x = Math.floor(Math.min(startX, endX) - radius); x <= Math.ceil(Math.max(startX, endX) + radius); x++) {
      const projection = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((x - startX) * dx + (y - startY) * dy) / lengthSquared));
      const nearestX = startX + projection * dx;
      const nearestY = startY + projection * dy;
      const offsetX = x - nearestX;
      const offsetY = y - nearestY;
      if (offsetX * offsetX + offsetY * offsetY <= radius * radius) pixel(x, y, color);
    }
  }
}

roundedRectangle(0, 0, size, size, 0, colors.background);
roundedRectangle(24, 28, 208, 200, 24, colors.border);
roundedRectangle(33, 37, 190, 182, 17, colors.panel);
roundedRectangle(34, 38, 188, 48, 15, colors.header);
roundedRectangle(34, 69, 188, 18, 5, colors.header);
circle(56, 61, 7, colors.red);
circle(78, 61, 7, colors.amber);
circle(100, 61, 7, colors.green);
line(79, 123, 118, 151, 15, colors.cyan);
line(118, 151, 79, 179, 15, colors.cyan);
line(145, 180, 184, 180, 14, colors.amber);
line(80, 199, 133, 199, 6, colors.muted);
line(80, 214, 158, 214, 6, colors.muted);

const rowBytes = Math.ceil(size / 32) * 4;
const mask = Buffer.alloc(rowBytes * size);
const bitmapInfo = Buffer.alloc(40);
bitmapInfo.writeUInt32LE(40, 0);
bitmapInfo.writeInt32LE(size, 4);
bitmapInfo.writeInt32LE(size * 2, 8);
bitmapInfo.writeUInt16LE(1, 12);
bitmapInfo.writeUInt16LE(32, 14);
bitmapInfo.writeUInt32LE(0, 16);
bitmapInfo.writeUInt32LE(pixels.length, 20);
const bottomUpPixels = Buffer.alloc(pixels.length);
for (let row = 0; row < size; row++) {
  pixels.copy(bottomUpPixels, row * size * 4, (size - row - 1) * size * 4, (size - row) * size * 4);
}

const directory = Buffer.alloc(22);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(1, 4);
directory.writeUInt16LE(1, 10);
directory.writeUInt16LE(32, 12);
directory.writeUInt32LE(bitmapInfo.length + bottomUpPixels.length + mask.length, 14);
directory.writeUInt32LE(directory.length, 18);
const iconPath = resolve(dirname(fileURLToPath(import.meta.url)), '../apps/desktop/resources/multiremote-terminal.ico');
await mkdir(dirname(iconPath), { recursive: true });
await writeFile(iconPath, Buffer.concat([directory, bitmapInfo, bottomUpPixels, mask]));
