/**
 * App icons, generated rather than committed.
 *
 * A PWA cannot be installed without them, and installation is what makes browser
 * storage durable (docs/decisions/0008) — so this is load-bearing for the workbook, not
 * decoration. Adding an image library to draw two squares and a star would be a poor
 * trade against docs/decisions/0003, and Node ships everything required: `zlib` for the
 * deflate stream and the CRC, and arithmetic for the rest.
 *
 * The mark is the same eight-point star as the site wordmark, so the installed icon and
 * the page header are the same drawing rather than two things that merely resemble each
 * other. Its coordinates are lifted directly from the SVG path in the layout.
 */

import { crc32, deflateSync } from "node:zlib";

/** The wordmark star, in its original 24×24 viewBox. */
const STAR: readonly (readonly [x: number, y: number])[] = [
  [12, 0],
  [14, 10],
  [24, 12],
  [14, 14],
  [12, 24],
  [10, 14],
  [0, 12],
  [10, 10],
];

/** Copper accent and warm paper, taken from the site's own palette. */
const BACKGROUND: readonly [number, number, number] = [0x9a, 0x6b, 0x3f];
const MARK: readonly [number, number, number] = [0xf6, 0xf4, 0xee];

/** Samples per axis. 3×3 is enough to keep the star's points from looking chewed. */
const SUPERSAMPLE = 3;

function png(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

/** Encode 8-bit RGB pixels as a PNG. */
export function encodePng(width: number, height: number, rgb: Buffer): Buffer {
  const stride = width * 3;
  if (rgb.length !== stride * height) {
    throw new Error(`expected ${stride * height} bytes of pixel data, received ${rgb.length}`);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  // Each scanline is prefixed with its filter type. 0 means "none", which costs a few
  // bytes against a smarter filter and keeps this readable.
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    png("IHDR", header),
    png("IDAT", deflateSync(raw, { level: 9 })),
    png("IEND", Buffer.alloc(0)),
  ]);
}

/** Even-odd ray cast. The star is simple and closed, so this is all it needs. */
function inside(x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = STAR.length - 1; i < STAR.length; j = i, i += 1) {
    const a = STAR[i];
    const b = STAR[j];
    if (a === undefined || b === undefined) {
      continue;
    }
    const [ax, ay] = a;
    const [bx, by] = b;
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) {
      hit = !hit;
    }
  }
  return hit;
}

/**
 * Draw the icon at `size` pixels with the mark occupying `coverage` of the width.
 *
 * A maskable icon is cropped to whatever shape the platform prefers, so its mark has to
 * sit inside the safe zone — a circle 80% of the width. Passing a smaller `coverage` is
 * what keeps the star's points from being shaved off on a device that crops to a circle.
 */
export function drawIcon(size: number, coverage: number): Buffer {
  const pixels = Buffer.alloc(size * size * 3);
  const scale = (size * coverage) / 24;
  const offset = (size - 24 * scale) / 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let covered = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const px = (x + (sx + 0.5) / SUPERSAMPLE - offset) / scale;
          const py = (y + (sy + 0.5) / SUPERSAMPLE - offset) / scale;
          if (inside(px, py)) {
            covered += 1;
          }
        }
      }

      const ratio = covered / (SUPERSAMPLE * SUPERSAMPLE);
      const base = (y * size + x) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        const back = BACKGROUND[channel] ?? 0;
        const fore = MARK[channel] ?? 0;
        pixels[base + channel] = Math.round(back + (fore - back) * ratio);
      }
    }
  }

  return encodePng(size, size, pixels);
}

export type Icon = {
  /** Path within the output, e.g. `icons/icon-192.png`. */
  readonly output: string;
  readonly size: number;
  readonly purpose: "any" | "maskable";
  readonly png: Buffer;
};

let cached: readonly Icon[] | undefined;

/**
 * The icon set the manifest declares.
 *
 * Memoised because it is deterministic and not cheap: three canvases, 2.9M pixels, nine
 * samples each. Regenerating them per `build()` call was measurable in the test suite.
 */
export function icons(): readonly Icon[] {
  cached ??= [
    { output: "icons/icon-192.png", size: 192, purpose: "any", png: drawIcon(192, 0.7) },
    { output: "icons/icon-512.png", size: 512, purpose: "any", png: drawIcon(512, 0.7) },
    {
      output: "icons/icon-maskable-512.png",
      size: 512,
      purpose: "maskable",
      png: drawIcon(512, 0.5),
    },
  ];
  return cached;
}
