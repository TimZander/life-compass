import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveLink, type LinkContext } from "./links.ts";

/** A stand-in site with one page per URL shape the real content uses. */
function context(): LinkContext {
  return {
    urls: new Map([
      ["README.md", "/"],
      ["one-page-anchor.md", "/one-page-anchor.html"],
      ["days/day-2-values.md", "/days/day-2-values.html"],
      ["rigorous/README.md", "/rigorous/"],
      ["docs/decisions/README.md", "/docs/decisions/"],
      ["templates/life-compass.md", "/templates/life-compass.html"],
    ]),
    assets: new Set(["LICENSE", "assets/css/style.css"]),
  };
}

describe("resolveLink", () => {
  it("resolveLink_SiblingMarkdownFile_RewritesToPageUrl", () => {
    // Arrange
    const href = "one-page-anchor.md";

    // Act
    const result = resolveLink(href, "README.md", context());

    // Assert
    assert.equal(result.kind, "page");
    assert.equal(result.href, "/one-page-anchor.html");
  });

  it("resolveLink_ParentRelativePath_ResolvesAgainstSourceDirectory", () => {
    // Arrange
    const href = "../templates/life-compass.md";

    // Act
    const result = resolveLink(href, "days/day-5-synthesis.md", context());

    // Assert
    assert.equal(result.kind, "page");
    assert.equal(result.href, "/templates/life-compass.html");
  });

  it("resolveLink_ReadmeInSubdirectory_ResolvesToDirectoryUrl", () => {
    // Arrange — the regression this whole module exists for. A naive `.md` -> `.html`
    // rewrite produces /rigorous/README.html, which is served by nothing.
    const href = "rigorous/README.md";

    // Act
    const result = resolveLink(href, "README.md", context());

    // Assert
    assert.equal(result.href, "/rigorous/");
  });

  it("resolveLink_TrailingSlashDirectory_ResolvesViaItsReadme", () => {
    // Arrange
    const href = "docs/decisions/";

    // Act
    const result = resolveLink(href, "README.md", context());

    // Assert
    assert.equal(result.kind, "page");
    assert.equal(result.href, "/docs/decisions/");
    assert.equal(result.target, "docs/decisions/README.md");
  });

  it("resolveLink_LinkWithFragment_PreservesFragmentExactly", () => {
    // Arrange — the double hyphen must survive rewriting untouched.
    const href = "one-page-anchor.md#add-on-a--outside-input";

    // Act
    const result = resolveLink(href, "README.md", context());

    // Assert
    assert.equal(result.href, "/one-page-anchor.html#add-on-a--outside-input");
  });

  it("resolveLink_ExtensionlessAsset_ClassifiesAsAssetNotBroken", () => {
    // Arrange — LICENSE is copied verbatim, so linking to it is legitimate.
    const href = "LICENSE";

    // Act
    const result = resolveLink(href, "README.md", context());

    // Assert
    assert.equal(result.kind, "asset");
    assert.equal(result.href, "/LICENSE");
  });

  it("resolveLink_AnchorOnly_LeftUnchanged", () => {
    // Arrange
    const href = "#where-the-exercises-come-from";

    // Act
    const result = resolveLink(href, "README.md", context());

    // Assert
    assert.equal(result.kind, "anchor");
    assert.equal(result.href, href);
  });

  it("resolveLink_ExternalUrl_LeftUnchanged", () => {
    // Arrange
    const href = "https://example.com/thing";

    // Act
    const result = resolveLink(href, "README.md", context());

    // Assert
    assert.equal(result.kind, "external");
    assert.equal(result.href, href);
  });

  it("resolveLink_MissingTarget_ClassifiesAsBroken", () => {
    // Arrange — negative case: the build refuses to emit when this happens.
    const href = "does-not-exist.md";

    // Act
    const result = resolveLink(href, "README.md", context());

    // Assert
    assert.equal(result.kind, "broken");
    assert.equal(result.target, null);
  });
});
