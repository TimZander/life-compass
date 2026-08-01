import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { checkHeaders, parseHeaders } from "./headers.ts";
import { ROOT } from "./build.ts";

/** The policy the shipped file declares, kept in one place for the tests below. */
const GOOD = `
# a comment
/*
  Content-Security-Policy: default-src 'self'; connect-src 'none'; form-action 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
`;

describe("parseHeaders", () => {
  it("parseHeaders_PathWithIndentedHeaders_GroupsThemUnderThatPath", () => {
    // Act
    const rules = parseHeaders(GOOD);

    // Assert
    assert.equal(rules.length, 1);
    assert.equal(rules[0]?.path, "/*");
    assert.equal(rules[0]?.headers.get("referrer-policy"), "no-referrer");
  });

  it("parseHeaders_HeaderNames_AreLowercasedForLookup", () => {
    // Arrange — the file writes them capitalised; HTTP names are case-insensitive.
    // Act
    const rules = parseHeaders(GOOD);

    // Assert
    assert.ok(rules[0]?.headers.has("x-content-type-options"));
  });

  it("parseHeaders_ValueContainingColons_IsNotTruncated", () => {
    // Arrange — a CSP is full of colons, so splitting on the last one loses most of it.
    const source = "/*\n  Content-Security-Policy: default-src 'self'; connect-src 'none'\n";

    // Act
    const rules = parseHeaders(source);

    // Assert
    assert.equal(
      rules[0]?.headers.get("content-security-policy"),
      "default-src 'self'; connect-src 'none'",
    );
  });

  it("parseHeaders_CommentsAndBlankLines_AreIgnored", () => {
    // Arrange — negative case.
    const source = "# only a comment\n\n   \n";

    // Act & Assert
    assert.deepEqual(parseHeaders(source), []);
  });

  it("parseHeaders_MultipleRules_AreKeptSeparate", () => {
    // Arrange
    const source = "/*\n  A: 1\n/sw.js\n  B: 2\n";

    // Act
    const rules = parseHeaders(source);

    // Assert
    assert.deepEqual(rules.map((rule) => rule.path), ["/*", "/sw.js"]);
    assert.equal(rules[1]?.headers.get("b"), "2");
  });
});

describe("checkHeaders", () => {
  it("checkHeaders_ShippedFile_IsClean", async () => {
    // Arrange — the file that actually deploys, not a fixture of it.
    const source = await readFile(path.join(ROOT, "_headers"), "utf8");

    // Act
    const problems = checkHeaders(parseHeaders(source));

    // Assert
    assert.deepEqual(problems, []);
  });

  it("checkHeaders_MissingConnectSrc_IsReported", () => {
    // Arrange — negative case, and the one that matters most: without it the
    // application could transmit, and docs/decisions/0006 says it cannot.
    const weakened = GOOD.replace(" connect-src 'none';", "");

    // Act
    const problems = checkHeaders(parseHeaders(weakened));

    // Assert
    assert.ok(problems.some((p) => p.includes("connect-src 'none'")));
    assert.ok(problems.some((p) => p.includes("this is the privacy claim")));
  });

  it("checkHeaders_MissingFormAction_IsReported", () => {
    // Arrange — negative case: a form needs no script to exfiltrate.
    const weakened = GOOD.replace(" form-action 'none'", "");

    // Act & Assert
    assert.ok(checkHeaders(parseHeaders(weakened)).some((p) => p.includes("form-action")));
  });

  it("checkHeaders_NoCatchAllRule_IsReported", () => {
    // Arrange — negative case: a file full of rules that match nothing.
    const source = "/sw.js\n  Cache-Control: no-cache\n";

    // Act & Assert
    assert.ok(checkHeaders(parseHeaders(source)).some((p) => p.includes('no "/*" rule')));
  });

  it("checkHeaders_NoPolicyAtAll_IsReported", () => {
    // Arrange — negative case.
    const source = "/*\n  X-Content-Type-Options: nosniff\n";

    // Act & Assert
    assert.ok(
      checkHeaders(parseHeaders(source)).some((p) => p.includes("declares no Content-Security-Policy")),
    );
  });
});
