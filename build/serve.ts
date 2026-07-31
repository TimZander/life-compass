/**
 * A local preview server for `dist/`, replacing what `jekyll serve` used to provide.
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

const PORT = Number(process.env["PORT"] ?? 4000);

const CONTENT_TYPES = new Map<string, string>([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".json", "application/json"],
]);

async function resolveFile(urlPath: string): Promise<string | null> {
  const decoded = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  const candidate = path.join(OUT, path.normalize(decoded));

  // Never serve outside dist/, whatever the request says.
  if (!candidate.startsWith(OUT)) {
    return null;
  }

  try {
    const info = await stat(candidate);
    if (info.isDirectory()) {
      const index = path.join(candidate, "index.html");
      await stat(index);
      return index;
    }
    return candidate;
  } catch {
    return null;
  }
}

const server = http.createServer((request, response) => {
  void (async () => {
    const file = await resolveFile(request.url ?? "/");
    if (file === null) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("404\n");
      return;
    }
    const type = CONTENT_TYPES.get(path.extname(file)) ?? "application/octet-stream";
    response.writeHead(200, { "content-type": type });
    createReadStream(file).pipe(response);
  })();
});

server.listen(PORT, () => {
  console.log(`Serving dist/ at http://localhost:${PORT}`);
});
