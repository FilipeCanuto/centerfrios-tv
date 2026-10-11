// Quais TVs usam esta playlist de vinhetas (cada TV usa no máximo uma: tvs.vignette_playlist_id).
import { supabase } from "@/integrations/supabase/client";
import { isOnline } from "@/lib/centerfrios";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";

export type TvLite = {
  id: string;
  name: string;
  orientation: string;
  last_ping: string | null;
  vignette_playlist_id?: string | null;
};

export function VignetteTvAssign({
  playlistId,
  playlistNames,
  tvs,
  onChanged,
}: {
  playlistId: string;
  playlistNames: Record<string, string>;
  tvs: TvLite[];
  onChanged: () => void;
}) {
  async function toggle(tv: TvLite, on: boolean) {
    const { error } = await supabase
      .from("tvs")
      .update({ vignette_playlist_id: on ? playlistId : null })
      .eq("id", tv.id);
    if (error) {
      toast.error("Não foi possível alterar a TV");
      return;
    }
    toast.success(on ? tv.name + " passa a usar esta playlist" : tv.name + " ficou sem vinhetas");
    onChanged();
  }

  return (
    <section className="cf-card p-5">
      <h3 className="text-base font-extrabold">TVs que usam esta playlist</h3>
      <p className="text-xs text-muted-foreground">
        Cada TV usa no máximo uma playlist de vinhetas. Marcar aqui tira a TV da playlist anterior.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {tvs.map((tv) => {
          const mine = tv.vignette_playlist_id === playlistId;
          const other =
            tv.vignette_playlist_id && !mine ? playlistNames[tv.vignette_playlist_id] : "";
          const online = isOnline(tv.last_ping);
          return (
            <label
              key={tv.id}
              htmlFor={"vigtv-" + tv.id}
              className={
                "flex min-w-0 cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors " +
                (mine ? "border-primary bg-secondary/60" : "border-border bg-card")
              }
            >
              <Checkbox
                id={"vigtv-" + tv.id}
                checked={mine}
                onCheckedChange={(v) => toggle(tv, v === true)}
              />
              <span className="min-w-0 flex-1">
                <span className="cf-title text-sm font-bold">{tv.name}</span>
                <span className="mt-0.5 block text-[11px] font-semibold text-muted-foreground">
                  {tv.orientation === "portrait" ? "em pé" : "deitada"} ·{" "}
                  {online ? "online" : "offline"}
                  {other ? " · usa agora: " + other : ""}
                </span>
              </span>
            </label>
          );
        })}
        {tvs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma TV cadastrada.</p>
        ) : null}
      </div>
    </section>
  );
}
