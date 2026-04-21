import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

interface ExpandableTextProps {
  /** Raw text to use for overflow measurement + children rendering. */
  text: string;
  /** Rendered content (may contain markdown). Defaults to `text`. */
  children?: ReactNode;
  className?: string;
  collapsedMaxPx?: number;
  prefix?: string;
}

/**
 * Multi-line text block that shows only the END of long content by default
 * (scrolled to bottom) with a fade-in-top gradient, and a discreet "Voir tout"
 * button to expand. Click on the body also toggles.
 */
export function ExpandableText({
  text,
  children,
  className = "",
  collapsedMaxPx = 180,
  prefix,
}: ExpandableTextProps) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const wasCollapsed = el.classList.contains("xt-collapsed");
    el.classList.remove("xt-collapsed");
    const fullHeight = el.scrollHeight;
    if (wasCollapsed) el.classList.add("xt-collapsed");
    const over = fullHeight > collapsedMaxPx + 4;
    setOverflows(over);
    if (!expanded && over) {
      el.scrollTop = el.scrollHeight;
    }
  }, [text, expanded, collapsedMaxPx]);

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (overflows) setExpanded((v) => !v);
  }

  return (
    <div className={`xt-wrap ${overflows ? "xt-has-overflow" : ""} ${className}`}>
      <div
        ref={bodyRef}
        className={`xt-body ${!expanded ? "xt-collapsed" : ""}`}
        onClick={toggle}
        style={
          !expanded ? { maxHeight: `${collapsedMaxPx}px`, overflow: "hidden" } : undefined
        }
      >
        {prefix && <span className="xt-prefix">{prefix}</span>}
        {children ?? text}
      </div>
      {!expanded && overflows && <div className="xt-fade" />}
      {overflows && (
        <button className="xt-toggle" onClick={toggle}>
          {expanded ? "Réduire" : "Voir tout"}
        </button>
      )}
      <style>{expandableCss}</style>
    </div>
  );
}

const expandableCss = `
.xt-wrap { position: relative; margin-top: 0; }
.xt-body {
  font-size: 11px;
  line-height: 1.65;
  word-break: break-word;
}
.xt-has-overflow .xt-body { cursor: zoom-in; }
.xt-prefix { color: var(--muted); }
.xt-fade {
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 28px;
  pointer-events: none;
  background: linear-gradient(180deg, var(--bg) 0%, rgba(10,14,10,0.8) 40%, transparent 100%);
}
.xt-toggle {
  background: transparent;
  border: 0;
  color: var(--muted);
  font-family: "JetBrains Mono", monospace;
  font-size: 9px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  padding: 6px 0 0 0;
  cursor: pointer;
}
.xt-toggle:hover { color: var(--phosphor); }
`;
