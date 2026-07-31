import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { OUT } from "./build.ts";
import { resolveFile } from "./serve.ts";

/**
 * These run against whatever `dist/` currently holds, so they assert resolution
 * behaviour rather than specific content — the preview server's only real job is
 * mapping a URL to a file the way Cloudflare Pages will.
 */
describe("resolveFile", () => {
  it("resolveFile_DirectoryUrl_ResolvesToItsIndexHtml", async () => {
    // Arrange
    const url = "/rigorous/";

    // Act
    const result = await resolveFile(url);

    // Assert
    assert.equal(result, path.join(OUT, "rigorous", "index.html"));
  });

  it("resolveFile_RootUrl_ResolvesToTheTopLevelIndex", async () => {
    // Arrange
    const url = "/";

    // Act
    const result = await resolveFile(url);

    // Assert
    assert.equal(result, path.join(OUT, "index.html"));
  });

  it("resolveFile_QueryString_IsIgnoredWhenLocatingTheFile", async () => {
    // Arrange
    const url = "/index.html?cachebust=1";

    // Act
    const result = await resolveFile(url);

    // Assert
    assert.equal(result, path.join(OUT, "index.html"));
  });

  it("resolveFile_MalformedPercentEscape_ReturnsNullInsteadOfThrowing", async () => {
    // Arrange — negative case: decodeURIComponent throws URIError on this, which
    // previously rejected out of the request handler and killed the server.
    const url = "/%zz";

    // Act
    const result = await resolveFile(url);

    // Assert
    assert.equal(result, null);
  });

  it("resolveFile_TraversalAttempt_DoesNotEscapeTheOutputDirectory", async () => {
    // Arrange — negative case.
    const url = "/../../etc/passwd";

    // Act
    const result = await resolveFile(url);

    // Assert
    assert.ok(result === null || result.startsWith(OUT + path.sep));
  });

  it("resolveFile_MissingFile_ReturnsNull", async () => {
    // Arrange — negative case.
    const url = "/definitely-not-a-page.html";

    // Act
    const result = await resolveFile(url);

    // Assert
    assert.equal(result, null);
  });
});
