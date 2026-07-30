import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { LOGO_URL, BRAND } from "@/lib/centerfrios";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { MediaManager } from "@/components/admin/MediaManager";
import { PlaylistManager } from "@/components/admin/PlaylistManager";
import { TvManager } from "@/components/admin/TvManager";
import { LiveBroadcast } from "@/components/admin/LiveBroadcast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminPage,
});

function AdminPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <AppErrorBoundary>
      <div className="min-h-screen bg-background">
        <header className="bg-primary">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
            <img src={LOGO_URL} alt="CENTERFRIOS" className="h-11 w-auto" />
            <Button size="sm" variant="secondary" onClick={signOut} className="font-bold">
              <LogOut className="mr-1.5 h-4 w-4" /> Sair
            </Button>
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-4 py-5">
          <h1 className="text-xl font-extrabold text-foreground sm:text-2xl">
            Painel de Mídia Indoor
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{BRAND.slogan}</p>

          <Tabs defaultValue="tvs" className="mt-5">
            <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4">
              <TabsTrigger value="tvs">TVs</TabsTrigger>
              <TabsTrigger value="media">Mídias</TabsTrigger>
              <TabsTrigger value="playlists">Playlists</TabsTrigger>
              <TabsTrigger value="live">Ao Vivo</TabsTrigger>
            </TabsList>

            <TabsContent value="tvs" className="mt-4">
              <TvManager />
            </TabsContent>
            <TabsContent value="media" className="mt-4">
              <MediaManager />
            </TabsContent>
            <TabsContent value="playlists" className="mt-4">
              <PlaylistManager />
            </TabsContent>
            <TabsContent value="live" className="mt-4">
              <LiveBroadcast />
            </TabsContent>
          </Tabs>
        </main>
      </div>
    </AppErrorBoundary>
  );
}
