/**
 * Markdown -> HTML, with the two things the site depends on that markdown-it does not
 * do on its own: heading `id` attributes, and links rewritten to real URLs.
 *
 * `html: true` is required, not stylistic. The worksheets carry 444 inline
 * `<span class="fill">` markers that draw the answer blanks, plus a handful of `<p>`
 * and `<em>`. Turning HTML off would render those as literal text across every page.
 * Note that this does NOT make code spans unsafe: markdown-it escapes code content
 * regardless, which matters here because the decision records discuss that very markup
 * inside backticks.
 */

import MarkdownIt from "markdown-it";
import { createSlugger } from "./slug.ts";
import { resolveLink, type LinkContext, type ResolvedLink } from "./links.ts";

export type RenderResult = {
  readonly html: string;
  /** Text of the first `# ` heading, used as the page title. */
  readonly title: string | null;
  /** Every link on the page, already classified — the raw material for link checking. */
  readonly links: readonly ResolvedLink[];
};

const md: MarkdownIt = new MarkdownIt({
  html: true,
  linkify: false,
  // Kramdown applies smart typography by default, so the live site renders curly
  // apostrophes and quotes. Leaving this off would straighten every quotation mark on
  // the site — a visible regression, and a conspicuous one on pages whose whole design
  // is careful typography. It also covers ellipses and `--`/`---`, matching kramdown
  // there too. Safe for the one link href containing `--`, because these rules operate
  // on text tokens, not on attributes (pinned by a test in build.test.ts).
  typographer: true,
});

/** Render one Markdown source into HTML, rewriting links relative to `source`. */
export function render(markdown: string, source: string, context: LinkContext): RenderResult {
  const tokens = md.parse(markdown, {});
  const slug = createSlugger();
  const links: ResolvedLink[] = [];
  let title: string | null = null;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === undefined) {
      continue;
    }

    if (token.type === "heading_open") {
      const inline = tokens[i + 1];
      const text = inline?.content ?? "";
      token.attrSet("id", slug(text));
      if (token.tag === "h1" && title === null) {
        // The heading stays in the body. jekyll-titles-from-headings leaves it in
        // place by default, and the stylesheet targets `article > h1:first-child`.
        title = inline?.children?.map((child) => child.content).join("") ?? text;
      }
      continue;
    }

    if (token.type === "inline" && token.children !== null) {
      for (const child of token.children) {
        if (child.type !== "link_open") {
          continue;
        }
        const href = child.attrGet("href");
        if (href === null) {
          continue;
        }
        const resolved = resolveLink(href, source, context);
        links.push(resolved);
        child.attrSet("href", resolved.href);
      }
    }
  }

  return { html: md.renderer.render(tokens, md.options, {}), title, links };
}
