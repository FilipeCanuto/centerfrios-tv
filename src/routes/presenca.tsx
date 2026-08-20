import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { LOGO_URL } from "@/lib/centerfrios";
import { CheckCircle2, Loader2 } from "lucide-react";

export const Route = createFileRoute("/presenca")({
  head: () => ({
    meta: [
      { title: "Confirmar Presença | CENTERFRIOS" },
      {
        name: "description",
        content:
          "Confirme sua presença no evento CENTERFRIOS: informe nome, WhatsApp e estabelecimento em segundos.",
      },
      { property: "og:title", content: "Confirmar Presença | CENTERFRIOS" },
      {
        property: "og:description",
        content: "Check-in rápido para participantes do evento CENTERFRIOS.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PresencaPage,
});

const schema = z.object({
  full_name: z
    .string()
    .trim()
    .min(3, "Informe seu nome e sobrenome")
    .max(120, "Nome muito longo"),
  phone: z
    .string()
    .trim()
    .min(10, "Informe um telefone válido com DDD")
    .max(30, "Telefone muito longo"),
  company: z
    .string()
    .trim()
    .min(2, "Informe o estabelecimento")
    .max(120, "Nome muito longo"),
});

function maskPhone(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d.length ? "(" + d : "";
  if (d.length <= 6) return "(" + d.slice(0, 2) + ") " + d.slice(2);
  if (d.length <= 10) return "(" + d.slice(0, 2) + ") " + d.slice(2, 6) + "-" + d.slice(6);
  return "(" + d.slice(0, 2) + ") " + d.slice(2, 7) + "-" + d.slice(7);
}

const FIELD =
  "w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3.5 text-base text-white placeholder:text-white/40 outline-none transition focus:border-[#FFC700] focus:ring-2 focus:ring-[#FFC700]/30";

function PresencaPage() {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = schema.safeParse({ full_name: fullName, phone, company });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message || "Verifique os dados");
      return;
    }
    setBusy(true);
    const { error: insertError } = await supabase
      .from("event_checkins")
      .insert(parsed.data);
    setBusy(false);
    if (insertError) {
      setError("Não foi possível confirmar agora. Tente novamente.");
      return;
    }
    setDone(true);
  }

  return (
    <main className="flex min-h-screen flex-col items-center bg-[#0b1329] px-5 py-10 text-white">
      <img src={LOGO_URL} alt="CENTERFRIOS" className="h-14 w-auto rounded-md" />

      {done ? (
        <section className="mt-10 w-full max-w-sm rounded-3xl border border-[#FFC700]/40 bg-white/5 p-7 text-center shadow-2xl">
          <CheckCircle2 className="mx-auto h-16 w-16 text-[#FFC700]" />
          <h1 className="mt-4 text-2xl font-extrabold">Presença Confirmada! 🎉</h1>
          <p className="mt-3 text-base leading-relaxed text-white/80">
            Seja bem-vindo à Centerfrios! Aproveite o evento e um excelente aprendizado!
          </p>
        </section>
      ) : (
        <section className="mt-8 w-full max-w-sm">
          <h1 className="text-center text-2xl font-extrabold tracking-tight">
            Confirmação de Presença
          </h1>
          <p className="mt-2 text-center text-sm text-white/60">
            Preencha os dados abaixo para fazer seu check-in no evento.
          </p>

          <form onSubmit={submit} className="mt-7 space-y-4">
            <div>
              <label htmlFor="nome" className="mb-1.5 block text-sm font-semibold text-white/80">
                Nome e Sobrenome
              </label>
              <input
                id="nome"
                className={FIELD}
                value={fullName}
                maxLength={120}
                autoComplete="name"
                placeholder="Ex.: Maria Silva"
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="tel" className="mb-1.5 block text-sm font-semibold text-white/80">
                Telefone / WhatsApp
              </label>
              <input
                id="tel"
                className={FIELD}
                value={phone}
                inputMode="tel"
                autoComplete="tel"
                placeholder="(82) 90000-0000"
                onChange={(e) => setPhone(maskPhone(e.target.value))}
              />
            </div>

            <div>
              <label htmlFor="empresa" className="mb-1.5 block text-sm font-semibold text-white/80">
                Estabelecimento / Empresa
              </label>
              <input
                id="empresa"
                className={FIELD}
                value={company}
                maxLength={120}
                autoComplete="organization"
                placeholder="Ex.: Mercado Bom Preço"
                onChange={(e) => setCompany(e.target.value)}
              />
            </div>

            {error ? (
              <p className="rounded-lg bg-red-500/15 px-3 py-2 text-sm font-semibold text-red-300">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#FFC700] px-4 py-4 text-lg font-extrabold text-[#0b1329] shadow-lg transition active:scale-[0.99] disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
              Confirmar Presença
            </button>
          </form>
        </section>
      )}

      <p className="mt-auto pt-10 text-xs text-white/40">CENTERFRIOS · Mídia Indoor</p>
    </main>
  );
}
