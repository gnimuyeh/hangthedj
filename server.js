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
  // Parse URL without hash/query for clean matching
  const urlPath = req.url.split("?")[0].split("#")[0];

  // Serve index.html for any GET that isn't /api/*
  if (req.method === "GET" && !urlPath.startsWith("/api/")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(INDEX_HTML);
    return;
  }

  // API proxy — same logic as the Vercel version that worked
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
      const { system, messages, max_tokens } = JSON.parse(await readBody(req));
      const msgs = [];
      if (system) msgs.push({ role: "system", content: system });
      for (const m of (messages || [])) msgs.push({ role: m.role, content: m.content });

      const payload = { model: "MiniMax-M2.5-highspeed", messages: msgs, temperature: 0.85 };
      if (max_tokens && max_tokens > 0) payload.max_tokens = max_tokens;

      const resp = await fetch(API_URL, {
        method: "POST",
        headers: { "Authorization": "Bearer " + KEY, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const raw = await resp.text();

      let data;
      try { data = JSON.parse(raw); } catch {
        res.writeHead(502, { ...CORS, "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Bad JSON: " + raw.substring(0, 200) }));
        return;
      }

      if (data.error) {
        res.writeHead(502, { ...CORS, "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: data.error.message || JSON.stringify(data.error).substring(0, 200) }));
        return;
      }
      if (data.base_resp && data.base_resp.status_code !== 0) {
        res.writeHead(502, { ...CORS, "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: data.base_resp.status_msg }));
        return;
      }

      let text = data.choices?.[0]?.message?.content || "";
      const fr = data.choices?.[0]?.finish_reason || "?";
      const u = data.usage || {};

      text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      if (text.includes("<think>")) text = text.replace(/<think>[\s\S]*/g, "").trim();

      res.writeHead(200, { ...CORS, "Content-Type": "application/json" });
      res.end(JSON.stringify({ text, finish_reason: fr, usage: u }));
    } catch (err) {
      console.error("API error:", err.message);
      res.writeHead(500, { ...CORS, "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 404
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
