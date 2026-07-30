import { Component, type ErrorInfo, type ReactNode } from "react";
import { LOGO_URL } from "@/lib/centerfrios";

type Props = { children: ReactNode; variant?: "tv" | "app" };
type State = { hasError: boolean; message: string };

/**
 * Impede a "tela branca" em TVs antigas: qualquer erro de script
 * cai neste aviso visual com a identidade CENTERFRIOS.
 */
export class AppErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error && error.message ? error.message : "Erro desconhecido" };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[CENTERFRIOS] erro capturado:", error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    const isTv = this.props.variant === "tv";

    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: isTv ? "#000000" : "#0B4D9C",
          color: "#FFFFFF",
          padding: "24px",
          textAlign: "center",
          fontFamily: "Montserrat, Arial, sans-serif",
        }}
      >
        <div style={{ maxWidth: "640px" }}>
          <img src={LOGO_URL} alt="CENTERFRIOS" style={{ width: "260px", maxWidth: "70%" }} />
          <h1
            style={{
              color: "#FFC700",
              fontSize: isTv ? "40px" : "26px",
              margin: "24px 0 8px",
              fontWeight: 800,
            }}
          >
            Não foi possível carregar o conteúdo
          </h1>
          <p style={{ fontSize: isTv ? "22px" : "16px", opacity: 0.9 }}>
            Verifique a conexão com a internet. A tela tentará novamente automaticamente.
          </p>
          <p style={{ marginTop: "24px", fontSize: "13px", opacity: 0.6 }}>{this.state.message}</p>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: "24px",
              backgroundColor: "#FFC700",
              color: "#101010",
              border: "none",
              borderRadius: "8px",
              padding: "12px 24px",
              fontSize: "16px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Recarregar
          </button>
        </div>
      </div>
    );
  }
}
