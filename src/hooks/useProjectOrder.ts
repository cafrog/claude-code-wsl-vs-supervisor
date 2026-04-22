import { useCallback, useEffect, useMemo, useState } from "react";
import type { Project } from "../types";

const STORAGE_KEY = "claude-code-wsl-vs-supervisor:project-order";

function loadOrder(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function saveOrder(order: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
  } catch {
    // Ignore storage errors (quota, disabled, etc.)
  }
}

/**
 * Keeps a persistent, user-defined order of projects.
 * New projects are appended to the end; removed projects are dropped from the order.
 * Exposes a `moveProject(fromName, toName)` to reorder by drag-and-drop.
 */
export function useProjectOrder(projects: Project[]): {
  orderedProjects: Project[];
  moveProject: (fromName: string, toName: string) => void;
} {
  const [order, setOrder] = useState<string[]>(() => loadOrder());

  // Reconcile the saved order with the live projects list:
  // keep saved names that still exist, and append new project names at the end.
  useEffect(() => {
    // Don't reconcile against an empty projects list — the first render fires
    // before the poller has delivered any data, and wiping would clobber the
    // persisted order every time the app starts.
    if (projects.length === 0) return;
    const names = new Set(projects.map((p) => p.name));
    const kept = order.filter((n) => names.has(n));
    const extras = projects.map((p) => p.name).filter((n) => !kept.includes(n));
    const next = [...kept, ...extras];
    if (
      next.length !== order.length ||
      next.some((n, i) => n !== order[i])
    ) {
      setOrder(next);
      saveOrder(next);
    }
  }, [projects, order]);

  const orderedProjects = useMemo(() => {
    const byName = new Map(projects.map((p) => [p.name, p]));
    const ordered: Project[] = [];
    for (const name of order) {
      const p = byName.get(name);
      if (p) ordered.push(p);
    }
    // Any project not in order (edge case during reconciliation)
    for (const p of projects) {
      if (!order.includes(p.name)) ordered.push(p);
    }
    return ordered;
  }, [projects, order]);

  const moveProject = useCallback((fromName: string, toName: string) => {
    if (fromName === toName) return;
    setOrder((prev) => {
      const from = prev.indexOf(fromName);
      const to = prev.indexOf(toName);
      if (from === -1 || to === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      saveOrder(next);
      return next;
    });
  }, []);

  return { orderedProjects, moveProject };
}
