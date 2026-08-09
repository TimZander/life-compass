import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import ts from "typescript";
import { ROOT } from "./build.ts";
import { buildClient } from "./client.ts";
import { layout } from "./layout.ts";
import { cacheVersion, precachable, renderServiceWorker } from "./serviceworker.ts";

/**
 * The emitted modules, keyed by output path.
 *
 * Read from the emit rather than from `src/client/*.ts`, because the emit is what the
 * browser gets. Asserting against the source would have kept passing if the transpile
 * step ever stopped running — and these assertions exist precisely because a silent
 * failure on this tier removes offline support and storage durability with no signal.
 */
let emitted: Promise<Map<string, string>> | undefined;
function client(name: string): Promise<string> {
  emitted ??= buildClient(ROOT).then(
    (modules) => new Map(modules.map((module) => [module.output, module.code])),
  );
  return emitted.then((modules) => {
    const code = modules.get(`assets/js/${name}`);
    assert.ok(code !== undefined, `no emitted module for ${name}`);
    return code;
  });
}

const ENTRIES = [
  { url: "/", content: "<p>home</p>" },
  { url: "/days/day-1-excavation", content: "<p>day one</p>" },
  { url: "/assets/css/style.css", content: "body{}" },
];

/** Pull the generated constants back out, so the tests read what ships. */
function precacheOf(source: string): readonly string[] {
  const match = /const PRECACHE = (\[[\s\S]*?\]);/.exec(source);
  assert.ok(match?.[1] !== undefined, "PRECACHE not found in the generated worker");
  return JSON.parse(match[1]) as string[];
}

describe("precachable", () => {
  it("precachable_UnderscorePrefixedFile_IsExcluded", () => {
    // Arrange — Cloudflare consumes _headers rather than serving it. Because addAll is
    // atomic, precaching it would 404, reject, and leave the site with no worker at all.
    const entries = [...ENTRIES, { url: "/_headers", content: "/*" }];

    // Act
    const kept = precachable(entries).map((entry) => entry.url);

    // Assert
    assert.ok(!kept.includes("/_headers"));
    assert.equal(kept.length, ENTRIES.length);
  });

  it("precachable_NestedUnderscoreFile_IsAlsoExcluded", () => {
    // Arrange — negative case: the rule is about the filename, at any depth.
    const entries = [{ url: "/nested/_redirects", content: "x" }];

    // Act & Assert
    assert.deepEqual(precachable(entries), []);
  });

  it("precachable_OrdinaryUrlContainingUnderscore_IsKept", () => {
    // Arrange — negative case: `day_one` is a page, not a Pages control file.
    const entries = [{ url: "/days/day_one", content: "x" }];

    // Act & Assert
    assert.equal(precachable(entries).length, 1);
  });
});

describe("cacheVersion", () => {
  it("cacheVersion_SameContent_IsStable", () => {
    // Arrange — a rebuild with no change must not invalidate every client's cache.
    // Act & Assert
    assert.equal(cacheVersion(ENTRIES), cacheVersion(ENTRIES));
  });

  it("cacheVersion_ChangedContent_Differs", () => {
    // Arrange — an unchanged name means an unchanged cache, so a deploy would never
    // reach an installed client.
    const edited = ENTRIES.map((e) => (e.url === "/" ? { ...e, content: "<p>edited</p>" } : e));

    // Act & Assert
    assert.notEqual(cacheVersion(ENTRIES), cacheVersion(edited));
  });

  it("cacheVersion_RenamedPageWithIdenticalContent_Differs", () => {
    // Arrange — hashing content alone would miss this, and it is a real change:
    // the old URL stops existing.
    const renamed = ENTRIES.map((e) => (e.url === "/" ? { ...e, url: "/home" } : e));

    // Act & Assert
    assert.notEqual(cacheVersion(ENTRIES), cacheVersion(renamed));
  });

  it("cacheVersion_ReorderedEntries_IsUnchanged", () => {
    // Arrange — discovery order is not a change to the site.
    const shuffled = [...ENTRIES].reverse();

    // Act & Assert
    assert.equal(cacheVersion(ENTRIES), cacheVersion(shuffled));
  });
});

describe("renderServiceWorker", () => {
  it("renderServiceWorker_Output_IsSyntacticallyValidJavaScript", () => {
    // Arrange — the worker ships as generated text and is never typechecked, so a
    // syntax error would reach production silently. `new Function` parses without
    // running, which is all that can be checked outside a worker scope.
    const source = renderServiceWorker(ENTRIES);

    // Act & Assert
    assert.doesNotThrow(() => new Function(source));
  });

  it("renderServiceWorker_PrecacheList_IsSortedAndComplete", () => {
    // Act
    const urls = precacheOf(renderServiceWorker(ENTRIES));

    // Assert — sorted so an unrelated reordering does not churn the generated file.
    assert.deepEqual(urls, [...urls].sort());
    assert.deepEqual([...urls].sort(), [...ENTRIES.map((e) => e.url)].sort());
  });

  it("renderServiceWorker_UnservedFile_NeverReachesThePrecacheList", () => {
    // Arrange — negative case, and the one that would break every install.
    const source = renderServiceWorker([...ENTRIES, { url: "/_headers", content: "/*" }]);

    // Act & Assert
    assert.ok(!precacheOf(source).includes("/_headers"));
  });

  it("renderServiceWorker_OfflineNavigation_FallsBackToTheCached404", () => {
    // Arrange — a navigation that misses the cache while offline must render something
    // rather than a browser error page.
    const source = renderServiceWorker(ENTRIES);

    // Act & Assert
    assert.ok(source.includes('caches.match("/404")'));
    assert.ok(source.includes('request.mode === "navigate"'));
  });

  it("renderServiceWorker_TheManifest_GoesToTheNetworkBeforeTheCache", () => {
    // Arrange — the one resource where a stale copy is not merely old. The manifest is how
    // the browser learns what the installed app IS, and Chrome re-reads it to decide whether
    // to rebuild an installed WebAPK. Answered from cache it reports whatever was true on the
    // day the reader installed, so a changed icon can never reach them however the file is
    // named — which is what a device found after #62's hashed names shipped.
    const source = renderServiceWorker(ENTRIES);

    // Act — the manifest branch must come BEFORE the cache lookup every other request takes.
    const manifestAt = source.indexOf("/manifest.webmanifest");
    const cacheFirstAt = source.indexOf("caches.match(request, { ignoreSearch: true })");

    // Assert
    assert.ok(manifestAt !== -1, "the manifest is not singled out at all");
    assert.ok(cacheFirstAt !== -1, "the cache-first path is gone");
    assert.ok(
      manifestAt < cacheFirstAt,
      "the manifest is answered from cache before the network is tried",
    );
  });

  it("renderServiceWorker_TheManifestOffline_StillHasSomethingToAnswerWith", () => {
    // Arrange — negative case. Network-first must not mean network-only: an installed app
    // opened with no connection still has an identity to read, and 0010 keeps the site
    // working offline.
    const source = renderServiceWorker(ENTRIES);

    // Act & Assert — matched as one expression rather than by looking for `caches.match`
    // somewhere nearby. A window wide enough to be readable also reaches the cache-first
    // lookup in the block below, so deleting this fallback outright left the check green.
    assert.match(
      source,
      /catch \{\s*const stored = await caches\.match\(request\);\s*return stored \?\?/,
      "a failed manifest fetch has no cache fallback",
    );
  });

  it("renderServiceWorker_TheManifest_IsStillPrecached", () => {
    // Arrange — network-first needs something to fall back TO, so it stays in the precache
    // list. Dropping it would make the offline branch above unreachable.
    // Act
    const urls = precacheOf(renderServiceWorker([...ENTRIES, { url: "/manifest.webmanifest", content: "{}" }]));

    // Assert
    assert.ok(urls.includes("/manifest.webmanifest"));
  });

  it("renderServiceWorker_NonGetRequest_IsNotIntercepted", () => {
    // Arrange — the worker has no business answering anything but GET.
    const source = renderServiceWorker(ENTRIES);

    // Act & Assert
    assert.ok(source.includes('request.method !== "GET"'));
  });
});

describe("shipped client scripts", () => {
  it("buildClient_RealRoot_EmitsEveryModuleAsBrowserReadyJavaScript", async () => {
    // Arrange — buildClient returns [] for a root with no src/client, which is what lets
    // fixture builds work. This is the guard that makes that silence safe: if the real
    // directory moved or emptied, every page would load zero modules and only this fails.
    // Act
    const modules = await buildClient(ROOT);

    // Assert
    // answers.js and store.js are emitted and precached before anything imports them —
    // app.js wires them up in the next slice. Listing them rather than allowing "at
    // least these" keeps the check able to notice a module that should not be shipping.
    assert.deepEqual(modules.map((module) => module.output).sort(), [
      "assets/js/answers.js",
      "assets/js/app.js",
      "assets/js/banner.js",
      "assets/js/export.js",
      "assets/js/fields.js",
      "assets/js/import.js",
      "assets/js/keys.js",
      "assets/js/store.js",
      "assets/js/sw-update.js",
    ]);
    // Emitting a module is not the same as anything loading it. `buildClient` discovers
    // files by reading the directory, not by following imports, so a feature can be
    // disconnected from the entry module and still appear here — verified: replacing
    // app.ts's import of import.ts with local stubs left the whole suite green while the
    // restore control was wired to nothing.
    const entry = modules.find((module) => module.output === "assets/js/app.js");
    assert.ok(entry !== undefined, "no entry module was emitted");
    for (const sibling of ["export", "import", "fields", "answers", "store", "banner", "sw-update"]) {
      assert.ok(
        entry.code.includes(`"./${sibling}.js"`),
        `app.js does not import ${sibling}.js, so that feature reaches no page`,
      );
    }
    for (const module of modules) {
      assert.ok(module.code.length > 0, `${module.output} emitted nothing`);
      // Type annotations are gone, and every relative specifier a browser will resolve
      // ends in `.js`. The sources say `.ts` and build/client.ts rewrites them (0012 ·
      // C5a), so this is what proves the rewrite ran rather than that somebody typed the
      // extension correctly — and it is the only thing that does.
      assert.ok(!/^(import type|export type)/m.test(module.code), `${module.output} kept types`);
      // Every form that can carry one, not just `from "…";`: a bare side-effect import and
      // a dynamic `import("./x.ts")` ship a 404 exactly as readily, and an earlier version
      // of this check looked only at `from` clauses while claiming to cover all of them.
      const specifiers = [...module.code.matchAll(/(?:from|import)\s*\(?\s*"(\.[^"]*)"/g)];
      for (const [, specifier] of specifiers) {
        assert.ok(specifier?.endsWith(".js"), `${module.output} ships ${specifier}, which will 404`);
      }
    }
  });

  it("buildClient_MissingDirectory_IsEmptyRatherThanAThrow", async () => {
    // Arrange — negative case: fixture roots have no client modules. Only ENOENT is
    // tolerated; any other error throws, so a build cannot quietly ship no JavaScript.
    // Act & Assert
    assert.deepEqual(await buildClient(path.join(ROOT, "docs")), []);
  });

  it("buildClient_EmittedModules_ParseAsEsModules", async () => {
    // Arrange — the assertions above all pass on `export {};`, which is what a syntax
    // error emits when transpileModule's diagnostics are ignored. Parsing is what tells
    // the two apart, and it has to be parsing rather than evaluation: these modules call
    // into `document` at load, so importing them here would fail for reasons that say
    // nothing about their syntax.
    const modules = await buildClient(ROOT);

    // Act & Assert — re-parsed by the same compiler that emitted them. Anything it
    // cannot read, a browser cannot either.
    for (const module of modules) {
      const { diagnostics } = ts.transpileModule(module.code, {
        compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
        fileName: module.output,
        reportDiagnostics: true,
      });
      assert.deepEqual(diagnostics ?? [], [], `${module.output} does not parse`);
    }
  });

  it("clientEntry_ShippedFile_RegistersTheWorkerAndReportsFailure", async () => {
    // Arrange — a registration that fails silently removes offline support and storage
    // durability (0008) with no signal at all.
    //
    // There is no parse check here any more, and its absence is deliberate. The earlier
    // one used `new Function`, which cannot parse an ES module — `import` is a syntax
    // error in a classic function body — and it is no longer needed: these files are in
    // tsconfig.client.json, so `npm run typecheck` parses AND type-checks them, which is
    // strictly stronger than parsing alone.
    const source = await client("app.js");

    // Act & Assert
    assert.ok(source.includes('.register("/sw.js")'));
    assert.ok(source.includes("console.error"));
  });
});

describe("update prompting", () => {
  it("renderServiceWorker_Install_DoesNotActivateItself", () => {
    // Arrange — skipWaiting() during install swapped the cache and claimed the open page
    // mid-session, which docs/decisions/0001 forbids once answers are being typed.
    const source = renderServiceWorker(ENTRIES);
    const install = source.slice(
      source.indexOf('addEventListener("install"'),
      source.indexOf('addEventListener("message"'),
    );
    // Comments are stripped first. Without that this asserts against the prose as well
    // as the code, and the comment explaining why skipWaiting() is absent contains the
    // very string being looked for — the test failed on its own explanation.
    const code = install
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");

    // Act & Assert
    assert.ok(!code.includes("skipWaiting()"));
  });

  it("renderServiceWorker_MessageHandler_ActivatesOnRequest", () => {
    // Arrange — activation moves to the reader, so the worker needs a way to be asked.
    const source = renderServiceWorker(ENTRIES);

    // Act & Assert
    assert.ok(source.includes('addEventListener("message"'));
    assert.ok(source.includes('=== "SKIP_WAITING"'));
    assert.ok(source.includes("self.skipWaiting()"));
  });

  it("renderServiceWorker_ActivateStill_ClaimsClients", () => {
    // Arrange — a first install has no worker to wait behind, so it activates and must
    // still take control of the page that installed it.
    const source = renderServiceWorker(ENTRIES);

    // Act & Assert
    assert.ok(source.includes("self.clients.claim()"));
  });
});

describe("update feedback", () => {
  it("swUpdate_AcceptingAnUpdate_ReplacesTheBannerRatherThanDismissingIt", async () => {
    // Arrange — dismissing made a successful update and a silent failure look identical:
    // the strip vanished either way, and the page reloads into the same content, so
    // there was nothing to see. Confirmed on a device before this was changed.
    const source = await client("sw-update.js");

    // Act & Assert
    assert.ok(source.includes("Updating"));
    assert.ok(source.includes("did not finish"));
  });

  it("swUpdate_ReloadListener_IsAttachedOnlyAfterTheReaderAccepts", async () => {
    // Arrange — controllerchange also fires on a first install, so a listener attached
    // at startup would reload a page nobody asked to reload.
    const source = await client("sw-update.js");
    const beforeAccept = source.slice(0, source.indexOf("function accept"));

    // Act & Assert
    assert.ok(!beforeAccept.includes("controllerchange"));
    assert.ok(source.includes("controllerchange"));
  });
});

describe("update confirmation", () => {
  it("swUpdate_Confirmation_HappensAfterTheReloadNotDuringIt", async () => {
    // Arrange — activation often completes in tens of milliseconds, so a progress
    // message may never paint, and the page carrying it is destroyed by the reload
    // regardless. The only honest moment to confirm is on the other side.
    const source = await client("sw-update.js");

    // Act & Assert
    assert.ok(source.includes("sessionStorage.getItem"));
    assert.ok(source.includes("export function confirmRecentUpdate"));

    // The marker is written inside the controllerchange handler, not on the tap.
    // Written on the tap, a failed activation left it behind and the next load
    // announced "Updated" while still offering the same update — the app saying the
    // opposite of the truth on the one path where it matters.
    const handler = source.slice(source.indexOf('"controllerchange"'), source.indexOf("worker.postMessage"));
    assert.ok(handler.includes("sessionStorage.setItem"), "the marker is not set on success");
    const beforeHandler = source.slice(0, source.indexOf('"controllerchange"'));
    assert.ok(!beforeHandler.includes("sessionStorage.setItem"), "the marker is set before success");
  });

  it("swUpdate_Confirmation_ClearsItsMarkerSoItShowsOnce", async () => {
    // Arrange — negative case: a marker left behind would announce an update on every
    // subsequent load, which is noise rather than information.
    const source = await client("sw-update.js");

    // Act & Assert
    assert.ok(source.includes("sessionStorage.removeItem"));
  });

  it("clientEntry_ConfirmsBeforeRegistering", async () => {
    // Arrange — the confirmation reports on the load that already happened, so it must
    // not wait on registration, which is deferred to the load event.
    const source = await client("app.js");

    // Act & Assert
    // `.register(` rather than `serviceWorker.register`: the call is chained across
    // lines, so the longer string never matches and indexOf returns -1 — which compares
    // as "earlier than everything" and fails for the wrong reason.
    const confirmAt = source.indexOf("confirmRecentUpdate()");
    const registerAt = source.indexOf(".register(");
    assert.ok(confirmAt >= 0, "confirmRecentUpdate() is not called");
    assert.ok(registerAt >= 0, "the worker is never registered");
    assert.ok(confirmAt < registerAt);
  });
});

describe("banner surface", () => {
  it("layout_EveryPage_RendersTheLiveRegionAsStaticMarkup", () => {
    // Arrange — a screen reader only announces changes to a region that existed before
    // the change, so creating it on demand and filling it in the same task is routinely
    // missed. 0001 makes that a defect rather than a nicety.
    // Act
    const html = layout("<p>x</p>", "Page", true);

    // Assert
    assert.ok(html.includes('<div id="banner-region" aria-live="polite"></div>'));
  });

  it("banner_ShippedFile_DoesNotCreateTheRegionItself", async () => {
    // Arrange — negative case: recreating it on demand would silently restore the
    // announcement bug the static markup exists to prevent.
    const source = await client("banner.js");

    // Act & Assert
    assert.ok(!source.includes("document.body.appendChild"));
    assert.ok(source.includes("console.error"));
  });

  it("banner_ShippedFile_UsesOnePendingSlotAndOneListener", async () => {
    // Arrange — a listener per deferred message leaked one for every message a reader
    // typed through, and let two scheduled timeouts both render.
    const source = await client("banner.js");

    // Act & Assert
    assert.equal(source.match(/addEventListener\("focusout"/g)?.length, 1);
    assert.ok(source.includes("let pending"));
    assert.ok(source.includes("watchingForPause"));
  });
});
