/**
 * Heading slugs, matching the algorithm GitHub and kramdown both use.
 *
 * This has to be exact, not merely reasonable. Two links in the content point at
 * headings by fragment, and one of them —
 *   optional-add-ons.md#add-on-a--outside-input  ->  "## Add-on A — Outside input"
 * — carries a DOUBLE hyphen, because the em dash is deleted rather than replaced and
 * the spaces that surrounded it each become a hyphen. Any implementation that
 * "tidies up" by collapsing repeated hyphens silently breaks that link, and silently
 * is the operative word: the page still renders, the anchor just goes nowhere.
 *
 * The rules, in order: lowercase, delete every character that is not a letter,
 * number, space, underscore or hyphen, then turn spaces into hyphens. No collapsing,
 * no trimming.
 */

/** Slugify a single heading's text content. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .replace(/ /g, "-");
}

/**
 * Slug generator scoped to one page.
 *
 * Repeated headings within a page get `-1`, `-2`, … appended, as kramdown does.
 * Nothing in the current content collides, but the counter costs three lines and
 * removes a whole category of "two headings, one anchor, wrong destination" bug
 * from ever being possible.
 */
export function createSlugger(): (text: string) => string {
  const seen = new Map<string, number>();

  return (text: string): string => {
    const base = slugify(text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
}
