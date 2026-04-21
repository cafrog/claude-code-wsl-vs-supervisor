import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";

type State =
  | { kind: "idle" }
  | { kind: "available"; update: Update }
  | { kind: "installing"; progress: number; total: number | null }
  | { kind: "ready" };

/**
 * Small banner in the TopBar that tells the user a new version is available.
 * Silently swallows errors — we never want to block the app if update checks
 * fail (offline, endpoint down, etc.).
 */
export function UpdateBanner() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const v = await getVersion();
        if (!cancelled) setCurrentVersion(v);
      } catch {
        /* ignore */
      }
      try {
        const u = await check();
        if (!cancelled && u) {
          setState({ kind: "available", update: u });
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function install() {
    if (state.kind !== "available") return;
    const update = state.update;
    let total: number | null = null;
    let downloaded = 0;
    setState({ kind: "installing", progress: 0, total: null });
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? null;
          setState({ kind: "installing", progress: 0, total });
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setState({ kind: "installing", progress: downloaded, total });
        } else if (event.event === "Finished") {
          setState({ kind: "ready" });
        }
      });
      await relaunch();
    } catch (err) {
      console.error("Update failed", err);
      setState({ kind: "idle" });
    }
  }

  const bannerClass =
    state.kind === "idle" ? "update-banner idle" : "update-banner";

  return (
    <>
      <div className={bannerClass}>
        {state.kind === "idle" && (
          <>
            <span className="update-icon idle-check">✓</span>
            <span className="update-text">
              v<b>{currentVersion ?? "—"}</b> · à jour
            </span>
          </>
        )}
        {state.kind === "available" && (
          <>
            <span className="update-icon">⇣</span>
            <span className="update-text">
              Nouvelle version <b>{state.update.version}</b> disponible
            </span>
            <button className="update-btn" onClick={install}>
              Mettre à jour
            </button>
            <button
              className="update-dismiss"
              onClick={() => setState({ kind: "idle" })}
              title="Plus tard"
            >
              ×
            </button>
          </>
        )}
        {state.kind === "installing" && (
          <>
            <span className="update-icon pulse">⇣</span>
            <span className="update-text">
              Téléchargement…
              {state.total
                ? ` ${Math.round((state.progress / state.total) * 100)} %`
                : ""}
            </span>
          </>
        )}
        {state.kind === "ready" && (
          <>
            <span className="update-icon">✓</span>
            <span className="update-text">Prêt — redémarrage…</span>
          </>
        )}
      </div>
      <style>{bannerCss}</style>
    </>
  );
}

const bannerCss = `
.update-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(0, 255, 159, 0.08);
  border: 1px solid rgba(0, 255, 159, 0.3);
  padding: 4px 12px;
  border-radius: 3px;
  font-family: "JetBrains Mono", monospace;
  font-size: 10.5px;
  color: var(--text);
}
.update-banner.idle {
  background: transparent;
  border-color: var(--line-bright);
  color: var(--muted);
  gap: 6px;
  padding: 3px 10px;
}
.update-banner.idle .update-text {
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-size: 10px;
}
.update-banner.idle .update-text b {
  color: var(--text);
  font-weight: 500;
}
.update-icon {
  color: var(--phosphor);
  font-size: 12px;
}
.update-icon.idle-check {
  color: var(--phosphor);
  opacity: 0.65;
  font-size: 11px;
}
.update-icon.pulse { animation: blink 1.4s infinite; }
.update-text b {
  color: var(--phosphor);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.update-btn {
  background: rgba(0, 255, 159, 0.15);
  border: 1px solid var(--phosphor);
  color: var(--phosphor);
  padding: 2px 10px;
  border-radius: 2px;
  font-family: inherit;
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background 0.15s;
}
.update-btn:hover { background: rgba(0, 255, 159, 0.3); }
.update-dismiss {
  background: transparent;
  border: 0;
  color: var(--muted);
  font-size: 14px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}
.update-dismiss:hover { color: var(--bright); }
`;
