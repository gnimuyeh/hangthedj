const http = require("http");
const https = require("https");
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

// Call MiniMax with streaming, buffer result, return { text, finish_reason, usage }
function callMiniMax(payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const url = new URL(API_URL);

    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: "POST",
      headers: {
        "Authorization": "Bearer " + KEY,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    };

    const req = https.request(options, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        if (res.statusCode !== 200) {
          reject(new Error("MiniMax HTTP " + res.statusCode + ": " + body.substring(0, 200)));
          return;
        }

        // Parse SSE stream from buffered body
        let fullText = "";
        let finishReason = "?";
        let usage = {};

        const lines = body.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data:")) continue;
          const d = trimmed.slice(5).trim();
          if (d === "[DONE]") continue;
          try {
            const chunk = JSON.parse(d);
            fullText += chunk.choices?.[0]?.delta?.content || "";
            if (chunk.choices?.[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason;
            if (chunk.usage) usage = chunk.usage;
          } catch {}
        }

        resolve({ text: fullText, finish_reason: finishReason, usage });
      });
      res.on("error", reject);
    });

    req.on("error", reject);
    req.setTimeout(120000, () => { req.destroy(new Error("MiniMax timeout (120s)")); });
    req.write(data);
    req.end();
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

      // Send headers immediately with chunked encoding
      // Write spaces every 5s to keep connection alive while MiniMax thinks
      res.writeHead(200, { ...CORS, "Content-Type": "application/json" });

      const keepAlive = setInterval(() => {
        try { res.write(" "); } catch {}
      }, 5000);

      const result = await callMiniMax(payload);
      clearInterval(keepAlive);

      // Strip think tags
      let text = result.text;
      text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      if (text.includes("<think>")) text = text.replace(/<think>[\s\S]*/g, "").trim();

      res.end(JSON.stringify({ text, finish_reason: result.finish_reason, usage: result.usage }));
    } catch (err) {
      console.error("API error:", err.message);
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
