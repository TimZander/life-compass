/**
 * App icons, generated rather than committed.
 *
 * A PWA cannot be installed without them, and installation is what makes browser
 * storage durable (docs/decisions/0008) — so this is load-bearing for the workbook, not
 * decoration. Adding an image library to draw two squares and a star would be a poor
 * trade against docs/decisions/0003, and Node ships everything required: `zlib` for the
 * deflate stream and the CRC, and arithmetic for the rest.
 *
 * The mark is the same compass rose as the site wordmark — an eight-point star whose
 * north point is drawn longer, the star you steer by — so the installed icon and the page
 * header are the same drawing rather than two things that merely resemble each other. Its
 * coordinates are lifted directly from the SVG path in the layout.
 */

import { createHash } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";

/**
 * The wordmark compass rose, in its 24×24 viewBox: eight points around the centre with
 * the north point (12,0) drawn longest, so the mark reads as the star you steer by.
 * Exported so a test can hold it against the SVG path in the layout and fail if the two
 * drawings ever drift apart.
 */
export const COMPASS_ROSE: readonly (readonly [x: number, y: number])[] = [
  [12, 0],
  [12.96, 9.69],
  [18.01, 5.99],
  [14.31, 11.04],
  [21, 12],
  [14.31, 12.96],
  [18.01, 18.01],
  [12.96, 14.31],
  [12, 21],
  [11.04, 14.31],
  [5.99, 18.01],
  [9.69, 12.96],
  [3, 12],
  [9.69, 11.04],
  [5.99, 5.99],
  [11.04, 9.69],
];

/** Copper accent and warm paper, taken from the site's own palette. */
const BACKGROUND: readonly [number, number, number] = [0x9a, 0x6b, 0x3f];
const MARK: readonly [number, number, number] = [0xf6, 0xf4, 0xee];

/** Samples per axis. 3×3 is enough to keep the rose's points from looking chewed. */
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

/** Even-odd ray cast. The mark is simple and closed, so this is all it needs. */
function inside(x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = COMPASS_ROSE.length - 1; i < COMPASS_ROSE.length; j = i, i += 1) {
    const a = COMPASS_ROSE[i];
    const b = COMPASS_ROSE[j];
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
 * what keeps the mark's points from being shaved off on a device that crops to a circle.
 */
export function drawIcon(size: number, coverage: number): Buffer {
  const pixels = Buffer.alloc(size * size * 3);
  const scale = (size * coverage) / 24;
  // Centred on the MARK, not on the viewBox it is drawn in. The compass rose reaches
  // further north than south — that is the point of it — so its ink spans y 0..21 of a
  // 24-high box, and centring the box left the drawing 22px above the middle of a 512
  // tile: a mark floating in its square rather than sitting in it. Taken from the shape so
  // that whatever is drawn next is centred too, rather than needing its coordinates nudged.
  const xs = COMPASS_ROSE.map(([x]) => x);
  const ys = COMPASS_ROSE.map(([, y]) => y);
  const middleX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const middleY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const offsetX = size / 2 - middleX * scale;
  const offsetY = size / 2 - middleY * scale;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let covered = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const px = (x + (sx + 0.5) / SUPERSAMPLE - offsetX) / scale;
          const py = (y + (sy + 0.5) / SUPERSAMPLE - offsetY) / scale;
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
  /** Path within the output, e.g. `icons/icon-192.a1b2c3d4.png`. */
  readonly output: string;
  readonly size: number;
  readonly purpose: "any" | "maskable";
  readonly png: Buffer;
};

/**
 * Name an icon after its own bytes.
 *
 * The reason is #62: the manifest names fixed paths, so #61 changed the drawing and left
 * `manifest.webmanifest` byte-identical. The manifest is what a browser watches to decide
 * whether an installed app's identity has changed, and it had nothing to notice — an
 * installed app kept the old mark. With the digest in the filename the manifest cannot
 * help but change when the drawing does.
 *
 * Eight hex characters, matching the shape `cacheVersion` already uses in
 * build/serviceworker.ts. This is a cache-busting name, not a security claim: the cost of
 * a collision is a stale icon, and 32 bits against a set of three is not a risk worth
 * spending URL length on.
 */
export function hashedName(base: string, extension: string, content: Buffer): string {
  const digest = createHash("sha256").update(content).digest("hex").slice(0, 8);
  return `${base}.${digest}.${extension}`;
}

/** Draw one icon and name it after what was drawn. */
function icon(base: string, size: number, coverage: number, purpose: Icon["purpose"]): Icon {
  const png = drawIcon(size, coverage);
  return { output: hashedName(base, "png", png), size, purpose, png };
}

let cached: readonly Icon[] | undefined;

/**
 * The icon set the manifest declares.
 *
 * Memoised because it is deterministic and not cheap: three canvases, 2.9M pixels, nine
 * samples each. Regenerating them per `build()` call was measurable in the test suite.
 */
export function icons(): readonly Icon[] {
  cached ??= [
    icon("icons/icon-192", 192, 0.7, "any"),
    icon("icons/icon-512", 512, 0.7, "any"),
    icon("icons/icon-maskable-512", 512, 0.5, "maskable"),
  ];
  return cached;
}

/**
 * The icon the document links as its favicon, as a root-absolute URL.
 *
 * The layout asks for this rather than writing the path itself. A tab's favicon is cached
 * separately from an installed app's icon and goes stale the same way, so the two want the
 * same digest — and a literal in the layout is exactly the drift #62 is about.
 */
export function faviconHref(): string {
  const [smallest] = [...icons()]
    .filter((icon) => icon.purpose === "any")
    .sort((a, b) => a.size - b.size);
  if (smallest === undefined) {
    throw new Error("no non-maskable icon to link as the favicon");
  }
  return `/${smallest.output}`;
}
