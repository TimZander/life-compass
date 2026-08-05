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
  ["/backup", "Backup"],
  ["/docs/decisions/", "Decisions"],
];

/**
 * The backup and restore controls, on the page that exists for them.
 *
 * On their own page rather than at the foot of every worksheet, and the move fixed more
 * than clutter. Export covers the whole store, but sitting under Day 3 it read as "back up
 * Day 3" — a confusion the button label had to fight with the words "all your answers".
 * Here the scope is the page. And restoring is the one irreversible act in the application;
 * asking somebody to weigh it three inches below the paragraph they were dictating is the
 * wrong moment for it.
 *
 * Reachable from everywhere, which is more than before: the footer navigation renders on
 * all 35 pages, where the old inline section existed on the 14 that carry blanks.
 * 0008 · C3 asks for the backup to be pushed rather than buried, and pushing is #26's job —
 * install prompting and a line saying when you last exported. This page is where the doing
 * happens; a permanent screenful of warnings under every day's work was nagging, not
 * pushing.
 *
 * Both controls ship `hidden` and are revealed by the client once a store actually opens.
 * A control visible before it can do anything is one somebody presses and watches do
 * nothing, and 0008 is about being straight over whether answers are safe.
 */
function tools(): string {
  return `
<section class="tools" id="backup" aria-labelledby="backup-heading" hidden>
  <h2 id="backup-heading">Save a backup</h2>
  <p><button type="button" id="backup-save">Download a backup</button></p>
</section>

<section class="tools" id="restore" aria-labelledby="restore-heading" hidden>
  <h2 id="restore-heading">Restore from a backup</h2>
  <p><input type="file" id="restore-file" accept="application/json,.json"><label
    class="restore-pick" for="restore-file">Choose a backup file</label></p>

  <div id="restore-confirm" role="group" aria-labelledby="restore-confirm-heading" hidden>
    <h3 id="restore-confirm-heading">Replace everything with this file?</h3>
    <p id="restore-chosen"></p>
    <p id="restore-summary"></p>
    <p>If you have not saved a copy of what is on this device, do that first — it is the
    only way back.</p>
    <p><button type="button" id="restore-backup-first">Download a backup of this device first</button></p>
    <p><label><input type="checkbox" id="restore-ack"> I have saved a copy of what is on
    this device.</label></p>
    <p><button type="button" id="restore-go" aria-disabled="true">Replace every answer on this device</button>
    <button type="button" id="restore-cancel">Cancel</button></p>
  </div>
</section>`;
}

export function layout(content: string, pageTitle: string | null, isBackupPage: boolean): string {
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
  <a class="wordmark" href="/"><svg class="wm-mark" width="11" height="11" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0 L12.96 9.69 L18.01 5.99 L14.31 11.04 L21 12 L14.31 12.96 L18.01 18.01 L12.96 14.31 L12 21 L11.04 14.31 L5.99 18.01 L9.69 12.96 L3 12 L9.69 11.04 L5.99 5.99 L11.04 9.69 Z" fill="currentColor"/></svg>&nbsp;&nbsp;LIFE COMPASS</a>
  <main><article>${content}${isBackupPage ? tools() : ""}</article></main>
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
