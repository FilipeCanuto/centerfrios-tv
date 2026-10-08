// Endomarketing — seletor de TVs alvo.
import { isOnline, type TvRow } from "@/lib/centerfrios";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tv } from "lucide-react";

export function EndoTargets({
  tvs,
  targets,
  setTargets,
}: {
  tvs: TvRow[];
  targets: Record<string, boolean>;
  setTargets: (t: Record<string, boolean>) => void;
}) {
  const count = tvs.filter((t) => targets[t.id]).length;

  function selectOnline() {
    const next: Record<string, boolean> = {};
    tvs.forEach((t) => {
      next[t.id] = isOnline(t.last_ping);
    });
    setTargets(next);
  }

  return (
    <section className="cf-card p-5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-extrabold">TVs alvo</h3>
          <p className="text-xs text-muted-foreground">
            Os comandos valem para as telas marcadas. Fire TV entra em até 20 s; depois responde em
            até 2 s.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-secondary px-3 py-1 text-xs font-bold text-secondary-foreground">
          {count} selecionada{count === 1 ? "" : "s"}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          className="rounded-xl font-bold"
          onClick={selectOnline}
        >
          Selecionar todas as telas ativas
        </Button>
        <Button size="sm" variant="ghost" className="rounded-xl" onClick={() => setTargets({})}>
          Desmarcar todas
        </Button>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {tvs.map((tv) => {
          const online = isOnline(tv.last_ping);
          const checked = !!targets[tv.id];
          return (
            <label
              key={tv.id}
              htmlFor={"endo-tv-" + tv.id}
              className={
                "flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors " +
                (checked ? "border-primary bg-secondary/60" : "border-border bg-card")
              }
            >
              <Checkbox
                id={"endo-tv-" + tv.id}
                checked={checked}
                onCheckedChange={(v) => setTargets({ ...targets, [tv.id]: v === true })}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">{tv.name}</span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                  <span
                    className={
                      online
                        ? "cf-dot-online h-1.5 w-1.5"
                        : "h-1.5 w-1.5 rounded-full bg-muted-foreground/60"
                    }
                  />
                  {online ? "Online" : "Offline"}
                  {tv.is_endomarketing_active ? (
                    <span className="ml-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-extrabold text-primary-foreground">
                      EM ATIVIDADE
                    </span>
                  ) : null}
                </span>
              </span>
            </label>
          );
        })}
        {tvs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-5 text-center sm:col-span-2">
            <Tv className="mx-auto h-7 w-7 text-muted-foreground/60" />
            <p className="mt-2 text-sm text-muted-foreground">Nenhuma TV pareada.</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
