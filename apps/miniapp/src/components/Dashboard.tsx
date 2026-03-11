import React from "react";
import { getDashboard, getBotMode, setBotMode, type DashboardData } from "../api";
import { haptic, hapticNotify } from "../telegram";
import { useToast } from "../App";

type Screen = "dashboard" | "schedule" | "payments" | "payroll" | "settings";

function fmtRub(n: number): string {
  if (!n) return "0 \u20BD";
  const s = Math.round(n).toString();
  const parts = [];
  for (let i = s.length; i > 0; i -= 3) parts.unshift(s.slice(Math.max(0, i - 3), i));
  return parts.join("\u2009") + " \u20BD";
}

const STATE_CONFIG: Record<string, { icon: string; label: string; color: string; bg: string }> = {
  COLLECTING: { icon: "\u{1F535}", label: "Сбор доступности", color: "rgba(0,122,255,1)", bg: "rgba(0,122,255,0.12)" },
  ACTIVE: { icon: "\u{1F7E2}", label: "График активен", color: "rgba(52,199,89,1)", bg: "rgba(52,199,89,0.12)" },
  CLOSED: { icon: "\u26AA", label: "Неделя закрыта", color: "var(--tg-hint)", bg: "rgba(255,255,255,0.06)" },
};

const BOT_MODES = [
  { id: "manual", icon: "\u{1F507}", label: "Тишина", color: "var(--tg-hint)", bg: "rgba(255,255,255,0.08)" },
  { id: "auto", icon: "\u{1F916}", label: "Авто", color: "rgba(52,199,89,1)", bg: "rgba(52,199,89,0.12)" },
  { id: "debug", icon: "\u{1F50D}", label: "Отладка", color: "rgba(255,204,0,1)", bg: "rgba(255,204,0,0.12)" },
];

export const Dashboard: React.FC<{
  isOwner: boolean;
  onNavigate: (s: Screen) => void;
}> = ({ isOwner, onNavigate }) => {
  const toast = useToast();
  const [data, setData] = React.useState<DashboardData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [botMode, setBotModeState] = React.useState<string>("manual");
  const [modeLoading, setModeLoading] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setData(await getDashboard()); }
    catch (e: any) { setError(e.message); }
    setLoading(false);
  }, []);

  React.useEffect(() => { load(); }, [load]);

  React.useEffect(() => {
    if (isOwner) getBotMode().then((d) => setBotModeState(d.mode)).catch(() => {});
  }, [isOwner]);

  const changeBotMode = async (mode: string) => {
    if (mode === botMode || modeLoading) return;
    haptic("medium");
    setModeLoading(true);
    try {
      const r = await setBotMode(mode);
      setBotModeState(r.mode);
      hapticNotify("success");
      const label = BOT_MODES.find((m) => m.id === r.mode)?.label || r.mode;
      toast(`Режим: ${label}`, "success");
    } catch (e: any) { hapticNotify("error"); toast(e.message, "error"); }
    setModeLoading(false);
  };

  if (loading) return <div className="loading">Загрузка...</div>;
  if (error) return <div className="error-box">{error}</div>;
  if (!data) return null;

  const { kpi, team, week_state } = data;
  const state = STATE_CONFIG[week_state || "COLLECTING"] || STATE_CONFIG.COLLECTING;

  return (
    <div>
      {/* Header + Week status */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 22, fontWeight: 700 }}>ShiftLedger</div>
          {week_state && (
            <div style={{
              fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 8,
              background: state.bg, color: state.color,
            }}>
              {state.icon} {state.label}
            </div>
          )}
        </div>
      </div>

      {/* KPI */}
      <div className="kpi-grid">
        <div className="kpi-item">
          <div className="kpi-value">{kpi.employee_count}</div>
          <div className="kpi-label">Сотрудников</div>
        </div>
        <div className="kpi-item">
          <div className="kpi-value">{fmtRub(kpi.total_payroll)}</div>
          <div className="kpi-label">ФОТ</div>
        </div>
        <div className="kpi-item">
          <div className="kpi-value">{kpi.total_hours.toFixed(0)}</div>
          <div className="kpi-label">Часов/нед</div>
        </div>
        <div className="kpi-item" style={kpi.pending_payments > 0 ? { background: "rgba(255,59,48,0.12)" } : {}}>
          <div className="kpi-value" style={kpi.pending_payments > 0 ? { color: "var(--tg-destructive)" } : {}}>
            {kpi.pending_payments}
          </div>
          <div className="kpi-label">Нужна оплата</div>
        </div>
      </div>

      {/* Bot mode toggle */}
      {isOwner && (
        <div className="card">
          <div className="card-title">Режим бота</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
            {BOT_MODES.map((m) => {
              const active = botMode === m.id;
              return (
                <button key={m.id} disabled={modeLoading}
                  onClick={() => changeBotMode(m.id)}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                    gap: 4, padding: "12px 6px", borderRadius: 10, border: "none", cursor: "pointer",
                    background: active ? m.bg : "rgba(255,255,255,0.04)",
                    color: active ? m.color : "var(--tg-hint)",
                    fontFamily: "inherit", fontSize: 12, fontWeight: active ? 700 : 500,
                    opacity: modeLoading ? 0.5 : 1,
                    outline: active ? `2px solid ${m.color}` : "2px solid transparent",
                    transition: "all 0.15s",
                  }}
                >
                  <span style={{ fontSize: 22 }}>{m.icon}</span>
                  <span>{m.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div className="card">
        <div className="card-title">Быстрые действия</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {([
            { id: "schedule" as Screen, icon: "\u{1F4C5}", label: "График" },
            { id: "payments" as Screen, icon: "\u{1F4B3}", label: "Оплаты" },
            { id: "payroll" as Screen, icon: "\u{1F4B0}", label: "Табель" },
            { id: "settings" as Screen, icon: "\u2699\uFE0F", label: "Настройки" },
          ]).map((a) => (
            <button
              key={a.id}
              className="btn btn-secondary"
              style={{ fontSize: 13, padding: "12px 8px" }}
              onClick={() => { haptic("light"); onNavigate(a.id); }}
            >
              {a.icon} {a.label}
            </button>
          ))}
        </div>
      </div>

      {/* Team */}
      <div className="card">
        <div className="card-title">Команда</div>
        {team.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--tg-hint)" }}>Нет данных</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {team.map((m) => (
              <div key={m.id} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.06)",
              }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{m.name}</div>
                  <div style={{ fontSize: 12, color: "var(--tg-hint)" }}>{m.role}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{fmtRub(m.pay)}</div>
                  <div style={{ fontSize: 12, color: "var(--tg-hint)" }}>{m.hours.toFixed(1)} ч</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
