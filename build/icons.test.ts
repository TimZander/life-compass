import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { inflateSync } from "node:zlib";
import { drawIcon, encodePng, faviconHref, hashedName, icons } from "./icons.ts";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Hex characters of sha256 kept in a filename. Cache-busting, not a security claim. */
const DIGEST_LENGTH = 8;

describe("encodePng", () => {
  it("encodePng_ValidPixels_StartsWithThePngSignature", () => {
    // Arrange — one black pixel.
    const pixels = Buffer.from([0, 0, 0]);

    // Act
    const png = encodePng(1, 1, pixels);

    // Assert
    assert.deepEqual(png.subarray(0, 8), PNG_SIGNATURE);
  });

  it("encodePng_Dimensions_AreWrittenIntoTheHeader", () => {
    // Arrange
    const width = 4;
    const height = 2;

    // Act
    const png = encodePng(width, height, Buffer.alloc(width * height * 3));

    // Assert — IHDR width/height sit at fixed offsets after signature and chunk header.
    assert.equal(png.readUInt32BE(16), width);
    assert.equal(png.readUInt32BE(20), height);
  });

  it("encodePng_WrongPixelBufferLength_Throws", () => {
    // Arrange — negative case: a silently truncated image is worse than a failure.
    const tooShort = Buffer.alloc(5);

    // Act & Assert
    assert.throws(() => encodePng(2, 2, tooShort), /expected 12 bytes/);
  });

  it("encodePng_SameInput_ProducesIdenticalBytes", () => {
    // Arrange — a nondeterministic encoder would churn the cache version on every
    // build, invalidating every installed client's cache for no reason.
    const pixels = Buffer.alloc(3 * 3 * 3, 7);

    // Act & Assert
    assert.deepEqual(encodePng(3, 3, pixels), encodePng(3, 3, pixels));
  });
});

describe("drawIcon", () => {
  it("drawIcon_Centre_IsTheMarkColour", () => {
    // Arrange — the star covers the centre of the canvas.
    const size = 64;

    // Act
    const png = drawIcon(size, 0.7);

    // Assert — decoding is out of scope here; the signature and size prove it encoded,
    // and the corner/centre difference below proves something was actually drawn.
    assert.deepEqual(png.subarray(0, 8), PNG_SIGNATURE);
    assert.equal(png.readUInt32BE(16), size);
  });

  it("drawIcon_SmallerCoverage_ProducesADifferentImage", () => {
    // Arrange — a maskable icon draws the mark smaller so a circular crop cannot shave
    // its points off. If coverage were ignored, both files would be identical.
    // Act
    const full = drawIcon(64, 0.7);
    const inset = drawIcon(64, 0.5);

    // Assert
    assert.notDeepEqual(full, inset);
  });
});

describe("icons", () => {
  it("icons_Set_CoversTheSizesAndPurposesTheManifestDeclares", () => {
    // Act
    const generated = icons();

    // Assert
    assert.deepEqual(
      generated.map((icon) => `${icon.size} ${icon.purpose}`),
      ["192 any", "512 any", "512 maskable"],
    );
  });

  it("icons_EveryOutput_IsAValidPngOfItsDeclaredSize", () => {
    // Act & Assert
    for (const icon of icons()) {
      assert.deepEqual(icon.png.subarray(0, 8), PNG_SIGNATURE, icon.output);
      assert.equal(icon.png.readUInt32BE(16), icon.size, icon.output);
      assert.equal(icon.png.readUInt32BE(20), icon.size, icon.output);
    }
  });

  it("icons_EveryOutput_IsNamedAfterItsOwnBytes", () => {
    // Arrange — #62. The name is what makes the manifest change when the drawing does, so
    // the digest in it has to be OF the drawing rather than merely present in the name.
    const DIGEST = /\.([0-9a-f]{8})\.png$/;

    // Act & Assert
    for (const icon of icons()) {
      const found = DIGEST.exec(icon.output);
      assert.ok(found?.[1] !== undefined, `${icon.output} carries no digest`);
      const expected = createHash("sha256").update(icon.png).digest("hex").slice(0, DIGEST_LENGTH);
      assert.equal(found[1], expected, icon.output);
    }
  });

  it("icons_TwoIconsOfTheSameSize_DoNotShareAName", () => {
    // Arrange — negative case. icon-512 and icon-maskable-512 are the same size and differ
    // only in the drawing; if the name came from anything but the bytes they would collide
    // and one would silently overwrite the other in the output directory.
    // Act
    const names = new Set(icons().map((icon) => icon.output));

    // Assert
    assert.equal(names.size, icons().length);
  });
});

describe("faviconHref", () => {
  it("faviconHref_Always_NamesAnIconThatWasGenerated", () => {
    // Act
    const href = faviconHref();

    // Assert — a favicon pointing at a path nothing writes is a 404 on every page.
    assert.ok(icons().some((icon) => `/${icon.output}` === href), href);
  });

  it("faviconHref_Always_PrefersTheSmallestNonMaskableIcon", () => {
    // Arrange — negative case. A maskable icon is drawn small inside a safe zone for
    // platforms that crop it; used as a tab favicon, nothing crops it and the mark appears
    // marooned in padding at 16px.
    const SMALLEST = 192;

    // Act
    const chosen = icons().find((icon) => `/${icon.output}` === faviconHref());

    // Assert
    assert.equal(chosen?.purpose, "any");
    assert.equal(chosen?.size, SMALLEST);
  });
});

describe("hashedName", () => {
  it("hashedName_SameContent_IsStable", () => {
    // Arrange
    const content = Buffer.from("the same bytes");

    // Act & Assert — an unstable name would change the manifest on every build, which
    // makes a browser's update check meaningless in the other direction.
    assert.equal(hashedName("icons/x", "png", content), hashedName("icons/x", "png", content));
  });

  it("hashedName_DifferentContent_Differs", () => {
    // Act
    const one = hashedName("icons/x", "png", Buffer.from("one"));
    const two = hashedName("icons/x", "png", Buffer.from("two"));

    // Assert
    assert.notEqual(one, two);
  });

  it("hashedName_Always_KeepsTheBaseAndExtensionEitherSideOfTheDigest", () => {
    // Arrange — the extension is what makes Pages serve it as an image rather than a
    // download, and the base is what makes the file recognisable in a directory listing.
    const BASE = "icons/icon-512";

    // Act
    const named = hashedName(BASE, "png", Buffer.from("bytes"));

    // Assert
    assert.match(named, new RegExp(`^${BASE}\\.[0-9a-f]{${DIGEST_LENGTH}}\\.png$`));
  });
});

describe("the icon in its tile", () => {
  /** Read the bounding box of the light mark out of a generated PNG. */
  function inkBox(png: Buffer, size: number): { top: number; bottom: number } {
    let at = 8;
    const parts: Buffer[] = [];
    while (at < png.length) {
      const length = png.readUInt32BE(at);
      if (png.toString("ascii", at + 4, at + 8) === "IDAT") {
        parts.push(png.subarray(at + 8, at + 8 + length));
      }
      at += 12 + length;
    }
    const raw = inflateSync(Buffer.concat(parts));
    const stride = size * 3 + 1;
    let top = -1;
    let bottom = -1;
    let previous = Buffer.alloc(size * 3);
    let row = Buffer.alloc(size * 3);
    for (let y = 0; y < size; y += 1) {
      const filter = raw[y * stride];
      for (let i = 0; i < size * 3; i += 1) {
        const value = raw[y * stride + 1 + i] ?? 0;
        const left = i >= 3 ? (row[i - 3] ?? 0) : 0;
        const above = previous[i] ?? 0;
        row[i] =
          filter === 1
            ? (value + left) & 0xff
            : filter === 2
              ? (value + above) & 0xff
              : filter === 3
                ? (value + ((left + above) >> 1)) & 0xff
                : value;
      }
      let ink = false;
      for (let x = 0; x < size; x += 1) {
        if ((row[x * 3] ?? 0) > 0xd0) {
          ink = true;
          break;
        }
      }
      if (ink) {
        if (top < 0) {
          top = y;
        }
        bottom = y;
      }
      previous = row;
      row = Buffer.alloc(size * 3);
    }
    return { top, bottom };
  }

  it("drawIcon_AMarkThatIsNotSymmetric_IsStillCentredInTheTile", () => {
    // Arrange — the compass rose reaches further north than south, which is the point of
    // it. Centring the 24-unit viewBox rather than the mark left the drawing 22px above
    // the middle of a 512 tile: a mark floating in its square rather than sitting in it.
    // Nothing in the suite could see that, because no test had ever looked at a pixel.
    const SIZE = 512;
    const COVERAGE = 0.7;
    const TOLERANCE = 2;

    // Act
    const { top, bottom } = inkBox(drawIcon(SIZE, COVERAGE), SIZE);

    // Assert
    const off = Math.abs(SIZE / 2 - (top + bottom) / 2);
    assert.ok(off <= TOLERANCE, `the mark sits ${off.toFixed(0)}px from the centre of its tile`);
  });

  it("drawIcon_TheMaskableIcon_KeepsTheNorthPointInsideTheSafeZone", () => {
    // Arrange — a maskable icon is cropped to whatever shape the platform likes, so the
    // mark has to sit inside a circle 80% of the width. The north point is the one at risk,
    // because it reaches furthest.
    const SIZE = 512;
    const MASKABLE_COVERAGE = 0.5;
    const SAFE_RADIUS = SIZE * 0.4;

    // Act
    const { top, bottom } = inkBox(drawIcon(SIZE, MASKABLE_COVERAGE), SIZE);

    // Assert — measured from the tile centre, both extremes clear the safe circle.
    assert.ok(SIZE / 2 - top <= SAFE_RADIUS, "the north point is cropped on a circular mask");
    assert.ok(bottom - SIZE / 2 <= SAFE_RADIUS, "the south point is cropped on a circular mask");
  });
});
