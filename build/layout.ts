/**
 * The page shell. Originally a port of the Liquid template this project used while it
 * was built by Jekyll; that file is gone, and this is now the only layout.
 *
 * URLs are root-absolute (`/assets/css/style.css`) because that is what the Jekyll
 * template emitted, and keeping them identical is what made the rewrite's output
 * diffable against the site it replaced. Document-relative paths would be equally
 * correct; there is simply no longer any reason to change.
 */

const SITE_TITLE = "Life Compass";

/**
 * Shown when a page is shared or listed by a search engine. Without it, whatever text
 * happens to sit near the top of the document is used instead — which for a worksheet is
 * the time estimate.
 */
const SITE_DESCRIPTION =
  "A five-day investigation into what matters most in your life. Your answers stay in this browser.";

/** Escape text destined for an HTML text node or a double-quoted attribute. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * `<title>` reproduces the Liquid conditional: a page whose own title differs from
 * the site title is suffixed, and the home page (whose H1 *is* "Life Compass") is not
 * rendered as "Life Compass · Life Compass".
 */
function documentTitle(pageTitle: string | null): string {
  if (pageTitle === null || pageTitle === SITE_TITLE) {
    return SITE_TITLE;
  }
  return `${pageTitle} · ${SITE_TITLE}`;
}

const NAV: readonly (readonly [href: string, label: string])[] = [
  ["/", "Home"],
  ["/one-page-anchor", "Quick Start"],
  ["/days/day-1-excavation", "5-Day"],
  ["/rigorous/", "Rigorous"],
  ["/with-a-partner", "Partner"],
  ["/optional-add-ons", "Add-ons"],
  ["/docs/decisions/", "Decisions"],
];

/**
 * The backup control, on pages that have somewhere to write.
 *
 * A first-class control rather than a settings menu item, because 0008 · C3 makes this the
 * only copy that survives eviction or uninstall — a backup nobody can find is a backup
 * nobody takes.
 *
 * Only on pages with questions, which the caller decides from the schema rather than by
 * scanning the rendered HTML. An earlier version matched the substring `class="fill`, which
 * is a third independent definition of "has somewhere to write" alongside `identifiersOf`
 * and `BLANK_SELECTOR`, is coupled to the attribute order `blank()` happens to emit, and
 * misses a page whose only answerable content is a checklist. Export covers the whole store
 * so it would work anywhere; a decision record is simply not where anybody is answering
 * something. The wording says "all your answers" for the same reason — the button sits on
 * one worksheet and does not mean that worksheet.
 *
 * `hidden` until the script has a working store. A control that is visible before it can
 * do anything is one somebody presses and watches do nothing, and 0008 is about being
 * straight over whether answers are actually safe.
 *
 * The plaintext sentence is 0009 · C1's, which asks for it to be accurate and not
 * alarming: what the file is, and that where it goes is the reader's call.
 */
function backup(): string {
  return `
<section class="backup" id="backup" aria-labelledby="backup-heading" hidden>
  <h2 id="backup-heading">Keep a copy</h2>
  <p>Your answers live on this device only. A backup is the one copy that survives your
  browser reclaiming space, clearing your browsing data, or removing the app.</p>
  <p><button type="button" id="backup-save">Download a backup of all your answers</button></p>
  <p class="backup-note">The file is ordinary text, not encrypted — anyone who opens it can
  read what you wrote. Keep it somewhere you would keep a private notebook.</p>

  <h3 id="restore-heading">Restore from a backup</h3>
  <p>Restoring <strong>replaces everything on this device</strong> with the contents of a
  backup file. Whatever is here now is gone afterwards, and there is no undo.</p>
  <p><label class="restore-pick" for="restore-file">Choose a backup file</label>
  <input type="file" id="restore-file" accept="application/json,.json"></p>

  <div id="restore-confirm" hidden>
    <p id="restore-summary"></p>
    <p><label><input type="checkbox" id="restore-ack"> I have a copy of what is on this
    device, or I do not need it.</label></p>
    <p><button type="button" id="restore-go" disabled>Replace everything on this device</button>
    <button type="button" id="restore-cancel">Cancel</button></p>
  </div>
</section>`;
}

export function layout(content: string, pageTitle: string | null, answerable: boolean): string {
  const nav = NAV.map(([href, label]) => `    <a href="${href}">${label}</a>`).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(documentTitle(pageTitle))}</title>
  <meta name="description" content="${escapeHtml(SITE_DESCRIPTION)}">
  <link rel="stylesheet" href="/assets/css/style.css">
  <link rel="manifest" href="/manifest.webmanifest">
  <meta name="theme-color" content="#9a6b3f">
  <link rel="icon" href="/icons/icon-192.png" type="image/png">
  <!-- The installed app opens standalone, so the OS chrome takes its colour from here
       and the page is the only thing on screen. Matching the paper the pages are drawn
       on keeps the seam between them invisible. -->
  <meta name="color-scheme" content="light">
  <!-- A module, resolved natively by the browser rather than bundled (0003), and
       external because the CSP has no 'unsafe-inline' and headers.ts will not let it
       gain one. type="module" defers by default. -->
  <script type="module" src="/assets/js/app.js"></script>
</head>
<body>
  <a class="wordmark" href="/"><svg class="wm-star" width="11" height="11" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0 L14 10 L24 12 L14 14 L12 24 L10 14 L0 12 L10 10 Z" fill="currentColor"/></svg>&nbsp;&nbsp;LIFE COMPASS</a>
  <main><article>${content}${answerable ? backup() : ""}</article></main>
  <!-- The banner's live region. Static markup on purpose: a screen reader only
       announces changes to a region that existed beforehand, so creating it on demand
       and filling it in the same task is routinely missed (0001). -->
  <div id="banner-region" aria-live="polite"></div>
  <nav class="endnav">
${nav}
  </nav>
</body>
</html>
`;
}

export { SITE_TITLE, documentTitle };
