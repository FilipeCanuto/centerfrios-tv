import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LOGO_URL, BRAND, isOnline, type TvRow } from "@/lib/centerfrios";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { MediaManager } from "@/components/admin/MediaManager";
import { PlaylistManager } from "@/components/admin/PlaylistManager";
import { TvManager } from "@/components/admin/TvManager";
import { LiveBroadcast } from "@/components/admin/LiveBroadcast";
import { EventsManager } from "@/components/admin/EventsManager";
import { AlertsManager } from "@/components/admin/AlertsManager";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import {
  LogOut,
  MonitorPlay,
  Images,
  ListVideo,
  Radio,
  PartyPopper,
  Megaphone,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: async () => {
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) throw redirect({ to: "/auth" });
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: uid,
      _role: "admin",
    });
    if (!isAdmin) throw redirect({ to: "/" });
  },
  component: AdminPage,
  head: () => ({
    meta: [
      { title: "Painel de Mídia Indoor | CENTERFRIOS" },
      {
        name: "description",
        content:
          "Gerencie TVs, playlists, mídias, transmissões ao vivo e o mural de eventos das telas CENTERFRIOS.",
      },
      { property: "og:title", content: "Painel de Mídia Indoor | CENTERFRIOS" },
      {
        property: "og:description",
        content: "Controle total das telas de mídia indoor da CENTERFRIOS.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

const TAB_TRIGGER =
  "relative flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-muted-foreground transition-all data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm";

const SHELL = "mx-auto w-full max-w-7xl px-4 sm:px-6 py-6";

type Counts = { tvs: number; online: number; playlists: number; media: number; pending: number };

function Badge({ value }: { value: number }) {
  if (!value) return null;
  return (
    <span className="ml-0.5 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-extrabold leading-none text-accent-foreground">
      {value}
    </span>
  );
}

function AdminPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [counts, setCounts] = useState<Counts>({
    tvs: 0,
    online: 0,
    playlists: 0,
    media: 0,
    pending: 0,
  });

  const refreshCounts = useCallback(async () => {
    const [{ data: tvs }, { count: playlists }, { count: media }, { count: pending }] =
      await Promise.all([
        supabase.from("tvs").select("id,last_ping"),
        supabase.from("playlists").select("id", { count: "exact", head: true }),
        supabase.from("media").select("id", { count: "exact", head: true }),
        supabase
          .from("event_photos")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending"),
      ]);
    const rows = (tvs || []) as unknown as TvRow[];
    setCounts({
      tvs: rows.length,
      online: rows.filter((t) => isOnline(t.last_ping)).length,
      playlists: playlists || 0,
      media: media || 0,
      pending: pending || 0,
    });
  }, []);

  useEffect(() => {
    refreshCounts();
    const t = setInterval(refreshCounts, 20000);
    return () => clearInterval(t);
  }, [refreshCounts]);

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <AppErrorBoundary>
      <div className="min-h-screen bg-background">
        <header className="cf-header">
          <div className="mx-auto grid w-full max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-4 sm:flex sm:justify-between sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <img
                src={LOGO_URL}
                alt="CENTERFRIOS"
                className="h-11 w-auto shrink-0 rounded-md"
              />
              <span className="hidden items-center gap-2 rounded-full bg-primary-foreground/12 px-3 py-1 text-xs font-semibold text-primary-foreground/90 ring-1 ring-primary-foreground/20 sm:inline-flex">
                <span className="cf-dot-online h-2 w-2" />
                {counts.online} de {counts.tvs} telas online
              </span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={signOut}
              className="rounded-full border border-primary-foreground/25 bg-primary-foreground/10 font-semibold text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground"
            >
              <LogOut className="mr-1.5 h-4 w-4" /> Sair
            </Button>
          </div>
        </header>

        <main className={SHELL}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
                Painel de Mídia Indoor
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">{BRAND.slogan}</p>
            </div>
            <span className="rounded-full bg-accent px-3 py-1 text-xs font-bold text-accent-foreground">
              Digital Signage
            </span>
          </div>

          <Tabs defaultValue="tvs" className="mt-6">
            <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-2xl border border-border/70 bg-card p-1 shadow-sm sm:grid-cols-6">
              <TabsTrigger value="tvs" className={TAB_TRIGGER}>
                <MonitorPlay className="h-4 w-4" /> TVs <Badge value={counts.tvs} />
              </TabsTrigger>
              <TabsTrigger value="playlists" className={TAB_TRIGGER}>
                <ListVideo className="h-4 w-4" /> Playlists <Badge value={counts.playlists} />
              </TabsTrigger>
              <TabsTrigger value="media" className={TAB_TRIGGER}>
                <Images className="h-4 w-4" /> Mídias <Badge value={counts.media} />
              </TabsTrigger>
              <TabsTrigger value="live" className={TAB_TRIGGER}>
                <Radio className="h-4 w-4" /> Ao Vivo
              </TabsTrigger>
              <TabsTrigger value="alerts" className={TAB_TRIGGER}>
                <Megaphone className="h-4 w-4" /> Avisos
              </TabsTrigger>
              <TabsTrigger value="events" className={TAB_TRIGGER}>
                <PartyPopper className="h-4 w-4" /> Eventos <Badge value={counts.pending} />
              </TabsTrigger>
            </TabsList>

            <TabsContent value="tvs" className="mt-5">
              <TvManager onChanged={refreshCounts} />
            </TabsContent>
            <TabsContent value="playlists" className="mt-5">
              <PlaylistManager />
            </TabsContent>
            <TabsContent value="media" className="mt-5">
              <MediaManager onChanged={refreshCounts} />
            </TabsContent>
            <TabsContent value="live" className="mt-5">
              <LiveBroadcast />
            </TabsContent>
            <TabsContent value="alerts" className="mt-5">
              <AlertsManager />
            </TabsContent>
            <TabsContent value="events" className="mt-5">
              <EventsManager onChanged={refreshCounts} />
            </TabsContent>
          </Tabs>
        </main>
      </div>
    </AppErrorBoundary>
  );
}
