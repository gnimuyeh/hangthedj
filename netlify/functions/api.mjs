const KEY = "sk-api-gwYvxa2sX0-B38idARiZPVmdq70lBjiw3xEsyO71psEkk-bHJHI_3O8vBRkx9r1D_r-x6QGlVrTpDBiV-UxBKCAN3ctFEVZ3MD9E2oNwIWGBj5ZwQMLCup8";
const API_URL = "https://api.minimaxi.com/v1/chat/completions";

export default async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { system, messages, max_tokens } = await req.json();
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
      return new Response(JSON.stringify({ error: "MiniMax HTTP " + resp.status + ": " + errText.substring(0, 200) }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Stream from MiniMax: collect all SSE chunks, buffer the full content,
    // then return as a single JSON response. The streaming keeps the
    // Netlify connection alive past the 26s timeout.
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

    return new Response(JSON.stringify({ text: fullText, finish_reason: finishReason, usage }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
};

export const config = {
  path: "/api/chat",
};
