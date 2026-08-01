/**
 * Which files become pages, which are copied as-is, and what URL each page gets.
 *
 * The URL rules reproduce what GitHub Pages currently does for this repo via
 * jekyll-readme-index and jekyll-optional-front-matter:
 *
 *   README.md              ->  /index.html          (served at /)
 *   rigorous/README.md     ->  /rigorous/index.html (served at /rigorous/)
 *   days/day-1-...md       ->  /days/day-1-....html
 *
 * The README rule applies in EVERY directory, not just the root. `rigorous/README.md`
 * is linked from four places and the site nav points at `/rigorous/`, so getting this
 * wrong breaks navigation rather than one stray link.
 *
 * Extensions are kept (`.html`, not extensionless) because that is what the live site
 * serves today and what the nav in the layout hard-codes. Prettier URLs would be a
 * separate, deliberate change with redirects — not something to slip into a rewrite
 * whose whole purpose is producing identical output.
 */

import { readdir } from "node:fs/promises";
import path from "node:path";

/**
 * Directories that never contribute pages or assets.
 *
 * Dot-prefixed directories (`.git`, `.github`, `.claude`) are already skipped by the
 * check in `walk`, so listing them here would only imply a protection this set is not
 * the one providing. Matching is by basename at any depth — a nested `build/` or
 * `dist/` anywhere in the tree would also be skipped, which is worth knowing before
 * naming a content directory either of those.
 */
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  // The build's own sources. Anything not recognised as a page is copied verbatim, so
  // without this the TypeScript that produced the site ships alongside it.
  "build",
  // Question definitions. Consumed by the build; not published as-is.
  "src",
]);

/**
 * Files that are neither pages nor deployable assets. Dot-files are skipped in `walk`.
 *
 * Patterns rather than exact names, because exact names are whack-a-mole: `tsconfig.json`
 * was listed and `tsconfig.client.json` was not, so the client typecheck config shipped
 * to the live site and into every visitor's precache. Discovery treats anything that is
 * not Markdown as an asset, which is permissive by default — so the safety net is the
 * explicit asset list asserted in build.test.ts, not this.
 */
const SKIP_FILES: readonly RegExp[] = [
  /^package(-lock)?\.json$/,
  /^tsconfig(\..+)?\.json$/,
];

function isSkipped(name: string): boolean {
  return SKIP_FILES.some((pattern) => pattern.test(name));
}

export type Page = {
  /** Repo-relative POSIX path of the Markdown source, e.g. `days/day-1-excavation.md`. */
  readonly source: string;
  /** Repo-relative POSIX path of the emitted file, e.g. `days/day-1-excavation.html`. */
  readonly output: string;
  /** Root-absolute URL the page is served at, e.g. `/days/day-1-excavation.html`. */
  readonly url: string;
};

export type Content = {
  readonly pages: readonly Page[];
  /** Repo-relative POSIX paths copied verbatim into the output (CSS, LICENSE). */
  readonly assets: readonly string[];
};

/** `README.md` becomes the directory index; everything else keeps its name. */
function outputPathFor(source: string): string {
  const dir = path.posix.dirname(source);
  const base = path.posix.basename(source);
  const name = base === "README.md" ? "index.html" : base.replace(/\.md$/, ".html");
  return dir === "." ? name : `${dir}/${name}`;
}

/**
 * The URL a page is served at.
 *
 * `index.html` becomes a directory URL (`/rigorous/`), and every other page drops its
 * extension (`/days/day-1-excavation`). The FILES keep their `.html` names — Cloudflare
 * Pages canonicalises `/page.html` to `/page` with a 308, so emitting the extension
 * would put a redirect on all 206 internal links, and a service worker caching by
 * request URL would cache redirects rather than pages (docs/decisions/0005 · C6).
 *
 * Keeping the files means links written before this change still resolve, via that same
 * redirect. This inverts the reasoning that originally kept extensions — "that is what
 * the live site serves" — which stopped being true when the live site became this build.
 */
function urlFor(output: string): string {
  const withoutIndex = output.replace(/(^|\/)index\.html$/, "$1");
  if (withoutIndex !== output) {
    return `/${withoutIndex}`;
  }
  return `/${output.replace(/\.html$/, "")}`;
}

async function walk(root: string, relative: string, out: string[]): Promise<void> {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".well-known") {
      continue;
    }
    const rel = relative === "" ? entry.name : `${relative}/${entry.name}`;

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      await walk(root, rel, out);
      continue;
    }
    if (isSkipped(entry.name)) {
      continue;
    }
    out.push(rel);
  }
}

/**
 * Discover every page and asset under `root`.
 *
 * `exclude` is an absolute directory kept out of the results — the build's own output
 * directory. Without it, building into a directory inside the source tree discovers
 * the previous build's files as assets, deletes them while clearing the output, and
 * then fails trying to copy them. `dist` in SKIP_DIRS covers the default path by name;
 * this covers it by identity, for any output location.
 */
export async function discover(root: string, exclude?: string): Promise<Content> {
  const found: string[] = [];
  await walk(root, "", found);

  const excluded = exclude === undefined ? null : path.resolve(exclude);
  const kept = (excluded === null
    ? [...found]
    : found.filter((relative) => {
        const absolute = path.resolve(root, relative);
        return absolute !== excluded && !absolute.startsWith(excluded + path.sep);
      })
  ).sort();

  const pages: Page[] = [];
  const assets: string[] = [];

  const claimed = new Map<string, string>();
  for (const source of kept) {
    if (!source.endsWith(".md")) {
      assets.push(source);
      continue;
    }

    const output = outputPathFor(source);

    // Two sources can map to one output — `index.md` alongside `README.md` is the
    // realistic case. Without this the second write silently wins and one page
    // disappears from a site nobody is watching closely.
    const existing = claimed.get(output);
    if (existing !== undefined) {
      throw new Error(`${source} and ${existing} would both be written to ${output}`);
    }
    claimed.set(output, source);

    pages.push({ source, output, url: urlFor(output) });
  }

  return { pages, assets };
}

/** Source path -> served URL, for resolving links between pages. */
export function pageUrls(pages: readonly Page[]): ReadonlyMap<string, string> {
  return new Map(pages.map((page) => [page.source, page.url]));
}
