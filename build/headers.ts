/**
 * Parsing and checking `_headers`.
 *
 * The file is deployed verbatim, so nothing here changes what Cloudflare serves. What it
 * does is refuse to build when the directives the privacy claim rests on have gone
 * missing or been weakened — because docs/decisions/0006 promises the application
 * transmits nothing, and the only thing making that true rather than aspirational is
 * `connect-src 'none'` actually being present.
 *
 * A weakened policy is a silent failure by construction: every page still renders, every
 * test that does not look at headers still passes, and the claim in the documentation
 * quietly stops being true.
 */

export type HeaderRule = {
  /** Path pattern the rule applies to, e.g. `/*`. */
  readonly path: string;
  /** Header name (lowercased) -> value. */
  readonly headers: ReadonlyMap<string, string>;
};

/**
 * Parse the Cloudflare Pages `_headers` format: a path on its own line, followed by
 * indented `Name: value` lines. Comments and blank lines are ignored.
 */
export function parseHeaders(source: string): readonly HeaderRule[] {
  const rules: { path: string; headers: Map<string, string> }[] = [];

  for (const raw of source.split("\n")) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }

    // Indented lines belong to the rule above them; unindented lines start a new one.
    if (/^\s/.test(line)) {
      const current = rules[rules.length - 1];
      const separator = trimmed.indexOf(":");
      if (current === undefined || separator === -1) {
        continue;
      }
      current.headers.set(
        trimmed.slice(0, separator).trim().toLowerCase(),
        trimmed.slice(separator + 1).trim(),
      );
      continue;
    }

    rules.push({ path: trimmed, headers: new Map() });
  }

  return rules.map((rule) => ({ path: rule.path, headers: rule.headers }));
}

/** Directives that must be present on `/*`, and why removing one matters. */
const REQUIRED_CSP: readonly (readonly [directive: string, because: string])[] = [
  ["default-src 'self'", "third-party resources would load again"],
  ["connect-src 'none'", "the application could transmit data — this is the privacy claim"],
  ["form-action 'none'", "a form could exfiltrate answers with no script involved"],
];

/** Report anything that would quietly weaken the contract. */
export function checkHeaders(rules: readonly HeaderRule[]): readonly string[] {
  const problems: string[] = [];

  const catchAll = rules.find((rule) => rule.path === "/*");
  if (catchAll === undefined) {
    problems.push('_headers has no "/*" rule, so no policy applies to the site at all');
    return problems;
  }

  const csp = catchAll.headers.get("content-security-policy");
  if (csp === undefined) {
    problems.push('_headers "/*" declares no Content-Security-Policy');
    return problems;
  }

  for (const [directive, because] of REQUIRED_CSP) {
    if (!csp.includes(directive)) {
      problems.push(`_headers "/*" CSP is missing ${directive} — without it, ${because}`);
    }
  }

  for (const header of ["x-content-type-options", "referrer-policy"]) {
    if (!catchAll.headers.has(header)) {
      problems.push(`_headers "/*" no longer sets ${header}`);
    }
  }

  return problems;
}
