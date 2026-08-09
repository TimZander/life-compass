import assert from "node:assert/strict";
import { describe, it } from "node:test";

/** Which page-specific controls the layout is asked for; build.ts decides from the source. */
const WITH_BACKUP_TOOLS = "backup";
import { documentTitle, layout, SITE_TITLE } from "./layout.ts";
import { COMPASS_ROSE } from "./icons.ts";

describe("documentTitle", () => {
  it("documentTitle_PageTitleMatchingSiteTitle_IsNotDoubled", () => {
    // Arrange — the home page's own H1 is the site title.
    const pageTitle = SITE_TITLE;

    // Act
    const result = documentTitle(pageTitle);

    // Assert
    assert.equal(result, SITE_TITLE);
  });

  it("documentTitle_DistinctPageTitle_IsSuffixedWithSiteTitle", () => {
    // Arrange
    const pageTitle = "Day 1 — Excavation";

    // Act
    const result = documentTitle(pageTitle);

    // Assert
    assert.equal(result, "Day 1 — Excavation · Life Compass");
  });

  it("documentTitle_NoPageTitle_FallsBackToSiteTitle", () => {
    // Arrange — negative case: a page with no H1 at all.
    const pageTitle = null;

    // Act
    const result = documentTitle(pageTitle);

    // Assert
    assert.equal(result, SITE_TITLE);
  });
});

describe("layout", () => {
  it("layout_TitleContainingMarkup_EscapesItInTheTitleElement", () => {
    // Arrange — negative case: a heading is arbitrary author text, not trusted markup.
    const pageTitle = '<script>"x"';

    // Act
    const result = layout("<p>body</p>", pageTitle, WITH_BACKUP_TOOLS);

    // Assert
    assert.ok(result.includes("&lt;script&gt;&quot;x&quot; · Life Compass"));
    assert.ok(!result.includes("<script>"));
  });

});

describe("the backup and restore controls", () => {
  /** Every id `export.ts` and `import.ts` look up by name. */
  const REQUIRED = [
    "backup",
    "backup-save",
    "restore",
    "restore-file",
    "restore-confirm",
    "restore-chosen",
    "restore-summary",
    "restore-backup-first",
    "restore-ack",
    "restore-go",
    "restore-cancel",
  ];

  it("layout_TheBackupPage_CarriesEveryElementTheClientLooksUp", () => {
    // Arrange — the client finds these by id and gives up with a console message if one is
    // missing, so a rename ships a control that silently is not there. Nothing pinned the
    // restore ids at all: renaming any of them left the whole suite green.
    // Act
    const html = layout("<p>body</p>", "Backup", "backup");

    // Assert
    for (const id of REQUIRED) {
      assert.ok(html.includes(`id="${id}"`), `the page does not carry id="${id}"`);
    }
  });

  it("layout_BothControls_ShipHiddenAndTheReplaceButtonShipsLocked", () => {
    // Arrange — a control visible before the client can work is one somebody presses and
    // watches do nothing; a Replace button live on page load is worse than that.
    // Act
    const html = layout("<p>body</p>", "Backup", "backup");

    // Assert
    assert.ok(/<section class="tools" id="backup"[^>]*\shidden>/.test(html), "backup not hidden");
    assert.ok(/<section class="tools" id="restore"[^>]*\shidden>/.test(html), "restore not hidden");
    assert.ok(/id="restore-confirm"[^>]*\shidden>/.test(html), "the confirmation is not hidden");
    assert.ok(
      /id="restore-go"[^>]*aria-disabled="true"/.test(html),
      "the replace button ships unlocked",
    );
  });

  it("layout_TheRestoreControl_WarnsThatReplacingCannotBeUndone", () => {
    // Arrange — the one irreversible action in the application. The warning is the reason
    // the confirmation is more than a button.
    // Act
    const html = layout("<p>body</p>", "Backup", "backup");

    // Assert
    assert.ok(html.includes("only way back"), "no warning that there is no way back");
    assert.ok(html.includes("I have saved a copy"), "no acknowledgement to tick");
  });

  it("layout_AnyOtherPage_CarriesNeitherControl", () => {
    // Arrange — negative case. They belong on the page that exists for them, not under
    // every worksheet: export covers the whole store, and at the foot of Day 3 it read as
    // "back up Day 3".
    // Act
    const html = layout('<p><span class="fill" data-field="t.a">___</span></p>', "A worksheet", null);

    // Assert
    for (const id of REQUIRED) {
      assert.ok(!html.includes(`id="${id}"`), `a worksheet carries id="${id}"`);
    }
  });
});

describe("the assistant page's controls", () => {
  /**
   * The backup section has four tests pinning its ids, its hidden state and its warning text.
   * This one had none, and a sweep found every part of it deletable with the suite green: the
   * `hidden` attribute, the heading, the `aria-labelledby` pointing at it, the `class` that
   * carries its styling, the label around its checkbox, and the privacy claim the page exists
   * to make. One of them turned the only control into a text input.
   */
  const AGENT = layout("<p>body</p>", "Assistant", "agent");

  it("layout_TheAssistantPage_ShipsItsOptInHiddenForTheClientToReveal", () => {
    // Arrange & Act & Assert — a control visible before the client can act on it is one
    // somebody presses and watches do nothing, which is the reasoning the backup section's
    // own docblock gives and which nothing was holding here.
    assert.match(AGENT, /<section class="tools" id="agent"[^>]*hidden>/);
  });

  it("layout_TheOptIn_IsACheckboxInsideItsOwnLabel", () => {
    // Arrange & Act & Assert — the switch is the page's entire purpose. As a `text` input it
    // becomes an inert box, and banner.ts treats a focused text input as typing, so it would
    // also defer every message the page tries to show.
    assert.match(AGENT, /<label><input type="checkbox" id="agent-on">[^<]+<\/label>/);
  });

  it("layout_TheAssistantSection_IsNamedByItsOwnHeading", () => {
    // Arrange & Act & Assert — `aria-labelledby` and the heading it points at are separately
    // deletable, and either alone leaves the section unnamed to a screen reader.
    assert.match(AGENT, /aria-labelledby="agent-heading"/);
    assert.match(AGENT, /<h2 id="agent-heading">[^<]+<\/h2>/);
  });

  it("layout_TheAssistantSection_StatesThePrivacyClaimTheDecisionIsMadeOn", () => {
    // Arrange & Act & Assert — docs/decisions/0007's whole argument is that the reader's
    // choice is real because the application cannot transmit. That sentence disappearing from
    // the page where the choice is made is not a cosmetic loss.
    assert.match(AGENT, /Nothing is sent from this app/);
  });

  it("layout_ThePasteBox_ShipsEveryElementItsModuleLooksFor", () => {
    // Arrange & Act & Assert — `wirePaste` gives up and logs if ANY of these is missing, so a
    // single renamed id is a paste box that quietly is not there. Listed one by one because
    // that is the failure: the section can be present and the control inside it gone.
    const REQUIRED = [
      '<section class="tools" id="paste"',
      'id="paste-text"',
      'id="paste-read"',
      'id="paste-confirm"',
      'id="paste-summary"',
      'id="paste-detail"',
      'id="paste-go"',
      'id="paste-cancel"',
    ];

    for (const part of REQUIRED) {
      assert.ok(AGENT.includes(part), `the paste box is missing ${part}`);
    }
  });

  it("layout_ThePasteBox_ShipsHiddenAndNamedByItsOwnHeading", () => {
    // Arrange & Act & Assert — hidden for the same reason as the opt-in above, and because
    // the client only reveals it once the reader has switched the bridge on. Shipping it
    // visible would offer to bring answers back to somebody who declined the assistant.
    assert.match(AGENT, /<section class="tools" id="paste"[^>]*hidden>/);
    assert.match(AGENT, /aria-labelledby="paste-heading"/);
    assert.match(AGENT, /<h3>[^<]+<\/h3>/);
  });

  it("layout_ThePasteTextarea_IsLabelledAndIsATextarea", () => {
    // Arrange & Act & Assert — `wirePaste` checks `instanceof HTMLTextAreaElement`, so an
    // `<input>` here disables the box with only a console line. A `for`/`id` pair is what
    // makes the control reachable by name to a screen reader.
    assert.match(AGENT, /<label for="paste-text">[^<]+<\/label>/);
    assert.match(AGENT, /<textarea id="paste-text"/);
  });

  it("layout_ThePasteBox_PromisesNothingIsReadOrSavedWithoutAsking", () => {
    // Arrange & Act & Assert — 0007 · C3's guarantee, stated on the page where the reader
    // decides. The implementation keeps it; this is the sentence that tells them so.
    assert.match(AGENT, /nothing is saved until you have seen what would change/i);
  });

  it("layout_APageWithNoTools_CarriesNeitherSection", () => {
    // Arrange & Act — negative case: the sections belong to exactly one page each.
    const plain = layout("<p>body</p>", "A worksheet", null);

    // Assert
    assert.ok(!plain.includes('id="agent"'), "the assistant controls leaked onto another page");
    assert.ok(!plain.includes('id="paste"'), "the paste box leaked onto another page");
    assert.ok(!plain.includes('id="backup"'), "the backup controls leaked onto another page");
  });
});

describe("the wordmark", () => {
  it("layout_TheWordmarkPath_IsTheSameDrawingAsTheIcon", () => {
    // The installed icon and the page header must be one drawing rather than two shapes
    // that resemble each other — build/icons.ts rasterises the same coordinates. Nothing
    // else holds them together, so this fails if either is edited alone.
    const COORDS_PER_POINT = 2;
    const html = layout("<p>body</p>", null, null);

    // Act — read the coordinates back out of the rendered wordmark.
    const path = /class="wm-mark"[^>]*>\s*<path d="([^"]+)"/.exec(html);
    const numbers = (path?.[1] ?? "").match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    const points: number[][] = [];
    for (let at = 0; at < numbers.length; at += COORDS_PER_POINT) {
      points.push(numbers.slice(at, at + COORDS_PER_POINT));
    }

    // Assert
    assert.deepEqual(points, COMPASS_ROSE.map(([x, y]) => [x, y]));
  });
});
