// A link, inside a sentence, that downloads the demo file for this year.

import type { ComponentChildren } from "preact";
import { saveYearFile } from "../backup";
import { demoFileName, demoYear } from "../demo";
import { localToday } from "../derive";

export function DemoLink(props: { children: ComponentChildren }) {
  const year = Number(localToday().slice(0, 4));
  return (
    <button type="button" class="link demo-link" onClick={() => saveYearFile(demoYear(year), demoFileName(year))}>
      {props.children}
    </button>
  );
}
