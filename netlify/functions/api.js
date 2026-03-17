const KEY = "sk-api-gwYvxa2sX0-B38idARiZPVmdq70lBjiw3xEsyO71psEkk-bHJHI_3O8vBRkx9r1D_r-x6QGlVrTpDBiV-UxBKCAN3ctFEVZ3MD9E2oNwIWGBj5ZwQMLCup8";
const API_URL = "https://api.minimaxi.com/v1/chat/completions";

exports.handler = async (event) => {
  const h = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: h, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: h, body: '{"error":"POST only"}' };

  try {
    const { system, messages, max_tokens } = JSON.parse(event.body);
    const msgs = [];
    if (system) msgs.push({ role: "system", content: system });
    for (const m of (messages || [])) msgs.push({ role: m.role, content: m.content });

    const payload = { model: "MiniMax-M2.5-highspeed", messages: msgs, temperature: 0.85, stream: true };
    if (max_tokens && max_tokens > 0) payload.max_tokens = max_tokens;

    const resp = await fetch(API_URL, {
      method: "POST",
      headers: { "Authorization": "Bearer " + KEY, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return { statusCode: 502, headers: h, body: JSON.stringify({ error: "MiniMax HTTP " + resp.status + ": " + errText.substring(0, 200) }) };
    }

    // Use streaming to read from MiniMax — tokens arrive incrementally,
    // which is faster than waiting for the full non-streaming response.
    // We buffer everything and return as a single JSON response.
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";
    let finishReason = "?";
    let usage = {};

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") continue;

        try {
          const chunk = JSON.parse(data);
          const delta = chunk.choices?.[0]?.delta?.content || "";
          fullText += delta;
          if (chunk.choices?.[0]?.finish_reason) {
            finishReason = chunk.choices[0].finish_reason;
          }
          if (chunk.usage) usage = chunk.usage;
        } catch {
          // skip unparseable chunks
        }
      }
    }

    // Strip think tags
    fullText = fullText.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    if (fullText.includes("<think>")) fullText = fullText.replace(/<think>[\s\S]*/g, "").trim();

    return { statusCode: 200, headers: h, body: JSON.stringify({ text: fullText, finish_reason: finishReason, usage }) };
  } catch (err) {
    return { statusCode: 500, headers: h, body: JSON.stringify({ error: err.message }) };
  }
};
