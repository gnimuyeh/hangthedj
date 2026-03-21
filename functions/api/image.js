const KEY = "sk-api-gwYvxa2sX0-B38idARiZPVmdq70lBjiw3xEsyO71psEkk-bHJHI_3O8vBRkx9r1D_r-x6QGlVrTpDBiV-UxBKCAN3ctFEVZ3MD9E2oNwIWGBj5ZwQMLCup8";
const API_URL = "https://api.minimaxi.com/v1/image_generation";

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
    const { prompt } = await request.json();
    if (!prompt) {
      return new Response(
        JSON.stringify({ error: "prompt is required" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const resp = await fetch(API_URL, {
      method: "POST",
      headers: { "Authorization": "Bearer " + KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "image-01",
        prompt,
        aspect_ratio: "16:9",
        response_format: "url",
        n: 1,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return new Response(
        JSON.stringify({ error: "MiniMax HTTP " + resp.status + ": " + errText.substring(0, 200) }),
        { status: 502, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const result = await resp.json();
    const url = result?.data?.image_urls?.[0];
    if (!url) {
      return new Response(
        JSON.stringify({ error: "No image URL in response" }),
        { status: 502, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ url }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
}
