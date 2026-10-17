import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  cellFor,
  ringSizeFromRadius,
  ringCells,
  roomName,
  userRoomName,
  CELL_SIZE
} from '../../../../shared/areaCells.js';

describe('shared/areaCells.js unit tests', () => {
  describe('cellFor', () => {
    it('calculates grid coordinates for positive coordinates', () => {
      const { cellX, cellY } = cellFor(76.35, 9.98);
      // 76.35 / 0.05 = 1527, 9.98 / 0.05 = 199.6 -> floor is 199
      assert.equal(cellX, 1527);
      assert.equal(cellY, 199);
    });

    it('handles negative coordinates cleanly with floor', () => {
      const c1 = cellFor(-0.01, -0.01);
      assert.equal(c1.cellX, -1);
      assert.equal(c1.cellY, -1);

      const c2 = cellFor(-0.05, -0.05);
      assert.equal(c2.cellX, -1);
      assert.equal(c2.cellY, -1);

      const c3 = cellFor(-0.051, -0.051);
      assert.equal(c3.cellX, -2);
      assert.equal(c3.cellY, -2);
    });

    it('handles exact zero and cell boundaries', () => {
      const cZero = cellFor(0, 0);
      assert.equal(cZero.cellX, 0);
      assert.equal(cZero.cellY, 0);

      const cEdge = cellFor(0.05, 0.05);
      assert.equal(cEdge.cellX, 1);
      assert.equal(cEdge.cellY, 1);

      const cJustBefore = cellFor(0.049999, 0.049999);
      assert.equal(cJustBefore.cellX, 0);
      assert.equal(cJustBefore.cellY, 0);
    });

    it('throws on non-numeric inputs', () => {
      assert.throws(() => cellFor('invalid', 10), /Invalid coordinates/);
    });
  });

  describe('ringSizeFromRadius', () => {
    it('returns minimum 1 for small or zero radius', () => {
      assert.equal(ringSizeFromRadius(0), 1);
      assert.equal(ringSizeFromRadius(1), 1);
      assert.equal(ringSizeFromRadius(3), 1);
      assert.equal(ringSizeFromRadius(5.5), 1);
    });

    it('increases to 2 for radius greater than 5.5 km', () => {
      assert.equal(ringSizeFromRadius(5.6), 2);
      assert.equal(ringSizeFromRadius(8), 2);
      assert.equal(ringSizeFromRadius(10), 2);
      assert.equal(ringSizeFromRadius(11), 2);
    });

    it('increases for larger radii', () => {
      assert.equal(ringSizeFromRadius(12), 3);
    });
  });

  describe('ringCells', () => {
    it('returns 9 cells for rings=1 centered at (cellX, cellY)', () => {
      const cells = ringCells(10, 20, 1);
      assert.equal(cells.length, 9);
      const keys = new Set(cells.map((c) => `${c.cellX}:${c.cellY}`));
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          assert.ok(keys.has(`${10 + dx}:${20 + dy}`));
        }
      }
    });

    it('returns 25 cells for rings=2', () => {
      const cells = ringCells(10, 20, 2);
      assert.equal(cells.length, 25);
    });

    it('returns 1 cell for rings=0', () => {
      const cells = ringCells(10, 20, 0);
      assert.equal(cells.length, 1);
      assert.deepEqual(cells[0], { cellX: 10, cellY: 20 });
    });
  });

  describe('roomName and userRoomName', () => {
    it('formats worker and customer room names correctly', () => {
      assert.equal(roomName('w', 1527, 199), 'w:1527:199');
      assert.equal(roomName('c', 1527, 199), 'c:1527:199');
      assert.throws(() => roomName('x', 1, 1), /Invalid room type/);
    });

    it('formats user personal room name', () => {
      assert.equal(userRoomName('user123'), 'user:user123');
    });
  });
});
