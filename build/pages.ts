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

/** Directories that never contribute pages or assets. */
const SKIP_DIRS = new Set([
  ".git",
  ".github",
  ".claude",
  "node_modules",
  "dist",
  "_layouts",
  // The build's own sources. Anything not recognised as a page is copied verbatim, so
  // without this the TypeScript that produced the site ships alongside it.
  "build",
]);

/** Files that are neither pages nor deployable assets. */
const SKIP_FILES = new Set([
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  ".gitignore",
  "_config.yml",
]);

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
  /** Repo-relative POSIX paths copied verbatim into the output (CSS, LICENSE, CNAME). */
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
 * The URL a page is served at. `index.html` is dropped so directories are addressed
 * as `/rigorous/` — which is what the site nav links to, and what a link written as
 * `rigorous/README.md` has to resolve to.
 */
function urlFor(output: string): string {
  const withoutIndex = output.replace(/(^|\/)index\.html$/, "$1");
  return `/${withoutIndex}`;
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
    if (SKIP_FILES.has(entry.name)) {
      continue;
    }
    out.push(rel);
  }
}

/** Discover every page and asset under `root`. */
export async function discover(root: string): Promise<Content> {
  const found: string[] = [];
  await walk(root, "", found);
  found.sort();

  const pages: Page[] = [];
  const assets: string[] = [];

  for (const source of found) {
    if (source.endsWith(".md")) {
      const output = outputPathFor(source);
      pages.push({ source, output, url: urlFor(output) });
    } else {
      assets.push(source);
    }
  }

  return { pages, assets };
}

/** Source path -> served URL, for resolving links between pages. */
export function pageUrls(pages: readonly Page[]): ReadonlyMap<string, string> {
  return new Map(pages.map((page) => [page.source, page.url]));
}
