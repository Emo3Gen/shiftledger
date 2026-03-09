import React from "react";

// ---- Types ----

type Employee = {
  id: string;
  name: string;
  role: string;
  rate_per_hour: number;
  min_hours_per_week: number;
  max_hours_per_week: number;
  is_active: boolean;
  telegram_user_id?: string;
  telegram_username?: string;
  phone?: string;
  auto_schedule?: boolean;
  branch?: string;
  meta?: Record<string, unknown>;
};

type Slot = {
  dow: string;
  slot_name: string;
  from: string;
  to: string;
  user_id: string | null;
  replaced_user_id?: string | null;
  status: string;
  hours: number | null;
  is_problematic?: boolean;
  is_problem?: boolean;
  problem_reason?: string;
  cleaning_user_id?: string;
  cleaning_is_replacement?: boolean;
  cleaning_status?: string;
  cleaning_scheduled?: boolean;
};

type Schedule = {
  week_start?: string;
  slots?: Slot[];
  gaps?: any[];
  conflicts?: any[];
  cleaning_assignments?: any[];
};

type TimesheetEmployee = {
  user_id: string;
  name: string;
  shift_hours: number;
  problem_shifts: number;
  effective_hours: number;
  rate: number;
  shift_pay: number;
  cleaning_count: number;
  cleaning_pay: number;
  extra_classes_count: number;
  extra_classes_total_pay: number;
  inter_branch_hours?: number;
  inter_branch_pay?: number;
  total_pay: number;
  total_before_rounding: number;
};

type Timesheet = {
  week_start: string;
  employees: TimesheetEmployee[];
  totals: { total_pay: number; total_hours: number };
};

type WeekState = {
  state: string;
  hasGaps: boolean;
  hasProblem: boolean;
};

type SettingsMap = Record<string, any>;

type EmployeeFormData = {
  id: string;
  name: string;
  role: string;
  rate_per_hour: number;
  min_hours_per_week: number;
  max_hours_per_week: number;
  telegram_username: string;
  phone: string;
  notes: string;
};

// ---- Constants ----

// Emoji as variables to avoid JSX/SWC parser issues with surrogate pairs
const EMOJI_SWAP = "\uD83D\uDD04";
const EMOJI_WARN = "\uD83D\uDD3A";
const EMOJI_BROOM = "\uD83E\uDDF9";

const DOW_RU: Record<string, string> = {
  mon: "Пн", tue: "Вт", wed: "Ср", thu: "Чт", fri: "Пт", sat: "Сб", sun: "Вс",
};
const DOW_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const STATE_LABELS: Record<string, { label: string; color: string }> = {
  COLLECTING: { label: "Сбор доступности", color: "#007bff" },
  ACTIVE: { label: "График активен", color: "#28a745" },
  CLOSED: { label: "Неделя закрыта", color: "#6c757d" },
};

const EMPTY_FORM: EmployeeFormData = {
  id: "",
  name: "",
  role: "junior",
  rate_per_hour: 280,
  min_hours_per_week: 0,
  max_hours_per_week: 40,
  telegram_username: "",
  phone: "",
  notes: "",
};

// ---- Helpers ----

function getMonday(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff).toISOString().slice(0, 10);
}

function shiftWeek(iso: string, delta: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + 7 * delta);
  return d.toISOString().slice(0, 10);
}

function fmtWeekRange(iso: string): string {
  const start = new Date(iso + "T00:00:00");
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString("ru", { day: "numeric", month: "short" });
  return `${fmt(start)} \u2013 ${fmt(end)}`;
}

function fmtRub(n: number | null | undefined): string {
  if (n == null || n === 0) return "0 \u20BD";
  const s = Math.round(n).toString();
  const parts: string[] = [];
  for (let i = s.length; i > 0; i -= 3) {
    parts.unshift(s.slice(Math.max(0, i - 3), i));
  }
  return parts.join("\u2009") + " \u20BD";
}

// ---- API ----

async function fetchJSON(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    throw new Error(`${url}: expected JSON, got ${ct || "unknown content-type"}`);
  }
  return res.json();
}

async function putJSON(url: string, body: any) {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    throw new Error(`${url}: expected JSON, got ${ct || "unknown content-type"}`);
  }
  return res.json();
}

async function postJSON(url: string, body: any) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    throw new Error(`${url}: expected JSON, got ${ct || "unknown content-type"}`);
  }
  return res.json();
}

// ---- Components ----

// EmployeeFormModal
const EmployeeFormModal: React.FC<{
  initial: EmployeeFormData;
  isEdit: boolean;
  onSave: (data: EmployeeFormData) => Promise<void>;
  onClose: () => void;
}> = ({ initial, isEdit, onSave, onClose }) => {
  const [form, setForm] = React.useState<EmployeeFormData>(initial);
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState("");

  const set = (field: keyof EmployeeFormData, value: string | number) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    if (!form.id.trim() || !form.name.trim()) {
      setErr("ID и Имя обязательны");
      return;
    }
    setSaving(true);
    setErr("");
    try {
      await onSave(form);
    } catch (e: any) {
      setErr(e.message || "Ошибка сохранения");
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex",
      alignItems: "center", justifyContent: "center", zIndex: 1000,
    }} onClick={onClose}>
      <div style={{
        background: "#fff", borderRadius: 10, padding: 24, width: 420, maxWidth: "90vw",
        maxHeight: "90vh", overflowY: "auto", boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
      }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 16px" }}>{isEdit ? "Редактировать сотрудника" : "Новый сотрудник"}</h3>

        {err && <div style={{ padding: 8, background: "#ffebee", color: "#c62828", borderRadius: 4, marginBottom: 12, fontSize: 13 }}>{err}</div>}

        <label style={formLabelStyle}>ID</label>
        <input style={formInputStyle} value={form.id} disabled={isEdit}
          onChange={(e) => set("id", e.target.value)} placeholder="u5" />

        <label style={formLabelStyle}>Имя</label>
        <input style={formInputStyle} value={form.name}
          onChange={(e) => set("name", e.target.value)} placeholder="Анна Петрова" />

        <label style={formLabelStyle}>Роль</label>
        <select style={formInputStyle} value={form.role}
          onChange={(e) => set("role", e.target.value)}>
          <option value="junior">Junior</option>
          <option value="senior">Senior</option>
          <option value="staff">Staff</option>
        </select>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={formLabelStyle}>Ставка/час (\u20BD)</label>
            <input style={formInputStyle} type="number" value={form.rate_per_hour}
              onChange={(e) => set("rate_per_hour", Number(e.target.value))} />
          </div>
          <div>
            <label style={formLabelStyle}>Мин. часов/нед</label>
            <input style={formInputStyle} type="number" value={form.min_hours_per_week}
              onChange={(e) => set("min_hours_per_week", Number(e.target.value))} />
          </div>
        </div>

        <label style={formLabelStyle}>Telegram username</label>
        <input style={formInputStyle} value={form.telegram_username}
          onChange={(e) => set("telegram_username", e.target.value)} placeholder="@username" />

        <label style={formLabelStyle}>Телефон</label>
        <input style={formInputStyle} value={form.phone}
          onChange={(e) => set("phone", e.target.value)} placeholder="+7 900 123-45-67" />

        <label style={formLabelStyle}>Заметки</label>
        <textarea style={{ ...formInputStyle, height: 60, resize: "vertical" }} value={form.notes}
          onChange={(e) => set("notes", e.target.value)} placeholder="Любые заметки..." />

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button onClick={handleSave} disabled={saving} style={btnStyle("#007bff")}>
            {saving ? "Сохранение..." : "Сохранить"}
          </button>
          <button onClick={onClose} style={{ ...btnStyle("#6c757d"), background: "#e9ecef", color: "#333" }}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
};

const formLabelStyle: React.CSSProperties = { display: "block", fontSize: 12, color: "#666", marginBottom: 2, marginTop: 10 };
const formInputStyle: React.CSSProperties = { width: "100%", padding: "6px 10px", border: "1px solid #ccc", borderRadius: 4, fontSize: 14, boxSizing: "border-box" };

// LiveScheduleGrid
const LiveScheduleGrid: React.FC<{ schedule: Schedule | null; employees: Employee[] }> = ({ schedule, employees }) => {
  if (!schedule?.slots || schedule.slots.length === 0) {
    return <div style={{ padding: 16, color: "#999" }}>Расписание пусто</div>;
  }

  const empMap = new Map(employees.map((e) => [e.id, e.name]));
  const getName = (uid: string | null) => (uid ? empMap.get(uid) || uid : "\u2014");

  const slotNames = [...new Set(schedule.slots.map((s) => s.slot_name).filter(Boolean))];
  const activeDays = DOW_ORDER.filter((d) => schedule.slots!.some((s) => s.dow === d));

  // Cleaning lookup — only show broom when cleaning is actually scheduled (not NOT_SCHEDULED)
  const cleaningByDow: Record<string, string> = {};
  for (const slot of schedule.slots) {
    if (slot.cleaning_user_id && slot.slot_name === "Вечер" && slot.cleaning_status && slot.cleaning_status !== "NOT_SCHEDULED") {
      cleaningByDow[slot.dow] = slot.cleaning_user_id;
    }
  }

  const cellPad: React.CSSProperties = { padding: "3px 6px", whiteSpace: "nowrap" };
  const thPad: React.CSSProperties = { ...cellPad, textAlign: "left", borderBottom: "2px solid #dee2e6", fontWeight: 600 };

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "#f8f9fa" }}>
            <th style={thPad}>День</th>
            {slotNames.map((sn) => (
              <th key={sn} style={thPad}>{sn}</th>
            ))}
            <th style={thPad}>Уборка</th>
          </tr>
        </thead>
        <tbody>
          {activeDays.map((dow) => (
            <tr key={dow} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ ...cellPad, fontWeight: 600 }}>{DOW_RU[dow]}</td>
              {slotNames.map((sn) => {
                const slot = schedule.slots!.find((s) => s.dow === dow && s.slot_name === sn);
                const uid = slot?.user_id ?? null;
                const name = getName(uid);
                const isReplacement = !!slot?.replaced_user_id;
                const isProblem = slot?.is_problematic || slot?.is_problem;

                let bg = uid ? "#e8f5e9" : "#fff3e0";
                if (isProblem) bg = "#ffebee";
                if (isReplacement) bg = "#e3f2fd";

                return (
                  <td key={sn} style={{ ...cellPad, background: bg }}>
                    {isReplacement && `${EMOJI_SWAP} `}
                    {isProblem && `${EMOJI_WARN} `}
                    {name}
                    {isReplacement && slot?.replaced_user_id && (
                      <span style={{ fontSize: 11, color: "#666" }}> (за {getName(slot.replaced_user_id)})</span>
                    )}
                  </td>
                );
              })}
              <td style={cellPad}>
                {cleaningByDow[dow] ? (
                  <span>{EMOJI_BROOM} {getName(cleaningByDow[dow])}</span>
                ) : "\u2014"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// PayrollTable
const PayrollTable: React.FC<{ timesheet: Timesheet | null; employees: Employee[] }> = ({ timesheet }) => {
  const [expandedIdx, setExpandedIdx] = React.useState<number | null>(null);

  if (!timesheet?.employees?.length) {
    return <div style={{ padding: 16, color: "#999" }}>Нет данных по зарплате</div>;
  }

  return (
    <table style={{ borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ background: "#f8f9fa" }}>
          <th style={thStyle}>Сотрудник</th>
          <th style={thStyle}>Часы</th>
          <th style={thStyle}>Смены</th>
          <th style={thStyle}>Уборки</th>
          <th style={thStyle}>Доп.</th>
          {timesheet.employees.some((e) => (e.inter_branch_hours || 0) > 0) && <th style={thStyle}>Допч.</th>}
          <th style={thStyle}>Итого</th>
        </tr>
      </thead>
      <tbody>
        {timesheet.employees.map((emp, idx) => {
          const showInterBranch = timesheet.employees.some((e) => (e.inter_branch_hours || 0) > 0);
          return (
          <React.Fragment key={emp.user_id}>
            <tr
              onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
              style={{ cursor: "pointer", borderBottom: "1px solid #eee" }}
            >
              <td style={tdStyle}>{emp.name}</td>
              <td style={tdStyle}>{emp.effective_hours}ч</td>
              <td style={tdStyle}>{fmtRub(emp.shift_pay)}</td>
              <td style={tdStyle}>{emp.cleaning_count > 0 ? fmtRub(emp.cleaning_pay) : "\u2014"}</td>
              <td style={tdStyle}>{emp.extra_classes_count > 0 ? fmtRub(emp.extra_classes_total_pay) : "\u2014"}</td>
              {showInterBranch && <td style={tdStyle}>{(emp.inter_branch_hours || 0) > 0 ? `${emp.inter_branch_hours}ч` : "\u2014"}</td>}
              <td style={{ ...tdStyle, fontWeight: 600 }}>{fmtRub(emp.total_pay)}</td>
            </tr>
            {expandedIdx === idx && (
              <tr>
                <td colSpan={showInterBranch ? 7 : 6} style={{ padding: "8px 16px", background: "#f8f9fa", fontSize: 13 }}>
                  <div>Всего часов: {emp.shift_hours} | Эфф.: {emp.effective_hours} | Ставка: {emp.rate} \u20BD/ч</div>
                  {emp.problem_shifts > 0 && <div style={{ color: "#d32f2f" }}>Проблемных смен: {emp.problem_shifts}</div>}
                  {(emp.inter_branch_hours || 0) > 0 && <div>Межфилиал: {emp.inter_branch_hours}ч = {fmtRub(emp.inter_branch_pay || 0)}</div>}
                  {emp.total_before_rounding !== emp.total_pay && (
                    <div>До округления: {fmtRub(emp.total_before_rounding)}</div>
                  )}
                </td>
              </tr>
            )}
          </React.Fragment>
          );
        })}
        <tr style={{ background: "#e8f5e9", fontWeight: 700 }}>
          <td style={tdStyle}>Итого</td>
          <td style={tdStyle}>{timesheet.totals.total_hours}ч</td>
          <td colSpan={timesheet.employees.some((e) => (e.inter_branch_hours || 0) > 0) ? 4 : 3} />
          <td style={tdStyle}>{fmtRub(timesheet.totals.total_pay)}</td>
        </tr>
      </tbody>
    </table>
  );
};

const thStyle: React.CSSProperties = { padding: "3px 6px", textAlign: "left", borderBottom: "2px solid #dee2e6", whiteSpace: "nowrap" };
const tdStyle: React.CSSProperties = { padding: "3px 6px", whiteSpace: "nowrap" };

// ControlButtons
const ControlButtons: React.FC<{
  weekState: WeekState | null;
  weekStart: string;
  chatId: string;
  userId: string;
  onAction: () => void;
  onToast: (text: string, type: "ok" | "err") => void;
}> = ({ weekState, weekStart, chatId, userId, onAction, onToast }) => {
  const [busy, setBusy] = React.useState<string | null>(null);

  const doAction = async (text: string, label: string) => {
    console.log(`[ControlButtons] ${label}: sending "${text}" to chat=${chatId}`);
    setBusy(label);
    try {
      await postJSON("/debug/send", { chat_id: chatId, user_id: userId, text });
      console.log(`[ControlButtons] ${label}: success`);
      await onAction();
      onToast(`${label} \u2014 готово`, "ok");
    } catch (e: any) {
      console.error(`[ControlButtons] ${label}: error`, e);
      onToast(`${label}: ${e.message}`, "err");
    }
    setBusy(null);
  };

  const doBuildSchedule = async () => {
    console.log(`[ControlButtons] Собрать график: chat=${chatId}, week=${weekStart}`);
    setBusy("Собрать график");
    try {
      await postJSON("/debug/build-schedule", { chat_id: chatId, user_id: userId, week_start: weekStart });
      console.log("[ControlButtons] Собрать график: success");
      await onAction();
      onToast("График собран", "ok");
    } catch (e: any) {
      console.error("[ControlButtons] Собрать график: error", e);
      onToast(`Сборка графика: ${e.message}`, "err");
    }
    setBusy(null);
  };

  const state = weekState?.state || "COLLECTING";
  const d1 = !!busy || state !== "CLOSED";
  const d2 = !!busy || state !== "COLLECTING";
  const d3 = !!busy || state !== "ACTIVE";

  // Hints explaining why each button is disabled
  const hint1 = !d1 ? "" : state === "COLLECTING" ? "Сбор уже идёт" : state === "ACTIVE" ? "Неделя уже активна" : "";
  const hint2 = !d2 ? "" : state === "ACTIVE" ? "График уже собран" : state === "CLOSED" ? "Сначала откройте неделю" : "";
  const hint3 = !d3 ? "" : state === "COLLECTING" ? "Сначала соберите график" : state === "CLOSED" ? "Неделя уже закрыта" : "";

  const btnWithHint = (
    label: string,
    busyLabel: string,
    color: string,
    disabled: boolean,
    hint: string,
    onClick: () => void,
  ) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <button onClick={onClick} disabled={disabled} style={btnStyle(color, disabled)} className="dp-btn">
        {busy === label ? busyLabel : label}
      </button>
      {disabled && hint && (
        <span style={{ fontSize: 11, color: "#999", marginTop: 3 }}>{hint}</span>
      )}
    </div>
  );

  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
      {btnWithHint("Начать сбор", "Загрузка...", "#007bff", d1, hint1, () => doAction(`OPEN_WEEK ${weekStart}`, "Начать сбор"))}
      {btnWithHint("Собрать график", "Загрузка...", "#28a745", d2, hint2, doBuildSchedule)}
      {btnWithHint("Закрыть неделю", "Загрузка...", "#6c757d", d3, hint3, () => doAction(`LOCK ${weekStart}`, "Закрыть неделю"))}
    </div>
  );
};

function btnStyle(color: string, disabled = false): React.CSSProperties {
  return {
    padding: "5px 10px",
    background: disabled ? "#adb5bd" : color,
    color: "#fff",
    border: "none",
    borderRadius: 4,
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 13,
    fontWeight: 500,
    opacity: disabled ? 0.6 : 1,
    transition: "all 0.15s ease",
  };
}

// StaffChat — messenger-style chat feed + send form
const StaffChat: React.FC<{
  events: any[];
  employees: Employee[];
  chatId: string;
  onSend: () => void;
  onToast: (text: string, type: "ok" | "err") => void;
}> = ({ events, employees, chatId, onSend, onToast }) => {
  const [selectedUser, setSelectedUser] = React.useState(employees[0]?.id || "u1");
  const [msgText, setMsgText] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const feedRef = React.useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when events change
  React.useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [events]);

  const empMap = new Map(employees.map((e) => [e.id, e.name]));
  const getName = (uid: string) => empMap.get(uid) || uid;

  // Classify event for color-coding
  const classifyEvent = (ev: any): { bg: string; label: string } => {
    const text = (ev.text || "").toLowerCase();
    const uid = ev.user_id || "";
    if (uid === "admin1" || uid === "owner1" || uid === "senior1") {
      return { bg: "#f5f5f5", label: "" };
    }
    if (text.startsWith("open_week") || text.startsWith("lock") || text.startsWith("propose") || text.startsWith("build")) {
      return { bg: "#f5f5f5", label: "" };
    }
    if (text.includes("уборк") || text.startsWith("cleaning")) {
      return { bg: "#e0f7fa", label: "" };
    }
    if (text.includes("подмен") || text.includes("замен") || text.includes("смогу")) {
      return { bg: "#fff3e0", label: "" };
    }
    if (text.includes("доп") || text.startsWith("extra")) {
      return { bg: "#e0f7fa", label: "" };
    }
    if (text.includes("могу") || text.includes("свобод") || text.startsWith("avail")) {
      return { bg: "#e8f5e9", label: "" };
    }
    if (text.includes("не могу")) {
      return { bg: "#fff3e0", label: "" };
    }
    return { bg: "transparent", label: "" };
  };

  const handleSend = async () => {
    if (!msgText.trim()) return;
    setSending(true);
    try {
      await postJSON("/debug/send", {
        chat_id: chatId,
        user_id: selectedUser,
        text: msgText.trim(),
      });
      setMsgText("");
      await onSend();
    } catch (e: any) {
      onToast(`Ошибка отправки: ${e.message}`, "err");
    }
    setSending(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Show events in chronological order (oldest first), limit to 50
  const displayed = [...events].reverse().slice(-50);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Chat feed */}
      <div
        ref={feedRef}
        style={{
          flex: 1, overflowY: "auto", padding: "4px 8px",
          background: "#fafafa", fontSize: 13,
        }}
      >
        {displayed.length === 0 && (
          <div style={{ color: "#999", padding: 12, textAlign: "center", fontSize: 12 }}>
            Нет сообщений. Отправьте первое от имени сотрудника.
          </div>
        )}
        {displayed.map((ev, i) => {
          const uid = ev.user_id || "";
          const isSystem = uid === "admin1" || uid === "owner1" ||
            (ev.text || "").startsWith("OPEN_WEEK") || (ev.text || "").startsWith("LOCK") ||
            (ev.text || "").startsWith("PROPOSE") || (ev.text || "").startsWith("BUILD");
          const { bg } = classifyEvent(ev);
          const time = ev.received_at ? new Date(ev.received_at).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" }) : "";

          if (isSystem) {
            return (
              <div key={ev.id || i} style={{ padding: "1px 0", textAlign: "center" }}>
                <span style={{ fontSize: 10, color: "#999", background: "#eee", padding: "1px 6px", borderRadius: 6 }}>
                  {time} {getName(uid)}: {(ev.text || "").slice(0, 80)}
                </span>
              </div>
            );
          }

          return (
            <div key={ev.id || i} style={{
              padding: "2px 6px", margin: "1px 0", borderRadius: 4,
              background: bg, borderLeft: `3px solid ${bg === "#e8f5e9" ? "#4caf50" : bg === "#fff3e0" ? "#ff9800" : bg === "#e0f7fa" ? "#00bcd4" : "#ddd"}`,
            }}>
              <span style={{ color: "#999", marginRight: 4, fontSize: 10 }}>{time}</span>
              <strong style={{ color: "#333", fontSize: 12 }}>{getName(uid)}</strong>
              <span style={{ color: "#555", marginLeft: 4, fontSize: 12 }}>{(ev.text || "").slice(0, 120)}</span>
            </div>
          );
        })}
      </div>

      {/* Send form — single compact line */}
      <div style={{
        padding: "4px 8px", borderTop: "1px solid #eee",
        display: "flex", gap: 4, alignItems: "center", background: "#fff",
      }}>
        <select
          value={selectedUser}
          onChange={(e) => setSelectedUser(e.target.value)}
          style={{
            padding: "3px 4px", border: "1px solid #ccc", borderRadius: 3,
            fontSize: 12, minWidth: 80, background: "#fff",
          }}
        >
          {employees.filter((e) => e.role !== "admin" && e.role !== "owner").map((emp) => (
            <option key={emp.id} value={emp.id}>{emp.name}</option>
          ))}
        </select>
        <input
          value={msgText}
          onChange={(e) => setMsgText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="могу пн утро, вт вечер..."
          disabled={sending}
          style={{
            flex: 1, padding: "3px 6px", border: "1px solid #ccc",
            borderRadius: 3, fontSize: 12, minWidth: 0,
          }}
        />
        <button
          onClick={handleSend}
          disabled={sending || !msgText.trim()}
          style={{ ...btnStyle("#007bff", sending || !msgText.trim()), padding: "3px 8px", fontSize: 12 }}
          className="dp-btn"
          title="Отправить"
        >
          {"\u2192"}
        </button>
      </div>
      <div style={{ padding: "0 8px 3px", fontSize: 10, color: "#bbb" }}>
        могу пн утро | не могу чт вечер | уборка вт | доп ср 10 детей
      </div>
    </div>
  );
};

// SettingsPanel
const SettingsPanel: React.FC<{
  settings: SettingsMap;
  employees: Employee[];
  onSettingChange: (key: string, value: any) => void;
  onEmployeeChange: (id: string, field: string, value: any) => void;
  onAddEmployee: () => void;
  onEditEmployee: (emp: Employee) => void;
}> = ({ settings, employees, onSettingChange, onEmployeeChange, onAddEmployee, onEditEmployee }) => {
  const [tab, setTab] = React.useState<"shifts" | "employees" | "rates">("shifts");

  const tabBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: "6px 16px",
    background: active ? "#007bff" : "#e9ecef",
    color: active ? "#fff" : "#333",
    border: "none",
    borderRadius: "6px 6px 0 0",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: active ? 600 : 400,
  });

  return (
    <div>
      <div style={{ display: "flex", gap: 2, marginBottom: 0 }}>
        <button style={tabBtnStyle(tab === "shifts")} onClick={() => setTab("shifts")}>Смены</button>
        <button style={tabBtnStyle(tab === "employees")} onClick={() => setTab("employees")}>Сотрудники</button>
        <button style={tabBtnStyle(tab === "rates")} onClick={() => setTab("rates")}>Ставки</button>
      </div>

      <div style={{ border: "1px solid #dee2e6", borderRadius: "0 6px 6px 6px", padding: 12 }}>
        {tab === "shifts" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {["morning", "evening"].map((period) => (
              <div key={period} style={{ background: "#f8f9fa", padding: 12, borderRadius: 6 }}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>{settings[`shifts.${period}.name`] || period}</div>
                <label style={labelStyle}>Начало</label>
                <input
                  style={inputStyle}
                  value={settings[`shifts.${period}.from`] || ""}
                  onChange={(e) => onSettingChange(`shifts.${period}.from`, e.target.value)}
                />
                <label style={labelStyle}>Конец</label>
                <input
                  style={inputStyle}
                  value={settings[`shifts.${period}.to`] || ""}
                  onChange={(e) => onSettingChange(`shifts.${period}.to`, e.target.value)}
                />
              </div>
            ))}
          </div>
        )}

        {tab === "employees" && (
          <div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
              <button onClick={onAddEmployee} style={btnStyle("#28a745")}>+ Добавить сотрудника</button>
            </div>
            {employees.length === 0 ? (
              <div style={{ padding: 16, color: "#999", textAlign: "center" }}>
                Нет сотрудников. Нажмите «+ Добавить сотрудника», чтобы создать первого.
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={thStyle}>ID</th>
                    <th style={thStyle}>Имя</th>
                    <th style={thStyle}>Роль</th>
                    <th style={thStyle}>Ставка</th>
                    <th style={thStyle}>Мин.ч</th>
                    <th style={thStyle}>Telegram</th>
                    <th style={thStyle}>Тел.</th>
                    <th style={{ ...thStyle, textAlign: "center" }}>Авто</th>
                    <th style={thStyle}>Филиал</th>
                    <th style={{ ...thStyle, width: 40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((emp) => (
                    <tr key={emp.id} style={{ borderBottom: "1px solid #eee" }}>
                      <td style={tdStyle}>{emp.id}</td>
                      <td style={tdStyle}>
                        <input
                          style={{ ...inputStyle, width: "100%" }}
                          value={emp.name}
                          onChange={(e) => onEmployeeChange(emp.id, "name", e.target.value)}
                        />
                      </td>
                      <td style={tdStyle}>{emp.role}</td>
                      <td style={tdStyle}>
                        <input
                          style={{ ...inputStyle, width: 60 }}
                          type="number"
                          value={emp.rate_per_hour}
                          onChange={(e) => onEmployeeChange(emp.id, "rate_per_hour", Number(e.target.value))}
                        />
                      </td>
                      <td style={tdStyle}>
                        <input
                          style={{ ...inputStyle, width: 50 }}
                          type="number"
                          value={emp.min_hours_per_week}
                          onChange={(e) => onEmployeeChange(emp.id, "min_hours_per_week", Number(e.target.value))}
                        />
                      </td>
                      <td style={tdStyle}>
                        {emp.telegram_username ? `@${emp.telegram_username}` : emp.telegram_user_id || "\u2014"}
                      </td>
                      <td style={tdStyle}>
                        {emp.phone || "\u2014"}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={emp.auto_schedule !== false}
                          onChange={(e) => onEmployeeChange(emp.id, "auto_schedule", e.target.checked)}
                        />
                      </td>
                      <td style={tdStyle}>
                        <select
                          style={{ ...inputStyle, width: 120 }}
                          value={emp.branch || "Архангельск"}
                          onChange={(e) => onEmployeeChange(emp.id, "branch", e.target.value)}
                        >
                          {(settings.branches || ["Архангельск", "Северодвинск"]).map((b: string) => (
                            <option key={b} value={b}>{b}</option>
                          ))}
                        </select>
                      </td>
                      <td style={tdStyle}>
                        <button
                          onClick={() => onEditEmployee(emp)}
                          style={{
                            padding: "3px 8px", background: "#e9ecef", border: "1px solid #ced4da",
                            borderRadius: 4, cursor: "pointer", fontSize: 12,
                          }}
                        >
                          Ред.
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === "rates" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {[
              { key: "pay.default_rate", label: "Ставка по умолч. (\u20BD/ч)" },
              { key: "pay.cleaning_rate", label: "Уборка (\u20BD)" },
              { key: "pay.extra_class_base", label: "Доп.занятие база (\u20BD)" },
              { key: "pay.extra_class_threshold", label: "Порог детей" },
              { key: "pay.extra_class_per_kid", label: "За ребёнка сверх (\u20BD)" },
              { key: "pay.rounding_step", label: "Округление (\u20BD)" },
              { key: "pay.inter_branch_extra_hours", label: "Допч. межфилиал" },
            ].map(({ key, label }) => (
              <div key={key}>
                <label style={labelStyle}>{label}</label>
                <input
                  style={inputStyle}
                  type="number"
                  value={settings[key] ?? ""}
                  onChange={(e) => onSettingChange(key, Number(e.target.value))}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const labelStyle: React.CSSProperties = { display: "block", fontSize: 12, color: "#666", marginBottom: 2, marginTop: 6 };
const navBtnStyle: React.CSSProperties = {
  padding: "6px 14px", background: "#e9ecef", border: "1px solid #ced4da",
  borderRadius: 6, cursor: "pointer", fontSize: 16, fontWeight: 600, lineHeight: 1,
};
const inputStyle: React.CSSProperties = { padding: "4px 8px", border: "1px solid #ccc", borderRadius: 4, fontSize: 13 };

// FeedbackButton
const FeedbackButton: React.FC = () => {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState("");
  const [sent, setSent] = React.useState(false);

  const send = () => {
    const existing = JSON.parse(localStorage.getItem("director_feedback") || "[]");
    existing.push({ text, ts: new Date().toISOString() });
    localStorage.setItem("director_feedback", JSON.stringify(existing));
    setSent(true);
    setTimeout(() => { setSent(false); setOpen(false); setText(""); }, 2000);
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{ ...btnStyle("#6c757d"), position: "fixed", bottom: 20, right: 20 }}>
        Обратная связь
      </button>
    );
  }

  return (
    <div style={{
      position: "fixed", bottom: 20, right: 20, width: 320, background: "#fff",
      border: "1px solid #dee2e6", borderRadius: 8, padding: 16, boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
    }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Обратная связь</div>
      <textarea
        style={{ width: "100%", height: 80, padding: 8, border: "1px solid #ccc", borderRadius: 4, fontSize: 13, resize: "vertical" }}
        placeholder="Что улучшить? Что не работает?"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button onClick={send} disabled={!text.trim()} style={btnStyle("#007bff")}>
          {sent ? "Отправлено!" : "Отправить"}
        </button>
        <button onClick={() => setOpen(false)} style={{ ...btnStyle("#6c757d"), background: "#e9ecef", color: "#333" }}>
          Закрыть
        </button>
      </div>
    </div>
  );
};

// WorkflowGuide (collapsible help)
const WorkflowGuide: React.FC = () => {
  const [open, setOpen] = React.useState(false);

  return (
    <div style={{
      marginBottom: 12, border: "1px solid #dee2e6", borderRadius: 6,
      background: open ? "#f8f9fa" : "transparent",
    }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%", padding: "8px 12px", background: "none", border: "none",
          cursor: "pointer", textAlign: "left", fontSize: 13, color: "#666",
          display: "flex", alignItems: "center", gap: 6,
        }}
      >
        <span style={{ fontSize: 11 }}>{open ? "\u25BC" : "\u25B6"}</span>
        Как работать с панелью?
      </button>
      {open && (
        <div style={{ padding: "0 12px 12px", fontSize: 13, lineHeight: 1.6 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Цикл недели:</div>
          <div style={{ marginBottom: 4 }}>
            <strong>1. Начать сбор</strong> {"\u2014"} открывает новую неделю.
            Бот начинает спрашивать сотрудников о доступности (кто когда может работать).
          </div>
          <div style={{ marginBottom: 4 }}>
            <strong>2. Собрать график</strong> {"\u2014"} после сбора ответов формирует
            расписание автоматически (распределяет смены по доступности и минимальным часам).
          </div>
          <div style={{ marginBottom: 8 }}>
            <strong>3. Закрыть неделю</strong> {"\u2014"} фиксирует график и рассчитывает
            зарплаты (смены + уборки + доп.занятия).
          </div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Панель:</div>
          <div style={{ marginBottom: 4 }}>
            <strong>Живой график</strong> (справа) {"\u2014"} расписание в реальном времени.
            Цвета: зелёный = назначен, оранжевый = пусто, синий = замена, красный = проблема.
          </div>
          <div style={{ marginBottom: 4 }}>
            <strong>Зарплаты</strong> {"\u2014"} табель и расчёт за неделю.
            Клик по строке {"\u2014"} детали (ставка, проблемные смены, округление).
          </div>
          <div>
            <strong>Настройки</strong> {"\u2014"} Смены (время начала/конца), Сотрудники
            (добавить/редактировать), Ставки (оплата за час, уборку, доп.занятия).
          </div>
        </div>
      )}
    </div>
  );
};

// DebugToolbar — reset week + load test data
const DebugToolbar: React.FC<{
  weekStart: string;
  chatId: string;
  onAction: () => void;
  onToast: (text: string, type: "ok" | "err") => void;
}> = ({ weekStart, chatId, onAction, onToast }) => {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [confirmReset, setConfirmReset] = React.useState(false);

  const handleReset = async () => {
    setBusy("reset");
    try {
      await postJSON("/debug/reset-week", { chat_id: chatId, week_start: weekStart });
      onToast("Неделя сброшена", "ok");
      setConfirmReset(false);
      await onAction();
    } catch (e: any) {
      onToast(`Ошибка сброса: ${e.message}`, "err");
    }
    setBusy(null);
  };

  const handleLoadSeed = async () => {
    setBusy("seed");
    try {
      await postJSON("/debug/seed", { week_start: weekStart, force: true });
      onToast("Тестовые данные загружены", "ok");
      await onAction();
    } catch (e: any) {
      onToast(`Ошибка загрузки: ${e.message}`, "err");
    }
    setBusy(null);
  };

  return (
    <div style={{ marginBottom: 16, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      {!confirmReset ? (
        <button
          onClick={() => setConfirmReset(true)}
          disabled={!!busy}
          style={{
            padding: "5px 12px", fontSize: 12, background: "#fff", color: "#dc3545",
            border: "1px solid #dc3545", borderRadius: 4, cursor: busy ? "not-allowed" : "pointer",
            opacity: busy ? 0.5 : 1,
          }}
        >
          Сбросить неделю
        </button>
      ) : (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "#dc3545" }}>
            Удалить все данные за {weekStart}?
          </span>
          <button
            onClick={handleReset}
            disabled={!!busy}
            style={{
              padding: "4px 10px", fontSize: 12, background: "#dc3545", color: "#fff",
              border: "none", borderRadius: 4, cursor: "pointer",
            }}
          >
            {busy === "reset" ? "Удаление..." : "Да, удалить"}
          </button>
          <button
            onClick={() => setConfirmReset(false)}
            disabled={!!busy}
            style={{
              padding: "4px 10px", fontSize: 12, background: "#e9ecef", color: "#333",
              border: "none", borderRadius: 4, cursor: "pointer",
            }}
          >
            Отмена
          </button>
        </div>
      )}
      <button
        onClick={handleLoadSeed}
        disabled={!!busy}
        style={{
          padding: "5px 12px", fontSize: 12, background: "#fff", color: "#17a2b8",
          border: "1px solid #17a2b8", borderRadius: 4, cursor: busy ? "not-allowed" : "pointer",
          opacity: busy ? 0.5 : 1,
        }}
      >
        {busy === "seed" ? "Загрузка..." : "Загрузить тестовый сценарий"}
      </button>
    </div>
  );
};

// ---- Main DirectorPanel ----

export const DirectorPanel: React.FC = () => {
  const userId = "admin1";

  const [chatId, setChatId] = React.useState<string>("dev_seed_chat");
  const [weekStart, setWeekStart] = React.useState<string>(getMonday());
  const [availableWeeks, setAvailableWeeks] = React.useState<string[]>([]);
  const [schedule, setSchedule] = React.useState<Schedule | null>(null);
  const [timesheet, setTimesheet] = React.useState<Timesheet | null>(null);
  const [weekState, setWeekState] = React.useState<WeekState | null>(null);
  const [employees, setEmployees] = React.useState<Employee[]>([]);
  const [settings, setSettings] = React.useState<SettingsMap>({});
  const [events, setEvents] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [showWelcome, setShowWelcome] = React.useState(false);
  const [seedingInProgress, setSeedingInProgress] = React.useState(false);
  const [activeSection, setActiveSection] = React.useState<"payroll" | "settings">("payroll");
  const [toast, setToast] = React.useState<{ text: string; type: "ok" | "err" } | null>(null);

  // Employee form modal state
  const [empFormOpen, setEmpFormOpen] = React.useState(false);
  const [empFormEdit, setEmpFormEdit] = React.useState(false);
  const [empFormData, setEmpFormData] = React.useState<EmployeeFormData>(EMPTY_FORM);

  // Mobile view toggle
  const [mobileView, setMobileView] = React.useState<"left" | "right">("left");

  // Resizable columns
  const [colSplit, setColSplit] = React.useState<number>(() => {
    const saved = localStorage.getItem("dp_col_split");
    return saved ? Number(saved) : 35;
  });
  const draggingRef = React.useRef(false);

  React.useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const pct = (e.clientX / window.innerWidth) * 100;
      const clamped = Math.max(20, Math.min(70, pct));
      setColSplit(clamped);
    };
    const onMouseUp = () => {
      if (draggingRef.current) {
        draggingRef.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        localStorage.setItem("dp_col_split", String(colSplit));
      }
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [colSplit]);

  const startDrag = () => {
    draggingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  // Debounced save for settings
  const settingSaveTimers = React.useRef<Record<string, NodeJS.Timeout>>({});
  // Debounced save for employees
  const empSaveTimers = React.useRef<Record<string, NodeJS.Timeout>>({});
  // Stable ref for chatId so callbacks always have the latest value
  const chatIdRef = React.useRef(chatId);
  chatIdRef.current = chatId;

  const showToast = (text: string, type: "ok" | "err" = "ok") => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 3000);
  };

  const loadWeekData = React.useCallback(async (ws: string, cid: string) => {
    console.log(`[DirectorPanel] loadWeekData: chat=${cid}, week=${ws}`);
    const errors: string[] = [];

    const [schedRes, wsRes, tsRes, empRes, settRes, evRes] = await Promise.all([
      fetchJSON(`/debug/schedule?chat_id=${cid}&week_start=${ws}`).catch((e) => { errors.push(`Расписание: ${e.message}`); return null; }),
      fetchJSON(`/debug/week_state?chat_id=${cid}&week_start=${ws}`).catch((e) => { errors.push(`Статус недели: ${e.message}`); return null; }),
      fetchJSON(`/debug/timesheet?chat_id=${cid}&week_start=${ws}`).catch((e) => { errors.push(`Зарплаты: ${e.message}`); return null; }),
      fetchJSON("/api/employees").catch((e) => { errors.push(`Сотрудники: ${e.message}`); return null; }),
      fetchJSON("/api/settings?tenant_id=dev").catch((e) => { errors.push(`Настройки: ${e.message}`); return null; }),
      fetchJSON(`/events?chat_id=${cid}&limit=50`).catch((e) => { errors.push(`События: ${e.message}`); return null; }),
    ]);

    console.log(`[DirectorPanel] loaded: slots=${schedRes?.slots?.length ?? 0}, assigned=${schedRes?.slots?.filter((s: any) => s.user_id).length ?? 0}`);

    if (schedRes) setSchedule(schedRes);
    if (wsRes?.week_state) setWeekState(wsRes.week_state);
    if (tsRes?.timesheet) setTimesheet(tsRes.timesheet);
    setEmployees(empRes?.employees || []);
    setSettings(settRes?.settings || {});
    setEvents(evRes?.events || []);

    setError(errors.length > 0 ? errors.join("; ") : "");
    setLoading(false);
  }, []);

  // Single mount effect: discover chat_id, best week, load data ONCE
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      // Step 1: find the active chat_id
      let activeChatId = "dev_seed_chat";
      try {
        const seedWeeks = await fetchJSON("/debug/weeks?chat_id=dev_seed_chat").catch(() => null);
        if (!seedWeeks?.weeks?.length) {
          const dialogsRes = await fetchJSON("/debug/dialogs?tenant_id=emu").catch(() => null);
          const dialogs: Array<{ chat_id: string }> = dialogsRes?.dialogs || [];
          if (dialogs.length > 0) {
            activeChatId = dialogs[0].chat_id;
          }
        }
      } catch {
        // fallback
      }

      // Step 2: find available weeks
      let weeks: string[] = [];
      try {
        const weeksRes = await fetchJSON(`/debug/weeks?chat_id=${activeChatId}`).catch(() => null);
        weeks = weeksRes?.weeks || [];
      } catch {
        // ignore
      }

      const today = getMonday();
      const bestWeek = weeks.length > 0 ? (weeks.includes(today) ? today : weeks[0]) : today;

      if (cancelled) return;

      // No data found at all — show welcome screen
      if (weeks.length === 0) {
        setShowWelcome(true);
        setLoading(false);
        return;
      }

      // Set all state at once, then load data exactly once
      setChatId(activeChatId);
      chatIdRef.current = activeChatId;
      setWeekStart(bestWeek);
      setAvailableWeeks(weeks);
      console.log(`[DirectorPanel] init: chat=${activeChatId}, week=${bestWeek}, available=${weeks.join(",")}`);
      await loadWeekData(bestWeek, activeChatId);
    })();
    return () => { cancelled = true; };
  }, [loadWeekData]);

  // Auto-refresh every 10s (uses refs for stable values)
  React.useEffect(() => {
    const interval = setInterval(() => {
      loadWeekData(weekStart, chatIdRef.current);
    }, 10000);
    return () => clearInterval(interval);
  }, [weekStart, loadWeekData]);

  // Week navigation: load data immediately with the new week
  const goWeek = (delta: number) => {
    setWeekStart((ws) => {
      const next = shiftWeek(ws, delta);
      setLoading(true);
      loadWeekData(next, chatIdRef.current);
      return next;
    });
  };

  const goToday = () => {
    const today = getMonday();
    setWeekStart(today);
    setLoading(true);
    loadWeekData(today, chatIdRef.current);
  };

  // Reload helper for buttons
  const reload = () => loadWeekData(weekStart, chatIdRef.current);

  const handleSettingChange = (key: string, value: any) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    // Debounced save
    if (settingSaveTimers.current[key]) clearTimeout(settingSaveTimers.current[key]);
    settingSaveTimers.current[key] = setTimeout(async () => {
      try {
        await putJSON(`/api/settings/${key}`, { value, tenant_id: "dev" });
      } catch (e) {
        showToast(`Ошибка сохранения: ${key}`, "err");
      }
    }, 800);
  };

  const handleEmployeeChange = (id: string, field: string, value: any) => {
    setEmployees((prev) => prev.map((e) => (e.id === id ? { ...e, [field]: value } : e)));
    // Debounced save
    const timerKey = `${id}:${field}`;
    if (empSaveTimers.current[timerKey]) clearTimeout(empSaveTimers.current[timerKey]);
    empSaveTimers.current[timerKey] = setTimeout(async () => {
      try {
        await putJSON(`/api/employees/${id}`, { [field]: value });
      } catch (e) {
        showToast(`Ошибка сохранения сотрудника ${id}`, "err");
      }
    }, 800);
  };

  const handleAddEmployee = () => {
    setEmpFormData(EMPTY_FORM);
    setEmpFormEdit(false);
    setEmpFormOpen(true);
  };

  const handleEditEmployee = (emp: Employee) => {
    setEmpFormData({
      id: emp.id,
      name: emp.name,
      role: emp.role,
      rate_per_hour: emp.rate_per_hour,
      min_hours_per_week: emp.min_hours_per_week,
      max_hours_per_week: emp.max_hours_per_week,
      telegram_username: emp.telegram_username || "",
      phone: emp.phone || "",
      notes: (emp.meta as any)?.notes || "",
    });
    setEmpFormEdit(true);
    setEmpFormOpen(true);
  };

  const handleSaveEmployee = async (data: EmployeeFormData) => {
    const body: any = {
      name: data.name,
      role: data.role,
      rate_per_hour: data.rate_per_hour,
      min_hours_per_week: data.min_hours_per_week,
      max_hours_per_week: data.max_hours_per_week,
    };
    if (data.telegram_username) body.telegram_username = data.telegram_username.replace(/^@/, "");
    if (data.phone) body.phone = data.phone;
    if (data.notes) body.meta = { notes: data.notes };

    if (empFormEdit) {
      await putJSON(`/api/employees/${data.id}`, body);
    } else {
      body.id = data.id;
      await postJSON("/api/employees", body);
    }

    setEmpFormOpen(false);
    showToast("Сотрудник сохранён", "ok");
    await reload();
  };

  const handleLoadSeed = async () => {
    setSeedingInProgress(true);
    try {
      const res = await postJSON("/debug/seed", {});
      if (res.ok) {
        setShowWelcome(false);
        setChatId(res.chat_id || "dev_seed_chat");
        chatIdRef.current = res.chat_id || "dev_seed_chat";
        setWeekStart(res.week || getMonday());
        await loadWeekData(res.week || getMonday(), res.chat_id || "dev_seed_chat");
      }
    } catch (e: any) {
      setError(`Ошибка загрузки данных: ${e.message}`);
    } finally {
      setSeedingInProgress(false);
    }
  };

  if (showWelcome) {
    return (
      <div style={{ maxWidth: 520, margin: "0 auto", padding: "80px 20px", fontFamily: "system-ui, sans-serif", textAlign: "center" }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>ShiftLedger</h1>
        <p style={{ fontSize: 16, color: "#666", marginBottom: 32 }}>
          Панель управления сменами и зарплатами
        </p>
        <div style={{
          background: "#f8f9fa", border: "1px solid #dee2e6", borderRadius: 12,
          padding: "32px 24px", marginBottom: 24,
        }}>
          <p style={{ fontSize: 15, marginBottom: 20, color: "#333" }}>
            Нет данных. Загрузите тестовый сценарий, чтобы увидеть панель в действии.
          </p>
          <button
            onClick={handleLoadSeed}
            disabled={seedingInProgress}
            style={{
              padding: "12px 32px", fontSize: 16, fontWeight: 600,
              background: seedingInProgress ? "#6c757d" : "#007bff",
              color: "#fff", border: "none", borderRadius: 8, cursor: seedingInProgress ? "wait" : "pointer",
            }}
          >
            {seedingInProgress ? "Загрузка..." : "Загрузить тестовые данные"}
          </button>
          {error && (
            <div style={{ color: "#c62828", marginTop: 12, fontSize: 13 }}>{error}</div>
          )}
        </div>
        <p style={{ fontSize: 13, color: "#999" }}>
          Тестовый сценарий: 4 сотрудника, полная неделя с заменами, уборками и доп. занятиями.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontSize: 18 }}>
        Загрузка...
      </div>
    );
  }

  const stateInfo = STATE_LABELS[weekState?.state || "COLLECTING"] || { label: weekState?.state, color: "#666" };

  const sectionBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: "4px 12px",
    background: active ? "#007bff" : "transparent",
    color: active ? "#fff" : "#007bff",
    border: active ? "none" : "1px solid #007bff",
    borderRadius: 4,
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 500,
  });

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", height: "100vh", overflow: "hidden" }}>
      {/* CSS */}
      <style>{`
        .dp-btn:not(:disabled):hover { filter: brightness(0.85); }
        .dp-btn:not(:disabled):active { filter: brightness(0.7); transform: scale(0.97); }
        .dp-tab:hover { filter: brightness(0.9); }
        .dp-tab:active { transform: scale(0.97); }
        @media (max-width: 768px) {
          .dp-grid { grid-template-columns: 1fr !important; }
          .dp-grid > div:nth-child(2) { display: none !important; }
          .dp-col-left, .dp-col-right { height: auto !important; max-height: none !important; }
          .dp-mobile-hide { display: none !important; }
          .dp-mobile-show { display: flex !important; }
        }
        @media (min-width: 769px) {
          .dp-mobile-toggle { display: none !important; }
        }
      `}</style>

      {/* Top bar */}
      <div style={{
        padding: "8px 16px", borderBottom: "1px solid #dee2e6", background: "#fff",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>ShiftLedger</h1>
          <div style={{
            padding: "2px 10px", borderRadius: 10, background: stateInfo.color,
            color: "#fff", fontSize: 12, fontWeight: 500,
          }}>
            {stateInfo.label}
          </div>
          {weekState?.hasGaps && (
            <span style={{ fontSize: 11, color: "#d32f2f" }}>Незакрытые смены</span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => goWeek(-1)} style={{ ...navBtnStyle, padding: "4px 10px", fontSize: 14 }} title="Предыдущая неделя">{"\u2190"}</button>
          <div style={{ textAlign: "center", minWidth: 140 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{fmtWeekRange(weekStart)}</div>
            <div style={{ fontSize: 11, color: "#666" }}>
              {weekStart}
              {(schedule?.slots?.some((s: Slot) => s.user_id) || (events && events.length > 0)) ? (
                <span style={{ color: "#28a745", marginLeft: 4 }}>+</span>
              ) : (
                <span style={{ color: "#ccc", marginLeft: 4 }}>{"\u2014"}</span>
              )}
            </div>
          </div>
          <button onClick={() => goWeek(1)} style={{ ...navBtnStyle, padding: "4px 10px", fontSize: 14 }} title="Следующая неделя">{"\u2192"}</button>
          {weekStart !== getMonday() && (
            <button onClick={goToday} style={{ ...navBtnStyle, fontSize: 11, padding: "3px 8px" }} title="Текущая неделя">Сегодня</button>
          )}
        </div>
      </div>

      {/* Mobile toggle */}
      <div className="dp-mobile-toggle" style={{ display: "none", gap: 0, borderBottom: "1px solid #dee2e6" }}>
        <button
          onClick={() => setMobileView("left")}
          style={{ flex: 1, padding: "8px", border: "none", cursor: "pointer", fontSize: 13, fontWeight: mobileView === "left" ? 700 : 400, background: mobileView === "left" ? "#007bff" : "#f8f9fa", color: mobileView === "left" ? "#fff" : "#333" }}
        >Управление</button>
        <button
          onClick={() => setMobileView("right")}
          style={{ flex: 1, padding: "8px", border: "none", cursor: "pointer", fontSize: 13, fontWeight: mobileView === "right" ? 700 : 400, background: mobileView === "right" ? "#007bff" : "#f8f9fa", color: mobileView === "right" ? "#fff" : "#333" }}
        >График + Чат</button>
      </div>

      {error && (
        <div style={{ padding: "8px 16px", background: "#ffebee", color: "#c62828", fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Two-column grid */}
      <div className="dp-grid" style={{
        display: "grid", gridTemplateColumns: `${colSplit}% 4px 1fr`,
        height: "calc(100vh - 60px)", overflow: "hidden",
      }}>
        {/* ===== LEFT COLUMN: controls + tabs ===== */}
        <div
          className={`dp-col-left ${mobileView === "right" ? "dp-mobile-hide" : ""}`}
          style={{
            overflowY: "auto",
            padding: "8px 10px", background: "#fff",
          }}
        >
          {/* Control buttons */}
          <div style={{ marginBottom: 12 }}>
            <ControlButtons weekState={weekState} weekStart={weekStart} chatId={chatId} userId={userId} onAction={reload} onToast={showToast} />
          </div>

          {/* Workflow guide */}
          <WorkflowGuide />

          {/* Section tabs */}
          <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
            {(["payroll", "settings"] as const).map((sec) => {
              const labels = { payroll: "Зарплаты", settings: "Настройки" };
              return (
                <button key={sec} className="dp-tab" onClick={() => setActiveSection(sec)} style={sectionBtnStyle(activeSection === sec)}>
                  {labels[sec]}
                </button>
              );
            })}
          </div>

          {/* Active section content */}
          <div style={{ background: "#fff", border: "1px solid #dee2e6", borderRadius: 6, marginBottom: 8 }}>
            {activeSection === "payroll" && (
              <div>
                <div style={{ padding: "6px 10px", borderBottom: "1px solid #eee", fontWeight: 600, fontSize: 13 }}>
                  Зарплаты {timesheet?.week_start && `\u2014 ${timesheet.week_start}`}
                </div>
                <PayrollTable timesheet={timesheet} employees={employees} />
              </div>
            )}

            {activeSection === "settings" && (
              <div style={{ padding: 8 }}>
                <SettingsPanel
                  settings={settings}
                  employees={employees}
                  onSettingChange={handleSettingChange}
                  onEmployeeChange={handleEmployeeChange}
                  onAddEmployee={handleAddEmployee}
                  onEditEmployee={handleEditEmployee}
                />
              </div>
            )}
          </div>

          {/* Debug toolbar at bottom */}
          <DebugToolbar weekStart={weekStart} chatId={chatId} onAction={reload} onToast={showToast} />
        </div>

        {/* Column resize handle */}
        <div
          onMouseDown={startDrag}
          className={mobileView === "right" || mobileView === "left" ? "" : ""}
          style={{
            background: draggingRef.current ? "#007bff" : "#dee2e6",
            cursor: "col-resize",
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => { (e.target as HTMLElement).style.background = "#adb5bd"; }}
          onMouseLeave={(e) => { if (!draggingRef.current) (e.target as HTMLElement).style.background = "#dee2e6"; }}
        />

        {/* ===== RIGHT COLUMN: live schedule + chat ===== */}
        <div
          className={`dp-col-right ${mobileView === "left" ? "dp-mobile-hide" : ""}`}
          style={{
            display: "flex", flexDirection: "column", height: "100%",
            overflow: "hidden", background: "#f8f9fa",
          }}
        >
          {/* Live schedule grid (top half) */}
          <div style={{
            flex: "0 0 auto", maxHeight: "45%", overflowY: "auto",
            background: "#fff", borderBottom: "1px solid #dee2e6",
          }}>
            <div style={{
              padding: "4px 8px", borderBottom: "1px solid #eee", fontWeight: 600, fontSize: 13,
              display: "flex", justifyContent: "space-between", alignItems: "center",
              background: "#fff", position: "sticky", top: 0, zIndex: 1,
            }}>
              <span>Живой график</span>
              <button onClick={reload} style={{
                padding: "1px 6px", fontSize: 10, background: "#e9ecef",
                border: "1px solid #ced4da", borderRadius: 3, cursor: "pointer",
              }}>Обновить</button>
            </div>
            <LiveScheduleGrid schedule={schedule} employees={employees} />
          </div>

          {/* Chat (bottom half, fills remaining space) */}
          <div style={{
            flex: 1, display: "flex", flexDirection: "column",
            overflow: "hidden", background: "#fff",
          }}>
            <div style={{
              padding: "4px 8px", borderBottom: "1px solid #eee", fontWeight: 600, fontSize: 13,
              background: "#fff",
            }}>
              Чат сотрудников
            </div>
            <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
              <StaffChat events={events} employees={employees} chatId={chatId} onSend={reload} onToast={showToast} />
            </div>
          </div>
        </div>
      </div>

      <FeedbackButton />

      {/* Employee form modal */}
      {empFormOpen && (
        <EmployeeFormModal
          initial={empFormData}
          isEdit={empFormEdit}
          onSave={handleSaveEmployee}
          onClose={() => setEmpFormOpen(false)}
        />
      )}

      {/* Toast notification */}
      {toast && (
        <div style={{
          position: "fixed", top: 20, right: 20, padding: "10px 20px",
          background: toast.type === "ok" ? "#28a745" : "#dc3545",
          color: "#fff", borderRadius: 8, fontSize: 14, fontWeight: 500,
          boxShadow: "0 4px 12px rgba(0,0,0,0.2)", zIndex: 2000,
          animation: "fadeIn 0.2s ease",
        }}>
          {toast.type === "ok" ? "\u2705 " : "\u274C "}{toast.text}
        </div>
      )}
    </div>
  );
};
