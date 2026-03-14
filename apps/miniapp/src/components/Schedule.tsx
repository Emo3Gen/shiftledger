import React from "react";
import {
  getSchedule, getEmployees, updateSlot, publishSchedule, proposeSchedule, lockSchedule, resetSchedule, addExtraPay, getCatalog,
  type ScheduleData, type SlotData, type Employee, type CatalogItem,
} from "../api";
import { haptic, hapticNotify } from "../telegram";
import { useToast } from "../App";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function getMonday(offset = 0): string {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff + offset * 7);
  return d.toISOString().slice(0, 10);
}

const STATUS_BG: Record<string, string> = {
  ASSIGNED: "rgba(52,199,89,0.18)",
  CONFIRMED: "rgba(52,199,89,0.18)",
  NEEDS_REPLACEMENT: "rgba(255,204,0,0.18)",
  PENDING: "rgba(255,204,0,0.18)",
  EMPTY: "rgba(255,59,48,0.12)",
  REPLACED: "rgba(0,122,255,0.18)",
};

const STATUS_BORDER: Record<string, string> = {
  ASSIGNED: "rgba(52,199,89,0.4)",
  CONFIRMED: "rgba(52,199,89,0.4)",
  NEEDS_REPLACEMENT: "rgba(255,204,0,0.4)",
  PENDING: "rgba(255,204,0,0.4)",
  EMPTY: "rgba(255,59,48,0.25)",
  REPLACED: "rgba(0,122,255,0.4)",
};

interface ModalState {
  day: string;
  slot: "morning" | "evening";
  dayLabel: string;
  slotLabel: string;
  currentName: string | null;
  currentId: string | null;
  cleaning: boolean;
  status: string;
  problem: boolean;
  available: Array<{ id: string; name: string }>;
  unavailable: Array<{ id: string; name: string }>;
}

export const Schedule: React.FC<{ isOwner: boolean }> = ({ isOwner }) => {
  const toast = useToast();
  const [weekStart, setWeekStart] = React.useState(getMonday);
  const [data, setData] = React.useState<ScheduleData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [publishing, setPublishing] = React.useState(false);
  const [pubResult, setPubResult] = React.useState<string | null>(null);
  const [modal, setModal] = React.useState<ModalState | null>(null);
  const [employees, setEmployees] = React.useState<Employee[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [actionLoading, setActionLoading] = React.useState<string | null>(null);

  const load = React.useCallback(async (ws: string) => {
    setLoading(true);
    try { setData(await getSchedule(ws)); } catch {}
    setLoading(false);
  }, []);

  React.useEffect(() => { load(weekStart); }, [weekStart, load]);
  React.useEffect(() => { getEmployees().then(setEmployees).catch(() => {}); }, []);

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
    try { await publishSchedule(weekStart); setPubResult("ok"); }
    catch (e: any) { setPubResult(e.message); }
    setPublishing(false);
  };

  const openModal = (day: string, slot: "morning" | "evening", dayIdx: number) => {
    if (!isOwner || !data) return;
    haptic("light");
    const ds = data.slots[day];
    if (!ds) return;
    setModal({
      day, slot,
      dayLabel: DAY_SHORT[dayIdx],
      slotLabel: slot === "morning" ? "Утро" : "Вечер",
      currentName: slot === "morning" ? ds.morning : ds.evening,
      currentId: slot === "morning" ? ds.morning_id : ds.evening_id,
      cleaning: ds.cleaning,
      status: slot === "morning" ? ds.morning_status : ds.evening_status,
      problem: slot === "morning" ? ds.morning_problem : ds.evening_problem,
      available: slot === "morning" ? ds.morning_available : ds.evening_available,
      unavailable: slot === "morning" ? (ds.morning_unavailable || []) : (ds.evening_unavailable || []),
    });
  };

  const handleAssign = async (employeeId: string | null, cleaning?: boolean) => {
    if (!modal || !data) return;
    haptic("medium");
    setSaving(true);
    try {
      await updateSlot(weekStart, modal.day, modal.slot, employeeId, cleaning);
      setData(await getSchedule(weekStart));
      setModal(null);
    } catch (e: any) { toast(e.message, "error"); }
    setSaving(false);
  };

  const handleAction = async (action: "propose" | "lock" | "reset") => {
    haptic("medium");
    setActionLoading(action);
    try {
      if (action === "propose") await proposeSchedule(weekStart);
      else if (action === "lock") await lockSchedule(weekStart);
      else await resetSchedule(weekStart);
      hapticNotify("success");
      toast(action === "propose" ? "График предложен" : action === "lock" ? "График зафиксирован" : "Неделя сброшена", "success");
      load(weekStart);
    } catch (e: any) { hapticNotify("error"); toast(e.message, "error"); }
    setActionLoading(null);
  };

  const bg = (ds: SlotData | undefined, slot: "morning" | "evening") =>
    STATUS_BG[(slot === "morning" ? ds?.morning_status : ds?.evening_status) || "EMPTY"] || STATUS_BG.EMPTY;
  const border = (ds: SlotData | undefined, slot: "morning" | "evening") =>
    STATUS_BORDER[(slot === "morning" ? ds?.morning_status : ds?.evening_status) || "EMPTY"] || STATUS_BORDER.EMPTY;

  const renderSlotCell = (ds: SlotData | undefined, slot: "morning" | "evening", dow: string, dayIdx: number) => {
    const name = slot === "morning" ? ds?.morning : ds?.evening;
    const status = slot === "morning" ? ds?.morning_status : ds?.evening_status;
    const problem = slot === "morning" ? ds?.morning_problem : ds?.evening_problem;
    return (
      <div
        key={`${dow}-${slot[0]}`}
        onClick={() => openModal(dow, slot, dayIdx)}
        style={{
          background: bg(ds, slot),
          border: `1px solid ${border(ds, slot)}`,
          borderRadius: 8, padding: "5px 3px", minHeight: 52,
          display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center",
          textAlign: "center", cursor: isOwner ? "pointer" : "default",
        }}
      >
        {name ? (
          <>
            <div style={{ fontWeight: 600, fontSize: 11, lineHeight: 1.2 }}>{name}</div>
            <div style={{ fontSize: 9, marginTop: 2, display: "flex", gap: 1, justifyContent: "center" }}>
              {status === "ASSIGNED" && "\u2705"}
              {status === "REPLACED" && "\u{1F504}"}
              {problem && "\u26A0\uFE0F"}
              {slot === "morning" && ds?.cleaning && "\u{1F9F9}"}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 16, opacity: 0.4 }}>&mdash;</div>
        )}
      </div>
    );
  };

  return (
    <div>
      {/* Week nav */}
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
        <div className="card" style={{ textAlign: "center", color: "var(--tg-hint)" }}>Ошибка загрузки</div>
      ) : (
        <>
          {/* Landscape-scrollable grid */}
          <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", marginBottom: 12, paddingBottom: 4 }}>
            <div style={{
              display: "grid", gridTemplateColumns: "44px repeat(7, 80px)",
              gap: 4, fontSize: 12, minWidth: "fit-content",
            }}>
              {/* Day headers */}
              <div />
              {DAYS.map((dow, i) => {
                const isToday = data.today_dow === dow;
                const d = new Date(weekStart + "T12:00:00");
                d.setDate(d.getDate() + i);
                return (
                  <div key={dow} style={{
                    textAlign: "center", fontWeight: 600, padding: "4px 0", borderRadius: 8,
                    ...(isToday ? { background: "var(--tg-link)", color: "#fff" } : {}),
                  }}>
                    {DAY_SHORT[i]}
                    <div style={{ fontSize: 10, opacity: 0.7 }}>{d.getDate()}</div>
                  </div>
                );
              })}

              {/* Morning row */}
              <div style={{ display: "flex", alignItems: "center", fontWeight: 600, fontSize: 10, color: "var(--tg-hint)" }}>Утро</div>
              {DAYS.map((dow, i) => renderSlotCell(data.slots[dow], "morning", dow, i))}

              {/* Evening row */}
              <div style={{ display: "flex", alignItems: "center", fontWeight: 600, fontSize: 10, color: "var(--tg-hint)" }}>Вечер</div>
              {DAYS.map((dow, i) => renderSlotCell(data.slots[dow], "evening", dow, i))}
            </div>
          </div>

          {/* Employee hours */}
          {data.employee_hours && Object.keys(data.employee_hours).length > 0 && (
            <div className="card">
              <div className="card-title">Часы за неделю</div>
              {Object.entries(data.employee_hours).map(([uid, h]) => {
                const name = employees.find((e) => e.id === uid)?.name || uid;
                const pct = h.min > 0 ? (h.hours / h.min) * 100 : 100;
                return (
                  <div key={uid} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.06)",
                  }}>
                    <span style={{ fontSize: 13 }}>{name}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{
                        width: 40, height: 4, borderRadius: 2,
                        background: "rgba(255,255,255,0.1)", overflow: "hidden",
                      }}>
                        <div style={{
                          width: `${Math.min(pct, 100)}%`, height: "100%", borderRadius: 2,
                          background: pct < 80 ? "var(--tg-destructive)" : "rgba(52,199,89,0.8)",
                        }} />
                      </div>
                      <span style={{
                        fontSize: 12, fontWeight: 600, minWidth: 50, textAlign: "right",
                        color: pct < 80 ? "var(--tg-destructive)" : pct >= 100 ? "rgba(52,199,89,1)" : "var(--tg-hint)",
                      }}>
                        {h.hours.toFixed(1)}/{h.min}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Schedule actions */}
          {isOwner && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 8 }}>
              <button className="btn btn-secondary" disabled={!!actionLoading} onClick={() => handleAction("propose")}
                style={{ fontSize: 12, padding: "9px 4px" }}>
                {actionLoading === "propose" ? "..." : "\u{1F4CB} Предложить"}
              </button>
              <button className="btn btn-secondary" disabled={!!actionLoading} onClick={() => handleAction("lock")}
                style={{ fontSize: 12, padding: "9px 4px" }}>
                {actionLoading === "lock" ? "..." : "\u{1F512} Зафиксировать"}
              </button>
              <button className="btn btn-secondary" disabled={!!actionLoading} onClick={() => handleAction("reset")}
                style={{ fontSize: 12, padding: "9px 4px", color: "var(--tg-destructive)" }}>
                {actionLoading === "reset" ? "..." : "\u{1F504} Обнулить"}
              </button>
            </div>
          )}

          {/* Publish */}
          {isOwner && (
            <button className="btn" disabled={publishing} onClick={handlePublish}>
              {publishing ? "Публикация..." : "\u{1F4E2} Опубликовать"}
            </button>
          )}
          {pubResult && (
            <div style={{
              marginTop: 8, fontSize: 13, textAlign: "center",
              color: pubResult === "ok" ? "rgba(52,199,89,1)" : "var(--tg-destructive)",
            }}>
              {pubResult === "ok" ? "\u2705 Опубликовано" : pubResult}
            </div>
          )}
        </>
      )}

      {modal && (
        <SlotModal
          modal={modal} employees={employees}
          employeeHours={data?.employee_hours}
          saving={saving} weekStart={weekStart}
          onAssign={handleAssign}
          onClose={() => setModal(null)}
          onReload={() => load(weekStart)}
        />
      )}
    </div>
  );
};

/* ── Rich Slot Modal ── */

const SlotModal: React.FC<{
  modal: ModalState;
  employees: Employee[];
  employeeHours?: Record<string, { hours: number; min: number }>;
  saving: boolean;
  weekStart: string;
  onAssign: (eid: string | null, cleaning?: boolean) => void;
  onClose: () => void;
  onReload: () => void;
}> = ({ modal, employees, employeeHours, saving, weekStart, onAssign, onClose, onReload }) => {
  const [cleaning, setCleaning] = React.useState(modal.cleaning);
  const [showExtraWork, setShowExtraWork] = React.useState(false);
  const [visible, setVisible] = React.useState(false);
  const [dragY, setDragY] = React.useState(0);
  const dragStart = React.useRef<number | null>(null);

  React.useEffect(() => { requestAnimationFrame(() => setVisible(true)); }, []);
  const close = () => { setVisible(false); setTimeout(onClose, 250); };

  const onTouchStart = (e: React.TouchEvent) => { dragStart.current = e.touches[0].clientY; };
  const onTouchMove = (e: React.TouchEvent) => {
    if (dragStart.current === null) return;
    const dy = e.touches[0].clientY - dragStart.current;
    if (dy > 0) setDragY(dy);
  };
  const onTouchEnd = () => { if (dragY > 100) close(); setDragY(0); dragStart.current = null; };

  const availIds = new Set(modal.available.map((a) => a.id));
  const unavailIds = new Set(modal.unavailable.map((a) => a.id));
  const sorted = [...employees].sort((a, b) => {
    // Sort: available first, then neutral, then unavailable
    const scoreA = availIds.has(a.id) ? 0 : unavailIds.has(a.id) ? 2 : 1;
    const scoreB = availIds.has(b.id) ? 0 : unavailIds.has(b.id) ? 2 : 1;
    return scoreA - scoreB;
  });

  return (
    <>
      <div onClick={close} style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 200,
        opacity: visible ? 1 : 0, transition: "opacity 0.25s",
      }} />
      <div
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
        style={{
          position: "fixed", bottom: 0, left: "50%",
          transform: `translateX(-50%) translateY(${visible ? dragY : 400}px)`,
          width: "100%", maxWidth: 390, maxHeight: "80vh",
          background: "var(--tg-section-bg)", borderRadius: "16px 16px 0 0", zIndex: 201,
          transition: dragY ? "none" : "transform 0.3s cubic-bezier(0.2, 0, 0, 1)",
          overflowY: "auto", paddingBottom: "env(safe-area-inset-bottom, 16px)",
        }}
      >
        {/* Handle */}
        <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 4px" }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.2)" }} />
        </div>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 16px 12px" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 17 }}>
              {modal.dayLabel}, {modal.slotLabel}
              {modal.problem && <span style={{ marginLeft: 6 }}>{"\u26A0\uFE0F"}</span>}
            </div>
            <div style={{ fontSize: 13, color: "var(--tg-hint)", marginTop: 2 }}>
              {modal.currentName ? `\u{1F464} ${modal.currentName}` : "Не назначен"}
              {modal.status !== "EMPTY" && (
                <span style={{
                  marginLeft: 6, fontSize: 11, padding: "1px 6px", borderRadius: 4,
                  background: STATUS_BG[modal.status],
                }}>
                  {modal.status === "ASSIGNED" ? "\u2705" : modal.status === "NEEDS_REPLACEMENT" ? "\u26A0\uFE0F" : modal.status}
                </span>
              )}
            </div>
          </div>
          <button onClick={close} style={{
            background: "rgba(255,255,255,0.1)", border: "none", borderRadius: "50%",
            width: 32, height: 32, fontSize: 16, cursor: "pointer", color: "var(--tg-hint)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>{"\u2715"}</button>
        </div>

        {/* Employee list */}
        <div style={{ padding: "0 16px" }}>
          {sorted.map((emp) => {
            const isSelected = emp.id === modal.currentId;
            const isAvail = availIds.has(emp.id);
            const isUnavail = unavailIds.has(emp.id);
            const h = employeeHours?.[emp.id];
            const dotColor = isAvail ? "rgba(52,199,89,0.8)" : isUnavail ? "rgba(255,59,48,0.7)" : "rgba(255,255,255,0.15)";
            return (
              <button key={emp.id} disabled={saving}
                onClick={() => { haptic("light"); onAssign(emp.id, modal.slot === "morning" ? cleaning : undefined); }}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%",
                  padding: "11px 0", background: "none", border: "none",
                  borderBottom: "1px solid rgba(255,255,255,0.06)", cursor: "pointer",
                  color: "var(--tg-text)", fontSize: 15, opacity: saving || isUnavail ? 0.4 : 1,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: 4, flexShrink: 0,
                    background: dotColor,
                  }} />
                  <span style={{ fontWeight: isSelected ? 700 : 400 }}>{emp.name}</span>
                  {isSelected && <span style={{ color: "var(--tg-link)", fontSize: 13 }}>{"\u2713"}</span>}
                  {isUnavail && <span style={{ fontSize: 11, color: "rgba(255,59,48,0.7)" }}>не может</span>}
                </div>
                <div style={{ textAlign: "right", fontSize: 12, color: "var(--tg-hint)" }}>
                  {h && <div>{h.hours.toFixed(1)}/{h.min}ч</div>}
                  <div>{emp.role}</div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Cleaning toggle */}
        {modal.slot === "morning" && (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "14px 16px", borderTop: "1px solid rgba(255,255,255,0.08)", marginTop: 4,
          }}>
            <span style={{ fontSize: 14 }}>{"\u{1F9F9}"} Уборка</span>
            <ToggleSwitch value={cleaning} onChange={(v) => { haptic("light"); setCleaning(v); }} />
          </div>
        )}

        {/* Actions */}
        <div style={{ padding: "8px 16px 4px", display: "flex", gap: 8 }}>
          {modal.currentId && (
            <button className="btn btn-danger" disabled={saving}
              onClick={() => { haptic("medium"); onAssign(null, false); }}
              style={{ flex: 1, fontSize: 14 }}>
              {saving ? "..." : "Очистить"}
            </button>
          )}
          {modal.currentId && (
            <button className="btn btn-secondary"
              onClick={() => { haptic("light"); setShowExtraWork(true); }}
              style={{ flex: 1, fontSize: 14 }}>
              + Допработа
            </button>
          )}
        </div>
      </div>

      {showExtraWork && modal.currentId && (
        <ExtraWorkSheet
          employeeId={modal.currentId}
          employeeName={modal.currentName || ""}
          weekStart={weekStart}
          onClose={() => setShowExtraWork(false)}
          onDone={() => { setShowExtraWork(false); onReload(); }}
        />
      )}
    </>
  );
};

/* ── Toggle Switch ── */

const ToggleSwitch: React.FC<{ value: boolean; onChange: (v: boolean) => void }> = ({ value, onChange }) => (
  <button
    onClick={() => onChange(!value)}
    style={{
      width: 48, height: 28, borderRadius: 14, border: "none",
      background: value ? "rgba(52,199,89,0.9)" : "rgba(255,255,255,0.15)",
      position: "relative", cursor: "pointer", transition: "background 0.2s",
    }}
  >
    <div style={{
      width: 22, height: 22, borderRadius: 11, background: "#fff",
      position: "absolute", top: 3, left: value ? 23 : 3, transition: "left 0.2s",
    }} />
  </button>
);

/* ── Extra Work Nested Sheet ── */

const ExtraWorkSheet: React.FC<{
  employeeId: string;
  employeeName: string;
  weekStart: string;
  onClose: () => void;
  onDone: () => void;
}> = ({ employeeId, employeeName, weekStart, onClose, onDone }) => {
  const toast = useToast();
  const [catalog, setCatalog] = React.useState<CatalogItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [visible, setVisible] = React.useState(false);
  const [customName, setCustomName] = React.useState("");
  const [customPrice, setCustomPrice] = React.useState("");

  React.useEffect(() => {
    getCatalog().then(setCatalog).catch(() => {}).finally(() => setLoading(false));
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const close = () => { setVisible(false); setTimeout(onClose, 250); };

  const add = async (name: string, price: number, typeId?: string) => {
    haptic("medium");
    setSaving(true);
    try {
      await addExtraPay({ user_id: employeeId, work_type_id: typeId || name, work_name: name, price, date: weekStart });
      onDone();
    } catch (e: any) { toast(e.message, "error"); }
    setSaving(false);
  };

  return (
    <>
      <div onClick={close} style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 300,
        opacity: visible ? 1 : 0, transition: "opacity 0.25s",
      }} />
      <div style={{
        position: "fixed", bottom: 0, left: "50%",
        transform: `translateX(-50%) translateY(${visible ? 0 : 300}px)`,
        width: "100%", maxWidth: 390, maxHeight: "60vh",
        background: "var(--tg-bg)", borderRadius: "16px 16px 0 0", zIndex: 301,
        transition: "transform 0.3s cubic-bezier(0.2, 0, 0, 1)",
        overflowY: "auto", paddingBottom: "env(safe-area-inset-bottom, 16px)",
      }}>
        <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 4px" }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.2)" }} />
        </div>
        <div style={{ padding: "4px 16px 12px" }}>
          <div style={{ fontWeight: 700, fontSize: 17 }}>Допработа</div>
          <div style={{ fontSize: 13, color: "var(--tg-hint)" }}>{employeeName}</div>
        </div>

        {loading ? <div className="loading">...</div> : (
          <div style={{ padding: "0 16px" }}>
            {catalog.map((item) => (
              <button key={item.id} disabled={saving}
                onClick={() => add(item.name, item.price, item.id)}
                style={{
                  display: "flex", justifyContent: "space-between", width: "100%", padding: "12px 0",
                  background: "none", border: "none", borderBottom: "1px solid rgba(255,255,255,0.06)",
                  cursor: "pointer", color: "var(--tg-text)", fontSize: 15, opacity: saving ? 0.4 : 1,
                }}
              >
                <span>{item.name}</span>
                <span style={{ color: "var(--tg-hint)" }}>{item.price} {"\u20BD"}</span>
              </button>
            ))}
            <div style={{ padding: "12px 0" }}>
              <div style={{ fontSize: 13, color: "var(--tg-hint)", marginBottom: 8 }}>Или своя:</div>
              <div style={{ display: "flex", gap: 8 }}>
                <input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="Название"
                  style={inputStyle} />
                <input value={customPrice} onChange={(e) => setCustomPrice(e.target.value)} placeholder={"\u20BD"} type="number"
                  style={{ ...inputStyle, flex: 1 }} />
              </div>
              <button className="btn" disabled={saving || !customName || !customPrice}
                onClick={() => add(customName, Number(customPrice))}
                style={{ marginTop: 8, fontSize: 14 }}>
                {saving ? "..." : "Добавить"}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

const inputStyle: React.CSSProperties = {
  flex: 2, padding: "8px 10px", borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "var(--tg-secondary-bg)", color: "var(--tg-text)", fontSize: 14,
  fontFamily: "inherit",
};
