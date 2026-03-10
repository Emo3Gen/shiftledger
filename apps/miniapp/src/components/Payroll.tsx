import React from "react";
import { getPayroll, type PayrollData } from "../api";

function fmtRub(n: number): string {
  if (!n) return "0 \u20BD";
  const s = Math.round(n).toString();
  const parts = [];
  for (let i = s.length; i > 0; i -= 3) parts.unshift(s.slice(Math.max(0, i - 3), i));
  return parts.join("\u2009") + " \u20BD";
}

export const Payroll: React.FC = () => {
  const [data, setData] = React.useState<PayrollData | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    setLoading(true);
    getPayroll()
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">Загрузка...</div>;
  if (!data) return <div className="error-box">Не удалось загрузить</div>;

  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Табель</div>
      <div style={{ fontSize: 13, color: "var(--tg-hint)", marginBottom: 12 }}>{data.period}</div>

      {/* Totals */}
      <div className="kpi-grid" style={{ marginBottom: 12 }}>
        <div className="kpi-item">
          <div className="kpi-value">{fmtRub(data.totals.total_pay)}</div>
          <div className="kpi-label">ФОТ</div>
        </div>
        <div className="kpi-item">
          <div className="kpi-value">{data.totals.total_hours.toFixed(0)}</div>
          <div className="kpi-label">Часов</div>
        </div>
      </div>

      {/* Employees */}
      {data.employees.length === 0 ? (
        <div className="card" style={{ textAlign: "center", color: "var(--tg-hint)" }}>
          Нет данных
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
                <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 600, color: "var(--tg-hint)", fontSize: 11 }}>Сотрудник</th>
                <th style={{ textAlign: "right", padding: "10px 8px", fontWeight: 600, color: "var(--tg-hint)", fontSize: 11 }}>Часы</th>
                <th style={{ textAlign: "right", padding: "10px 12px", fontWeight: 600, color: "var(--tg-hint)", fontSize: 11 }}>ЗП</th>
              </tr>
            </thead>
            <tbody>
              {data.employees.map((emp, i) => (
                <tr key={emp.user_id} style={{
                  borderBottom: i < data.employees.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none",
                }}>
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ fontWeight: 600 }}>{emp.name}</div>
                    <div style={{ fontSize: 11, color: "var(--tg-hint)", marginTop: 1 }}>
                      {emp.cleaning_count > 0 && `${emp.cleaning_count} уб. `}
                      {emp.extra_pay > 0 && `допы ${fmtRub(emp.extra_pay)}`}
                    </div>
                  </td>
                  <td style={{ textAlign: "right", padding: "10px 8px", fontSize: 14 }}>
                    {emp.effective_hours.toFixed(1)}
                  </td>
                  <td style={{ textAlign: "right", padding: "10px 12px", fontWeight: 600, fontSize: 14 }}>
                    {fmtRub(emp.total_pay)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
