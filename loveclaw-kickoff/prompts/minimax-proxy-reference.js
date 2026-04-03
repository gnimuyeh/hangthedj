// MiniMax API Proxy Pattern — Reference from hangthedj/_worker.js
// Reuse this streaming-buffer pattern in the loveclaw worker
//
// Key details:
// - Endpoint: https://api.minimaxi.com/v1/chat/completions (note the 'i' in minimaxi)
// - Model: MiniMax-M2.5-highspeed
// - M2.5 uses <think> tags — MUST strip them (including unclosed)
// - Stream from MiniMax, buffer everything, return single JSON response
// - Streaming keeps Cloudflare Worker connection alive (no timeout)

// Example implementation:
//
// const KEY = "your-minimax-api-key";
// const API_URL = "https://api.minimaxi.com/v1/chat/completions";
//
// async function callMiniMax(system, messages, maxTokens = 4096, temperature = 0.5) {
//   const msgs = [];
//   if (system) msgs.push({ role: "system", content: system });
//   for (const m of messages) msgs.push({ role: m.role, content: m.content });
//
//   const payload = {
//     model: "MiniMax-M2.5-highspeed",
//     messages: msgs,
//     temperature,
//     stream: true
//   };
//   if (maxTokens > 0) payload.max_tokens = maxTokens;
//
//   const resp = await fetch(API_URL, {
//     method: "POST",
//     headers: {
//       "Authorization": "Bearer " + KEY,
//       "Content-Type": "application/json"
//     },
//     body: JSON.stringify(payload),
//   });
//
//   if (!resp.ok) {
//     const errText = await resp.text();
//     throw new Error("MiniMax HTTP " + resp.status + ": " + errText.substring(0, 200));
//   }
//
//   // Stream and buffer
//   const reader = resp.body.getReader();
//   const decoder = new TextDecoder();
//   let buffer = "";
//   let fullText = "";
//   let finishReason = "?";
//   let usage = {};
//
//   while (true) {
//     const { done, value } = await reader.read();
//     if (done) break;
//     buffer += decoder.decode(value, { stream: true });
//
//     const lines = buffer.split("\n");
//     buffer = lines.pop(); // keep incomplete line
//
//     for (const line of lines) {
//       const trimmed = line.trim();
//       if (!trimmed || !trimmed.startsWith("data: ")) continue;
//       const payload = trimmed.slice(6);
//       if (payload === "[DONE]") continue;
//
//       try {
//         const chunk = JSON.parse(payload);
//         const delta = chunk.choices?.[0]?.delta?.content;
//         if (delta) fullText += delta;
//         if (chunk.choices?.[0]?.finish_reason) {
//           finishReason = chunk.choices[0].finish_reason;
//         }
//         if (chunk.usage) usage = chunk.usage;
//       } catch (e) { /* skip unparseable chunks */ }
//     }
//   }
//
//   // Strip <think> tags (including unclosed)
//   fullText = fullText.replace(/<think>[\s\S]*?<\/think>/g, "");
//   fullText = fullText.replace(/<think>[\s\S]*/g, "");
//   fullText = fullText.trim();
//
//   return { text: fullText, finish_reason: finishReason, usage };
// }
