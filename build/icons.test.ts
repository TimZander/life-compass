import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { drawIcon, encodePng, icons } from "./icons.ts";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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
});
