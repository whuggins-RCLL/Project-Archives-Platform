/**
 * Client-side image preparation for branding uploads.
 *
 * Branding images are stored as base64 data URLs inside the settings document, so the
 * binding constraint is the *encoded* character count (base64 inflates bytes by ~4/3),
 * not the raw file size. Instead of rejecting files over an arbitrary byte cap, we
 * downscale/recompress on a canvas until the encoded result fits the server's budget.
 */

export interface PrepareImageOptions {
  /** Maximum length of the returned data URL in characters (must stay under the server-side validation cap). */
  maxChars: number;
  /** Longest edge in pixels when the image needs to be re-encoded. */
  maxDimension: number;
  /**
   * 'png' preserves transparency (logos); 'jpeg' compresses photos far better (hero backgrounds).
   * JPEG output is composited onto a white background.
   */
  encode: 'png' | 'jpeg';
}

/** Aligned with server.ts validateSettings: logoDataUrl <= 150k chars. */
export const LOGO_IMAGE_LIMITS: PrepareImageOptions = { maxChars: 140_000, maxDimension: 512, encode: 'png' };
/** Aligned with server.ts HERO_IMAGE_MAX_LENGTH (600k chars), with headroom for the rest of the payload. */
export const HERO_IMAGE_LIMITS: PrepareImageOptions = { maxChars: 560_000, maxDimension: 1920, encode: 'jpeg' };

const JPEG_QUALITY_STEPS = [0.85, 0.75, 0.65, 0.55];
const MIN_DIMENSION = 96;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string' && reader.result.length > 0) {
        resolve(reader.result);
      } else {
        reject(new Error('Could not read the selected file.'));
      }
    };
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The selected file is not a supported image.'));
    image.src = dataUrl;
  });
}

function drawScaled(image: HTMLImageElement, longestEdge: number, fillWhite: boolean): HTMLCanvasElement | null {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) return null;

  const scale = Math.min(1, longestEdge / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));

  const context = canvas.getContext('2d');
  if (!context) return null;
  if (fillWhite) {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Returns a data URL guaranteed to be at most `maxChars` characters, re-encoding and
 * progressively shrinking the image as needed. Throws when the file is unreadable, not
 * an image, or cannot be compressed enough (e.g. a huge PNG logo with fine detail).
 */
export async function prepareImageDataUrl(file: File, options: PrepareImageOptions): Promise<string> {
  const original = await readFileAsDataUrl(file);
  if (original.length <= options.maxChars) {
    return original;
  }

  const image = await loadImage(original);

  for (let dimension = options.maxDimension; dimension >= MIN_DIMENSION; dimension = Math.round(dimension * 0.75)) {
    const canvas = drawScaled(image, dimension, options.encode === 'jpeg');
    if (!canvas) break;

    if (options.encode === 'png') {
      const encoded = canvas.toDataURL('image/png');
      if (encoded.length <= options.maxChars) return encoded;
    } else {
      for (const quality of JPEG_QUALITY_STEPS) {
        const encoded = canvas.toDataURL('image/jpeg', quality);
        if (encoded.length <= options.maxChars) return encoded;
      }
    }
  }

  throw new Error('This image could not be compressed enough to save. Please choose a smaller or simpler image.');
}
