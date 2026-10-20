import { useEffect } from "preact/hooks";
import { requestPersistence } from "./storage";
import { persistState, refreshYears } from "./state";
import { DataView } from "./views/data";

export function App() {
  useEffect(() => {
    requestPersistence().then((s) => (persistState.value = s));
    refreshYears();
  }, []);

  return (
    <>
      <header class="topbar">
        <h1>Money Tracker</h1>
      </header>
      <main>
        <DataView />
      </main>
    </>
  );
}
