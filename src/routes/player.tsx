import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { useEffect } from "react";

/**
 * A URL /player é preservada para os aparelhos já pareados em campo, mas o
 * player agora roda 100% fora do React/TanStack Router: o engine imperativo
 * vive em /player.html + /player-engine.js. Aqui só redirecionamos.
 */
export const Route = createFileRoute("/player")({
  head: () => ({
    meta: [
      { title: "Player CENTERFRIOS — Tela de exibição" },
      {
        name: "description",
        content: "Tela de exibição das TVs CENTERFRIOS com loop de anúncios e transmissão ao vivo.",
      },
      { property: "og:title", content: "Player CENTERFRIOS" },
      { property: "og:description", content: "Tela de exibição das TVs CENTERFRIOS." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PlayerRoute,
});

function PlayerRedirect() {
  useEffect(() => {
    window.location.replace("/player.html" + window.location.search);
  }, []);
  return null;
}

function PlayerRoute() {
  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#000000" }}>
      <ClientOnly fallback={null}>
        <PlayerRedirect />
      </ClientOnly>
    </div>
  );
}
