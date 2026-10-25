import { render } from "preact";
import { App } from "./app";
import { registerOffline } from "./offline";
import "./theme"; // light or dark, and following the device when it switches
import "./style.css";

render(<App />, document.getElementById("app")!);
registerOffline();
