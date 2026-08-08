/**
 * Client modules: TypeScript in, browser-ready JavaScript out.
 *
 * This is the same type stripping the build itself gets, moved to the only place it can
 * happen for the browser. Node 22.18+ erases types at load, which is why `node
 * build/build.ts` needs no compile step (docs/decisions/0003 · C1a); browsers have no
 * such feature, so something has to erase them before the file is served. That is all
 * this does.
 *
 * `transpileModule` and not a program: it strips types from one file at a time and emits
 * nothing else. No bundling and no downlevelling. The one thing it does rewrite is the
 * extension on a relative import — the source says `./keys.ts` so Node can run it, the
 * browser gets `./keys.js` — and nothing else about a specifier is touched (0012 · C5a).
 * Type CHECKING
 * stays where it was, in `tsc -p tsconfig.client.json --noEmit`, so this step cannot
 * report an error and cannot silently pass one either: it never looks.
 *
 * `erasableSyntaxOnly` in that config is what makes the split safe. It rejects enums,
 * parameter properties and namespaces — everything whose emit would be more than
 * erasure — so what ships is always the source minus its types.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

/** Where the modules live, and the URL prefix they are served under. */
export const CLIENT_DIR = "src/client";
export const CLIENT_URL_PREFIX = "assets/js";

export type ClientModule = {
  /** Output path relative to the site root, e.g. `assets/js/banner.js`. */
  readonly output: string;
  readonly code: string;
};

const OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2023,
  module: ts.ModuleKind.ESNext,
  verbatimModuleSyntax: true,
  // The one rewrite this does: `./keys.ts` becomes `./keys.js`. Nothing else about a
  // specifier is touched — no resolution, no bundling, no knowledge of how the site is
  // served, which is the coupling 0003 avoided by not having a bundler.
  //
  // The sources say `.ts` so that Node can run them, which is what makes this tier
  // testable at all: a client module importing another as `./keys.js` is a path Node
  // cannot resolve from source. app.ts has always imported siblings at runtime and a
  // browser resolves every one — but app.ts has no test, so Node was never asked to load
  // one. keys.ts is the first sibling that a TESTED module imports.
  rewriteRelativeImportExtensions: true,
};

/**
 * Transpile every client module, in a stable order.
 *
 * Sorted because the caller feeds these into the service worker's precache list, whose
 * hash is the cache version — directory order varies by filesystem, and a version that
 * changes when nothing did would ask every reader to accept an update for nothing.
 */
export async function buildClient(root: string): Promise<readonly ClientModule[]> {
  const directory = path.join(root, CLIENT_DIR);
  // A fixture root has no client modules and needs none. Returning empty rather than
  // gating on `root === ROOT` keeps the string-identity check out of this path; the real
  // root is guarded instead by a test asserting it emits exactly the modules it should,
  // so a directory that goes missing fails loudly rather than emitting nothing quietly.
  //
  // Only a missing directory is tolerated. Swallowing every error meant a permissions or
  // I/O failure produced a site with no client JavaScript and a build that said it
  // succeeded, which is the same silence with none of the reason.
  let found: string[];
  try {
    // Recursive, because tsconfig.client.json checks `src/client/**/*.ts`. Reading only
    // the top level meant a module in a subdirectory typechecked and was never emitted —
    // an import that resolves for the compiler and 404s for the browser.
    found = await readdir(directory, { recursive: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  // `.d.ts` carries no code and `.test.ts` is not for shipping; both would otherwise be
  // emitted and published, and these files bypass the discovered-asset list that exists
  // to stop exactly that.
  const entries = found
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".d.ts") && !name.endsWith(".test.ts"))
    .map((name) => name.split(path.sep).join("/"))
    .sort();

  const modules: ClientModule[] = [];
  for (const entry of entries) {
    const source = await readFile(path.join(directory, entry), "utf8");
    const { outputText, diagnostics } = ts.transpileModule(source, {
      compilerOptions: OPTIONS,
      fileName: entry,
      reportDiagnostics: true,
    });
    // Without this a syntax error emits `export {};` — an empty module — and the build
    // reports success. Every function the file exported becomes undefined at the import
    // site, which is a harder failure to trace than the error being thrown here.
    if (diagnostics !== undefined && diagnostics.length > 0) {
      const detail = diagnostics
        .map((one) => ts.flattenDiagnosticMessageText(one.messageText, " "))
        .join("; ");
      throw new Error(`${CLIENT_DIR}/${entry} could not be transpiled: ${detail}`);
    }
    modules.push({
      output: `${CLIENT_URL_PREFIX}/${entry.replace(/\.ts$/, ".js")}`,
      code: outputText,
    });
  }
  checkSpecifiers(modules);
  return modules;
}


/** Relative specifiers in emitted code, e.g. `from "./keys.js"` or `import "./app.js"`. */
const RELATIVE_SPECIFIER = /(?:^|[\s{(,;])(?:from|import)\s*\(?\s*"(\.[^"]*)"/g;

/**
 * Refuse a module graph the browser cannot load.
 *
 * `buildClient` discovers files by reading a directory, so a module that is absent is not an
 * error here — it is simply not in the list. That was survivable while every module was
 * committed. It stopped being survivable when one of them became GENERATED: delete
 * `src/client/schema.ts`, and the build emitted `prompt.js` importing `./schema.js`, shipped
 * it, left it out of the precache — so `cache.addAll` succeeded, the deploy smoke test read
 * one fewer URL from the manifest, and every gate passed on a site whose client was dead.
 *
 * Checking that each specifier resolves to something actually emitted closes that whole
 * family at once rather than one entry point at a time: a skipped `prebuild` hook, `node
 * --run`, `npm run serve`, a symlinked checkout, a fresh clone. None of them can produce a
 * build that says it succeeded, because none of them can produce an import that resolves.
 */
export function checkSpecifiers(modules: readonly ClientModule[]): void {
  const emitted = new Set(modules.map((module) => module.output));
  const problems: string[] = [];

  for (const module of modules) {
    const directory = path.dirname(module.output);
    for (const [, specifier] of module.code.matchAll(RELATIVE_SPECIFIER)) {
      if (specifier === undefined) {
        continue;
      }
      const target = path.posix.normalize(path.posix.join(directory, specifier));
      if (!emitted.has(target)) {
        problems.push(`${module.output} imports ${specifier}, which nothing emits (${target})`);
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(`refusing to emit a client graph the browser cannot load:\n  ${problems.join("\n  ")}`);
  }
}
