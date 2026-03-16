const http = require("http");
const fs = require("fs");
const path = require("path");

const KEY = "sk-api-gwYvxa2sX0-B38idARiZPVmdq70lBjiw3xEsyO71psEkk-bHJHI_3O8vBRkx9r1D_r-x6QGlVrTpDBiV-UxBKCAN3ctFEVZ3MD9E2oNwIWGBj5ZwQMLCup8";
const API_URL = "https://api.minimaxi.com/v1/chat/completions";
const PORT = process.env.PORT || 3000;

const INDEX_HTML = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  // Serve index.html
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(INDEX_HTML);
    return;
  }

  // API proxy
  if (req.url === "/api/chat") {
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      res.end();
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405, { ...CORS, "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "POST only" }));
      return;
    }

    try {
      const body = JSON.parse(await readBody(req));
      const { system, messages, max_tokens } = body;
      const msgs = [];
      if (system) msgs.push({ role: "system", content: system });
      for (const m of messages || []) msgs.push({ role: m.role, content: m.content });

      const payload = { model: "MiniMax-M2.5-highspeed", messages: msgs, temperature: 0.85, stream: true };
      if (max_tokens && max_tokens > 0) payload.max_tokens = max_tokens;

      const resp = await fetch(API_URL, {
        method: "POST",
        headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        res.writeHead(502, { ...CORS, "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "MiniMax HTTP " + resp.status + ": " + errText.substring(0, 200) }));
        return;
      }

      // Stream SSE from MiniMax directly to the browser.
      // This keeps the Render connection alive (no 30s timeout)
      // and lets the client accumulate tokens.
      res.writeHead(200, {
        ...CORS,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          // Forward raw SSE chunks to client
          res.write(decoder.decode(value, { stream: true }));
        }
      } catch (e) {
        console.error("Stream read error:", e);
      }

      res.end();
    } catch (err) {
      console.error("API error:", err);
      if (!res.headersSent) {
        res.writeHead(500, { ...CORS, "Content-Type": "application/json" });
      }
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 404 for everything else
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
