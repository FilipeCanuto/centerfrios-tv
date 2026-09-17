// Endpoint público: /api/public/youtube-playlist
// Retorna os vídeos de uma playlist pública do YouTube (Data API v3).
// Uso: GET /api/public/youtube-playlist?playlistId=PLxxxx  →  { items: [...] }
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/youtube-playlist")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Lê o secret dentro do handler (env injetado por requisição no worker).
        // YOUTUBE_API_KEY tem prioridade; GOOGLE_API_KEY é o fallback já salvo.
        const apiKey = process.env["YOUTUBE_API_KEY"] || process.env["GOOGLE_API_KEY"];
        if (!apiKey) {
          return Response.json(
            { error: "Chave da API do YouTube não configurada" },
            { status: 500 },
          );
        }

        const playlistId = new URL(request.url).searchParams.get("playlistId") || "";
        if (!playlistId) {
          return Response.json({ error: "Informe playlistId" }, { status: 400 });
        }

        try {
          // Pagina até 50 itens por chamada (máx. da API), juntando todas as páginas.
          const items: unknown[] = [];
          let pageToken = "";
          do {
            const url =
              "https://www.googleapis.com/youtube/v3/playlistItems" +
              "?part=snippet,contentDetails&maxResults=50" +
              "&playlistId=" +
              encodeURIComponent(playlistId) +
              "&key=" +
              encodeURIComponent(apiKey) +
              (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : "");
            const res = await fetch(url);
            const data = await res.json();
            if (!res.ok) {
              return Response.json(
                { error: data?.error?.message || "Erro na API do YouTube" },
                { status: res.status },
              );
            }
            items.push(...(data.items || []));
            pageToken = data.nextPageToken || "";
          } while (pageToken);

          return Response.json({ items });
        } catch (err) {
          return Response.json({ error: String(err) }, { status: 500 });
        }
      },
    },
  },
});
