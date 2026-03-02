/**
 * Client-side image processing utilities for resizing and format conversion.
 */

/**
 * Resize an image file to fit within maxWidth x maxHeight, preserving aspect ratio.
 * Also converts unsupported formats (like HEIC) to JPEG.
 * Returns a new File object with the resized image.
 */
export async function resizeImage(
  file: File,
  maxWidth: number,
  maxHeight: number,
  quality = 0.85
): Promise<File> {
  // Convert HEIC to a usable format by reading as blob and drawing to canvas
  const bitmap = await createImageBitmap(await fileToBlob(file));

  let { width, height } = bitmap;

  // Only downscale, never upscale
  if (width > maxWidth || height > maxHeight) {
    const ratio = Math.min(maxWidth / width, maxHeight / height);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get canvas context");

  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  // Determine output format - keep PNG for PNG inputs, use JPEG for everything else
  const outputType = file.type === "image/png" ? "image/png" : "image/jpeg";
  const ext = outputType === "image/png" ? ".png" : ".jpg";

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Canvas toBlob failed"))),
      outputType,
      quality
    );
  });

  const baseName = file.name.replace(/\.[^.]+$/, "");
  return new File([blob], baseName + ext, { type: outputType });
}

/**
 * Convert a File to a Blob, handling HEIC by attempting to decode it.
 * For HEIC files, we attempt to use the browser's built-in decoder
 * (supported in Safari). For browsers that don't support HEIC natively,
 * the createImageBitmap call in resizeImage will throw and we show an error.
 */
async function fileToBlob(file: File): Promise<Blob> {
  return file;
}

/**
 * Check if a file type is an image we can process (including HEIC).
 */
export function isSupportedImageType(type: string): boolean {
  return [
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/heic",
    "image/heif",
  ].includes(type.toLowerCase());
}

/**
 * Check if a file needs HEIC conversion.
 */
export function isHeicFile(file: File): boolean {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return (
    type === "image/heic" ||
    type === "image/heif" ||
    name.endsWith(".heic") ||
    name.endsWith(".heif")
  );
}

/**
 * Process an image for community icon upload.
 * Resizes to 256x256 max and ensures format compatibility.
 */
export async function processIconImage(file: File): Promise<File> {
  return resizeImage(file, 256, 256, 0.85);
}

/**
 * Process an image for emoji upload.
 * Resizes to 128x128 max and ensures format compatibility.
 * Preserves GIF as-is (no resize for animated images).
 */
export async function processEmojiImage(file: File): Promise<File> {
  // Don't resize GIFs as it would lose animation
  if (file.type === "image/gif") return file;
  return resizeImage(file, 128, 128, 0.85);
}
