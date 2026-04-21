import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownProps {
  children: string;
  className?: string;
}

/**
 * Render the agent's markdown output with terminal-friendly styling.
 * Only transformations (links, code blocks, lists, bold/italic, tables via GFM).
 * No raw HTML — for safety.
 */
export function Markdown({ children, className }: MarkdownProps) {
  return (
    <div className={`md ${className ?? ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: (props) => (
            <a {...props} target="_blank" rel="noreferrer noopener" />
          ),
          // prevent outer <p> from adding margins in our compact layout
          p: ({ children, ...rest }) => <p {...rest}>{children}</p>,
        }}
      >
        {children}
      </ReactMarkdown>
      <style>{mdCss}</style>
    </div>
  );
}

const mdCss = `
.md { white-space: normal; }
.md > :first-child { margin-top: 0; }
.md > :last-child { margin-bottom: 0; }
.md p { margin: 0 0 0.5em; }
.md p:last-child { margin-bottom: 0; }
.md h1, .md h2, .md h3, .md h4 {
  font-family: "Space Grotesk", sans-serif;
  color: var(--bright);
  letter-spacing: -0.01em;
  margin: 0.8em 0 0.3em;
  font-weight: 600;
}
.md h1 { font-size: 14px; }
.md h2 { font-size: 13px; }
.md h3, .md h4 { font-size: 12px; }
.md ul, .md ol { margin: 0.3em 0 0.5em 0; padding-left: 1.3em; }
.md li { margin: 0.1em 0; }
.md li > p { margin: 0; }
.md code {
  font-family: "JetBrains Mono", monospace;
  background: rgba(0,255,159,0.08);
  color: var(--phosphor);
  padding: 1px 4px;
  border-radius: 2px;
  font-size: 95%;
}
.md pre {
  background: var(--bg);
  border: 1px solid var(--line-bright);
  border-radius: 4px;
  padding: 8px 10px;
  margin: 0.5em 0;
  overflow-x: auto;
}
.md pre code {
  background: transparent;
  color: var(--soft);
  padding: 0;
  border-radius: 0;
  font-size: 100%;
}
.md strong { color: var(--bright); font-weight: 600; }
.md em { color: var(--bright); font-style: italic; }
.md a { color: var(--phosphor); text-decoration: underline; text-decoration-color: rgba(0,255,159,0.4); }
.md a:hover { text-decoration-color: var(--phosphor); }
.md blockquote {
  border-left: 2px solid var(--line-bright);
  margin: 0.4em 0;
  padding: 0.1em 0.8em;
  color: var(--soft);
}
.md table {
  border-collapse: collapse;
  margin: 0.4em 0;
  font-size: 10.5px;
}
.md th, .md td {
  border: 1px solid var(--line-bright);
  padding: 3px 8px;
  text-align: left;
}
.md th {
  background: var(--panel-2);
  color: var(--bright);
  font-weight: 500;
}
.md hr {
  border: 0;
  border-top: 1px dashed var(--line-bright);
  margin: 0.6em 0;
}
`;
