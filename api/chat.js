const KEY = "sk-api-gwYvxa2sX0-B38idARiZPVmdq70lBjiw3xEsyO71psEkk-bHJHI_3O8vBRkx9r1D_r-x6QGlVrTpDBiV-UxBKCAN3ctFEVZ3MD9E2oNwIWGBj5ZwQMLCup8";
const URL = "https://api.minimaxi.com/v1/chat/completions";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const { system, messages, max_tokens } = req.body;
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
      return res.status(502).json({ error: "Bad JSON: " + raw.substring(0, 200) });
    }

    if (data.error) return res.status(502).json({ error: data.error.message || JSON.stringify(data.error).substring(0, 200) });
    if (data.base_resp && data.base_resp.status_code !== 0) return res.status(502).json({ error: data.base_resp.status_msg });

    let text = data.choices?.[0]?.message?.content || "";
    const fr = data.choices?.[0]?.finish_reason || "?";
    const u = data.usage || {};

    text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    if (text.includes("<think>")) text = text.replace(/<think>[\s\S]*/g, "").trim();

    return res.status(200).json({ text, finish_reason: fr, usage: u });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
