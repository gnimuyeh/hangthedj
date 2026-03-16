const KEY = "sk-api-gwYvxa2sX0-B38idARiZPVmdq70lBjiw3xEsyO71psEkk-bHJHI_3O8vBRkx9r1D_r-x6QGlVrTpDBiV-UxBKCAN3ctFEVZ3MD9E2oNwIWGBj5ZwQMLCup8";
const URL = "https://api.minimaxi.com/v1/chat/completions";

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

    const payload = { model: "MiniMax-M2.5-highspeed", messages: msgs, temperature: 0.85 };
    if (max_tokens && max_tokens > 0) payload.max_tokens = max_tokens;

    const resp = await fetch(URL, {
      method: "POST",
      headers: { "Authorization": "Bearer " + KEY, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const raw = await resp.text();

    let data;
    try { data = JSON.parse(raw); } catch {
      return { statusCode: 502, headers: h, body: JSON.stringify({ error: "Bad JSON: " + raw.substring(0, 200) }) };
    }

    if (data.error) return { statusCode: 502, headers: h, body: JSON.stringify({ error: data.error.message || JSON.stringify(data.error).substring(0, 200) }) };
    if (data.base_resp && data.base_resp.status_code !== 0) return { statusCode: 502, headers: h, body: JSON.stringify({ error: data.base_resp.status_msg }) };

    let text = data.choices?.[0]?.message?.content || "";
    const fr = data.choices?.[0]?.finish_reason || "?";
    const u = data.usage || {};

    text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    if (text.includes("<think>")) text = text.replace(/<think>[\s\S]*/g, "").trim();

    return { statusCode: 200, headers: h, body: JSON.stringify({ text, finish_reason: fr, usage: u }) };
  } catch (err) {
    return { statusCode: 500, headers: h, body: JSON.stringify({ error: err.message }) };
  }
};
