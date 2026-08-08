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
import type { Worksheet } from "../src/questions/index.ts";

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
  return modules;
}

/**
 * The question definitions, as a module the browser can load.
 *
 * The client needs them — #67 to build a prompt for a group, #68 to check that a block
 * names a group that exists and to know which shape its answers take — and until now it
 * had no way to get them. `import.ts` says so outright: "the client has no copy of the
 * question set", which is why it identifies instance orders by shape rather than by
 * schema.
 *
 * It cannot be fetched. `connect-src 'none'` (docs/decisions/0006, 0007 · C1) blocks
 * fetch, XHR and beacon outright, and that rule is the privacy claim rather than an
 * obstacle in front of it — a test fails CI if it weakens. So the schema arrives as
 * script, which `script-src 'self'` already permits and `connect-src` never governs.
 * docs/decisions/0015 records the choice.
 *
 * Generated rather than committed, from the same worksheets the pages were rendered from,
 * so there is no second copy of the question set to drift. `src/client/schema.d.ts` types
 * it; that file is a declaration, so `buildClient` above skips it and this is what ships
 * in its place.
 */
export function schemaModule(worksheets: readonly Worksheet[]): ClientModule {
  return {
    output: `${CLIENT_URL_PREFIX}/schema.js`,
    code:
      `// Generated by build/client.ts. Editing this file achieves nothing.\n` +
      `//\n` +
      `// The question definitions, served as script because connect-src 'none' means the\n` +
      `// page cannot fetch them (docs/decisions/0015).\n` +
      `export const WORKSHEETS = ${JSON.stringify(worksheets, null, 2)};\n`,
  };
}
