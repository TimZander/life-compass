# 0005 — Cloudflare Pages, for control over response headers

- **Status:** Accepted
- **Date:** 2026-07-29

## Context

The site is served from GitHub Pages today at a custom subdomain, built by Jekyll's
auto-enabled plugins, with no CI at all. GitHub Pages could keep hosting it after the
rewrite — Actions can build and deploy there perfectly well. So moving needs a reason
beyond wanting the newer thing.

## Decision

Cloudflare Pages, and the reason is response headers. Two things depend on them and
neither is optional.

A service worker must be served `Cache-Control: no-cache`, or clients hold onto a stale
worker and new deploys never reach the people who already installed the app. GitHub
Pages offers no header control whatsoever.

More importantly, the privacy claim in
[0006](0006-no-in-app-speech-recognition.md) rests on a Content-Security-Policy —
`default-src 'self'; connect-src 'none'; form-action 'none'`. That turns "this
application does not transmit your writing" from an assertion in a README into something
the browser enforces, including against a future dependency, a careless change, or a
compromised build. A `_headers` file makes it deployable; running that real file through
a Pages emulator in CI makes it enforceable.

Per-PR preview deployments are a real benefit but were not the deciding factor.

## Consequences

**C1.** A DNS cutover, sequenced deliberately and late. The live domain stays on GitHub
Pages throughout the rewrite, with production builds going to the `pages.dev` origin
until the app is actually worth switching to.

**C2.** Deploy plumbing to build and own: preview on pull request, production on main,
teardown on close.

**C3.** Preview deployments are named `pr-<number>` rather than by branch. Cloudflare
truncates preview alias hostnames to 28 characters, and a `branches/<issue>-<slug>`
convention spends nine of those on the prefix alone — so two pull requests against one
issue would otherwise collide onto a single alias and silently overwrite each other's
previews.

**C4.** Teardown must walk every page of the deployments API. It offers no server-side
branch filter, and reading only the first page reaps a branch's newest deployment while
leaking all its earlier ones — while still reporting success.

**C5.** A Cloudflare account becomes a dependency, and deploy credentials become
repository secrets.

**C6.** Pages canonicalises `/page.html` to `/page` with a 308, and answers an unmatched
path with 200 and the site's index unless a `404.html` exists. Neither is configurable,
neither matches what GitHub Pages did, and neither was visible until something was
actually deployed — the second meant a mistyped link looked like a working page. A 404
page now exists; the redirect is left in place, because keeping `.html` files on disk is
what allows links written before the move to survive it.

The redirect is not finished business. A service worker caching `/page.html` caches a
redirect rather than a page, so the canonical form has to be settled before one exists
(#23), and this is where the "keep the extensions, that is what the live site serves"
reasoning in `pages.ts` stops being true — the live site is now this build.

**C7.** The zone can override the headers Pages sends, so `_headers` is not by itself the
whole contract. Cloudflare's default Browser Cache TTL is four hours, and it silently
rewrote `max-age=0, must-revalidate` to `max-age=14400` on static assets — HTML was
untouched, which is why nothing looked wrong until there were assets to notice it on. A
service worker served that way would strand installed clients on stale code for up to
four hours after every deploy: precisely the failure this record chose Cloudflare to be
able to prevent, arriving through the door the choice opened.

Fixed by a Cache Rule setting Browser Cache TTL to *Respect Origin* for the hostname,
rather than by exceptions for `/sw.js` and `*.js` — path exceptions leave two places to
reason about, and the next asset type that needs one gets forgotten.

That rule lives in a dashboard and cannot be version-controlled, so the production smoke
test asserts its observable consequence instead: every checked path must serve the same
`Cache-Control` through the zone as the origin sends without one. Comparing the two
rather than pinning a literal value means the check survives `_headers` declaring
different policies per path (#23), and it fails loudly if either side returns nothing —
otherwise two empty strings compare equal and the assertion passes having verified
nothing.
