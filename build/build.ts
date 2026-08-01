/**
 * Build the site into `dist/`.
 *
 * Refuses to emit when a link is broken, an anchor points at a heading that does not
 * exist, or a `.md` target survived into the output. A dead link on a static site is
 * invisible until somebody clicks it, which on a site read once and then left alone
 * means effectively never — so the build is the only place it can be caught cheaply.
 */

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { discover, pageUrls, type Page } from "./pages.ts";
import { render } from "./markdown.ts";
import { layout } from "./layout.ts";
import type { ResolvedLink } from "./links.ts";
import { checkRegistry, loadSchema, type Schema } from "./questions.ts";
import { checkHeaders, parseHeaders } from "./headers.ts";
import { WORKSHEETS, type Worksheet } from "../src/questions/index.ts";

export const ROOT: string = path.join(import.meta.dirname, "..");
export const OUT: string = path.join(ROOT, "dist");

export type BuiltPage = Page & {
  readonly html: string;
  readonly title: string | null;
  readonly links: readonly ResolvedLink[];
  readonly headingIds: readonly string[];
  readonly anchors: readonly string[];
};

export type ProblemKind =
  | "broken-link"
  | "missing-anchor"
  | "unrewritten-link"
  | "unresolved-question-anchor"
  | "unanchored-question"
  | "registry"
  | "headers";

export type BuildProblem = {
  readonly kind: ProblemKind;
  /** Repo-relative path of the page the problem was found in. */
  readonly source: string;
  readonly detail: string;
};

export type BuildResult = {
  readonly pages: readonly BuiltPage[];
  readonly assets: readonly string[];
  readonly problems: readonly BuildProblem[];
  readonly schema: Schema;
};

/** Any `.md` left in an emitted href means a link escaped rewriting — e.g. a raw `<a>`. */
const MARKDOWN_HREF = /(?:href|src)="([^"]*\.md(?:#[^"]*)?)"/g;

/**
 * Every anchor must name a heading that exists.
 *
 * Path correctness is only half of link integrity, and it is the half that fails
 * loudly. A fragment is silent: rename a heading and the page still resolves, the
 * reader just lands at the top with no indication anything is wrong. Given that the
 * slug rules here are deliberately quirky — see slug.ts — that is the half more likely
 * to rot.
 */
function checkAnchors(pages: readonly BuiltPage[]): BuildProblem[] {
  const idsByUrl = new Map<string, ReadonlySet<string>>(
    pages.map((page) => [page.url, new Set(page.headingIds)]),
  );
  const problems: BuildProblem[] = [];

  for (const page of pages) {
    for (const link of page.links) {
      if (link.kind === "external" || link.kind === "broken" || link.kind === "asset") {
        continue;
      }
      const hash = link.href.indexOf("#");
      if (hash === -1 || hash === link.href.length - 1) {
        continue;
      }
      const fragment = link.href.slice(hash + 1);
      // An anchor-only link targets the page it appears on.
      const targetUrl = link.kind === "anchor" ? page.url : link.href.slice(0, hash);
      const ids = idsByUrl.get(targetUrl);
      if (ids === undefined || ids.has(fragment)) {
        continue;
      }
      problems.push({
        kind: "missing-anchor",
        source: page.source,
        detail: `${link.raw} -> no heading with id "${fragment}" on ${targetUrl}`,
      });
    }
  }

  return problems;
}

/**
 * Anchors and questions must account for each other exactly.
 *
 * Both directions matter, and the second is the one that fails quietly. An anchor with
 * no question renders a stray HTML comment — visible, if anyone looks. A question with
 * no anchor renders nothing at all: the page is complete, well-formed, and simply
 * missing a section, with nothing anywhere to say so. That asymmetry is the whole reason
 * this is a bidirectional check rather than a lookup at render time.
 */
function checkQuestionAnchors(
  pages: readonly BuiltPage[],
  schema: Schema,
): readonly BuildProblem[] {
  const problems: BuildProblem[] = [];
  const seen = new Map<string, string>();

  for (const page of pages) {
    for (const id of page.anchors) {
      if (!schema.byId.has(id)) {
        problems.push({
          kind: "unresolved-question-anchor",
          source: page.source,
          detail: `<!-- questions: ${id} --> names no question`,
        });
        continue;
      }
      const already = seen.get(id);
      if (already !== undefined) {
        problems.push({
          kind: "unresolved-question-anchor",
          source: page.source,
          detail: `${id} is already anchored in ${already}; a question renders in one place`,
        });
        continue;
      }
      seen.set(id, page.source);
    }
  }

  for (const [source, questions] of schema.bySource) {
    for (const question of questions) {
      const where = seen.get(question.id);
      if (where === undefined) {
        problems.push({
          kind: "unanchored-question",
          source,
          detail: `${question.id} is defined but never anchored — it would render nowhere`,
        });
      } else if (where !== source) {
        problems.push({
          kind: "unanchored-question",
          source,
          detail: `${question.id} is declared for ${source} but anchored in ${where}`,
        });
      }
    }
  }

  return problems;
}

/**
 * Render every page and verify it. Nothing is written to disk.
 *
 * `out` is only used to keep the output directory out of the discovered content; see
 * `discover`. Pass it whenever the output lives inside `root`.
 *
 * `worksheets` is injectable for the same reason: the schema is global, so a fixture
 * root would otherwise be checked against the real Day 1 questions and report every one
 * of them as unanchored. Tests building a temp tree pass their own, or none.
 */
export async function buildPages(
  root: string = ROOT,
  out?: string,
  worksheets: readonly Worksheet[] = WORKSHEETS,
): Promise<BuildResult> {
  const { pages, assets } = await discover(root, out);
  const schema = loadSchema(worksheets);
  const context = {
    urls: pageUrls(pages),
    assets: new Set(assets),
    questions: schema.byId,
  };

  const built: BuiltPage[] = [];
  for (const page of pages) {
    const markdown = await readFile(path.join(root, page.source), "utf8");
    const { html, title, links, headingIds, anchors } = render(markdown, page.source, context);
    built.push({ ...page, html: layout(html, title), title, links, headingIds, anchors });
  }

  const problems: BuildProblem[] = [];

  for (const page of built) {
    for (const link of page.links) {
      if (link.kind === "broken") {
        problems.push({ kind: "broken-link", source: page.source, detail: link.raw });
      }
    }

    // Links inside raw HTML are not tokenised, so they bypass rewriting entirely and
    // would ship a dead `.md` target. Anything the resolver already saw is excluded —
    // a broken Markdown link also leaves its `.md` href in the output, and reporting
    // one defect under two names makes the error harder to read, not more thorough.
    const seen = new Set(page.links.map((link) => link.href));
    for (const match of page.html.matchAll(MARKDOWN_HREF)) {
      const href = match[1];
      if (href === undefined || seen.has(href)) {
        continue;
      }
      problems.push({
        kind: "unrewritten-link",
        source: page.source,
        detail: `${href} — a Markdown target reached the output, probably from raw HTML`,
      });
    }
  }

  problems.push(...checkAnchors(built));
  problems.push(...checkQuestionAnchors(built, schema));
  // _headers is deployed verbatim, so this cannot change what Cloudflare serves — it
  // refuses to build when the directives the privacy claim rests on have gone missing.
  // Only meaningful for the real root; a fixture has no _headers and needs none.
  if (root === ROOT) {
    const headersFile = path.join(root, "_headers");
    try {
      const declared = await readFile(headersFile, "utf8");
      problems.push(
        ...checkHeaders(parseHeaders(declared)).map((detail) => ({
          kind: "headers" as const,
          source: "_headers",
          detail,
        })),
      );
    } catch {
      problems.push({
        kind: "headers",
        source: "_headers",
        detail: "_headers is missing — the site would deploy with no security headers at all",
      });
    }
  }

  // The registry describes the real schema, so it is only meaningful against it.
  const registryProblems = worksheets === WORKSHEETS ? checkRegistry(schema) : [];
  problems.push(
    ...registryProblems.map((detail) => ({
      kind: "registry" as const,
      source: "src/questions/registry.ts",
      detail,
    })),
  );

  return { pages: built, assets, problems, schema };
}

/** Render, verify, and write. `out` is a parameter so tests can build to a temp dir. */
export async function build(
  root: string = ROOT,
  out: string = OUT,
  worksheets: readonly Worksheet[] = WORKSHEETS,
): Promise<BuildResult> {
  const result = await buildPages(root, out, worksheets);

  if (result.problems.length > 0) {
    const detail = result.problems
      .map((problem) => `  [${problem.kind}] ${problem.source}: ${problem.detail}`)
      .join("\n");
    throw new Error(`${result.problems.length} problem(s); refusing to build:\n${detail}`);
  }

  // `out` is about to be deleted recursively. Refuse anything that isn't a plausible
  // build directory, so a mistaken argument cannot take a real one with it.
  if (!path.isAbsolute(out) || path.dirname(out) === out) {
    throw new Error(`refusing to build into ${out}: expected an absolute, non-root path`);
  }

  await rm(out, { recursive: true, force: true });

  for (const page of result.pages) {
    const destination = path.join(out, page.output);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, page.html, "utf8");
  }

  // The schema as data, so the assistant contract and the importer can key off the
  // same definitions the pages were rendered from rather than a second copy (#15).
  await writeFile(
    path.join(out, "questions.json"),
    `${JSON.stringify({ worksheets: result.schema.worksheets }, null, 2)}\n`,
    "utf8",
  );

  for (const asset of result.assets) {
    const destination = path.join(out, asset);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(root, asset), destination);
  }

  return result;
}

// Only run when executed directly, so the test suite can import the functions above.
if (process.argv[1] !== undefined && import.meta.filename === path.resolve(process.argv[1])) {
  try {
    const result = await build();
    console.log(
      `Built ${result.pages.length} pages and copied ${result.assets.length} assets to dist/`,
    );
  } catch (error) {
    // The message is composed to be read; a stack trace here only buries it.
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
