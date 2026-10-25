// Compression stays on the device; no third-party image service receives photos.
export async function compressImage(file, folder = 'photos') {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Use JPEG, PNG, or WebP. Export HEIC as JPEG first.');
  if (file.size > 10 * 1024 * 1024) throw new Error('Choose an image no larger than 10 MB.');
  let image; let objectUrl;
  try {
    if (typeof createImageBitmap === 'function') image = await createImageBitmap(file, { imageOrientation: 'from-image' });
    else {
      objectUrl = URL.createObjectURL(file);
      image = new Image(); image.src = objectUrl; await image.decode();
    }
    const width = image.width || image.naturalWidth; const height = image.height || image.naturalHeight;
    if (!width || !height || width * height > 60000000) throw new Error('This image is too large to process. Export a smaller copy first.');
    const maxEdge = folder === 'logos' ? 1024 : ['receipts', 'evidence'].includes(folder) ? 2560 : 1920;
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image compression is unavailable in this browser.');
    const type = folder === 'logos' ? 'image/png' : 'image/jpeg';
    if (type === 'image/jpeg') { context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, type, ['receipts', 'evidence'].includes(folder) ? 0.9 : 0.85));
    if (!blob) throw new Error('Unable to compress this image. Try exporting it as JPEG.');
    // Never enlarge a file just to recompress it; never upscale dimensions.
    if (blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + (type === 'image/png' ? '.png' : '.jpg'), { type: blob.type, lastModified: file.lastModified });
  } catch (error) {
    if (error.name === 'InvalidStateError' || error.name === 'EncodingError') throw new Error('This image could not be decoded. Export it as JPEG and retry.');
    throw error;
  } finally { image?.close?.(); if (objectUrl) URL.revokeObjectURL(objectUrl); }
}
