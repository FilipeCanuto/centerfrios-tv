import { Component, type ErrorInfo, type ReactNode } from "react";
import { LOGO_URL } from "@/lib/centerfrios";

type Props = { children: ReactNode };
type State = { hasError: boolean; message: string };

const BG = "#0b1329";
const YELLOW = "#FFC700";

/**
 * Blindagem final do /player: qualquer exceção vira um card de diagnóstico
 * escuro com a identidade CENTERFRIOS e auto-reload a cada 10 segundos.
 */
export class PlayerErrorBoundary extends Component<Props, State> {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error && error.message ? error.message : "Erro desconhecido no player",
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[CENTERFRIOS] player error boundary:", error, info);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (typeof window !== "undefined") window.location.reload();
    }, 10000);
  }

  componentWillUnmount() {
    if (this.timer) clearTimeout(this.timer);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: BG,
          color: "#FFFFFF",
          padding: "32px",
          textAlign: "center",
          fontFamily: "Montserrat, Arial, sans-serif",
        }}
      >
        <div
          style={{
            maxWidth: "760px",
            width: "100%",
            backgroundColor: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.10)",
            borderRadius: "20px",
            padding: "40px 32px",
          }}
        >
          <img src={LOGO_URL} alt="CENTERFRIOS" style={{ width: "260px", maxWidth: "60%" }} />
          <h1 style={{ color: YELLOW, fontSize: "38px", margin: "28px 0 10px", fontWeight: 800 }}>
            Sincronizando Player...
          </h1>
          <p style={{ fontSize: "20px", opacity: 0.9, margin: 0 }}>
            Ocorreu uma falha temporária na exibição. A tela será recarregada automaticamente em
            até 10 segundos.
          </p>
          <p
            style={{
              marginTop: "24px",
              fontSize: "14px",
              opacity: 0.6,
              wordBreak: "break-word",
            }}
          >
            Diagnóstico: {this.state.message}
          </p>
        </div>
      </div>
    );
  }
}
