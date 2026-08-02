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
 * nothing else. No bundling, no downlevelling, no module rewriting — the `./banner.js`
 * specifier a browser resolves is the same specifier the source imports. Type CHECKING
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
  // The source's import specifiers are already what the browser needs. Anything that
  // rewrites them would have to know how the site is served, which is the coupling
  // 0003 avoided by not having a bundler at all.
  verbatimModuleSyntax: true,
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
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return [];
  }
  entries = entries.filter((name) => name.endsWith(".ts")).sort();

  const modules: ClientModule[] = [];
  for (const entry of entries) {
    const source = await readFile(path.join(directory, entry), "utf8");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: OPTIONS,
      fileName: entry,
    });
    modules.push({
      output: `${CLIENT_URL_PREFIX}/${entry.replace(/\.ts$/, ".js")}`,
      code: outputText,
    });
  }
  return modules;
}
