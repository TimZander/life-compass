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

/**
 * Split a policy into `directive -> sources`.
 *
 * Checking a policy by substring answers "does this text appear?" when the question is
 * "is this directive exactly this?" — and those differ in the direction that matters.
 * Policies are almost never weakened by deleting a directive; they are weakened by
 * appending one more source to an existing one. `connect-src 'none' https://elsewhere`
 * contains the substring `connect-src 'none'` and is not remotely the same policy.
 */
export function parseCsp(value: string): ReadonlyMap<string, readonly string[]> {
  const directives = new Map<string, readonly string[]>();
  for (const part of value.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/).filter((token) => token !== "");
    if (name !== undefined) {
      directives.set(name.toLowerCase(), sources);
    }
  }
  return directives;
}

/** Directives whose source list must match exactly, and why. */
const REQUIRED_CSP: readonly {
  readonly directive: string;
  readonly sources: readonly string[];
  readonly because: string;
}[] = [
  {
    directive: "default-src",
    sources: ["'self'"],
    because: "third-party resources would load again",
  },
  {
    directive: "connect-src",
    sources: ["'none'"],
    because: "the application could transmit data — this is the privacy claim",
  },
  {
    directive: "form-action",
    sources: ["'none'"],
    because: "a form could exfiltrate answers with no script involved",
  },
];

/** Headers whose absence is a regression, with the reason each exists. */
const REQUIRED_HEADERS: readonly (readonly [name: string, because: string])[] = [
  ["x-content-type-options", "a mistyped content type could be reinterpreted as executable"],
  ["referrer-policy", "a worksheet URL names which day someone is working through"],
  ["permissions-policy", "docs/decisions/0006 decided this application asks for no microphone"],
];

/** Sources that are a bare keyword: `'self'`, `'none'`. Anything else names something. */
const KEYWORD_SOURCE = /^'[a-z0-9-]+'$/;

/** Keywords that are syntactically fine and defeat the point. */
const FORBIDDEN_KEYWORDS: ReadonlySet<string> = new Set(["'unsafe-inline'", "'unsafe-eval'"]);

/** Report anything that would quietly weaken the contract. */
export function checkHeaders(rules: readonly HeaderRule[]): readonly string[] {
  const problems: string[] = [];

  const catchAll = rules.find((rule) => rule.path === "/*");
  if (catchAll === undefined) {
    problems.push('_headers has no "/*" rule, so no policy applies to the site at all');
    return problems;
  }

  const declared = catchAll.headers.get("content-security-policy");
  if (declared === undefined) {
    problems.push('_headers "/*" declares no Content-Security-Policy');
    return problems;
  }

  const csp = parseCsp(declared);

  for (const { directive, sources, because } of REQUIRED_CSP) {
    const actual = csp.get(directive);
    if (actual === undefined) {
      problems.push(`CSP has no ${directive} — without it, ${because}`);
      continue;
    }
    if (actual.length !== sources.length || actual.some((src, i) => src !== sources[i])) {
      problems.push(
        `CSP ${directive} is "${actual.join(" ")}", expected exactly "${sources.join(" ")}" — ${because}`,
      );
    }
  }

  // The broader rule, and the one that catches the realistic drift. This site is
  // entirely self-hosted by construction: no CDN (docs/decisions/0003), nothing external
  // (0006). So no directive may name a host, scheme or wildcard — not just the three
  // above. An `img-src https://cdn…` added in two years by someone who has not read 0006
  // fails the build rather than quietly ending the privacy claim. If a `data:` icon is
  // ever genuinely wanted, this failing is the point: the exemption gets added on purpose.
  for (const [directive, sources] of csp) {
    for (const source of sources) {
      if (!KEYWORD_SOURCE.test(source)) {
        problems.push(
          `CSP ${directive} names ${source}; only keyword sources are allowed, because nothing on this site is loaded from anywhere else`,
        );
      } else if (FORBIDDEN_KEYWORDS.has(source)) {
        problems.push(`CSP ${directive} allows ${source}, which defeats the policy`);
      }
    }
  }

  for (const [header, because] of REQUIRED_HEADERS) {
    if (!catchAll.headers.has(header)) {
      problems.push(`_headers "/*" no longer sets ${header} — ${because}`);
    }
  }

  return problems;
}
