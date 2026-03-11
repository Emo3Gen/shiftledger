import React from "react";

export interface ParaplanPanelProps {
  paraplanStatus: any;
  paraplanHours: any;
  paraplanRefreshing: boolean;
  setParaplanRefreshing: (v: boolean) => void;
  setParaplanStatus: (v: any) => void;
  setParaplanHours: (v: any) => void;
  groupsConfig?: any[];
}

const RU_DOW: Record<string, string> = { mon: "Пн", tue: "Вт", wed: "Ср", thu: "Чт", fri: "Пт", sat: "Сб", sun: "Вс" };
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const PREP_BUFFER = 60; // ±1h buffer, same as backend
const toMin = (t: string) => parseInt(t.split(":")[0]) * 60 + parseInt(t.split(":")[1]);
const fmtMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

function SlotInfo({ slot, filterPrefixes }: { slot: any; filterPrefixes: Set<string> | null }) {
  if (!slot) return <span style={{ color: "#ccc" }}>{"\u2014"}</span>;
  const allGroups = slot.groups || [];
  const groups = filterPrefixes
    ? allGroups.filter((g: any) => filterPrefixes.has(g.prefix))
    : allGroups;
  if (groups.length === 0) return <span style={{ color: "#ccc" }}>{"\u2014"}</span>;

  // Recalculate hours & time range from filtered groups
  let hours = slot.hours;
  let paidStart = slot.paid_start;
  let paidEnd = slot.paid_end;
  if (filterPrefixes) {
    const starts = groups.map((g: any) => toMin(g.start));
    const ends = groups.map((g: any) => toMin(g.end));
    const paidStartMin = Math.max(0, Math.min(...starts) - PREP_BUFFER);
    const paidEndMin = Math.max(...ends) + PREP_BUFFER;
    hours = Math.round((paidEndMin - paidStartMin) / 60 * 10) / 10;
    paidStart = fmtMin(paidStartMin);
    paidEnd = fmtMin(paidEndMin);
  }

  const excluded = groups.filter((g: any) => !g.included);
  return (
    <div>
      <strong>{hours}ч</strong>
      <span style={{ color: "#888", marginLeft: 4 }}>({paidStart}{"\u2013"}{paidEnd})</span>
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
  groupsConfig = [],
}) => {
  const [filter, setFilter] = React.useState<"all" | "junior">("all");

  const juniorPrefixes = React.useMemo(() => {
    const s = new Set<string>();
    for (const gc of groupsConfig) {
      if (gc.requires_junior) s.add(gc.prefix);
    }
    return s;
  }, [groupsConfig]);

  const filterPrefixes = filter === "junior" ? juniorPrefixes : null;

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
            | {paraplanStatus.groupCount || 0} групп
            {paraplanStatus.mode === "emogen"
              ? (paraplanStatus.daysWithHours ? ` | ${paraplanStatus.daysWithHours} дн. с часами` : "")
              : ` | ${paraplanStatus.daysWithHours || 0} дн. с часами`}
          </span>
        )}
      </div>

      {/* Hours table */}
      {paraplanHours?.hours && (
        <div style={{ marginTop: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <strong>Часы смен из Параплана:</strong>
            {juniorPrefixes.size > 0 && (
              <div style={{ display: "inline-flex", borderRadius: 4, overflow: "hidden", border: "1px solid #ccc" }}>
                {([["all", "Все группы"], ["junior", "\u{1F465} Нужен помощник"]] as const).map(([val, label]) => (
                  <button key={val} onClick={() => setFilter(val)}
                    style={{
                      padding: "2px 8px", border: "none", fontSize: "var(--font-xs)", cursor: "pointer",
                      background: filter === val ? "#1976d2" : "#f5f5f5",
                      color: filter === val ? "#fff" : "#555",
                    }}
                  >{label}</button>
                ))}
              </div>
            )}
          </div>
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
                    <td style={{ padding: "2px 6px" }}><SlotInfo slot={dayData.morning} filterPrefixes={filterPrefixes} /></td>
                    <td style={{ padding: "2px 6px" }}><SlotInfo slot={dayData.evening} filterPrefixes={filterPrefixes} /></td>
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
