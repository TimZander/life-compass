/**
 * The web app manifest, generated so that it names the icons that were actually drawn.
 *
 * It used to be a committed file at the repository root, copied to the output like any
 * other asset. That is what #62 turned out to be: the manifest named `/icons/icon-512.png`,
 * a path with no version in it, so #61 redrew the mark and the manifest came out
 * byte-identical. A browser watches the manifest to decide whether an installed app's
 * identity has changed, and it had nothing to notice.
 *
 * Generated from `icons()` rather than rewritten from JSON, so the icon list exists once.
 * A committed file whose `src` fields were overwritten during the build would still read
 * as authoritative to whoever opened it next.
 *
 * `id` is deliberately NOT derived from anything that changes. It is the installed app's
 * identity: a new id is a new app, so an icon change that altered it would leave a reader
 * with two Life Compasses on the home screen rather than an updated one.
 */

import { icons, type Icon } from "./icons.ts";

const NAME = "Life Compass";

/**
 * Kept identical to the layout's meta description. Both are the first thing somebody sees
 * about the app before they have read a word of it — in a browser's install dialog here,
 * in a search result there.
 */
const DESCRIPTION =
  "A five-day investigation into what matters most in your life. Your answers stay in this browser.";

/** The warm paper the pages are drawn on, and the copper accent. From the site's palette. */
const BACKGROUND_COLOR = "#f6f4ee";
const THEME_COLOR = "#9a6b3f";

export function renderManifest(set: readonly Icon[] = icons()): string {
  const manifest = {
    name: NAME,
    short_name: NAME,
    description: DESCRIPTION,
    start_url: "/",
    id: "/",
    scope: "/",
    display: "standalone",
    background_color: BACKGROUND_COLOR,
    theme_color: THEME_COLOR,
    icons: set.map((icon) => ({
      src: `/${icon.output}`,
      sizes: `${icon.size}x${icon.size}`,
      type: "image/png",
      purpose: icon.purpose,
    })),
  };

  return `${JSON.stringify(manifest, null, 2)}\n`;
}
