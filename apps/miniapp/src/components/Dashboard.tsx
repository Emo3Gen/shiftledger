import React from "react";
import { getDashboard, type DashboardData } from "../api";
import { haptic } from "../telegram";

type Screen = "dashboard" | "schedule" | "payments" | "payroll";

function fmtRub(n: number): string {
  if (!n) return "0 \u20BD";
  const s = Math.round(n).toString();
  const parts = [];
  for (let i = s.length; i > 0; i -= 3) parts.unshift(s.slice(Math.max(0, i - 3), i));
  return parts.join("\u2009") + " \u20BD";
}

export const Dashboard: React.FC<{
  isOwner: boolean;
  onNavigate: (s: Screen) => void;
}> = ({ isOwner, onNavigate }) => {
  const [data, setData] = React.useState<DashboardData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await getDashboard();
      setData(d);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  }, []);

  React.useEffect(() => { load(); }, [load]);

  if (loading) return <div className="loading">Загрузка...</div>;
  if (error) return <div className="error-box">{error}</div>;
  if (!data) return null;

  const { kpi, team, week_state } = data;
  const stateLabel: Record<string, string> = {
    COLLECTING: "\u{1F535} Сбор доступности",
    ACTIVE: "\u{1F7E2} График активен",
    CLOSED: "\u26AA Неделя закрыта",
  };

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 2 }}>ShiftLedger</div>
        {week_state && (
          <div style={{ fontSize: 13, color: "var(--tg-hint)" }}>
            {stateLabel[week_state] || week_state}
          </div>
        )}
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
        <div className="kpi-item">
          <div className="kpi-value">{kpi.pending_payments}</div>
          <div className="kpi-label">Нужна оплата</div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="card">
        <div className="card-title">Быстрые действия</div>
        <div style={{ display: "flex", gap: 8 }}>
          {([
            { id: "schedule" as Screen, icon: "\u{1F4C5}", label: "График" },
            { id: "payments" as Screen, icon: "\u{1F4B3}", label: "Оплаты" },
            { id: "payroll" as Screen, icon: "\u{1F4B0}", label: "Табель" },
          ]).map((a) => (
            <button
              key={a.id}
              className="btn btn-secondary"
              style={{ flex: 1, fontSize: 13, padding: "10px 8px" }}
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
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {team.map((m) => (
              <div key={m.id} style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 0",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
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
