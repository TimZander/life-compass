/**
 * Markdown -> HTML, with the three things the site depends on that markdown-it does not
 * do on its own: heading `id` attributes, links rewritten to real URLs, and enough
 * reporting for the build to verify both.
 *
 * `html: true` is required, not stylistic. Question anchors arrive as html_block
 * tokens — the injection point for every generated blank — and the prose still carries
 * a handful of raw `<p>` and `<em>`. Turning HTML off would render all of that as
 * literal text across every page. Note that this does NOT make code spans unsafe:
 * markdown-it escapes code content regardless, which matters here because the decision
 * records discuss blank markup inside backticks.
 */

import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import { createSlugger } from "./slug.ts";
import { resolveLink, type LinkContext, type ResolvedLink } from "./links.ts";
import { ANCHOR, renderQuestion } from "./questions.ts";
import type { Question } from "../src/questions/types.ts";

export type RenderResult = {
  readonly html: string;
  /** Text of the first `# ` heading, used as the page title. */
  readonly title: string | null;
  /** Every link on the page, already classified — the raw material for link checking. */
  readonly links: readonly ResolvedLink[];
  /** Every `id` this page generated, so cross-page `#fragment` links can be verified. */
  readonly headingIds: readonly string[];
  /** Question ids this page anchored, in order, for the bidirectional check. */
  readonly anchors: readonly string[];
  /**
   * Hand-written `- [ ]` markers, which no longer render as checkboxes.
   *
   * markdown-it does not do task lists, and the rule that used to add them is gone: the
   * only ticks in the workbook are `checklist` questions now, which emit the markup
   * themselves. Without this, a hand-written one renders as the literal text "[ ] Values
   * filled in" — which is what it did on the day this was first noticed.
   */
  readonly taskMarkers: readonly string[];
  /**
   * Hand-written fill markup found in the source's raw HTML, for the build to refuse.
   *
   * Every blank is generated from a question definition (docs/decisions/0004), which is
   * what gives it a data-field and a storage address. A hand-written one still renders,
   * still draws its underline, and is invisible to storage — and if it copies an
   * existing data-field it silently shares that field's address. Collected from the
   * token stream, not the raw source, because the decision records legitimately discuss
   * this markup inside code spans and fences; only html_block and html_inline tokens are
   * markup the page will actually pass through to a browser.
   */
  readonly fillMarkup: readonly string[];
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
export type RenderContext = LinkContext & {
  /** Question id -> definition. Anchors resolve against this.  */
  readonly questions: ReadonlyMap<string, Question>;
};

/** `- [ ]` or `- [x]` at the head of a list item, which markdown-it leaves as text. */
const TASK_MARKER = /^\[[ xX]\]\s/;

/**
 * A `class` attribute in raw HTML, in every spelling a browser accepts: any whitespace
 * around `=`, a double-quoted, single-quoted or unquoted value, any case. The canonical
 * spelling alone is not enough — `class = "fill"` resolves to class="fill" in a browser
 * while slipping past every check that assumed no whitespace, which is exactly how an
 * unaddressed blank once reached a built page with the suite green.
 */
const CLASS_ATTRIBUTE = /class\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;

/**
 * Fill markup inside one raw-HTML token's text, reported as the attribute as written.
 *
 * The value is split on whitespace and compared token-wise, the way a browser matches
 * class selectors — so `class="fill extra"` is caught and `class="filler"` is not.
 */
function fillMarkupIn(rawHtml: string): string[] {
  const found: string[] = [];
  for (const match of rawHtml.matchAll(CLASS_ATTRIBUTE)) {
    const value = match[1] ?? match[2] ?? match[3] ?? "";
    const classes = value.trim().split(/\s+/).map((name) => name.toLowerCase());
    if (classes.includes("fill") || classes.includes("fill-sm")) {
      found.push(match[0]);
    }
  }
  return found;
}

export function render(markdown: string, source: string, context: RenderContext): RenderResult {
  const tokens = md.parse(markdown, {});
  const slug = createSlugger();
  const links: ResolvedLink[] = [];
  const headingIds: string[] = [];
  const anchors: string[] = [];
  const taskMarkers: string[] = [];
  const fillMarkup: string[] = [];
  let title: string | null = null;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === undefined) {
      continue;
    }

    // A question anchor is a standalone HTML comment, which markdown-it hands over as
    // an html_block emitted verbatim — so replacing its content is enough to inject
    // the generated markup without a second pass over the rendered string.
    if (token.type === "html_block") {
      // Scanned before the anchor branch can replace the content: what is checked here
      // must be what the author wrote, never the generated markup injected below.
      fillMarkup.push(...fillMarkupIn(token.content));
      const match = ANCHOR.exec(token.content.trim());
      if (match !== null) {
        const id = match[1] ?? "";
        anchors.push(id);
        const question = context.questions.get(id);
        // An unresolvable anchor is reported by the build rather than thrown here;
        // leaving the comment in place keeps the failure legible in the output too.
        if (question !== undefined) {
          const generated = renderQuestion(question);
          token.content = `${generated}\n`;
          // Generated headings never pass through the slugger above, so without this the
          // build's anchor check treats a link to one as broken and the page's landmarks
          // are missing from every list built off headingIds.
          for (const heading of generated.matchAll(/<h[1-6] id="([^"]+)"/g)) {
            headingIds.push(heading[1] ?? "");
          }
        }
      }
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

    // Checked on the token stream rather than the raw source, so a fenced example that
    // shows the syntax is not mistaken for one that meant it.
    if (token.type === "inline" && TASK_MARKER.test(token.content)) {
      taskMarkers.push(token.content.split("\n")[0] ?? "");
    }

    if (token.type === "inline" && token.children !== null) {
      for (const child of token.children) {
        // Raw HTML mixed into a line of prose — the shape every hand-written blank
        // actually had. Code spans are code_inline tokens, so they never land here.
        if (child.type === "html_inline") {
          fillMarkup.push(...fillMarkupIn(child.content));
        }
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

  return {
    html: md.renderer.render(tokens, md.options, {}),
    title,
    links,
    headingIds,
    anchors,
    taskMarkers,
    fillMarkup,
  };
}
