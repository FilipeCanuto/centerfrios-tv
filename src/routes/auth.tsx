import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { LOGO_URL, BRAND } from "@/lib/centerfrios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar — Painel CENTERFRIOS" },
      {
        name: "description",
        content: "Acesso ao painel de gerenciamento das TVs e mídias da CENTERFRIOS.",
      },
      { property: "og:title", content: "Entrar — Painel CENTERFRIOS" },
      { property: "og:description", content: "Acesso ao painel de mídia indoor da CENTERFRIOS." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/admin" });
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin + "/admin" },
        });
        if (error) throw error;
        if (data.session) {
          navigate({ to: "/admin" });
        } else {
          toast.success("Conta criada! Confirme o e-mail para entrar.");
          setMode("login");
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Falha na autenticação";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-primary px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-2xl">
        <img src={LOGO_URL} alt="CENTERFRIOS" className="mx-auto w-full max-w-[240px]" />
        <h1 className="mt-6 text-center text-xl font-extrabold text-foreground">
          {mode === "login" ? "Painel de Mídia Indoor" : "Criar acesso ao painel"}
        </h1>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              value={email}
              autoComplete="email"
              required
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              type="password"
              value={password}
              minLength={6}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full font-bold" disabled={loading}>
            {loading ? "Aguarde…" : mode === "login" ? "Entrar" : "Criar conta"}
          </Button>
        </form>

        <button
          type="button"
          onClick={() => setMode(mode === "login" ? "login" : "login")}
          className="hidden"
        />

        <p className="mt-4 text-center text-sm text-muted-foreground">
          {mode === "login" ? "Ainda não tem acesso?" : "Já possui acesso?"}{" "}
          <button
            type="button"
            className="font-semibold text-primary underline"
            onClick={() => setMode(mode === "login" ? "signup" : "login")}
          >
            {mode === "login" ? "Criar conta" : "Entrar"}
          </button>
        </p>

        <p className="mt-6 text-center text-xs font-semibold" style={{ color: BRAND.blue }}>
          {BRAND.slogan}
        </p>
      </div>
    </div>
  );
}
