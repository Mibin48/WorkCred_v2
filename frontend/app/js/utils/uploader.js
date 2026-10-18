import { api } from '../api.js';
import { calculateTargetDimensions } from './imageMath.js';

export async function processAndUploadAvatar(file, onProgress) {
  if (!file) throw new Error('No file selected');

  // 1. Validate file type & size (max 20 MB)
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    throw new Error('Please choose a JPEG, PNG or WebP image.');
  }

  if (file.size > 20 * 1024 * 1024) {
    throw new Error('Image file must be under 20 MB.');
  }

  if (onProgress) onProgress('Processing image…');

  // 2. Decode with createImageBitmap to strip EXIF and handle orientation
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('Could not process image.');
  }

  const { width: targetWidth, height: targetHeight } = calculateTargetDimensions(
    bitmap.width,
    bitmap.height,
    1280
  );

  // 3. Draw to canvas
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  bitmap.close();

  // 4. Export as image/jpeg quality 0.85
  const blob = await new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', 0.85);
  });

  if (!blob || blob.size > 5 * 1024 * 1024) {
    throw new Error('Processed image exceeds 5 MB limit.');
  }

  // 5. Request server-signed upload URL
  if (onProgress) onProgress('Requesting upload signature…');
  let signData;
  try {
    signData = await api.post('/uploads/sign', { purpose: 'avatar' });
  } catch (err) {
    if (err.status === 503 || err.code === 'UPLOADS_DISABLED') {
      const customErr = new Error('Photo upload is not set up yet. You can add a photo later.');
      customErr.code = 'UPLOADS_DISABLED';
      throw customErr;
    }
    throw err;
  }

  const { uploadUrl, fields } = signData;

  // 6. Direct upload to Cloudinary via FormData
  if (onProgress) onProgress('Uploading image…');
  const formData = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    formData.append(k, v);
  }
  formData.append('file', blob, 'avatar.jpg');

  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    body: formData
  });

  if (!uploadRes.ok) {
    throw new Error('Failed to upload image to storage provider.');
  }

  const uploadResult = await uploadRes.json();
  const secureUrl = uploadResult.secure_url;

  if (!secureUrl || !secureUrl.startsWith('https://res.cloudinary.com/')) {
    throw new Error('Invalid upload response from storage provider.');
  }

  return secureUrl;
}
