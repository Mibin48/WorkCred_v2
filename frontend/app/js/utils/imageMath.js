/**
 * Image dimension calculation utilities
 * Ensures downscaling preserves aspect ratio without upscaling.
 */

export function calculateTargetDimensions(width, height, maxDimension = 1280) {
  if (width <= 0 || height <= 0) {
    throw new Error('Image width and height must be positive numbers');
  }

  // Never upscale
  if (width <= maxDimension && height <= maxDimension) {
    return { width: Math.round(width), height: Math.round(height) };
  }

  if (width >= height) {
    const scale = maxDimension / width;
    return {
      width: maxDimension,
      height: Math.round(height * scale)
    };
  } else {
    const scale = maxDimension / height;
    return {
      width: Math.round(width * scale),
      height: maxDimension
    };
  }
}
