import { useCallback, useEffect, useRef, useState } from "react";
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
  const [checking, setChecking] = useState(false);
  const [flashUpToDate, setFlashUpToDate] = useState(false);
  const inflightRef = useRef(false);
  const cancelledRef = useRef(false);

  const runCheck = useCallback(async (manual: boolean) => {
    if (cancelledRef.current || inflightRef.current) return;
    inflightRef.current = true;
    if (manual) setChecking(true);
    try {
      const u = await check();
      if (cancelledRef.current) return;
      if (u) {
        setState((s) => (s.kind === "idle" ? { kind: "available", update: u } : s));
      } else if (manual) {
        setFlashUpToDate(true);
        setTimeout(() => setFlashUpToDate(false), 2500);
      }
    } catch {
      /* ignore */
    } finally {
      inflightRef.current = false;
      if (!cancelledRef.current) setChecking(false);
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;

    (async () => {
      try {
        const v = await getVersion();
        if (!cancelledRef.current) setCurrentVersion(v);
      } catch {
        /* ignore */
      }
      await runCheck(false);
    })();

    const onAuto = () => void runCheck(false);
    const intervalId = setInterval(onAuto, 30 * 60 * 1000);
    window.addEventListener("focus", onAuto);

    return () => {
      cancelledRef.current = true;
      clearInterval(intervalId);
      window.removeEventListener("focus", onAuto);
    };
  }, [runCheck]);

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

  const isIdle = state.kind === "idle";
  const bannerClass = isIdle ? "update-banner idle" : "update-banner";

  return (
    <>
      <div className={bannerClass}>
        {isIdle && (
          <button
            className="idle-check-btn"
            onClick={() => runCheck(true)}
            disabled={checking}
            title="Cliquer pour vérifier les mises à jour"
          >
            {checking ? (
              <>
                <span className="update-icon spin">↻</span>
                <span className="update-text">vérification…</span>
              </>
            ) : (
              <>
                <span
                  className={`update-icon idle-check${flashUpToDate ? " flash" : ""}`}
                >
                  ✓
                </span>
                <span className="update-text">
                  v<b>{currentVersion ?? "—"}</b> · à jour
                </span>
              </>
            )}
          </button>
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
  gap: 0;
  padding: 0;
}
.idle-check-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  background: transparent;
  border: 0;
  color: inherit;
  font-family: inherit;
  font-size: inherit;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  border-radius: 2px;
}
.idle-check-btn:hover:not(:disabled) {
  background: rgba(0, 255, 159, 0.08);
  color: var(--text);
}
.idle-check-btn:hover:not(:disabled) .idle-check {
  opacity: 1;
}
.idle-check-btn:disabled { cursor: wait; }
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
  transition: opacity 0.15s;
}
.update-icon.idle-check.flash {
  opacity: 1;
  animation: flash-up 0.4s ease-out;
}
@keyframes flash-up {
  0% { transform: scale(1.6); opacity: 0.2; }
  60% { transform: scale(1.1); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}
.update-icon.pulse { animation: blink 1.4s infinite; }
.update-icon.spin {
  display: inline-block;
  animation: spin 0.9s linear infinite;
  color: var(--phosphor);
  opacity: 0.85;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
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
