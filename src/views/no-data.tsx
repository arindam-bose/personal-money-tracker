// What a page says before there is any data: every way in starts on the Settings page.

export function NoData() {
  return (
    <p>
      No data yet. Go to <a href="#/settings">Settings</a> to import a year or start one from scratch,
      or download a demo file there to try it out.
    </p>
  );
}
