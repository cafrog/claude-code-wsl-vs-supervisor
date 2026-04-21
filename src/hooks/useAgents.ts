import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { DashboardState } from "../types";

export function useAgents() {
  const [state, setState] = useState<DashboardState>({
    projects: [],
    totalAgents: 0,
  });

  useEffect(() => {
    const unlisten = listen<DashboardState>("agents-update", (event) => {
      setState(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return state;
}
