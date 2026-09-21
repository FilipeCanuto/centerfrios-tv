import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { BarChart3, RefreshCw } from "lucide-react";

type LogRow = { tv_id: string; media_id: string; day: string; plays: number };

// Relatório de exibição: quantas vezes cada mídia tocou em cada TV (últimos 7 dias).
export function PlayReport() {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [tvs, setTvs] = useState<Record<string, string>>({});
  const [media, setMedia] = useState<Record<string, string>>({});
  const [state, setState] = useState<"loading" | "ok" | "unavailable">("loading");

  async function load() {
    setState("loading");
    const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const logs = await supabase
      .from("play_logs" as never)
      .select("tv_id,media_id,day,plays")
      .gte("day", since);
    if (logs.error) {
      setState("unavailable");
      return;
    }
    const [t, m] = await Promise.all([
      supabase.from("tvs").select("id,name"),
      supabase.from("media").select("id,title"),
    ]);
    const tm: Record<string, string> = {};
    ((t.data || []) as { id: string; name: string }[]).forEach((x) => (tm[x.id] = x.name));
    const mm: Record<string, string> = {};
    ((m.data || []) as { id: string; title: string }[]).forEach((x) => (mm[x.id] = x.title));
    setTvs(tm);
    setMedia(mm);
    setRows((logs.data || []) as unknown as LogRow[]);
    setState("ok");
  }

  useEffect(() => {
    load();
  }, []);

  const today = new Date().toISOString().slice(0, 10);
  const grouped = useMemo(() => {
    const map: Record<string, { tv: string; media: string; week: number; today: number }> = {};
    rows.forEach((r) => {
      const key = r.tv_id + "|" + r.media_id;
      if (!map[key]) map[key] = { tv: tvs[r.tv_id] || "TV", media: media[r.media_id] || "Mídia removida", week: 0, today: 0 };
      map[key].week += r.plays;
      if (r.day === today) map[key].today += r.plays;
    });
    return Object.values(map).sort((a, b) => b.week - a.week);
  }, [rows, tvs, media, today]);

  return (
    <section className="cf-card mt-6 p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-muted-foreground">
          <BarChart3 className="h-4 w-4" /> Relatório de exibição (7 dias)
        </h3>
        <Button size="sm" variant="outline" className="h-8 rounded-lg" onClick={load}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" /> Atualizar
        </Button>
      </div>
      {state === "unavailable" ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Relatório ainda não disponível: falta aplicar a migration de exibições no banco.
        </p>
      ) : state === "loading" ? (
        <p className="mt-3 text-sm text-muted-foreground">Carregando…</p>
      ) : grouped.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Ainda sem exibições registradas. As TVs enviam os totais a cada 5 minutos.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-1 pr-3">Mídia</th>
                <th className="py-1 pr-3">TV</th>
                <th className="py-1 pr-3 text-right">Hoje</th>
                <th className="py-1 text-right">7 dias</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map((g, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="py-1.5 pr-3 font-semibold">{g.media}</td>
                  <td className="py-1.5 pr-3">{g.tv}</td>
                  <td className="py-1.5 pr-3 text-right">{g.today}</td>
                  <td className="py-1.5 text-right font-bold">{g.week}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
