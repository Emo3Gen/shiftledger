import React from "react";
import { getSchedule, getEmployees, updateSlot, publishSchedule, type ScheduleData, type SlotData, type Employee } from "../api";
import { haptic } from "../telegram";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function getMonday(offset = 0): string {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff + offset * 7);
  return d.toISOString().slice(0, 10);
}

interface ModalState {
  day: string;
  slot: "morning" | "evening";
  dayLabel: string;
  slotLabel: string;
  currentName: string | null;
  currentId: string | null;
  cleaning: boolean;
}

export const Schedule: React.FC<{ isOwner: boolean }> = ({ isOwner }) => {
  const [weekStart, setWeekStart] = React.useState(getMonday);
  const [data, setData] = React.useState<ScheduleData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [publishing, setPublishing] = React.useState(false);
  const [pubResult, setPubResult] = React.useState<string | null>(null);
  const [modal, setModal] = React.useState<ModalState | null>(null);
  const [employees, setEmployees] = React.useState<Employee[]>([]);
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async (ws: string) => {
    setLoading(true);
    try {
      setData(await getSchedule(ws));
    } catch {}
    setLoading(false);
  }, []);

  React.useEffect(() => { load(weekStart); }, [weekStart, load]);

  // Load employees once for modal
  React.useEffect(() => {
    getEmployees().then(setEmployees).catch(() => {});
  }, []);

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

  const openModal = (day: string, slot: "morning" | "evening", dayIdx: number) => {
    if (!isOwner || !data) return;
    haptic("light");
    const daySlot = data.slots[day];
    if (!daySlot) return;
    setModal({
      day,
      slot,
      dayLabel: DAY_SHORT[dayIdx],
      slotLabel: slot === "morning" ? "Утро" : "Вечер",
      currentName: slot === "morning" ? daySlot.morning : daySlot.evening,
      currentId: slot === "morning" ? daySlot.morning_id : daySlot.evening_id,
      cleaning: daySlot.cleaning,
    });
  };

  const handleAssign = async (employeeId: string | null, cleaning?: boolean) => {
    if (!modal || !data) return;
    haptic("medium");
    setSaving(true);
    try {
      await updateSlot(weekStart, modal.day, modal.slot, employeeId, cleaning);
      // Reload schedule
      const updated = await getSchedule(weekStart);
      setData(updated);
      setModal(null);
    } catch (e: any) {
      alert(e.message);
    }
    setSaving(false);
  };

  const slotBg = (daySlot: SlotData | undefined, slot: "morning" | "evening") => {
    const name = slot === "morning" ? daySlot?.morning : daySlot?.evening;
    if (!name) return "rgba(255,59,48,0.15)";
    return "rgba(52,199,89,0.15)";
  };

  return (
    <div>
      {/* Week navigation */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <button className="btn btn-secondary" style={{ width: 40, padding: 8, fontSize: 18 }} onClick={() => navigate(-1)}>&larr;</button>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>График</div>
          <div style={{ fontSize: 13, color: "var(--tg-hint)" }}>{data?.week || ""}</div>
        </div>
        <button className="btn btn-secondary" style={{ width: 40, padding: 8, fontSize: 18 }} onClick={() => navigate(1)}>&rarr;</button>
      </div>

      {loading ? (
        <div className="loading">Загрузка...</div>
      ) : !data ? (
        <div className="card" style={{ textAlign: "center", color: "var(--tg-hint)" }}>
          Ошибка загрузки
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
            {DAYS.map((dow, i) => {
              const daySlot = data.slots[dow];
              return (
                <div
                  key={`${dow}-m`}
                  onClick={() => openModal(dow, "morning", i)}
                  style={{
                    background: slotBg(daySlot, "morning"),
                    borderRadius: 8,
                    padding: "6px 4px",
                    minHeight: 48,
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    alignItems: "center",
                    textAlign: "center",
                    cursor: isOwner ? "pointer" : "default",
                  }}
                >
                  {daySlot?.morning ? (
                    <>
                      <div style={{ fontWeight: 600, fontSize: 11, lineHeight: 1.2 }}>
                        {daySlot.morning}
                      </div>
                      {daySlot.cleaning && (
                        <div style={{ fontSize: 9, color: "var(--tg-hint)", marginTop: 1 }}>
                          {"\u{1F9F9}"}
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
            {DAYS.map((dow, i) => {
              const daySlot = data.slots[dow];
              return (
                <div
                  key={`${dow}-e`}
                  onClick={() => openModal(dow, "evening", i)}
                  style={{
                    background: slotBg(daySlot, "evening"),
                    borderRadius: 8,
                    padding: "6px 4px",
                    minHeight: 48,
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    alignItems: "center",
                    textAlign: "center",
                    cursor: isOwner ? "pointer" : "default",
                  }}
                >
                  {daySlot?.evening ? (
                    <div style={{ fontWeight: 600, fontSize: 11, lineHeight: 1.2 }}>
                      {daySlot.evening}
                    </div>
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

      {/* Modal */}
      {modal && (
        <SlotModal
          modal={modal}
          employees={employees}
          saving={saving}
          onAssign={handleAssign}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
};

// --- Bottom Sheet Modal ---

const SlotModal: React.FC<{
  modal: ModalState;
  employees: Employee[];
  saving: boolean;
  onAssign: (employeeId: string | null, cleaning?: boolean) => void;
  onClose: () => void;
}> = ({ modal, employees, saving, onAssign, onClose }) => {
  const [cleaning, setCleaning] = React.useState(modal.cleaning);
  const sheetRef = React.useRef<HTMLDivElement>(null);
  const [visible, setVisible] = React.useState(false);
  const [dragY, setDragY] = React.useState(0);
  const dragStart = React.useRef<number | null>(null);

  // Animate in
  React.useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const close = () => {
    setVisible(false);
    setTimeout(onClose, 250);
  };

  // Touch drag to dismiss
  const onTouchStart = (e: React.TouchEvent) => {
    dragStart.current = e.touches[0].clientY;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (dragStart.current === null) return;
    const dy = e.touches[0].clientY - dragStart.current;
    if (dy > 0) setDragY(dy);
  };
  const onTouchEnd = () => {
    if (dragY > 100) {
      close();
    }
    setDragY(0);
    dragStart.current = null;
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={close}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.5)",
          zIndex: 200,
          opacity: visible ? 1 : 0,
          transition: "opacity 0.25s",
        }}
      />
      {/* Sheet */}
      <div
        ref={sheetRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{
          position: "fixed",
          bottom: 0,
          left: "50%",
          transform: `translateX(-50%) translateY(${visible ? dragY : 400}px)`,
          width: "100%",
          maxWidth: 390,
          maxHeight: "75vh",
          background: "var(--tg-section-bg)",
          borderRadius: "16px 16px 0 0",
          zIndex: 201,
          transition: dragY ? "none" : "transform 0.3s cubic-bezier(0.2, 0, 0, 1)",
          overflowY: "auto",
          paddingBottom: "env(safe-area-inset-bottom, 16px)",
        }}
      >
        {/* Drag handle */}
        <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 4px" }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.2)" }} />
        </div>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 16px 12px" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 17 }}>
              {modal.dayLabel}, {modal.slotLabel}
            </div>
            <div style={{ fontSize: 13, color: "var(--tg-hint)", marginTop: 2 }}>
              {modal.currentName ? `Сейчас: ${modal.currentName}` : "Не назначен"}
            </div>
          </div>
          <button
            onClick={close}
            style={{
              background: "rgba(255,255,255,0.1)",
              border: "none",
              borderRadius: "50%",
              width: 32,
              height: 32,
              fontSize: 16,
              cursor: "pointer",
              color: "var(--tg-hint)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {"\u2715"}
          </button>
        </div>

        {/* Employee list */}
        <div style={{ padding: "0 16px" }}>
          {employees.map((emp) => {
            const isSelected = emp.id === modal.currentId;
            return (
              <button
                key={emp.id}
                disabled={saving}
                onClick={() => {
                  haptic("light");
                  onAssign(emp.id, modal.slot === "morning" ? cleaning : undefined);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  padding: "12px 0",
                  background: "none",
                  border: "none",
                  borderBottom: "1px solid rgba(255,255,255,0.06)",
                  cursor: "pointer",
                  color: "var(--tg-text)",
                  fontSize: 15,
                  opacity: saving ? 0.4 : 1,
                }}
              >
                <span style={{ fontWeight: isSelected ? 700 : 400 }}>
                  {emp.name}
                </span>
                <span style={{ fontSize: 12, color: "var(--tg-hint)" }}>
                  {isSelected ? "\u2713" : ""} {emp.role}
                </span>
              </button>
            );
          })}
        </div>

        {/* Cleaning toggle (morning only) */}
        {modal.slot === "morning" && (
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 16px",
            borderTop: "1px solid rgba(255,255,255,0.08)",
            marginTop: 4,
          }}>
            <span style={{ fontSize: 14 }}>{"\u{1F9F9}"} Уборка</span>
            <button
              onClick={() => { haptic("light"); setCleaning(!cleaning); }}
              style={{
                width: 48,
                height: 28,
                borderRadius: 14,
                border: "none",
                background: cleaning ? "rgba(52,199,89,0.9)" : "rgba(255,255,255,0.15)",
                position: "relative",
                cursor: "pointer",
                transition: "background 0.2s",
              }}
            >
              <div style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                background: "#fff",
                position: "absolute",
                top: 3,
                left: cleaning ? 23 : 3,
                transition: "left 0.2s",
              }} />
            </button>
          </div>
        )}

        {/* Clear slot button */}
        {modal.currentId && (
          <div style={{ padding: "8px 16px 12px" }}>
            <button
              className="btn btn-danger"
              disabled={saving}
              onClick={() => {
                haptic("medium");
                onAssign(null, false);
              }}
              style={{ fontSize: 14 }}
            >
              {saving ? "..." : "Очистить слот"}
            </button>
          </div>
        )}
      </div>
    </>
  );
};
