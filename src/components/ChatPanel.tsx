import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Agent, AgentStatus } from "../types";
import { Markdown } from "./Markdown";

export type ChatTarget = { kind: "agent"; agent: Agent };

interface ChatPanelProps {
  target: ChatTarget | null;
  onClose: () => void;
}

interface ConversationEntry {
  role: "user" | "assistant";
  text: string;
  timestamp: number;
  order: number;
}

interface LocalMessage {
  role: "user";
  text: string;
  ts: number;
  local: true;
}

type Bubble = ConversationEntry | LocalMessage;

export function ChatPanel({ target, onClose }: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [history, setHistory] = useState<ConversationEntry[]>([]);
  const [local, setLocal] = useState<LocalMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Track whether the user scrolled up — if so, don't auto-scroll on updates.
  const pinnedToBottomRef = useRef(true);

  const pid = target?.agent.pid ?? null;
  const projectPath = target?.agent.projectPath ?? null;
  const sessionId = target?.agent.sessionId ?? null;

  // Fetch full history on target change + periodically + when response changes
  useEffect(() => {
    if (!projectPath || !sessionId) return;
    let cancelled = false;

    async function load() {
      try {
        const entries = await invoke<ConversationEntry[]>("get_conversation", {
          projectPath,
          sessionId,
        });
        if (!cancelled) {
          setHistory(entries);
          // Drop local echo entries now present in history
          setLocal((prev) =>
            prev.filter(
              (l) =>
                !entries.some(
                  (e) => e.role === "user" && e.text.trim() === l.text.trim()
                )
            )
          );
        }
      } catch {
        /* ignore */
      }
    }

    load();
    const iv = setInterval(load, 2500);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [projectPath, sessionId]);

  // Also refetch when backend sees a new response (quicker than the 2.5s poll).
  useEffect(() => {
    if (!projectPath || !sessionId) return;
    invoke<ConversationEntry[]>("get_conversation", { projectPath, sessionId })
      .then((entries) => setHistory(entries))
      .catch(() => {});
  }, [target?.agent.lastResponseAt, target?.agent.lastMessageAt, projectPath, sessionId]);

  // Reset when target changes
  useEffect(() => {
    setDraft("");
    setLocal([]);
    setError(null);
    pinnedToBottomRef.current = true;
    const t = setTimeout(() => textareaRef.current?.focus(), 260);
    return () => clearTimeout(t);
  }, [pid]);

  // Track scroll position — unpin if user scrolls up
  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinnedToBottomRef.current = fromBottom < 30;
  }

  // Auto-scroll when content grows AND user is pinned at the bottom
  useEffect(() => {
    if (!pinnedToBottomRef.current) return;
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [history, local, target?.agent.status]);

  // Escape closes
  useEffect(() => {
    if (!target) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (document.activeElement === textareaRef.current) {
          textareaRef.current?.blur();
        } else {
          onClose();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [target, onClose]);

  function autoResize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }

  async function send() {
    const text = draft.trim();
    if (!text || !target || sending) return;
    setSending(true);
    setError(null);
    try {
      await invoke("send_to_terminal", {
        projectPath: target.agent.projectPath,
        pid: target.agent.pid,
        text,
      });
      setLocal((m) => [...m, { role: "user", text, ts: Date.now(), local: true }]);
      setDraft("");
      autoResize();
      pinnedToBottomRef.current = true;
    } catch (e: unknown) {
      setError(typeof e === "string" ? e : (e as Error)?.message ?? "Envoi impossible");
    } finally {
      setSending(false);
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const open = target !== null;
  const agent = target?.agent ?? null;

  // Merge history + local messages, de-duplicating by text
  const bubbles: Bubble[] = [...history];
  for (const l of local) {
    const alreadyInHistory = history.some(
      (h) => h.role === "user" && h.text.trim() === l.text.trim()
    );
    if (!alreadyInHistory) bubbles.push(l);
  }

  const lastUserTs = Math.max(
    agent?.lastMessageAt ?? 0,
    ...local.map((l) => l.ts)
  );
  const showTyping =
    agent &&
    agent.status !== "waiting" &&
    lastUserTs > (agent.lastResponseAt ?? 0);

  const title = agent
    ? `${agent.name ?? `Agent #${agent.pid}`} · ${agent.project}`
    : "—";
  const status: AgentStatus | null = agent?.status ?? null;
  const statusLabel =
    status === "thinking"
      ? "Réfléchit…"
      : status === "coding"
      ? "Code…"
      : "En attente";
  const avatarChar = agent
    ? (() => {
        const n = agent.name ?? "";
        if (n.startsWith("Agent")) {
          return String(agent.pid).charAt(0);
        }
        return (n.charAt(0) || "A").toUpperCase();
      })()
    : "—";

  return (
    <aside
      className={`chat ${open ? "open" : ""}`}
      role="dialog"
      aria-hidden={!open}
      aria-label="Conversation avec l'agent"
    >
      <div className="chat-head">
        <div className="avatar">{avatarChar}</div>
        <div className="meta">
          <span className="chat-name">{title}</span>
          <span className="chat-sub">
            <span className={`d dot-${status ?? "waiting"}`} />
            {statusLabel}
          </span>
        </div>
        <button className="chat-close" title="Fermer (Esc)" onClick={onClose}>
          ×
        </button>
      </div>

      <div className="chat-body" ref={bodyRef} onScroll={onScroll}>
        {bubbles.length === 0 && !showTyping && (
          <div className="chat-empty">
            Pas encore d'historique. Tapez un message ci-dessous.
          </div>
        )}
        {bubbles.map((b, i) => (
          <div
            key={`b-${i}-${"ts" in b ? b.ts : b.order}`}
            className={`bubble ${b.role}`}
          >
            {b.role === "assistant" ? (
              <Markdown>{b.text}</Markdown>
            ) : (
              b.text
            )}
          </div>
        ))}
        {showTyping && agent && <TypingBubble status={agent.status} />}
        {error && <div className="chat-error">⚠ {error}</div>}
      </div>

      <div className="chat-compose">
        <textarea
          ref={textareaRef}
          value={draft}
          placeholder="Écrire un message…"
          rows={1}
          onChange={(e) => {
            setDraft(e.target.value);
            autoResize();
          }}
          onKeyDown={onKey}
          disabled={!open}
        />
        <button
          className="chat-send"
          onClick={send}
          disabled={!open || !draft.trim() || sending}
        >
          {sending ? "…" : "Envoyer"}
        </button>
      </div>
      <div className="chat-hint">
        ⏎ envoyer &nbsp;·&nbsp; Maj+⏎ nouvelle ligne &nbsp;·&nbsp; Esc fermer
      </div>

      <style>{chatCss}</style>
    </aside>
  );
}

function TypingBubble({ status }: { status: AgentStatus }) {
  const label =
    status === "coding"
      ? "Code…"
      : status === "thinking"
      ? "Réfléchit…"
      : "Travaille…";
  return (
    <div className="bubble assistant typing">
      <span className="typing-inner">
        {label}
        <span className="typing-dots">
          <span /> <span /> <span />
        </span>
      </span>
    </div>
  );
}

const chatCss = `
.chat {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 440px;
  max-width: 92vw;
  border-left: 1px solid var(--line);
  background: var(--panel);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 150;
  transform: translateX(100%);
  transition: transform 0.25s ease;
  box-shadow: -8px 0 32px rgba(0, 0, 0, 0.5);
}
.chat.open { transform: translateX(0); }

.chat-head {
  padding: 12px 16px;
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--panel-2);
}
.chat-head .avatar {
  width: 28px; height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0,255,159,0.12);
  border: 1px solid rgba(0,255,159,0.3);
  color: var(--phosphor);
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
}
.chat-head .meta { flex: 1; min-width: 0; }
.chat-head .chat-name {
  font-family: "Space Grotesk", sans-serif;
  font-weight: 500;
  font-size: 13px;
  color: var(--bright);
  letter-spacing: -0.01em;
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chat-head .chat-sub {
  font-size: 10px;
  color: var(--muted);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  display: flex;
  align-items: center;
  gap: 6px;
}
.chat-head .chat-sub .d {
  width: 7px; height: 7px; border-radius: 50%;
}
.chat-head .dot-thinking { background: var(--magenta); box-shadow: 0 0 6px var(--magenta); }
.chat-head .dot-coding { background: var(--phosphor); box-shadow: 0 0 6px var(--phosphor); }
.chat-head .dot-waiting { background: var(--amber); }

.chat-close {
  background: transparent;
  border: 1px solid var(--line-bright);
  color: var(--muted);
  width: 26px; height: 26px;
  border-radius: 2px;
  cursor: pointer;
  font-family: inherit;
  line-height: 1;
}
.chat-close:hover { color: var(--phosphor); border-color: var(--phosphor); }

.chat-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  scroll-behavior: smooth;
}
.chat-empty {
  color: var(--dim);
  font-size: 11px;
  text-align: center;
  padding: 30px 10px;
  letter-spacing: 0.05em;
}

.bubble {
  max-width: 88%;
  padding: 10px 13px;
  border-radius: 10px;
  font-size: 11.5px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}
.bubble.user {
  align-self: flex-end;
  background: rgba(0,255,159,0.1);
  border: 1px solid rgba(0,255,159,0.2);
  color: var(--bright);
  border-bottom-right-radius: 3px;
}
.bubble.assistant {
  align-self: flex-start;
  background: var(--panel-2);
  border: 1px solid var(--line);
  color: var(--text);
  border-bottom-left-radius: 3px;
  white-space: normal;
}

.bubble.assistant.typing {
  padding: 10px 14px;
  background: rgba(255,46,126,0.08);
  border-color: rgba(255,46,126,0.25);
}
.bubble.assistant.typing .typing-inner {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--magenta);
  font-style: italic;
}
.bubble.assistant.typing .typing-dots { display: inline-flex; gap: 3px; }
.bubble.assistant.typing .typing-dots span {
  width: 4px; height: 4px;
  background: var(--magenta);
  border-radius: 50%;
  animation: typing-dot 1.2s infinite;
}
.bubble.assistant.typing .typing-dots span:nth-child(2) { animation-delay: 0.15s; }
.bubble.assistant.typing .typing-dots span:nth-child(3) { animation-delay: 0.3s; }

.chat-error {
  color: var(--amber);
  font-size: 10px;
  padding: 6px 10px;
  border: 1px solid rgba(255,176,0,0.3);
  border-radius: 3px;
  background: rgba(255,176,0,0.06);
  align-self: stretch;
}

.chat-compose {
  border-top: 1px solid var(--line);
  padding: 10px 14px 12px;
  background: var(--panel-2);
  display: flex;
  align-items: flex-end;
  gap: 8px;
}
.chat-compose textarea {
  flex: 1;
  background: var(--bg);
  border: 1px solid var(--line-bright);
  border-radius: 4px;
  padding: 8px 10px;
  color: var(--bright);
  font-family: "JetBrains Mono", monospace;
  font-size: 11.5px;
  line-height: 1.5;
  resize: none;
  min-height: 36px;
  max-height: 160px;
  outline: 0;
}
.chat-compose textarea:focus { border-color: var(--phosphor); }
.chat-compose textarea::placeholder { color: var(--dim); }
.chat-send {
  background: rgba(0,255,159,0.12);
  border: 1px solid var(--phosphor);
  color: var(--phosphor);
  padding: 8px 14px;
  border-radius: 4px;
  cursor: pointer;
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  flex-shrink: 0;
}
.chat-send:hover { background: rgba(0,255,159,0.25); }
.chat-send:disabled { opacity: 0.4; cursor: not-allowed; }
.chat-hint {
  padding: 4px 14px 8px;
  background: var(--panel-2);
  color: var(--muted);
  font-size: 9px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
`;
