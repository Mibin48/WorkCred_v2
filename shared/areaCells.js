/**
 * shared/areaCells.js – Pure geographic cell grid and room resolution.
 *
 * Divides coordinate space into 0.05-degree square cells (~5.5 km).
 * Used for coarse first-pass socket room targeting without database lookups.
 *
 * Room naming:
 *   w:<cellX>:<cellY>  – worker cell
 *   c:<cellX>:<cellY>  – customer cell
 *   user:<userId>      – personal direct room
 */

export const CELL_SIZE = 0.05;

/**
 * Computes integer grid cell coordinates for a given (lng, lat).
 * Uses Math.floor to handle negative coordinates and zero boundary consistently.
 *
 * @param {number} lng
 * @param {number} lat
 * @returns {{ cellX: number, cellY: number }}
 */
export function cellFor(lng, lat) {
  const numLng = Number(lng);
  const numLat = Number(lat);

  if (Number.isNaN(numLng) || Number.isNaN(numLat)) {
    throw new Error(`Invalid coordinates for cellFor: lng=${lng}, lat=${lat}`);
  }

  // Multiply by 20 (1 / 0.05) to minimize floating point rounding issues
  const cellX = Math.floor(Math.round(numLng * 1e6) / (CELL_SIZE * 1e6));
  const cellY = Math.floor(Math.round(numLat * 1e6) / (CELL_SIZE * 1e6));

  return { cellX, cellY };
}

/**
 * Computes ring size (number of concentric cell rings) from radius in km.
 * Rule: ceil(radiusKm / 5.5), minimum 1.
 *
 * @param {number} radiusKm
 * @returns {number}
 */
export function ringSizeFromRadius(radiusKm) {
  const r = Number(radiusKm);
  if (Number.isNaN(r) || r <= 0) return 1;
  return Math.max(1, Math.ceil(r / 5.5));
}

/**
 * Returns all grid cells within Chebyshev distance `rings` of (cellX, cellY).
 * For rings=1, returns a 3x3 square (9 cells) with (cellX, cellY) at the center.
 * For rings=2, returns a 5x5 square (25 cells).
 *
 * @param {number} cellX
 * @param {number} cellY
 * @param {number} rings
 * @returns {Array<{ cellX: number, cellY: number }>}
 */
export function ringCells(cellX, cellY, rings = 1) {
  const cX = Math.round(Number(cellX));
  const cY = Math.round(Number(cellY));
  const r = Math.max(0, Math.round(Number(rings)));

  const cells = [];
  for (let dx = -r; dx <= r; dx++) {
    for (let dy = -r; dy <= r; dy++) {
      cells.push({ cellX: cX + dx, cellY: cY + dy });
    }
  }
  return cells;
}

/**
 * Formats a room name for a cell.
 *
 * @param {'w' | 'c'} type 'w' for worker, 'c' for customer
 * @param {number} cellX
 * @param {number} cellY
 * @returns {string} e.g. "w:1527:199"
 */
export function roomName(type, cellX, cellY) {
  if (type !== 'w' && type !== 'c') {
    throw new Error(`Invalid room type: ${type}. Expected 'w' or 'c'.`);
  }
  return `${type}:${cellX}:${cellY}`;
}

/**
 * Formats a personal user room name.
 *
 * @param {string} userId
 * @returns {string} e.g. "user:60d5ec49f1b2c8a1e8a8b123"
 */
export function userRoomName(userId) {
  return `user:${userId}`;
}
