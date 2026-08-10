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
  /** Question id -> the prose that introduces it on this page. See `askAt`. */
  readonly asks: ReadonlyMap<string, string>;
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

/**
 * The prose that introduces a question, read back out of the page it sits on.
 *
 * The schema knows a question's identifier, label and fields; it does not know what the
 * question ASKS, because docs/decisions/0004 put the prose in Markdown on purpose. That is
 * fine for rendering a blank beside its own paragraph and useless anywhere the question has
 * to be stated away from the page — which is #67, where a generated prompt for `day4.eulogy`
 * said "Eulogy" and nothing else, while the Markdown two lines above asked the real question.
 *
 * Taken from the token stream rather than the raw text, so "belonging to" is structural: the
 * content since the nearest boundary — the previous anchor, or a heading, or the list item
 * this anchor sits inside. Three shapes occur in the worksheets and all three fall out of
 * that one rule:
 *
 *   a lead-in line          `**Skills (technical and otherwise):**` then the anchor
 *   nested in a list item   `- **Who do you want to be useful to?**` with the anchor indented
 *   a shared lead-in        "Finish these sentences:" then four anchors in a row
 *
 * The third is why there is a fallback: the second of four consecutive anchors has nothing
 * between it and the one before, so the walk continues past it to the nearest prose. It will
 * not cross a heading, because a heading is a new subject rather than more of this one.
 *
 * Anchor positions are passed in rather than recognised from token content, because the
 * render pass REPLACES an anchor's content with the question it generated. Testing content
 * meant a question could not see the anchor above it — already rewritten — and walked
 * straight through into the previous question's lead-in. It read as a plausible ask, which
 * is the failure mode worth engineering against here.
 */
function askAt(tokens: readonly Token[], anchorIndexes: ReadonlySet<number>, anchor: number): string {
  const prose: string[] = [];
  let heading = "";
  let inHeading = false;
  /**
   * Whether a sibling question stands between here and whatever prose comes next.
   *
   * Only set once this question has a heading of its own, and that is the whole distinction.
   * A question with its own heading has siblings with their own headings too, so prose met
   * immediately past a sibling's anchor sits under THAT heading and belongs to it. A question
   * with no heading is one of a run sharing a lead-in printed once above all of them, and
   * that prose is genuinely its own.
   *
   * Without this, `anchor.review_date` — a heading with no paragraph of its own — walked back
   * past `anchor.decision_rule` and took its paragraph, so the generated prompt interviewed
   * the reader about a decision rule when they had asked about a review date (#80).
   */
  let pastASibling = false;
  // Walking backwards, a blockquote is entered at its closing token. A list inside one is
  // part of the quoted example rather than a sibling of this question — Day 4 quotes a
  // format and two example statements, and treating that list as a boundary left the
  // question with no ask at all.
  let quoted = 0;

  for (let at = anchor - 1; at >= 0; at -= 1) {
    const token = tokens[at];
    if (token === undefined) {
      continue;
    }

    // Boundaries. A list ends the subject — reaching past one collects a neighbouring
    // question's bullet as though it introduced this one, which the rigorous Day 3 does
    // (History, Spending, then Calendar). `list_item_open` is the same rule seen from
    // inside: where an anchor is nested in an item, the item's own text is the question.
    if (token.type === "blockquote_close") {
      quoted += 1;
      continue;
    }
    if (token.type === "blockquote_open") {
      quoted -= 1;
      continue;
    }
    if (
      quoted === 0 &&
      (token.type === "list_item_open" ||
        token.type === "bullet_list_close" ||
        token.type === "ordered_list_close")
    ) {
      break;
    }

    // Walking backwards, a heading's closing token arrives before its text.
    if (token.type === "heading_close") {
      inHeading = true;
      continue;
    }
    if (token.type === "heading_open") {
      inHeading = false;
      // A heading above prose we already have is a different subject. A heading above
      // nothing is this question's subject, and the words that ask it are further up —
      // Day 5 asks one question under five sibling headings, and only the paragraph above
      // the first of them says what to ask.
      if (prose.length > 0) {
        break;
      }
      // Crossing a heading means whatever lies above it introduces a GROUP rather than one
      // question, so it is shared and this question may have it. Day 5 asks one question
      // under five sibling headings and only the paragraph above the first says what to ask.
      pastASibling = false;
      continue;
    }

    if (anchorIndexes.has(at)) {
      // Another question. Stop, unless nothing has been gathered — then this anchor shares
      // a lead-in with the one before it, which is the four-sentences-in-a-row shape on
      // Day 4.
      if (prose.length > 0) {
        break;
      }
      if (heading !== "") {
        pastASibling = true;
      }
      continue;
    }

    if (token.type === "inline" && token.content.trim() !== "") {
      if (pastASibling && !inHeading) {
        // Prose under a sibling's own heading. Taking it would put another question's words
        // in this one's ask, which the empty-ask guard cannot see because the result is not
        // empty — merely wrong.
        break;
      }
      if (inHeading) {
        // The NEAREST heading is the subject; ones further up are the section it sits in.
        // Day 5 asks one question five times under `### Career`, `### Money` and so on, and
        // without this all five read identically — which is how seven questions came out
        // with no ask at all.
        if (heading === "") {
          heading = token.content.trim();
        }
        continue;
      }
      // Contiguous blocks, not just the nearest one: Day 1 puts the instruction in a
      // paragraph and an example in a blockquote beneath it, and the instruction is the
      // half that matters.
      prose.unshift(token.content.trim());
    }
  }

  return [heading, ...prose].filter((part) => part !== "").join("\n\n");
}

/**
 * Every question this Markdown anchors, and the prose that introduces each.
 *
 * Parses its own token stream rather than sharing `render`'s. That costs one extra parse per
 * worksheet and buys the thing that went wrong first: `render` REPLACES an anchor's content
 * with the question it generated, so reading asks from a stream mid-rewrite let a question
 * walk through the anchor above it — already rewritten, no longer recognisable — into the
 * previous question's lead-in. Here nothing has been rewritten, so it cannot arise.
 */
export function asksIn(markdown: string): ReadonlyMap<string, string> {
  const tokens = md.parse(markdown, {});
  const anchorIndexes = new Set<number>();
  const ids = new Map<number, string>();
  for (let at = 0; at < tokens.length; at += 1) {
    const token = tokens[at];
    if (token?.type !== "html_block") {
      continue;
    }
    const match = ANCHOR.exec(token.content.trim());
    if (match !== null) {
      anchorIndexes.add(at);
      ids.set(at, match[1] ?? "");
    }
  }

  const asks = new Map<string, string>();
  for (const [at, id] of ids) {
    asks.set(id, askAt(tokens, anchorIndexes, at));
  }
  return asks;
}

export function render(markdown: string, source: string, context: RenderContext): RenderResult {
  const tokens = md.parse(markdown, {});
  const asks = asksIn(markdown);
  const slug = createSlugger();
  const links: ResolvedLink[] = [];
  const headingIds: string[] = [];
  const anchors: string[] = [];
  const taskMarkers: string[] = [];
  const fillMarkup: string[] = [];
  let title: string | null = null;
  /**
   * The numbered item now being rendered, for #82.
   *
   * `h2` only. The worksheets number at that level, and a reader thinks in those units —
   * "3. The contribution question" is one task whether it asks one question or four.
   * `h3` is deliberately not a boundary: day 5's five dimensions sit under a single
   * numbered item and are one piece of work.
   */
  let section = "";
  /** Which heading level this page numbers at, decided by the first one it uses. */
  let numbered: "h2" | "h3" | "" = "";

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
          const generated = renderQuestion(question, section);
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
      // The level the page numbers at, not a fixed one. Most worksheets number with `##`
      // and use `###` for sub-parts of a single task — day 5's five dimensions sit under
      // one numbered item and are one piece of work, so `###` must not split them. The
      // one-page anchor numbers with `###` and has no `##` at all, and reading only `##`
      // left all eight of its questions in no section whatsoever.
      if (token.tag === "h2") {
        numbered = "h2";
        section = id;
      } else if (token.tag === "h3" && numbered !== "h2") {
        numbered = "h3";
        section = id;
      }
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
    asks,
    taskMarkers,
    fillMarkup,
  };
}
