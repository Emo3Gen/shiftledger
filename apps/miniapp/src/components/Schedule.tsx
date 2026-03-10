import React from "react";
import { getSchedule, publishSchedule, type ScheduleData } from "../api";
import { haptic } from "../telegram";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function getMonday(offset = 0): string {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff + offset * 7);
  return d.toISOString().slice(0, 10);
}

function formatDateRange(weekStart: string): string {
  const d = new Date(weekStart + "T12:00:00");
  const end = new Date(d);
  end.setDate(d.getDate() + 6);
  const f = (dt: Date) => `${String(dt.getDate()).padStart(2, "0")}.${String(dt.getMonth() + 1).padStart(2, "0")}`;
  return `${f(d)} \u2013 ${f(end)}`;
}

export const Schedule: React.FC<{ isOwner: boolean }> = ({ isOwner }) => {
  const [weekStart, setWeekStart] = React.useState(getMonday);
  const [data, setData] = React.useState<ScheduleData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [publishing, setPublishing] = React.useState(false);
  const [pubResult, setPubResult] = React.useState<string | null>(null);

  const load = React.useCallback(async (ws: string) => {
    setLoading(true);
    try {
      setData(await getSchedule(ws));
    } catch {}
    setLoading(false);
  }, []);

  React.useEffect(() => { load(weekStart); }, [weekStart, load]);

  const navigate = (dir: -1 | 1) => {
    haptic("light");
    const d = new Date(weekStart + "T12:00:00");
    d.setDate(d.getDate() + dir * 7);
    setWeekStart(d.toISOString().slice(0, 10));
  };

  const handlePublish = async () => {
    haptic("medium");
    setPublishing(true);
    setPubResult(null);
    try {
      await publishSchedule(weekStart);
      setPubResult("ok");
    } catch (e: any) {
      setPubResult(e.message);
    }
    setPublishing(false);
  };

  const getSlot = (dow: string, slotName: string) =>
    data?.slots?.find((s) => s.dow === dow && s.slot_name === slotName);

  const slotBg = (slot: any) => {
    if (!slot?.user_id) return "rgba(255,59,48,0.15)";
    if (slot.status === "NEEDS_REPLACEMENT") return "rgba(255,152,0,0.15)";
    if (slot.replaced_user_id) return "rgba(0,122,255,0.12)";
    if (slot.status === "CONFIRMED") return "rgba(52,199,89,0.15)";
    return "rgba(255,204,0,0.12)";
  };

  return (
    <div>
      {/* Week navigation */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <button className="btn btn-secondary" style={{ width: 40, padding: 8, fontSize: 18 }} onClick={() => navigate(-1)}>&larr;</button>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>График</div>
          <div style={{ fontSize: 13, color: "var(--tg-hint)" }}>{formatDateRange(weekStart)}</div>
        </div>
        <button className="btn btn-secondary" style={{ width: 40, padding: 8, fontSize: 18 }} onClick={() => navigate(1)}>&rarr;</button>
      </div>

      {loading ? (
        <div className="loading">Загрузка...</div>
      ) : !data?.slots?.length ? (
        <div className="card" style={{ textAlign: "center", color: "var(--tg-hint)" }}>
          Нет данных на эту неделю
        </div>
      ) : (
        <>
          {/* Schedule grid */}
          <div style={{ display: "grid", gridTemplateColumns: "48px repeat(7, 1fr)", gap: 4, fontSize: 12, marginBottom: 12 }}>
            {/* Header */}
            <div />
            {DAYS.map((dow, i) => {
              const isToday = data.today_dow === dow;
              const d = new Date(weekStart + "T12:00:00");
              d.setDate(d.getDate() + i);
              return (
                <div key={dow} style={{
                  textAlign: "center",
                  fontWeight: 600,
                  padding: "4px 0",
                  borderRadius: 8,
                  ...(isToday ? { background: "var(--tg-link)", color: "#fff" } : {}),
                }}>
                  {DAY_SHORT[i]}
                  <div style={{ fontSize: 10, opacity: 0.7 }}>{d.getDate()}</div>
                </div>
              );
            })}

            {/* Morning row */}
            <div style={{ display: "flex", alignItems: "center", fontWeight: 600, fontSize: 11, color: "var(--tg-hint)" }}>Утро</div>
            {DAYS.map((dow) => {
              const slot = getSlot(dow, "Утро");
              return (
                <div key={`${dow}-m`} style={{
                  background: slotBg(slot),
                  borderRadius: 8,
                  padding: "6px 4px",
                  minHeight: 48,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  alignItems: "center",
                  textAlign: "center",
                }}>
                  {slot?.user_id ? (
                    <>
                      <div style={{ fontWeight: 600, fontSize: 11, lineHeight: 1.2 }}>
                        {slot.user_name || slot.user_id}
                      </div>
                      {slot.replaced_user_name && (
                        <div style={{ fontSize: 9, color: "var(--tg-hint)", marginTop: 1 }}>
                          {"\u{1F504}"} {slot.replaced_user_name}
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{ fontSize: 14 }}>{"\u26A0\uFE0F"}</div>
                  )}
                </div>
              );
            })}

            {/* Evening row */}
            <div style={{ display: "flex", alignItems: "center", fontWeight: 600, fontSize: 11, color: "var(--tg-hint)" }}>Вечер</div>
            {DAYS.map((dow) => {
              const slot = getSlot(dow, "Вечер");
              return (
                <div key={`${dow}-e`} style={{
                  background: slotBg(slot),
                  borderRadius: 8,
                  padding: "6px 4px",
                  minHeight: 48,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  alignItems: "center",
                  textAlign: "center",
                }}>
                  {slot?.user_id ? (
                    <>
                      <div style={{ fontWeight: 600, fontSize: 11, lineHeight: 1.2 }}>
                        {slot.user_name || slot.user_id}
                      </div>
                      {slot.cleaning_user_name && (
                        <div style={{ fontSize: 9, color: "var(--tg-hint)", marginTop: 1 }}>
                          {"\u{1F9F9}"} {slot.cleaning_user_name}
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{ fontSize: 14 }}>{"\u26A0\uFE0F"}</div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Publish button */}
          {isOwner && (
            <button
              className="btn"
              disabled={publishing}
              onClick={handlePublish}
            >
              {publishing ? "Публикация..." : "\u{1F4E2} Опубликовать в Telegram"}
            </button>
          )}
          {pubResult && (
            <div style={{
              marginTop: 8,
              fontSize: 13,
              textAlign: "center",
              color: pubResult === "ok" ? "rgba(52,199,89,1)" : "var(--tg-destructive)",
            }}>
              {pubResult === "ok" ? "\u2705 Опубликовано" : pubResult}
            </div>
          )}
        </>
      )}
    </div>
  );
};
