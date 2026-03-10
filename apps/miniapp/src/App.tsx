import React from "react";
import { authenticate, clearToken, type AuthResult } from "./api";
import { themeParams, user, isDevMode, ready } from "./telegram";
import { Dashboard } from "./components/Dashboard";
import { Schedule } from "./components/Schedule";
import { Payroll } from "./components/Payroll";
import { Payments } from "./components/Payments";
import { Settings } from "./components/Settings";
import { BottomNav } from "./components/BottomNav";

type Screen = "dashboard" | "schedule" | "payments" | "payroll" | "settings";

/* ── Toast System ── */

interface ToastItem {
  id: number;
  message: string;
  type: "success" | "error" | "info";
}

const ToastContext = React.createContext<(msg: string, type?: ToastItem["type"]) => void>(() => {});
export const useToast = () => React.useContext(ToastContext);

const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const nextId = React.useRef(0);

  const show = React.useCallback((message: string, type: ToastItem["type"] = "info") => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 2500);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div style={{
        position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)",
        zIndex: 9999, display: "flex", flexDirection: "column", gap: 6,
        maxWidth: 370, width: "calc(100% - 32px)", pointerEvents: "none",
      }}>
        {toasts.map((t) => (
          <div key={t.id} style={{
            padding: "10px 16px", borderRadius: 10, fontSize: 14, fontWeight: 600,
            textAlign: "center", animation: "toast-in 0.25s ease-out",
            background: t.type === "success" ? "rgba(52,199,89,0.95)"
              : t.type === "error" ? "rgba(255,59,48,0.95)"
              : "rgba(0,122,255,0.95)",
            color: "#fff",
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
          }}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

/* ── Styles ── */

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
    font-family: inherit;
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
  @keyframes toast-in {
    from { opacity: 0; transform: translateY(-10px); }
    to { opacity: 1; transform: translateY(0); }
  }
`;

/* ── Pull to Refresh ── */

const PullRefresh: React.FC<{ children: React.ReactNode; onRefresh: () => void }> = ({ children, onRefresh }) => {
  const [pullY, setPullY] = React.useState(0);
  const [refreshing, setRefreshing] = React.useState(false);
  const startY = React.useRef<number | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    if (containerRef.current && containerRef.current.scrollTop <= 0) {
      startY.current = e.touches[0].clientY;
    }
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (startY.current === null) return;
    const dy = e.touches[0].clientY - startY.current;
    if (dy > 0 && containerRef.current && containerRef.current.scrollTop <= 0) {
      setPullY(Math.min(dy * 0.4, 80));
    }
  };
  const onTouchEnd = () => {
    if (pullY > 50 && !refreshing) {
      setRefreshing(true);
      onRefresh();
      setTimeout(() => { setRefreshing(false); setPullY(0); }, 800);
    } else {
      setPullY(0);
    }
    startY.current = null;
  };

  return (
    <div ref={containerRef} className="screen"
      onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
    >
      {(pullY > 10 || refreshing) && (
        <div style={{
          textAlign: "center", padding: "4px 0", fontSize: 12, color: "var(--tg-hint)",
          transition: "opacity 0.2s", opacity: pullY > 30 || refreshing ? 1 : pullY / 30,
        }}>
          {refreshing ? "\u21BB ..." : pullY > 50 ? "\u2191 Отпустите" : "\u2193 Потяните"}
        </div>
      )}
      {children}
    </div>
  );
};

/* ── App ── */

export const App: React.FC = () => {
  const [screen, setScreen] = React.useState<Screen>("dashboard");
  const [auth, setAuth] = React.useState<AuthResult | null>(null);
  const [authLoading, setAuthLoading] = React.useState(true);
  const [authError, setAuthError] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const doRefresh = React.useCallback(() => setRefreshKey((k) => k + 1), []);

  React.useEffect(() => {
    ready();
    (async () => {
      try {
        const result = await authenticate();
        if (result.ok) setAuth(result);
        else setAuthError(result.error || "\u0414\u043E\u0441\u0442\u0443\u043F \u0437\u0430\u043F\u0440\u0435\u0449\u0451\u043D");
      } catch (e: any) {
        setAuthError(e.message || "\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u0435\u0442\u0438");
      }
      setAuthLoading(false);
    })();
  }, []);

  const isOwner = auth?.user?.is_owner || false;

  return (
    <>
      <style>{globalStyles}</style>
      <ToastProvider>
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
              <PullRefresh onRefresh={doRefresh}>
                {screen === "dashboard" && <Dashboard key={refreshKey} isOwner={isOwner} onNavigate={setScreen} />}
                {screen === "schedule" && <Schedule key={refreshKey} isOwner={isOwner} />}
                {screen === "payments" && <Payments key={refreshKey} isOwner={isOwner} />}
                {screen === "payroll" && <Payroll key={refreshKey} />}
                {screen === "settings" && <Settings key={refreshKey} isOwner={isOwner} />}
              </PullRefresh>
              <BottomNav current={screen} onChange={setScreen} />
            </>
          )}
        </div>
      </ToastProvider>
    </>
  );
};
