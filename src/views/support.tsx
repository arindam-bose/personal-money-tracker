// The Support card on the Settings page, as in the Habit Tracker and the RDR2 Crafting Guide: the one
// card lit in the accent, with Buy me a coffee and Share the tracker.

import { useSignal } from "@preact/signals";
import { COFFEE_URL, SHARE, browserEnv, shareLink, usesSheet } from "../share";
import { Icon } from "./icons";

export function SupportCard() {
  /** What came of the last Share, in place of the line under the button; null until there is one. */
  const said = useSignal<string | null>(null);
  const sheet = usesSheet(browserEnv());

  async function onShare(e: Event) {
    // A real link, so a long press or right-click can copy it too; a click shares instead.
    e.preventDefault();
    const outcome = await shareLink(SHARE, browserEnv());
    said.value = outcome === "copied" ? "Link copied. Paste it to a friend."
      : outcome === "failed" ? `This browser wouldn't let the page copy. The link is ${SHARE.url}`
      : null;
  }

  return (
    <section class="panel settings support">
      <h2>Support the tracker</h2>
      <p class="muted">
        The tracker is free, with no ads and no accounts, and your ledger never leaves this browser -
        it will stay that way. If it showed you where the money goes, a coffee keeps it going - and so
        does passing it on to a friend who'd like to know the same.
      </p>
      {/* A plain link, not that site's widget or button image: those load from its servers, which
          the promise that nothing is sent anywhere rules out. Nothing is fetched until it's tapped. */}
      <div class="setting-row">
        <a class="button coffee-button" href={COFFEE_URL} target="_blank" rel="noopener noreferrer">
          <Icon name="coffee" />
          Buy me a coffee
        </a>
        <span class="muted small">Opens buymeacoffee.com in a new tab</span>
      </div>
      <div class="setting-row">
        <a class="button plain-button" href={SHARE.url} onClick={onShare}>Share the tracker</a>
        <span class="muted small" role="status">{said.value ?? (sheet ? "Opens your share menu" : "Copies the link")}</span>
      </div>
    </section>
  );
}
