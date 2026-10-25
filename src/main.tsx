import { render } from "preact";
import { App } from "./app";
import { registerOffline } from "./offline";
import "./style.css";

render(<App />, document.getElementById("app")!);
registerOffline();
