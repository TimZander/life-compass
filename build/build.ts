/**
 * Build the site into `dist/`.
 *
 * Refuses to emit when a link is broken, an anchor points at a heading that does not
 * exist, or a `.md` target survived into the output. A dead link on a static site is
 * invisible until somebody clicks it, which on a site read once and then left alone
 * means effectively never — so the build is the only place it can be caught cheaply.
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { discover, pageUrls, type Page } from "./pages.ts";
import { render } from "./markdown.ts";
import { layout } from "./layout.ts";
import type { ResolvedLink } from "./links.ts";
import { checkRegistry, checkSchema, loadSchema, type Schema } from "./questions.ts";
import { checkHeaders, parseHeaders } from "./headers.ts";
import { icons } from "./icons.ts";
import { renderManifest } from "./manifest.ts";
import { buildClient } from "./client.ts";
import { renderServiceWorker, type PrecacheEntry } from "./serviceworker.ts";
import { WORKSHEETS, type Worksheet } from "../src/questions/index.ts";

export const ROOT: string = path.join(import.meta.dirname, "..");

/** The page that carries the backup and restore controls (#25). */
export const BACKUP_SOURCE = "backup.md";

/** The page that carries the assistant bridge and its opt-in (#67). */
export const AGENT_SOURCE = "agent.md";
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
  | "questionless-ask"
  | "registry"
  | "schema"
  | "task-list"
  | "hand-written-fill"
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
  /**
   * Question id -> the prose that introduces it on its page.
   *
   * The definitions know a question's identifier, label and fields and not what it asks,
   * because docs/decisions/0004 keeps the prose in Markdown. Read back off the page here so
   * that anything stating a question away from its worksheet — #67's prompt, and printing
   * (0010) eventually — says what the reader was actually asked rather than a label.
   */
  readonly asks: ReadonlyMap<string, string>;
};

/**
 * Inputs to a build. Every field is optional; the defaults describe the real site.
 *
 * `checkHeaders` and `checkRegistry` are named intent rather than something inferred from
 * `root` or `worksheets`. Each gates a check that is only meaningful against the real tree
 * — the `_headers` contract, and the registry that describes the global schema — so a
 * fixture that happens to reuse the real path or the real worksheets must not silently
 * re-enable them, and (the failure that motivated this) a path that resolves to the real
 * root but differs as a string must not silently switch the header check off. Both default
 * off, so a fixture is safe without saying so; the production build turns them on by naming
 * them, which is exactly two places — the CLI entry below and the real-content test.
 */
export type BuildOptions = {
  /** Source tree to build from. Defaults to the repository root. */
  readonly root?: string;
  /**
   * Output directory. Only used to keep itself out of the discovered content when it lives
   * inside `root`; see `discover`. `build` defaults it to `dist/`; `buildPages` writes
   * nothing and leaves it unset.
   */
  readonly out?: string;
  /**
   * Question definitions to check the tree against. Defaults to the shipped worksheets; the
   * schema is global, so a fixture root passes its own — or none — rather than have every
   * real Day 1 question reported as unanchored against it.
   */
  readonly worksheets?: readonly Worksheet[];
  /** Verify `_headers` declares, and ships, the policy the privacy claim rests on. */
  readonly checkHeaders?: boolean;
  /** Check the registry against the schema it describes. */
  readonly checkRegistry?: boolean;
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
 * See `BuildOptions` for what each field means and why the two check flags are explicit.
 */
export async function buildPages(options: BuildOptions = {}): Promise<BuildResult> {
  const {
    root = ROOT,
    out,
    worksheets = WORKSHEETS,
    checkHeaders: shouldCheckHeaders = false,
    checkRegistry: shouldCheckRegistry = false,
  } = options;
  const { pages, assets } = await discover(root, out);
  const schema = loadSchema(worksheets);
  const context = {
    urls: pageUrls(pages),
    assets: new Set(assets),
    questions: schema.byId,
  };

  const problems: BuildProblem[] = [];
  const built: BuiltPage[] = [];
  const asks = new Map<string, string>();
  for (const page of pages) {
    const markdown = await readFile(path.join(root, page.source), "utf8");
    const rendered = render(markdown, page.source, context);
    const { html, title, links, headingIds, anchors } = rendered;
    // The backup page is the one that carries the tools. Named by source rather than by
    // scanning the rendered HTML: the build knows which file it is reading, and deriving it
    // from the output would be a second answer to the same question, free to drift.
    const tools =
      page.source === BACKUP_SOURCE ? "backup" : page.source === AGENT_SOURCE ? "agent" : null;
    built.push({ ...page, html: layout(html, title, tools), title, links, headingIds, anchors });
    for (const [id, ask] of rendered.asks) {
      asks.set(id, ask);
    }
    for (const marker of rendered.taskMarkers) {
      problems.push({
        kind: "task-list",
        source: page.source,
        detail: `${marker} renders as literal text — a tick is a checklist question, not Markdown`,
      });
    }
    // Refused here, with the other page checks, because the build is the one gate every
    // page passes through: a hand-written blank renders correctly, looks like a field,
    // and is invisible to storage — or worse, copies an existing data-field and shares
    // its address — so nothing after the build would ever notice it. The render reports
    // it from the token stream so the decision records can keep discussing the markup
    // inside code spans and fences without tripping this.
    for (const markup of rendered.fillMarkup) {
      problems.push({
        kind: "hand-written-fill",
        source: page.source,
        detail: `${markup} — a hand-written blank; every blank is generated from a question definition (docs/decisions/0004)`,
      });
    }
  }

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

  // A question with no ask is a question nothing outside its own page can state. The rule
  // that reads the prose back off the page is structural rather than textual, so it can
  // capture the wrong paragraph or none at all when a worksheet is written in a shape it has
  // not seen — and capturing nothing is the half that would otherwise be silent. Seven
  // questions came out empty on the first attempt, all of them under a heading.
  for (const [id, question] of schema.byId) {
    if ((asks.get(id) ?? "").trim() === "") {
      problems.push({
        kind: "questionless-ask",
        source: [...schema.bySource].find(([, qs]) => qs.includes(question))?.[0] ?? id,
        detail: `${id} has no prose introducing it; nothing outside the page could state it`,
      });
    }
  }
  problems.push(
    ...checkSchema(schema).map((detail) => ({
      kind: "schema" as const,
      source: "src/questions",
      detail,
    })),
  );
  // _headers is deployed verbatim, so this cannot change what Cloudflare serves — it
  // refuses to build when the directives the privacy claim rests on have gone missing.
  // Gated on an explicit flag, not on `root`: a path that resolves to the real root but
  // differs as a string (a trailing slash, a symlink, an absolute-vs-relative spelling)
  // must not silently switch this security check off.
  if (shouldCheckHeaders) {
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

    // Validating the source file proves what was declared, not what ships. If _headers
    // ever stopped being copied — a SKIP_FILES edit, a change to discover — the policy
    // would vanish from production while this check still reported the contract intact.
    if (!assets.includes("_headers")) {
      problems.push({
        kind: "headers",
        source: "_headers",
        detail: "_headers is not among the copied assets, so it would never reach the deployed site",
      });
    }
  }

  // The registry describes the real schema, so it is only meaningful against it — and,
  // like the header check, gated on an explicit flag rather than on whether `worksheets`
  // is the real array, which a fixture could hold without wanting the registry checked.
  const registryProblems = shouldCheckRegistry ? checkRegistry(schema) : [];
  problems.push(
    ...registryProblems.map((detail) => ({
      kind: "registry" as const,
      source: "src/questions/registry.ts",
      detail,
    })),
  );

  return { pages: built, assets, problems, schema, asks };
}

/** Render, verify, and write. `out` is an option so tests can build to a temp dir. */
export async function build(options: BuildOptions = {}): Promise<BuildResult> {
  const {
    root = ROOT,
    out = OUT,
    worksheets = WORKSHEETS,
    checkHeaders = false,
    checkRegistry = false,
  } = options;
  const result = await buildPages({ root, out, worksheets, checkHeaders, checkRegistry });

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
  const schemaJson = `${JSON.stringify(
    { worksheets: result.schema.worksheets, asks: Object.fromEntries(result.asks) },
    null,
    2,
  )}\n`;
  await writeFile(path.join(out, "questions.json"), schemaJson, "utf8");

  // Everything the site serves, gathered as it is written so the service worker's
  // precache list and its cache version cover the same bytes that shipped. Anything
  // Pages consumes rather than serves is dropped by `precachable`, not here, so the
  // rule lives in one place.
  const precache: PrecacheEntry[] = [{ url: "/questions.json", content: schemaJson }];

  // Client modules are emitted rather than copied — the one thing on the site that is not
  // served exactly as it is committed. They join the precache here so the cache version
  // covers the code that shipped rather than the TypeScript it came from.
  for (const module of await buildClient(root)) {
    const destination = path.join(out, module.output);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, module.code, "utf8");
    precache.push({ url: `/${module.output}`, content: module.code });
  }

  for (const asset of result.assets) {
    const destination = path.join(out, asset);
    await mkdir(path.dirname(destination), { recursive: true });
    // Read rather than `cp`, because the bytes are needed for the cache version anyway
    // and reading them twice to avoid one buffer is a poor trade.
    const bytes = await readFile(path.join(root, asset));
    await writeFile(destination, bytes);
    precache.push({ url: `/${asset}`, content: bytes });
  }

  // Icons are generated rather than committed; a PWA cannot be installed without them,
  // and installation is what makes storage durable (docs/decisions/0008). Their names
  // carry a digest of their own bytes, so the manifest below changes whenever the drawing
  // does — see build/icons.ts and #62.
  for (const icon of icons()) {
    const destination = path.join(out, icon.output);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, icon.png);
    precache.push({ url: `/${icon.output}`, content: icon.png });
  }

  // Written here rather than copied from the root, so it names the icons just written
  // rather than a fixed path that survives them being redrawn. It has to be added to the
  // precache explicitly now: it used to arrive for free among the discovered assets.
  const manifest = renderManifest();
  await writeFile(path.join(out, "manifest.webmanifest"), manifest, "utf8");
  precache.push({ url: "/manifest.webmanifest", content: manifest });

  for (const page of result.pages) {
    precache.push({ url: page.url, content: page.html });
  }

  await writeFile(path.join(out, "sw.js"), renderServiceWorker(precache), "utf8");

  return result;
}

// Only run when executed directly, so the test suite can import the functions above.
if (process.argv[1] !== undefined && import.meta.filename === path.resolve(process.argv[1])) {
  try {
    // The real deploy: verify the header contract and the registry, the two checks that
    // only mean something against the real tree and that nothing downstream re-runs.
    const result = await build({ checkHeaders: true, checkRegistry: true });
    console.log(
      `Built ${result.pages.length} pages and copied ${result.assets.length} assets to dist/`,
    );
  } catch (error) {
    // The message is composed to be read; a stack trace here only buries it.
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
