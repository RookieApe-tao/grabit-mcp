// MCP stdio 握手冒烟测试：initialize → tools/list → 校验工具名后退出
import { spawn } from "node:child_process";

const child = spawn(process.execPath, ["dist/mcp-server.js"], {
  stdio: ["pipe", "pipe", "pipe"],
});

let buf = "";
const timer = setTimeout(() => {
  console.error("MCP SMOKE TIMEOUT");
  child.kill();
  process.exit(1);
}, 20_000);

child.stdout.on("data", (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id === 1) {
      console.log("INIT OK:", msg.result?.serverInfo?.name, msg.result?.serverInfo?.version);
    }
    if (msg.id === 2) {
      const names = (msg.result?.tools ?? []).map((t) => t.name);
      console.log("TOOLS:", names.join(", "));
      const expected = ["media_info", "media_download", "media_batch", "media_cookies", "media_doctor"];
      const missing = expected.filter((n) => !names.includes(n));
      clearTimeout(timer);
      child.kill();
      if (missing.length) {
        console.error("MISSING TOOLS:", missing.join(", "));
        process.exit(1);
      }
      console.log("MCP SMOKE PASS");
      process.exit(0);
    }
  }
});

child.stderr.on("data", (d) => process.stderr.write(d));
child.on("exit", (code) => {
  if (code && code !== 0) {
    clearTimeout(timer);
    console.error("mcp-server exited early:", code);
    process.exit(1);
  }
});

child.stdin.write(
  JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "smoke", version: "0.0.0" },
    },
  }) + "\n",
);
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");
