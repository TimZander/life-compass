/**
 * Build the site into `dist/`.
 *
 * Fails on a broken internal link rather than emitting one. A dead link on a static
 * site is invisible until somebody clicks it, which on a site read once and then left
 * alone means effectively never — so the build is the only place it can be caught
 * cheaply.
 */

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { discover, pageUrls, type Page } from "./pages.ts";
import { render } from "./markdown.ts";
import { layout } from "./layout.ts";
import type { LinkContext, ResolvedLink } from "./links.ts";

export const ROOT: string = path.join(import.meta.dirname, "..");
export const OUT: string = path.join(ROOT, "dist");

export type BuiltPage = Page & {
  readonly html: string;
  readonly title: string | null;
  readonly links: readonly ResolvedLink[];
};

export type BuildResult = {
  readonly pages: readonly BuiltPage[];
  readonly assets: readonly string[];
  readonly broken: readonly ResolvedLink[];
};

/** Render every page. Pure with respect to the filesystem output — nothing is written. */
export async function buildPages(root: string = ROOT): Promise<BuildResult> {
  const { pages, assets } = await discover(root);
  const context: LinkContext = {
    urls: pageUrls(pages),
    assets: new Set(assets),
  };

  const built: BuiltPage[] = [];
  for (const page of pages) {
    const markdown = await readFile(path.join(root, page.source), "utf8");
    const { html, title, links } = render(markdown, page.source, context);
    built.push({ ...page, html: layout(html, title), title, links });
  }

  const broken = built.flatMap((page) => page.links.filter((link) => link.kind === "broken"));
  return { pages: built, assets, broken };
}

/** Render, verify, and write `dist/`. */
export async function build(root: string = ROOT, out: string = OUT): Promise<BuildResult> {
  const result = await buildPages(root);

  if (result.broken.length > 0) {
    const detail = result.broken
      .map((link) => `  ${link.source} -> ${link.raw}`)
      .join("\n");
    throw new Error(
      `${result.broken.length} broken internal link(s); refusing to build:\n${detail}`,
    );
  }

  await rm(out, { recursive: true, force: true });

  for (const page of result.pages) {
    const destination = path.join(out, page.output);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, page.html, "utf8");
  }

  for (const asset of result.assets) {
    const destination = path.join(out, asset);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(root, asset), destination);
  }

  return result;
}

// Only run when executed directly, so the test suite can import the functions above.
if (process.argv[1] !== undefined && import.meta.filename === path.resolve(process.argv[1])) {
  const result = await build();
  console.log(
    `Built ${result.pages.length} pages and copied ${result.assets.length} assets to dist/`,
  );
}
