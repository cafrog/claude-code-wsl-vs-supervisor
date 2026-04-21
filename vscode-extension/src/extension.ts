import * as vscode from "vscode";
import * as http from "http";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Directory where each extension instance publishes its port + workspace info.
// The Tauri app on the Windows side reads this dir via wsl.exe to discover
// which port to talk to for a given workspace.
const DISCOVERY_DIR = path.join(os.homedir(), ".claude-code-wsl-vs-supervisor", "helpers");

export async function activate(context: vscode.ExtensionContext) {
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method !== "POST") {
        res.writeHead(405).end();
        return;
      }
      const url = new URL(req.url || "/", "http://localhost");
      const pidStr = url.searchParams.get("pid");
      const targetPid = pidStr ? parseInt(pidStr, 10) : 0;
      if (!targetPid || Number.isNaN(targetPid)) {
        res.writeHead(400).end("missing or invalid pid");
        return;
      }

      if (url.pathname === "/focus") {
        const focused = await focusTerminalByPid(targetPid);
        res.writeHead(focused ? 200 : 404).end(focused ? "ok" : "not found");
        return;
      }

      if (url.pathname === "/send") {
        const body = await readBody(req);
        if (!body) {
          res.writeHead(400).end("missing body");
          return;
        }
        const sent = await sendTextToTerminalByPid(targetPid, body);
        res.writeHead(sent ? 200 : 404).end(sent ? "ok" : "not found");
        return;
      }

      res.writeHead(404).end();
    } catch (e) {
      res.writeHead(500).end(String(e));
    }
  });

  // Bind to an ephemeral port on loopback so multiple VS Code windows don't collide.
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const addr = server.address();
  const port =
    typeof addr === "object" && addr && "port" in addr ? (addr.port as number) : 0;

  const discoveryFile = publishDiscovery(port);

  context.subscriptions.push({
    dispose: () => {
      try {
        if (discoveryFile) fs.unlinkSync(discoveryFile);
      } catch {
        /* ignore */
      }
      server.close();
    },
  });

  // Re-publish on workspace change so folders added later are visible.
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => publishDiscovery(port))
  );
}

export function deactivate() {
  // Handled via context.subscriptions disposal.
}

function publishDiscovery(port: number): string | null {
  try {
    fs.mkdirSync(DISCOVERY_DIR, { recursive: true });
  } catch {
    /* ignore */
  }

  const workspaceFolders = (vscode.workspace.workspaceFolders || [])
    .map((f) => f.uri.fsPath)
    .filter(Boolean);

  const data = {
    pid: process.pid,
    port,
    workspaceFolders,
  };

  const fileName = `${process.pid}.json`;
  const filePath = path.join(DISCOVERY_DIR, fileName);

  try {
    fs.writeFileSync(filePath, JSON.stringify(data));
    return filePath;
  } catch {
    return null;
  }
}

async function focusTerminalByPid(targetPid: number): Promise<boolean> {
  for (const terminal of vscode.window.terminals) {
    const shellPid = await terminal.processId;
    if (!shellPid) continue;
    if (isDescendant(shellPid, targetPid)) {
      terminal.show(false); // preserveFocus=false — moves focus to the terminal
      return true;
    }
  }
  return false;
}

/**
 * Find the terminal hosting the given PID and send text to it (as if the user
 * typed it). Appends a newline so the input is submitted.
 */
async function sendTextToTerminalByPid(
  targetPid: number,
  text: string
): Promise<boolean> {
  for (const terminal of vscode.window.terminals) {
    const shellPid = await terminal.processId;
    if (!shellPid) continue;
    if (isDescendant(shellPid, targetPid)) {
      terminal.sendText(text, true);
      return true;
    }
  }
  return false;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

/**
 * Walks up the process tree from `descendant` and returns true if `ancestor`
 * appears in its parent chain. This lets us match a terminal (identified by
 * its shell PID) to a Claude process running inside it.
 */
function isDescendant(ancestor: number, descendant: number): boolean {
  let current = descendant;
  for (let i = 0; i < 50; i++) {
    if (current === ancestor) return true;
    const ppid = getPpid(current);
    if (ppid === null || ppid <= 1 || ppid === current) return false;
    current = ppid;
  }
  return false;
}

function getPpid(pid: number): number | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    // /proc/<pid>/stat format: pid (comm) state ppid ...
    // comm may contain spaces AND parentheses, so locate the LAST ')'
    // and parse fields after it.
    const lastParen = stat.lastIndexOf(")");
    if (lastParen < 0) return null;
    const rest = stat.slice(lastParen + 2).split(" ");
    // rest[0] = state, rest[1] = ppid
    const ppid = parseInt(rest[1], 10);
    return Number.isFinite(ppid) ? ppid : null;
  } catch {
    return null;
  }
}
