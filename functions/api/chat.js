const KEY = "sk-api-gwYvxa2sX0-B38idARiZPVmdq70lBjiw3xEsyO71psEkk-bHJHI_3O8vBRkx9r1D_r-x6QGlVrTpDBiV-UxBKCAN3ctFEVZ3MD9E2oNwIWGBj5ZwQMLCup8";
const API_URL = "https://api.minimaxi.com/v1/chat/completions";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost({ request }) {
  try {
    const { system, messages, max_tokens, temperature } = await request.json();
    const msgs = [];
    if (system) msgs.push({ role: "system", content: system });
    for (const m of (messages || [])) msgs.push({ role: m.role, content: m.content });

    const temp = (typeof temperature === "number") ? temperature : 0.85;
    const payload = { model: "MiniMax-M2.5-highspeed", messages: msgs, temperature: temp, stream: true };
    if (max_tokens && max_tokens > 0) payload.max_tokens = max_tokens;

    const resp = await fetch(API_URL, {
      method: "POST",
      headers: { "Authorization": "Bearer " + KEY, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return new Response(
        JSON.stringify({ error: "MiniMax HTTP " + resp.status + ": " + errText.substring(0, 200) }),
        { status: 502, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Stream SSE keepalive pings to client while buffering MiniMax response.
    // This prevents client-side timeouts during long reasoning phases.
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    (async () => {
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";
      let finishReason = "?";
      let usage = {};

      try {
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
              if (chunk.choices?.[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason;
              if (chunk.usage) usage = chunk.usage;
            } catch {
              // skip unparseable chunks
            }
          }

          // Send SSE comment as keepalive ping (prevents client timeout)
          await writer.write(encoder.encode(":\n\n"));
        }

        // Strip think tags from buffered response
        fullText = fullText.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
        if (fullText.includes("<think>")) fullText = fullText.replace(/<think>[\s\S]*/g, "").trim();

        // Send final result as SSE data event
        await writer.write(encoder.encode(`data: ${JSON.stringify({ text: fullText, finish_reason: finishReason, usage })}\n\n`));
      } catch (err) {
        await writer.write(encoder.encode(`data: ${JSON.stringify({ error: err.message })}\n\n`));
      } finally {
        await writer.close();
      }
    })();

    return new Response(readable, {
      status: 200,
      headers: { ...CORS, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
}
