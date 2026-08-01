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
  ["/one-page-anchor.html", "Quick Start"],
  ["/days/day-1-excavation.html", "5-Day"],
  ["/rigorous/", "Rigorous"],
  ["/with-a-partner.html", "Partner"],
  ["/optional-add-ons.html", "Add-ons"],
  ["/docs/decisions/", "Decisions"],
];

export function layout(content: string, pageTitle: string | null): string {
  const nav = NAV.map(([href, label]) => `    <a href="${href}">${label}</a>`).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(documentTitle(pageTitle))}</title>
  <link rel="stylesheet" href="/assets/css/style.css">
</head>
<body>
  <a class="wordmark" href="/"><svg class="wm-star" width="11" height="11" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0 L14 10 L24 12 L14 14 L12 24 L10 14 L0 12 L10 10 Z" fill="currentColor"/></svg>&nbsp;&nbsp;LIFE COMPASS</a>
  <main><article>${content}</article></main>
  <nav class="endnav">
${nav}
  </nav>
</body>
</html>
`;
}

export { SITE_TITLE, documentTitle };
