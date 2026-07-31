import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { resolveFile } from "./serve.ts";

/**
 * These run against a fixture tree rather than the real `dist/`, which is gitignored
 * and therefore absent on a clean checkout. Reading `dist/` directly made these tests
 * pass only where a build had already been run.
 */
let root: string;

before(async () => {
  root = await mkdtemp(path.join(tmpdir(), "life-compass-serve-"));
  await mkdir(path.join(root, "rigorous"), { recursive: true });
  await mkdir(path.join(root, "assets", "css"), { recursive: true });
  await writeFile(path.join(root, "index.html"), "<p>home</p>", "utf8");
  await writeFile(path.join(root, "rigorous", "index.html"), "<p>rigorous</p>", "utf8");
  await writeFile(path.join(root, "assets", "css", "style.css"), "body{}", "utf8");
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("resolveFile", () => {
  it("resolveFile_DirectoryUrl_ResolvesToItsIndexHtml", async () => {
    // Arrange — the one behaviour a naive static file server gets wrong.
    const url = "/rigorous/";

    // Act
    const result = await resolveFile(url, root);

    // Assert
    assert.equal(result, path.join(root, "rigorous", "index.html"));
  });

  it("resolveFile_RootUrl_ResolvesToTheTopLevelIndex", async () => {
    // Arrange
    const url = "/";

    // Act
    const result = await resolveFile(url, root);

    // Assert
    assert.equal(result, path.join(root, "index.html"));
  });

  it("resolveFile_NestedAsset_ResolvesToTheFile", async () => {
    // Arrange
    const url = "/assets/css/style.css";

    // Act
    const result = await resolveFile(url, root);

    // Assert
    assert.equal(result, path.join(root, "assets", "css", "style.css"));
  });

  it("resolveFile_QueryString_IsIgnoredWhenLocatingTheFile", async () => {
    // Arrange
    const url = "/index.html?cachebust=1";

    // Act
    const result = await resolveFile(url, root);

    // Assert
    assert.equal(result, path.join(root, "index.html"));
  });

  it("resolveFile_MalformedPercentEscape_ReturnsNullInsteadOfThrowing", async () => {
    // Arrange — negative case: decodeURIComponent throws URIError on this, which
    // previously rejected out of the request handler and killed the server.
    const url = "/%zz";

    // Act
    const result = await resolveFile(url, root);

    // Assert
    assert.equal(result, null);
  });

  it("resolveFile_TraversalAttempt_DoesNotEscapeTheOutputDirectory", async () => {
    // Arrange — negative case.
    const url = "/../../etc/passwd";

    // Act
    const result = await resolveFile(url, root);

    // Assert
    assert.ok(result === null || result.startsWith(root + path.sep));
  });

  it("resolveFile_DirectoryWithoutAnIndex_ReturnsNull", async () => {
    // Arrange — negative case: a directory exists but has nothing to serve.
    const url = "/assets/";

    // Act
    const result = await resolveFile(url, root);

    // Assert
    assert.equal(result, null);
  });

  it("resolveFile_MissingFile_ReturnsNull", async () => {
    // Arrange — negative case.
    const url = "/definitely-not-a-page.html";

    // Act
    const result = await resolveFile(url, root);

    // Assert
    assert.equal(result, null);
  });
});
