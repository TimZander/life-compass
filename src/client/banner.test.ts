/**
 * When the banner speaks, and when it waits.
 *
 * This module had no tests, which is how a change to a function it calls came to break
 * every consumer of that function silently — the update prompt's Dismiss button has done
 * nothing in production since #51. These cover the invocation contract that broke, and the
 * deferral behaviour it sits next to.
 */

import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { after, before, describe, it } from "node:test";

let window: Window;

before(() => {
  window = new Window();
  const scope = globalThis as unknown as Record<string, unknown>;
  scope["document"] = window.document;
  scope["HTMLElement"] = window.HTMLElement;
  scope["HTMLInputElement"] = window.HTMLInputElement;
});

after(() => {
  void window.close();
});

/** A page with the live region the build emits, plus something to put focus on. */
function page(focusOn: string): Document {
  window.document.body.innerHTML =
    '<div id="banner-region" aria-live="polite"></div>' +
    '<input type="file" id="file">' +
    '<input type="text" id="text">' +
    '<input type="checkbox" id="checkbox">' +
    '<button type="button" id="button">Press</button>' +
    "<textarea id="+'"area"'+"></textarea>";
  (window.document.getElementById(focusOn) as unknown as HTMLElement | null)?.focus();
  return window.document as unknown as Document;
}

function showing(): boolean {
  return (window.document.getElementById("banner-region")?.children.length ?? 0) > 0;
}

const MESSAGE = { id: "storage", text: "That file is not a Life Compass backup.", actions: [] };

describe("waiting for a pause in typing", () => {
  it("showBanner_WhileAFileInputHasFocus_SpeaksImmediately", async () => {
    // Arrange — the restore control's picker leaves focus on its file input, so the rule
    // "the focused element is an INPUT" deferred every message explaining why a file was
    // refused, until a pause that never came. The reader picked the wrong thing and was
    // told nothing at all, which is the opposite of what deferring is for.
    const { showBanner, dismissBanner } = await import("./banner.ts");
    page("file");
    dismissBanner();

    // Act
    showBanner(MESSAGE);

    // Assert
    assert.equal(showing(), true, "the refusal was deferred behind a file input");
  });

  it("showBanner_WhileAControlHasFocus_SpeaksImmediately", async () => {
    // Arrange — operating a control is not composing text, and a message about the control
    // just operated is precisely the one that should not wait.
    const { showBanner, dismissBanner } = await import("./banner.ts");

    // Act & Assert
    for (const id of ["checkbox", "button"]) {
      page(id);
      dismissBanner();
      showBanner(MESSAGE);
      assert.equal(showing(), true, `deferred behind a ${id}`);
    }
  });

  it("showBanner_WhileSomebodyIsWriting_Waits", async () => {
    // Arrange — the reason the delay exists (0001). A strip appearing under a reader's
    // hands mid-dictation is the interruption the record forbids.
    const { showBanner, dismissBanner } = await import("./banner.ts");

    // Act & Assert
    for (const id of ["text", "area"]) {
      page(id);
      dismissBanner();
      showBanner(MESSAGE);
      assert.equal(showing(), false, `interrupted somebody writing in a ${id}`);
    }
  });

  it("showBanner_WithNothingFocused_SpeaksImmediately", async () => {
    // Arrange & Act & Assert — the ordinary case, which the rule above must not swallow.
    const { showBanner, dismissBanner } = await import("./banner.ts");
    page("button");
    (window.document.getElementById("button") as unknown as HTMLElement).blur();
    dismissBanner();
    showBanner(MESSAGE);
    assert.equal(showing(), true);
  });
});

describe("pressing an action", () => {
  it("showBanner_AnActionHandler_IsCalledWithNoArguments", async () => {
    // Arrange — `BannerAction.onSelect` is declared `() => void`, and handing it straight to
    // `addEventListener` called it with the click event instead. Harmless until a handler
    // took an optional first parameter: `dismissBanner(id?)` then received a MouseEvent as
    // the id, matched no banner, and dismissed nothing — so the update prompt's Dismiss
    // button stopped working. TypeScript cannot see this, because a function of fewer
    // parameters is assignable to one of more.
    const { showBanner, dismissBanner } = await import("./banner.ts");
    page("button");
    dismissBanner();
    // The COUNT, never the arguments themselves. With the bug present the first argument
    // is a MouseEvent, and comparing that with `assert.deepEqual` walks the DOM graph until
    // the heap is gone — the test then reports as a 30-second out-of-memory kill with no
    // message, which looks exactly like a passing mutation. 0014 · C6 records this; the
    // first version of this very test walked into it.
    const given: number[] = [];
    showBanner({
      id: "storage",
      text: "A new version is ready.",
      actions: [{ label: "Dismiss", onSelect: (...args: unknown[]) => given.push(args.length) }],
    });

    // Act
    const action = window.document.querySelector(".banner-action") as unknown as HTMLElement;
    action.dispatchEvent(new window.Event("click", { bubbles: true }) as unknown as Event);

    // Assert
    assert.deepEqual(given, [0], "the handler was given arguments it does not declare");
  });

  it("dismissBanner_PassedStraightToAnAction_StillClearsTheBanner", async () => {
    // Arrange — the shape sw-update.ts uses, and the one that broke. This is the end-to-end
    // version of the case above: whatever the handler is handed, Dismiss must dismiss.
    const { showBanner, dismissBanner } = await import("./banner.ts");
    page("button");
    dismissBanner();
    showBanner({
      id: "update",
      text: "A new version is ready.",
      actions: [{ label: "Dismiss", onSelect: dismissBanner }],
    });
    assert.equal(showing(), true, "the banner never appeared");

    // Act
    const action = window.document.querySelector(".banner-action") as unknown as HTMLElement;
    action.dispatchEvent(new window.Event("click", { bubbles: true }) as unknown as Event);

    // Assert
    assert.equal(showing(), false, "Dismiss did not dismiss");
  });
});
