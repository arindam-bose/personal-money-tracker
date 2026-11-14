// What a page says before there is any data: every way in starts on the Settings page.

import { DemoLink } from "./demo-link";

export function NoData() {
  return (
    <p>
      No data yet. Go to <a href="#/settings">Settings</a> to import a year or start one from scratch.
      Or download a <DemoLink>demo file</DemoLink> and import it there to try it out. Moving from
      another device? Drop its backup file anywhere on this page, or use Import in the top bar.
    </p>
  );
}
