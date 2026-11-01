import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { Layout } from './common.ts';

/**
 * Greyscale pixels → 1-bit. Returns a "black" mask (1 = black), with the device holes forced white.
 */
export function threshold(grey: Uint8Array, width: number, height: number, level: number, layout?: Layout): Uint8Array {
  const black = new Uint8Array(width * height);
  for (let i = 0; i < black.length; i++) black[i] = grey[i] < level ? 1 : 0;
  for (const r of Object.values(layout?.holes ?? {})) {
    for (let y = r.y; y < r.y + r.h; y++) black.fill(0, y * width + r.x, y * width + r.x + r.w);
  }
  return black;
}

/** Packs the mask row-major, MSB first, 1 = black (Adafruit GFX drawBitmap convention). */
export function packBits(black: Uint8Array, width: number, height: number): Uint8Array {
  const stride = Math.ceil(width / 8);
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (black[y * width + x]) out[y * stride + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return out;
}

export const shortHash = (data: Uint8Array) => createHash('sha256').update(data).digest('hex').slice(0, 16);

/** Converts a screenshot PNG into a 1-bit PNG + raw bitmap. */
export async function convert(png: Buffer, layout: Layout, level: number) {
  const { width, height } = layout;
  const grey = await sharp(png).resize(width, height, { fit: 'fill' }).greyscale().raw().toBuffer();
  const black = threshold(grey, width, height, level, layout);
  const bin = packBits(black, width, height);

  const pixels = Buffer.alloc(width * height);
  for (let i = 0; i < black.length; i++) pixels[i] = black[i] ? 0 : 255;
  const png1 = await sharp(pixels, { raw: { width, height, channels: 1 } })
    .png({ palette: true, colours: 2, dither: 0, compressionLevel: 9 }) // 2-colour palette → libvips writes a 1-bit PNG
    .toBuffer();

  return { bin, png: png1, hash: shortHash(bin) };
}
