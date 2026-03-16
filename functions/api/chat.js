const KEY = "sk-api-gwYvxa2sX0-B38idARiZPVmdq70lBjiw3xEsyO71psEkk-bHJHI_3O8vBRkx9r1D_r-x6QGlVrTpDBiV-UxBKCAN3ctFEVZ3MD9E2oNwIWGBj5ZwQMLCup8";
const API_URL = "https://api.minimaxi.com/v1/chat/completions";

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

export async function onRequestPost({ request }) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  try {
    const { system, messages, max_tokens } = await request.json();
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
      return new Response(JSON.stringify({ error: "Bad JSON: " + raw.substring(0, 200) }), { status: 502, headers: corsHeaders });
    }

    if (data.error) {
      return new Response(JSON.stringify({ error: data.error.message || JSON.stringify(data.error).substring(0, 200) }), { status: 502, headers: corsHeaders });
    }
    if (data.base_resp && data.base_resp.status_code !== 0) {
      return new Response(JSON.stringify({ error: data.base_resp.status_msg }), { status: 502, headers: corsHeaders });
    }

    let text = data.choices?.[0]?.message?.content || "";
    const fr = data.choices?.[0]?.finish_reason || "?";
    const u = data.usage || {};

    // Strip think tags
    text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    if (text.includes("<think>")) text = text.replace(/<think>[\s\S]*/g, "").trim();

    return new Response(JSON.stringify({ text, finish_reason: fr, usage: u }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
}
