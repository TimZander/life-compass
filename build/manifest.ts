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
import { SITE_DESCRIPTION, SITE_TITLE, THEME_COLOR } from "./layout.ts";

/**
 * The name, the description and the accent come from the layout rather than being written
 * again here. They are the same three things said twice — in a browser's install dialog
 * from this file, in a `<meta>` tag and a `<title>` from that one — and a comment claiming
 * the copies are identical is not what keeps them identical.
 *
 * The background colour has no counterpart in the layout; it is the paper the stylesheet
 * paints, which cannot import TypeScript. build.test.ts holds that pair together instead.
 */
const BACKGROUND_COLOR = "#f6f4ee";

export function renderManifest(set: readonly Icon[] = icons()): string {
  const manifest = {
    name: SITE_TITLE,
    short_name: SITE_TITLE,
    description: SITE_DESCRIPTION,
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
