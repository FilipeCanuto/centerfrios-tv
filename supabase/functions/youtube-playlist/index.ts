import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  let playlistId: string | undefined;
  try {
    const body = await req.json();
    playlistId = body?.playlistId;
  } catch {
    return json({ error: "corpo da requisição inválido" }, 400);
  }
  if (!playlistId || typeof playlistId !== "string") {
    return json({ error: "playlistId obrigatório" }, 400);
  }

  const apiKey = Deno.env.get("YOUTUBE_API_KEY");
  if (!apiKey) {
    return json({ error: "YOUTUBE_API_KEY não configurada no projeto" }, 500);
  }

  const items: { videoId: string; title: string }[] = [];
  let pageToken = "";
  let guard = 0;

  try {
    do {
      const url =
        "https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50" +
        "&playlistId=" + encodeURIComponent(playlistId) +
        "&key=" + apiKey +
        (pageToken ? "&pageToken=" + pageToken : "");
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) {
        const message = data?.error?.message || "Falha ao consultar a playlist do YouTube";
        return json({ error: message }, 502);
      }
      for (const it of data.items || []) {
        const videoId = it?.snippet?.resourceId?.videoId;
        const title = it?.snippet?.title;
        // pula vídeos privados/removidos da playlist (aparecem como "Private video"/"Deleted video")
        if (videoId && title && title !== "Private video" && title !== "Deleted video") {
          items.push({ videoId, title });
        }
      }
      pageToken = data.nextPageToken || "";
      guard++;
    } while (pageToken && guard < 20); // até 1000 vídeos, segurança contra loop infinito
  } catch (err) {
    return json({ error: String(err) }, 500);
  }

  return json({ items });
});
