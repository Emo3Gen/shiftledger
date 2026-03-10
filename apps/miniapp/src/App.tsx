import React from "react";
import { authenticate, clearToken, type AuthResult } from "./api";
import { themeParams, user, isDevMode } from "./telegram";
import { Dashboard } from "./components/Dashboard";
import { Schedule } from "./components/Schedule";
import { Payroll } from "./components/Payroll";
import { Payments } from "./components/Payments";
import { BottomNav } from "./components/BottomNav";

type Screen = "dashboard" | "schedule" | "payments" | "payroll";

const globalStyles = `
  :root {
    --tg-bg: ${themeParams.bg_color || "#1c1c1e"};
    --tg-text: ${themeParams.text_color || "#ffffff"};
    --tg-hint: ${themeParams.hint_color || "#8e8e93"};
    --tg-link: ${themeParams.link_color || "#007aff"};
    --tg-btn: ${themeParams.button_color || "#007aff"};
    --tg-btn-text: ${themeParams.button_text_color || "#ffffff"};
    --tg-secondary-bg: ${themeParams.secondary_bg_color || "#2c2c2e"};
    --tg-section-bg: ${themeParams.section_bg_color || "#2c2c2e"};
    --tg-section-header: ${themeParams.section_header_text_color || "#8e8e93"};
    --tg-subtitle: ${themeParams.subtitle_text_color || "#8e8e93"};
    --tg-destructive: ${themeParams.destructive_text_color || "#ff3b30"};
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--tg-bg);
    color: var(--tg-text);
    -webkit-font-smoothing: antialiased;
    overscroll-behavior: none;
  }
  .app {
    max-width: 390px;
    margin: 0 auto;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }
  .screen {
    flex: 1;
    padding: 12px 16px;
    padding-bottom: 72px;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }
  .card {
    background: var(--tg-section-bg);
    border-radius: 12px;
    padding: 14px;
    margin-bottom: 10px;
  }
  .card-title {
    font-size: 13px;
    color: var(--tg-section-header);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 10px 18px;
    border: none;
    border-radius: 10px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    background: var(--tg-btn);
    color: var(--tg-btn-text);
    transition: opacity 0.15s;
    width: 100%;
  }
  .btn:active { opacity: 0.7; }
  .btn:disabled { opacity: 0.4; cursor: default; }
  .btn-secondary {
    background: var(--tg-secondary-bg);
    color: var(--tg-text);
  }
  .btn-danger {
    background: var(--tg-destructive);
    color: #fff;
  }
  .kpi-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-bottom: 10px;
  }
  .kpi-item {
    background: var(--tg-section-bg);
    border-radius: 12px;
    padding: 12px;
    text-align: center;
  }
  .kpi-value {
    font-size: 24px;
    font-weight: 700;
    line-height: 1.2;
  }
  .kpi-label {
    font-size: 11px;
    color: var(--tg-hint);
    margin-top: 2px;
  }
  .loading {
    display: flex;
    justify-content: center;
    padding: 40px;
    color: var(--tg-hint);
  }
  .error-box {
    background: rgba(255, 59, 48, 0.15);
    color: var(--tg-destructive);
    border-radius: 10px;
    padding: 12px;
    font-size: 14px;
    text-align: center;
    margin: 16px;
  }
`;

export const App: React.FC = () => {
  const [screen, setScreen] = React.useState<Screen>("dashboard");
  const [auth, setAuth] = React.useState<AuthResult | null>(null);
  const [authLoading, setAuthLoading] = React.useState(true);
  const [authError, setAuthError] = React.useState<string | null>(null);

  React.useEffect(() => {
    (async () => {
      try {
        const result = await authenticate();
        if (result.ok) {
          setAuth(result);
        } else {
          setAuthError(result.error || "Доступ запрещён");
        }
      } catch (e: any) {
        setAuthError(e.message || "Ошибка сети");
      }
      setAuthLoading(false);
    })();
  }, []);

  const isOwner = auth?.role === "owner";

  return (
    <>
      <style>{globalStyles}</style>
      <div className="app">
        {authLoading ? (
          <div className="loading" style={{ paddingTop: 120 }}>
            <div>
              <div style={{ fontSize: 32, marginBottom: 8, textAlign: "center" }}>&#128736;</div>
              <div>Авторизация...</div>
            </div>
          </div>
        ) : authError ? (
          <div style={{ padding: 24 }}>
            <div className="error-box">
              <div style={{ fontSize: 32, marginBottom: 8 }}>&#128274;</div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Нет доступа</div>
              <div style={{ fontSize: 13, opacity: 0.8 }}>{authError}</div>
            </div>
            {isDevMode && (
              <div style={{ textAlign: "center", marginTop: 16, fontSize: 12, color: "var(--tg-hint)" }}>
                Dev mode: user.id = {user?.id}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="screen">
              {screen === "dashboard" && <Dashboard isOwner={isOwner} onNavigate={setScreen} />}
              {screen === "schedule" && <Schedule isOwner={isOwner} />}
              {screen === "payments" && <Payments isOwner={isOwner} />}
              {screen === "payroll" && <Payroll />}
            </div>
            <BottomNav current={screen} onChange={setScreen} />
          </>
        )}
      </div>
    </>
  );
};
