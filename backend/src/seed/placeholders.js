import crypto from 'node:crypto';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Approved solid colours for sample post placeholder images (Decision L7).
 */
export const APPROVED_COLORS = [
  '#f3efe6',
  '#eee8df',
  '#e9e2d5',
  '#f0a27f',
  '#b8dac2',
  '#f0deb4'
];

/**
 * Parses a 6-character hex color string (#rrggbb) into [r, g, b].
 * @param {string} hex
 * @returns {[number, number, number]}
 */
export function hexToRgb(hex) {
  const clean = hex.replace('#', '').trim().toLowerCase();
  if (clean.length !== 6) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return [r, g, b];
}

/**
 * Computes CRC32 checksum for PNG chunk data.
 * @param {Buffer} buf
 * @returns {number}
 */
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      if ((crc & 1) !== 0) {
        crc = (crc >>> 1) ^ 0xedb88320;
      } else {
        crc >>>= 1;
      }
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Builds a PNG chunk buffer.
 * @param {string} type 4-character ASCII type
 * @param {Buffer} data
 * @returns {Buffer}
 */
function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32BE(data.length, 0);

  const crcPayload = Buffer.concat([typeBuf, data]);
  const crcVal = crc32(crcPayload);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crcVal, 0);

  return Buffer.concat([lengthBuf, typeBuf, data, crcBuf]);
}

/**
 * Generates a valid solid-colour PNG Buffer of given dimensions using node:zlib.
 * @param {string} hexColor One of APPROVED_COLORS
 * @param {number} width Default 400
 * @param {number} height Default 300
 * @returns {Buffer}
 */
export function generateSolidPng(hexColor, width = 400, height = 300) {
  const normalizedHex = hexColor.trim().toLowerCase();
  const isApproved = APPROVED_COLORS.some((c) => c.toLowerCase() === normalizedHex);
  if (!isApproved) {
    throw new Error(`Color ${hexColor} is not in approved sample colors list: ${APPROVED_COLORS.join(', ')}`);
  }

  const [r, g, b] = hexToRgb(normalizedHex);

  // PNG Signature: 137 80 78 71 13 10 26 10
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR chunk: width (4), height (4), bit depth (1), color type (1), compression (1), filter (1), interlace (1)
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8-bit depth
  ihdr[9] = 2; // Truecolor (RGB)
  ihdr[10] = 0; // Deflate
  ihdr[11] = 0; // Standard filter
  ihdr[12] = 0; // No interlace

  const ihdrChunk = makeChunk('IHDR', ihdr);

  // Raw image scanlines: each scanline starts with filter byte (0 = None), followed by RGB triplets
  const scanlineLength = 1 + width * 3;
  const rawData = Buffer.alloc(scanlineLength * height);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * scanlineLength;
    rawData[rowOffset] = 0; // Filter: None
    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 3;
      rawData[pxOffset] = r;
      rawData[pxOffset + 1] = g;
      rawData[pxOffset + 2] = b;
    }
  }

  // Compress with node:zlib
  const compressedData = zlib.deflateSync(rawData);
  const idatChunk = makeChunk('IDAT', compressedData);

  // IEND chunk
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

/**
 * Ensures frontend/assets/sample/ directory exists and writes work-1.png ... work-6.png.
 * @param {string} targetDir Target directory path (default: frontend/assets/sample)
 */
export function ensureSamplePlaceholderImages(targetDir) {
  const dir = targetDir || path.resolve('..', 'frontend', 'assets', 'sample');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const generatedFiles = [];
  for (let i = 0; i < APPROVED_COLORS.length; i++) {
    const filename = `work-${i + 1}.png`;
    const filePath = path.join(dir, filename);
    const color = APPROVED_COLORS[i];
    const pngBuf = generateSolidPng(color, 400, 300);
    fs.writeFileSync(filePath, pngBuf);
    generatedFiles.push({ filename, filePath, color, sizeBytes: pngBuf.length });
  }

  return generatedFiles;
}
