/**
 * GitHub-style task lists: `- [ ] item` becomes a real (disabled) checkbox.
 *
 * markdown-it does not do this; kramdown on GitHub Pages does, so without it eight
 * checklist items across two worksheets render as the literal text "[ ] Values filled
 * in". That is a visible regression, and it was missed by an earlier parity check that
 * sampled four pages instead of diffing all of them.
 *
 * Written here rather than pulled in as a plugin: the transform is thirty lines, and
 * docs/decisions/0003 weighs each added dependency against a project meant to sit
 * untouched for years. The emitted markup matches kramdown's exactly — `task-list` on
 * the list, `task-list-item` on the item, and a disabled checkbox — so the output stays
 * diffable against the live site. The stylesheet references none of those classes
 * today; they exist for parity, and for the interactive version this becomes later.
 */

import type MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";

const TASK_MARKER = /^\[([ xX])\]\s+/;

/** Find the `bullet_list_open` / `ordered_list_open` enclosing the item at `index`. */
function enclosingList(tokens: readonly Token[], index: number): Token | undefined {
  for (let i = index - 1; i >= 0; i -= 1) {
    const token = tokens[i];
    if (token?.type === "bullet_list_open" || token?.type === "ordered_list_open") {
      return token;
    }
  }
  return undefined;
}

export function taskLists(md: MarkdownIt): void {
  md.core.ruler.after("inline", "task_lists", (state) => {
    const tokens = state.tokens;
    // One class per list, not one per item. `attrJoin` appends unconditionally, so
    // marking the same list from each of its four items yields
    // `class="task-list task-list task-list task-list"`.
    const marked = new Set<Token>();

    for (let i = 2; i < tokens.length; i += 1) {
      const inline = tokens[i];
      if (
        inline?.type !== "inline" ||
        tokens[i - 1]?.type !== "paragraph_open" ||
        tokens[i - 2]?.type !== "list_item_open"
      ) {
        continue;
      }

      const match = TASK_MARKER.exec(inline.content);
      const first = inline.children?.[0];
      // The marker lives in the first text child; if the item opens with anything else
      // (emphasis, a link, raw HTML) it is not a task item and must be left alone.
      if (match === null || first === undefined || first.type !== "text") {
        continue;
      }
      const marker = match[0];
      if (!first.content.startsWith(marker)) {
        continue;
      }

      const checked = match[1] !== " ";
      first.content = first.content.slice(marker.length);
      inline.content = inline.content.slice(marker.length);

      const checkbox = new state.Token("html_inline", "", 0);
      checkbox.content =
        `<input type="checkbox" class="task-list-item-checkbox" disabled="disabled"` +
        `${checked ? " checked=\"checked\"" : ""} />`;
      inline.children?.unshift(checkbox);

      tokens[i - 2]?.attrJoin("class", "task-list-item");

      const list = enclosingList(tokens, i - 2);
      if (list !== undefined && !marked.has(list)) {
        marked.add(list);
        list.attrJoin("class", "task-list");
      }
    }

    return true;
  });
}
