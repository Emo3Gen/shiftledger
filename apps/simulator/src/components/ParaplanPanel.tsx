import React from "react";

export interface ParaplanPanelProps {
  paraplanStatus: any;
  paraplanHours: any;
  paraplanRefreshing: boolean;
  setParaplanRefreshing: (v: boolean) => void;
  setParaplanStatus: (v: any) => void;
  setParaplanHours: (v: any) => void;
}

const RU_DOW: Record<string, string> = { mon: "Пн", tue: "Вт", wed: "Ср", thu: "Чт", fri: "Пт", sat: "Сб", sun: "Вс" };
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function SlotInfo({ slot }: { slot: any }) {
  if (!slot) return <span style={{ color: "#ccc" }}>{"\u2014"}</span>;
  const groups = slot.groups || [];
  const excluded = groups.filter((g: any) => !g.included);
  return (
    <div>
      <strong>{slot.hours}ч</strong>
      <span style={{ color: "#888", marginLeft: 4 }}>({slot.paid_start}{"\u2013"}{slot.paid_end})</span>
      <div style={{ marginTop: 2 }}>
        {groups.map((g: any, i: number) => (
          <div key={i} style={{ fontSize: "0.85em", color: g.included ? "#555" : "#bbb", textDecoration: g.included ? "none" : "line-through" }}>
            {g.prefix} {g.start}{"\u2013"}{g.end} {g.teacher ? `(${g.teacher})` : ""}
          </div>
        ))}
      </div>
      {excluded.length > 0 && (
        <div style={{ fontSize: "0.8em", color: "#f57c00", marginTop: 1 }}>
          {"\u26A0"} {excluded.length} {excluded.length === 1 ? "группа без мл." : "групп без мл."}
        </div>
      )}
    </div>
  );
}

export const ParaplanPanel: React.FC<ParaplanPanelProps> = ({
  paraplanStatus,
  paraplanHours,
  paraplanRefreshing,
  setParaplanRefreshing,
  setParaplanStatus,
  setParaplanHours,
}) => {
  return (
    <div style={{ fontSize: "var(--font-xs)", padding: "8px" }}>
      {/* Status row */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <button
          type="button"
          disabled={paraplanRefreshing}
          style={{ padding: "3px 10px", fontSize: "var(--font-xs)", cursor: paraplanRefreshing ? "wait" : "pointer", background: "#f5f5f5", border: "1px solid #ccc", borderRadius: 4 }}
          onClick={async () => {
            setParaplanRefreshing(true);
            try {
              const res = await fetch("/api/paraplan/refresh", { method: "POST" });
              const data = await res.json();
              if (data.ok) {
                const [statusRes, hoursRes] = await Promise.all([
                  fetch("/api/paraplan/status").then(r => r.json()),
                  fetch("/api/paraplan/hours").then(r => r.json()),
                ]);
                if (statusRes.ok) setParaplanStatus(statusRes);
                if (hoursRes.ok) setParaplanHours(hoursRes);
              }
            } catch (e) { console.error("Paraplan refresh error", e); }
            setParaplanRefreshing(false);
          }}
        >
          {paraplanRefreshing ? "Обновление..." : "Обновить из Параплана"}
        </button>
        {paraplanStatus?.updatedAt && (
          <span style={{ color: "#888" }}>
            Обновлено: {new Date(paraplanStatus.updatedAt).toLocaleTimeString("ru")}
          </span>
        )}
        {paraplanStatus && (
          <span style={{ color: "#888" }}>
            | {paraplanStatus.groupCount || 0} групп | {paraplanStatus.daysWithHours || 0} дн. с часами
          </span>
        )}
      </div>

      {/* Hours table */}
      {paraplanHours?.hours && (
        <div style={{ marginTop: 4 }}>
          <strong>Часы смен из Параплана:</strong>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 4, fontSize: "var(--font-xs)" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #ddd" }}>
                <th style={{ textAlign: "left", padding: "2px 6px" }}>День</th>
                <th style={{ textAlign: "center", padding: "2px 6px" }}>Утро</th>
                <th style={{ textAlign: "center", padding: "2px 6px" }}>Вечер</th>
              </tr>
            </thead>
            <tbody>
              {DAYS.map((dow) => {
                const dayData = paraplanHours.hours[dow];
                if (!dayData) return (
                  <tr key={dow} style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <td style={{ padding: "2px 6px", fontWeight: "bold" }}>{RU_DOW[dow]}</td>
                    <td style={{ textAlign: "center", padding: "2px 6px", color: "#ccc" }}>{"\u2014"}</td>
                    <td style={{ textAlign: "center", padding: "2px 6px", color: "#ccc" }}>{"\u2014"}</td>
                  </tr>
                );
                return (
                  <tr key={dow} style={{ borderBottom: "1px solid #f0f0f0", verticalAlign: "top" }}>
                    <td style={{ padding: "2px 6px", fontWeight: "bold" }}>{RU_DOW[dow]}</td>
                    <td style={{ padding: "2px 6px" }}><SlotInfo slot={dayData.morning} /></td>
                    <td style={{ padding: "2px 6px" }}><SlotInfo slot={dayData.evening} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!paraplanStatus?.configured && (
        <div style={{ color: "#999", padding: 8 }}>
          Для подключения укажите PARAPLAN_LOGIN и PARAPLAN_PASSWORD в .env
        </div>
      )}
    </div>
  );
};
