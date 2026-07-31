/**
 * Rewriting `[Day 2](day-2-values.md)` into a working URL.
 *
 * This is a LOOKUP, not a string substitution. Replacing `.md` with `.html` would be
 * shorter and would be wrong: `rigorous/README.md` is served at `/rigorous/`, not at
 * `/rigorous/README.html`. Every link is therefore resolved to a real source file and
 * then asked what URL that file was published at, so the README-becomes-index rule in
 * pages.ts is honoured automatically instead of being re-implemented here and drifting.
 *
 * Resolution also classifies, which is what lets the build fail on a broken link rather
 * than emit one. A link to `LICENSE` is legitimate — it is copied to the output as an
 * asset — while a link to a file that exists nowhere is a defect, and the two are only
 * distinguishable if assets are enumerated rather than assumed.
 */

import path from "node:path";

export type LinkKind = "page" | "asset" | "anchor" | "external" | "broken";

export type ResolvedLink = {
  /** The href exactly as written in the Markdown. */
  readonly raw: string;
  /** Repo-relative POSIX path of the page the link appears in. */
  readonly source: string;
  readonly kind: LinkKind;
  /** What to emit. Unchanged from `raw` for external and anchor-only links. */
  readonly href: string;
  /** Repo-relative path this resolved to, for page and asset links. */
  readonly target: string | null;
};

export type LinkContext = {
  /** Source path -> served URL, from `pageUrls()`. */
  readonly urls: ReadonlyMap<string, string>;
  /** Repo-relative paths of files copied verbatim to the output. */
  readonly assets: ReadonlySet<string>;
};

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/** Split `page.md#section` into its path and its `#section` suffix. */
function splitFragment(href: string): { readonly path: string; readonly suffix: string } {
  const hash = href.indexOf("#");
  if (hash === -1) {
    return { path: href, suffix: "" };
  }
  return { path: href.slice(0, hash), suffix: href.slice(hash) };
}

/** Resolve one link found in `source` against the site's pages and assets. */
export function resolveLink(raw: string, source: string, context: LinkContext): ResolvedLink {
  if (raw === "" || EXTERNAL.test(raw)) {
    return { raw, source, kind: "external", href: raw, target: null };
  }
  if (raw.startsWith("#")) {
    return { raw, source, kind: "anchor", href: raw, target: null };
  }

  const { path: rawPath, suffix } = splitFragment(raw);
  const fromDir = path.posix.dirname(source);

  // Normalize keeps a trailing slash, which would produce `docs/decisions//README.md`
  // below — a path that matches nothing and reports a working link as broken.
  const resolved = path.posix
    .normalize(path.posix.join(fromDir, rawPath))
    .replace(/\/+$/, "");

  // A link ending in `/` addresses a directory, which is published from that
  // directory's README.md. The repo's own README links to `docs/decisions/` this way.
  const candidates = rawPath.endsWith("/")
    ? [`${resolved}/README.md`]
    : [resolved, `${resolved}/README.md`];

  for (const candidate of candidates) {
    const url = context.urls.get(candidate);
    if (url !== undefined) {
      return { raw, source, kind: "page", href: `${url}${suffix}`, target: candidate };
    }
  }

  if (context.assets.has(resolved)) {
    return { raw, source, kind: "asset", href: `/${resolved}${suffix}`, target: resolved };
  }

  return { raw, source, kind: "broken", href: raw, target: null };
}
