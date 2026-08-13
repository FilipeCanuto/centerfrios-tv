import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { PlayerErrorBoundary } from "@/components/PlayerErrorBoundary";
import { TvPlayer } from "@/components/TvPlayer";

const PLAYER_GLOBAL_CSS = `
html, body, #root {
  background-color: #0b1329 !important;
  color: #ffffff !important;
  margin: 0;
  padding: 0;
  min-height: 100vh;
  overflow: hidden;
}
`;

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

function PlayerRoute() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: PLAYER_GLOBAL_CSS }} />
      <PlayerErrorBoundary>
        <ClientOnly
          fallback={
            <div
              style={{
                minHeight: "100vh",
                backgroundColor: "#0b1329",
              }}
            />
          }
        >
          <TvPlayer />
        </ClientOnly>
      </PlayerErrorBoundary>
    </>
  );
}
