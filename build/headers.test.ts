import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { checkHeaders, parseCsp, parseHeaders } from "./headers.ts";
import { ROOT } from "./build.ts";

/** The policy the shipped file declares, kept in one place for the tests below. */
const GOOD = `
# a comment
/*
  Content-Security-Policy: default-src 'self'; connect-src 'none'; form-action 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: microphone=(), camera=(), geolocation=()
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

describe("parseCsp", () => {
  it("parseCsp_Policy_SplitsIntoDirectivesAndSources", () => {
    // Act
    const csp = parseCsp("default-src 'self'; connect-src 'none' https://x");

    // Assert
    assert.deepEqual(csp.get("default-src"), ["'self'"]);
    assert.deepEqual(csp.get("connect-src"), ["'none'", "https://x"]);
  });

  it("parseCsp_TrailingSemicolonAndExtraSpaces_ProduceNoEmptyEntries", () => {
    // Arrange — negative case: sloppy formatting must not invent a blank directive.
    const csp = parseCsp("  default-src   'self' ;  ");

    // Act & Assert
    assert.deepEqual([...csp.keys()], ["default-src"]);
    assert.deepEqual(csp.get("default-src"), ["'self'"]);
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

  it("checkHeaders_ConnectSrcRemoved_IsReported", () => {
    // Arrange — negative case: the directive the privacy claim rests on.
    const weakened = GOOD.replace(" connect-src 'none';", "");

    // Act
    const problems = checkHeaders(parseHeaders(weakened));

    // Assert
    assert.ok(problems.some((p) => p.includes("this is the privacy claim")));
  });

  it("checkHeaders_SourceAppendedToConnectSrc_IsReported", () => {
    // Arrange — the way policies are actually weakened. A substring check passes this,
    // because "connect-src 'none'" is still present inside the longer value.
    const weakened = GOOD.replace("connect-src 'none'", "connect-src 'none' https://elsewhere");

    // Act
    const problems = checkHeaders(parseHeaders(weakened));

    // Assert
    assert.ok(problems.some((p) => p.includes("expected exactly")));
  });

  it("checkHeaders_UnrelatedDirectiveNamingAHost_IsReported", () => {
    // Arrange — nothing on this site loads from anywhere else, so a CDN in ANY
    // directive is drift, not just in the three that are pinned exactly.
    const weakened = GOOD.replace("form-action 'none'", "form-action 'none'; img-src https://cdn.example");

    // Act
    const problems = checkHeaders(parseHeaders(weakened));

    // Assert
    assert.ok(problems.some((p) => p.includes("only keyword sources are allowed")));
  });

  it("checkHeaders_SchemeOrWildcardSource_IsReported", () => {
    // Arrange — negative cases that are neither a host nor a keyword.
    for (const source of ["data:", "*", "https:"]) {
      const weakened = GOOD.replace("form-action 'none'", `form-action 'none'; img-src ${source}`);

      // Act
      const problems = checkHeaders(parseHeaders(weakened));

      // Assert
      assert.ok(
        problems.some((p) => p.includes("only keyword sources are allowed")),
        `${source} was not reported`,
      );
    }
  });

  it("checkHeaders_UnsafeInline_IsReported", () => {
    // Arrange — negative case: syntactically a keyword, and it defeats the policy.
    const weakened = GOOD.replace("form-action 'none'", "form-action 'none'; script-src 'unsafe-inline'");

    // Act & Assert
    assert.ok(checkHeaders(parseHeaders(weakened)).some((p) => p.includes("defeats the policy")));
  });

  it("checkHeaders_MissingPermissionsPolicy_IsReported", () => {
    // Arrange — negative case. 0006 decided this application asks for no microphone.
    const weakened = GOOD.replace(/\n  Permissions-Policy:[^\n]*/, "");

    // Act & Assert
    assert.ok(
      checkHeaders(parseHeaders(weakened)).some((p) => p.includes("no microphone")),
    );
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

describe("checkHeaders — service worker rule", () => {
  const SW = `
/*
  Content-Security-Policy: default-src 'self'; connect-src 'none'; form-action 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: microphone=()

/sw.js
  Cache-Control: no-cache
  ! Content-Security-Policy
  Content-Security-Policy: default-src 'self'; connect-src 'self'
`;

  it("checkHeaders_WorkerRuleAsShipped_IsClean", () => {
    // Act & Assert
    assert.deepEqual(checkHeaders(parseHeaders(SW)), []);
  });

  it("checkHeaders_WorkerWithoutNoCache_IsReported", () => {
    // Arrange — negative case: an installed client would keep an old worker and never
    // see a deploy, which is the failure 0005 chose Cloudflare to be able to prevent.
    const weakened = SW.replace("Cache-Control: no-cache", "Cache-Control: max-age=3600");

    // Act & Assert
    assert.ok(checkHeaders(parseHeaders(weakened)).some((p) => p.includes("must be no-cache")));
  });

  it("checkHeaders_WorkerConnectSrcWidened_IsReported", () => {
    // Arrange — negative case, and the important one. The worker's rule has to be
    // permissive to precache at all, which makes it the single place the site-wide
    // policy can be escaped.
    const weakened = SW.replace("connect-src 'self'\n", "connect-src 'self' https://elsewhere\n");

    // Act
    const problems = checkHeaders(parseHeaders(weakened));

    // Assert
    assert.ok(problems.some((p) => p.includes("this origin and nowhere else")));
  });

  it("checkHeaders_WorkerWithNoPolicy_IsReported", () => {
    // Arrange — negative case: falling back to the site-wide connect-src 'none' would
    // stop the worker fetching anything, so precaching would fail outright.
    const weakened = SW.replace(/\n  Content-Security-Policy: default-src 'self'; connect-src 'self'/, "");

    // Act & Assert
    assert.ok(
      checkHeaders(parseHeaders(weakened)).some((p) => p.includes("no Content-Security-Policy of its own")),
    );
  });

  it("checkHeaders_WorkerNotUnsettingTheInheritedPolicy_IsReported", () => {
    // Arrange — negative case, and the one only a real deployment revealed. Pages
    // APPENDS matching rules, so the worker receives two policies and the browser
    // enforces their intersection: the site-wide connect-src 'none' still binds it and
    // precaching fails, while both headers look correct read individually.
    const weakened = SW.replace("  ! Content-Security-Policy\n", "");

    // Act
    const problems = checkHeaders(parseHeaders(weakened));

    // Assert
    assert.ok(problems.some((p) => p.includes("must unset the inherited")));
  });
});

describe("parseHeaders — removals", () => {
  it("parseHeaders_BangPrefixedLine_IsRecordedAsAnUnset", () => {
    // Arrange — Cloudflare's syntax for removing a header inherited from a broader rule.
    const source = "/sw.js\n  ! Content-Security-Policy\n  Cache-Control: no-cache\n";

    // Act
    const rules = parseHeaders(source);

    // Assert
    assert.ok(rules[0]?.unset.has("content-security-policy"));
    assert.equal(rules[0]?.headers.get("cache-control"), "no-cache");
  });

  it("parseHeaders_NoRemovals_LeavesTheSetEmpty", () => {
    // Arrange — negative case.
    const rules = parseHeaders("/*\n  A: 1\n");

    // Act & Assert
    assert.equal(rules[0]?.unset.size, 0);
  });
});
