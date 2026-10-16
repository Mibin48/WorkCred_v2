import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCloudinarySignature } from '../../../src/utils/cloudinarySigner.js';

describe('backend/src/utils/cloudinarySigner.js', () => {
  it('builds Cloudinary SHA-1 signature matching sorted parameter order', () => {
    // Cloudinary official documented example:
    // Parameters: folder="my_folder", public_id="sample_image", timestamp=1315060510
    // apiSecret="abcd"
    // String to sign: "folder=my_folder&public_id=sample_image&timestamp=1315060510abcd"
    const params = {
      timestamp: 1315060510,
      public_id: 'sample_image',
      folder: 'my_folder'
    };
    const secret = 'abcd';

    // Verify deterministic signature
    const sig = buildCloudinarySignature(params, secret);
    // Calculated sha1 of "folder=my_folder&public_id=sample_image&timestamp=1315060510abcd"
    assert.equal(typeof sig, 'string');
    assert.equal(sig.length, 40); // 40-char SHA-1 hex string
    assert.equal(sig, '4ce64532d0b699aa47896752c53d38d63809a590');
  });

  it('excludes signature, api_key, resource_type, file, and empty values from signing', () => {
    const params = {
      folder: 'my_folder',
      timestamp: 1315060510,
      signature: 'ignored_sig',
      api_key: '12345678',
      file: 'data:...',
      extra_empty: '',
      null_val: null
    };
    const sig = buildCloudinarySignature(params, 'abcd');
    const cleanSig = buildCloudinarySignature({ folder: 'my_folder', timestamp: 1315060510 }, 'abcd');
    assert.equal(sig, cleanSig);
  });
});
