import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { DirectorPanel } from "./DirectorPanel";

import "./styles.css";

/* DEBUG_ERROR_OVERLAY */

function renderFatal(err: unknown) {
  const root = document.getElementById("root");
  if (!root) return;
  const msg = (err instanceof Error) ? (err.stack || err.message) : String(err);
  root.innerHTML = `
    <div style="padding:16px;font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;">
      <h2>Simulator crashed</h2>
      <pre style="white-space:pre-wrap;">${msg}</pre>
    </div>`;
}
window.addEventListener("error", (e) => renderFatal(e.error || e.message));
window.addEventListener("unhandledrejection", (e) => renderFatal((e as PromiseRejectionEvent).reason));

/** Simple hash router: #/director → DirectorPanel, everything else → App */
const Router: React.FC = () => {
  const [hash, setHash] = React.useState(window.location.hash);

  React.useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  if (hash === "#/director") {
    return <DirectorPanel />;
  }

  return <App />;
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Router />
  </React.StrictMode>,
);
