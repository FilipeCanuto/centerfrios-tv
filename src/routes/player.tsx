import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { TvPlayer } from "@/components/TvPlayer";

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
    <AppErrorBoundary variant="tv">
      <ClientOnly fallback={<div style={{ minHeight: "100vh", backgroundColor: "#000000" }} />}>
        <TvPlayer />
      </ClientOnly>
    </AppErrorBoundary>
  );
}
