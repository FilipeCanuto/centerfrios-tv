// Aba "Vinhetas": duas listas (vertical / horizontal) de vídeos do YouTube intercalados com a
// playlist de cada TV: vinheta 1, item 1, vinheta 2, item 2... A TV usa a lista da sua orientação
// e só intercala com a chave "Intercalar vinhetas" ligada (aba TVs).
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { makeNonce, type Vignette } from "@/lib/centerfrios";
import { VignetteList } from "@/components/admin/VignetteList";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { RefreshCw, Clapperboard } from "lucide-react";

export function VignetteManager() {
  const [list, setList] = useState<Vignette[]>([]);
  const [enabledTvs, setEnabledTvs] = useState<{ id: string; name: string }[]>([]);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    const [{ data, error }, { data: tvs }] = await Promise.all([
      supabase
        .from("vignettes")
        .select("*")
        .order("order_index", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase.from("tvs").select("id,name,vignettes_enabled"),
    ]);
    if (error) {
      toast.error("Não foi possível carregar as vinhetas (a migration já foi aplicada?)");
      return;
    }
    setList((data || []) as unknown as Vignette[]);
    setEnabledTvs(
      (
        (tvs || []) as unknown as { id: string; name: string; vignettes_enabled?: boolean }[]
      ).filter((t) => t.vignettes_enabled),
    );
  }, []);

  useEffect(() => {
    load();
    const ch = supabase
      .channel("vignettes-admin")
      .on("postgres_changes", { event: "*", schema: "public", table: "vignettes" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load]);

  // As TVs reconferem sozinhas a cada 5 min; este botão manda sincronizar na hora.
  async function syncNow() {
    if (!enabledTvs.length)
      return toast.error('Nenhuma TV com "Intercalar vinhetas" ligado (aba TVs)');
    setSyncing(true);
    const results = await Promise.all(
      enabledTvs.map((t) =>
        supabase
          .from("tvs")
          .update({ command: { action: "sync", nonce: makeNonce() } as never })
          .eq("id", t.id),
      ),
    );
    setSyncing(false);
    if (results.some((r) => r.error)) toast.error("Algumas TVs não receberam o comando");
    else
      toast.success(
        "Vinhetas aplicadas em " + enabledTvs.length + (enabledTvs.length === 1 ? " TV" : " TVs"),
      );
  }

  return (
    <div className="grid gap-5">
      <section className="cf-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
              <Clapperboard className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-extrabold">Vinhetas intercaladas</h3>
              <p className="text-xs text-muted-foreground">
                A TV alterna: vinheta 1, item 1 da playlist, vinheta 2, item 2… e volta ao início em
                loop. TVs em pé usam a lista vertical; TVs deitadas, a horizontal. Se houver menos
                vinhetas que itens, elas recomeçam. Ligue <b>“Intercalar vinhetas”</b> em cada TV
                (aba TVs). Mudanças chegam às TVs em até 5 min, ou na hora pelo botão.
              </p>
            </div>
          </div>
          <Button
            onClick={syncNow}
            disabled={syncing}
            variant="secondary"
            className="shrink-0 rounded-xl font-bold"
          >
            <RefreshCw className={"mr-1.5 h-4 w-4 " + (syncing ? "animate-spin" : "")} />
            Aplicar agora nas TVs ({enabledTvs.length})
          </Button>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <VignetteList
          orientation="portrait"
          items={list.filter((v) => v.orientation === "portrait")}
          onChanged={load}
        />
        <VignetteList
          orientation="landscape"
          items={list.filter((v) => v.orientation === "landscape")}
          onChanged={load}
        />
      </div>
    </div>
  );
}
