import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { calculateTargetDimensions } from '../../frontend/app/js/utils/imageMath.js';

describe('Image resizing math (calculateTargetDimensions)', () => {
  test('never upscales images smaller than maxDimension', () => {
    const smallSquare = calculateTargetDimensions(400, 400, 1280);
    assert.deepEqual(smallSquare, { width: 400, height: 400 });

    const smallLandscape = calculateTargetDimensions(800, 600, 1280);
    assert.deepEqual(smallLandscape, { width: 800, height: 600 });

    const smallPortrait = calculateTargetDimensions(600, 900, 1280);
    assert.deepEqual(smallPortrait, { width: 600, height: 900 });
  });

  test('keeps image unchanged if longest side exactly matches maxDimension', () => {
    const exactMatch = calculateTargetDimensions(1280, 720, 1280);
    assert.deepEqual(exactMatch, { width: 1280, height: 720 });
  });

  test('scales down wide landscape image keeping aspect ratio', () => {
    // 2560 x 1440 (16:9) -> width 1280, height 720
    const res = calculateTargetDimensions(2560, 1440, 1280);
    assert.deepEqual(res, { width: 1280, height: 720 });
  });

  test('scales down tall portrait image keeping aspect ratio', () => {
    // 1080 x 1920 (9:16) -> height 1280, width 720
    const res = calculateTargetDimensions(1080, 1920, 1280);
    assert.deepEqual(res, { width: 720, height: 1280 });
  });

  test('scales down large square image to maxDimension square', () => {
    const res = calculateTargetDimensions(3000, 3000, 1280);
    assert.deepEqual(res, { width: 1280, height: 1280 });
  });

  test('throws on negative or zero dimensions', () => {
    assert.throws(() => calculateTargetDimensions(0, 500), /positive numbers/);
    assert.throws(() => calculateTargetDimensions(-10, 500), /positive numbers/);
  });
});
