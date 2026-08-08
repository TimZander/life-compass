import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderManifest } from "./manifest.ts";
import { type Icon } from "./icons.ts";

/**
 * A stand-in icon. The manifest never looks at the pixels, only at the name derived from
 * them, so a one-byte buffer says what matters and nothing else.
 */
function icon(output: string, byte: number, purpose: Icon["purpose"] = "any"): Icon {
  const SIZE = 512;
  return { output, size: SIZE, purpose, png: Buffer.from([byte]) };
}

describe("renderManifest", () => {
  it("renderManifest_IconNamesDiffer_ProducesADifferentManifest", () => {
    // Arrange — the property that failed in #62. The mark was redrawn in #61 and the
    // manifest came out byte-identical, because it named a fixed path; a browser watches
    // the manifest to decide whether an installed app has changed and had nothing to
    // notice. This is that failure, checkable without a device.
    const BEFORE = "icons/icon-512.aaaaaaaa.png";
    const AFTER = "icons/icon-512.bbbbbbbb.png";

    // Act
    const before = renderManifest([icon(BEFORE, 1)]);
    const after = renderManifest([icon(AFTER, 2)]);

    // Assert
    assert.notEqual(before, after);
    assert.match(after, /icon-512\.bbbbbbbb\.png/);
  });

  it("renderManifest_SameIcons_IsByteIdentical", () => {
    // Arrange — the other half of the same property. A manifest that churned between
    // identical builds would make every deploy look like an identity change, which
    // teaches a browser's update check to mean nothing.
    const OUTPUT = "icons/icon-512.abcd1234.png";

    // Act
    const first = renderManifest([icon(OUTPUT, 1)]);
    const second = renderManifest([icon(OUTPUT, 1)]);

    // Assert
    assert.equal(first, second);
  });

  it("renderManifest_IconsChange_LeavesTheAppsIdentityAlone", () => {
    // Arrange — negative case, and the one with teeth. `id` is what an installed app is;
    // a changed id is a NEW app, so a reader who redrew nothing but the mark would end up
    // with two Life Compasses on the home screen instead of an updated one.
    const IDENTITY = ["id", "start_url", "scope", "name", "short_name"] as const;

    // Act
    const before = JSON.parse(renderManifest([icon("icons/a.1111aaaa.png", 1)]));
    const after = JSON.parse(renderManifest([icon("icons/b.2222bbbb.png", 2)]));

    // Assert
    for (const field of IDENTITY) {
      assert.equal(after[field], before[field], field);
    }
  });

  it("renderManifest_EachIcon_IsDeclaredWithItsSizeAndPurpose", () => {
    // Arrange — a maskable icon declared as `any` is cropped by the platform and loses
    // its points; declared `maskable` and it is given the safe zone it was drawn for.
    const SMALL = 192;
    const LARGE = 512;
    const set: readonly Icon[] = [
      { output: "icons/small.11111111.png", size: SMALL, purpose: "any", png: Buffer.from([1]) },
      { output: "icons/large.22222222.png", size: LARGE, purpose: "maskable", png: Buffer.from([2]) },
    ];

    // Act
    const declared = JSON.parse(renderManifest(set)).icons;

    // Assert
    assert.deepEqual(declared, [
      { src: "/icons/small.11111111.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/large.22222222.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ]);
  });

  it("renderManifest_Always_IsValidJsonEndingInANewline", () => {
    // Act
    const rendered = renderManifest([icon("icons/icon-512.abcd1234.png", 1)]);

    // Assert — a manifest a browser cannot parse is an app that cannot be installed, and
    // installation is what makes storage durable (docs/decisions/0008).
    assert.doesNotThrow(() => JSON.parse(rendered));
    assert.ok(rendered.endsWith("\n"));
  });
});
