import { UpdateBanner } from "./UpdateBanner";

interface TopBarProps {
  search: string;
  onSearchChange: (s: string) => void;
}

export function TopBar({ search, onSearchChange }: TopBarProps) {
  return (
    <header className="hdr">
      <span className="logo">Claude Code WSL VS Supervisor</span>
      <div className="search">
        <input
          type="text"
          placeholder="rechercher agents, projets, messages..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
      <div className="hdr-spacer" />
      <UpdateBanner />
      <style>{hdrCss}</style>
    </header>
  );
}

const hdrCss = `
.hdr {
  grid-column: 1 / -1;
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: center;
  padding: 0 18px;
  gap: 28px;
  background: linear-gradient(180deg, #0f1612 0%, var(--bg) 100%);
}
.logo {
  font-family: "Space Grotesk", sans-serif;
  font-weight: 700;
  font-size: 13px;
  letter-spacing: 0.18em;
  color: var(--bright);
}
.logo::before {
  content: "◉";
  color: var(--phosphor);
  margin-right: 8px;
  animation: blink 2s infinite;
}
.search {
  flex: 1;
  max-width: 420px;
  display: flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--line-bright);
  border-radius: 3px;
  padding: 4px 10px;
  background: var(--panel);
}
.search:focus-within { border-color: var(--phosphor); }
.search::before {
  content: "/";
  color: var(--phosphor);
  font-size: 12px;
  font-weight: 700;
}
.search input {
  background: transparent;
  border: 0;
  outline: 0;
  color: var(--bright);
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  width: 100%;
}
.search input::placeholder { color: var(--muted); }
.hdr-spacer { flex: 1; }
`;
