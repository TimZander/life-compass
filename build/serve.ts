/**
 * A local preview server for `dist/`.
 *
 * Deliberately minimal and dependency-free. It only needs to resolve directory URLs to
 * their `index.html` the way Cloudflare Pages does, so that `/rigorous/` behaves
 * locally the way it will in production — the one behaviour worth reproducing, and the
 * one a naive file server gets wrong.
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { OUT } from "./build.ts";

/** `Number("abc")` is NaN, and `listen(NaN)` binds a random port while logging 4000. */
function port(): number {
  const raw = process.env["PORT"];
  if (raw === undefined) {
    return 4000;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(`PORT must be an integer between 0 and 65535, got "${raw}"`);
  }
  return parsed;
}

const CONTENT_TYPES = new Map<string, string>([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".json", "application/json"],
  [".txt", "text/plain; charset=utf-8"],
  [".webmanifest", "application/manifest+json"],
]);

/**
 * Map a request path to a file, or null.
 *
 * `root` is a parameter so tests can point at a fixture instead of the real `dist/`.
 * They used to read `dist/` directly and passed locally only because a build had
 * already been run — on a clean checkout `dist/` is gitignored and absent, so they
 * failed the moment they ran anywhere but my machine. A test that depends on a
 * previous command is a broken test, not a step-ordering problem.
 */
export async function resolveFile(urlPath: string, root: string = OUT): Promise<string | null> {
  // A malformed escape like `/%zz` makes decodeURIComponent throw URIError. Unhandled,
  // that rejects out of the request handler and takes the whole server down.
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  } catch {
    return null;
  }

  const candidate = path.join(root, path.normalize(decoded));

  // Never serve outside dist/, whatever the request says. The trailing separator
  // matters: without it a sibling directory sharing the prefix (`dist-notes/`) would
  // satisfy the check. Not reachable today — request paths are absolute, so normalize
  // drops leading `..` — but the guard should mean what it appears to mean.
  if (candidate !== root && !candidate.startsWith(root + path.sep)) {
    return null;
  }

  // Mirror what Cloudflare Pages does, in this order: an exact file, a directory's
  // index, then the extensionless form of a `.html` file. The third is not a nicety —
  // every link the build emits is now extensionless, so without it local preview 404s
  // on every navigation while production works fine.
  try {
    const info = await stat(candidate);
    if (!info.isDirectory()) {
      return candidate;
    }
    const index = path.join(candidate, "index.html");
    await stat(index);
    return index;
  } catch {
    // fall through to the extensionless lookup
  }

  // Attempted unconditionally rather than only for extensionless paths. Guarding on
  // `extname === ""` looks tidy and silently excludes any page whose name contains a
  // dot — `/v1.2-notes` has extname ".2-notes" — which would 404 locally while
  // production served it, the exact split this branch exists to prevent. A file that
  // does not exist simply fails the stat.
  try {
    const asHtml = `${candidate}.html`;
    await stat(asHtml);
    return asHtml;
  } catch {
    return null;
  }
}

export const server = http.createServer((request, response) => {
  void (async () => {
    try {
      const file = await resolveFile(request.url ?? "/");
      if (file === null) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("404\n");
        return;
      }
      const type = CONTENT_TYPES.get(path.extname(file)) ?? "application/octet-stream";
      response.writeHead(200, { "content-type": type });
      createReadStream(file).pipe(response);
    } catch (error) {
      // A preview server that dies on one bad request is worse than one that 500s.
      console.error(error);
      if (!response.headersSent) {
        response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      }
      response.end("500\n");
    }
  })();
});

// Listen only when run directly, so importing `resolveFile` in a test does not leave a
// server bound to a port for the lifetime of the suite.
if (process.argv[1] !== undefined && import.meta.filename === path.resolve(process.argv[1])) {
  const chosen = port();
  server.listen(chosen, () => {
    console.log(`Serving dist/ at http://localhost:${chosen}`);
  });
}
