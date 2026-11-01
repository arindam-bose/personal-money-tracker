import { render } from "preact";
import { App } from "./app";
import { detectDevice } from "./device";
import { registerOffline } from "./offline";
import "./install"; // listens for the browser's install offer from the start, for Settings
import "./theme"; // light or dark, and following the device when it switches
import "./style.css";

// iPhones and iPads zoom the page into a field with text under 16px when it's tapped, and stay
// zoomed. Capping zoom at 100% stops that, and they still let people pinch to zoom. Apple only:
// on Android the cap would block pinch-zoom, and Android doesn't zoom on tap anyway.
const { system } = detectDevice();
if (system === "iPhone" || system === "iPad") {
  document.querySelector('meta[name="viewport"]')?.setAttribute("content", "width=device-width, initial-scale=1.0, maximum-scale=1");
}

render(<App />, document.getElementById("app")!);
registerOffline();
