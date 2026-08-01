/**
 * Markdown -> HTML, with the three things the site depends on that markdown-it does not
 * do on its own: heading `id` attributes, links rewritten to real URLs, and enough
 * reporting for the build to verify both.
 *
 * `html: true` is required, not stylistic. The worksheets carry 443 inline
 * `<span class="fill">` markers that draw the answer blanks, plus a handful of `<p>`
 * and `<em>`. Turning HTML off would render those as literal text across every page.
 * Note that this does NOT make code spans unsafe: markdown-it escapes code content
 * regardless, which matters here because the decision records discuss that very markup
 * inside backticks.
 */

import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import { createSlugger } from "./slug.ts";
import { resolveLink, type LinkContext, type ResolvedLink } from "./links.ts";
import { taskLists } from "./tasklists.ts";

export type RenderResult = {
  readonly html: string;
  /** Text of the first `# ` heading, used as the page title. */
  readonly title: string | null;
  /** Every link on the page, already classified — the raw material for link checking. */
  readonly links: readonly ResolvedLink[];
  /** Every `id` this page generated, so cross-page `#fragment` links can be verified. */
  readonly headingIds: readonly string[];
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

// `- [ ] item` -> a disabled checkbox, matching what kramdown emits on the live site.
md.use(taskLists);

/**
 * The visible text of an inline token, with markup removed.
 *
 * Used for BOTH the slug and the title so the two cannot disagree. Reading
 * `token.content` instead would be shorter and would use the raw Markdown source, so a
 * heading like `## [Day 2](day-2-values.md)` would slug as `day-2day-2-valuesmd` where
 * GitHub gives `day-2`. No heading in the repo contains markup today, which is exactly
 * why the divergence would go unnoticed until one did.
 */
function inlineText(token: Token | undefined): string {
  if (token === undefined) {
    return "";
  }
  if (token.children === null) {
    return token.content;
  }
  // Raw HTML children carry their markup as content, so including them puts tag text
  // into ids and titles: `### Value 1 — <span class="fill">___</span>` produced
  // `id="value-1--span-classfill______span"`. Several worksheets have headings shaped
  // exactly like that.
  return token.children
    .filter((child) => child.type !== "html_inline")
    .map((child) => child.content)
    .join("");
}

/** Render one Markdown source into HTML, rewriting links relative to `source`. */
export function render(markdown: string, source: string, context: LinkContext): RenderResult {
  const tokens = md.parse(markdown, {});
  const slug = createSlugger();
  const links: ResolvedLink[] = [];
  const headingIds: string[] = [];
  let title: string | null = null;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === undefined) {
      continue;
    }

    if (token.type === "heading_open") {
      const text = inlineText(tokens[i + 1]);
      const id = slug(text);
      token.attrSet("id", id);
      headingIds.push(id);
      if (token.tag === "h1" && title === null) {
        // The heading stays in the body. jekyll-titles-from-headings leaves it in
        // place by default, and the stylesheet targets `article > h1:first-child`.
        title = text;
      }
      continue;
    }

    if (token.type === "inline" && token.children !== null) {
      for (const child of token.children) {
        // Images carry their target in `src`, links in `href`. Both need rewriting and
        // both need checking; handling only links would leave a silent hole in the
        // integrity guarantee for the first image anyone adds.
        const attribute = child.type === "link_open" ? "href" : child.type === "image" ? "src" : null;
        if (attribute === null) {
          continue;
        }
        const value = child.attrGet(attribute);
        if (value === null) {
          continue;
        }
        const resolved = resolveLink(value, source, context);
        links.push(resolved);
        child.attrSet(attribute, resolved.href);
      }
    }
  }

  return { html: md.renderer.render(tokens, md.options, {}), title, links, headingIds };
}
