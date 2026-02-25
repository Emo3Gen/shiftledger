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

  // Cleaning lookup
  const cleaningByDow: Record<string, string> = {};
  for (const slot of schedule.slots) {
    if (slot.cleaning_user_id && slot.slot_name === "Вечер") {
      cleaningByDow[slot.dow] = slot.cleaning_user_id;
    }
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ background: "#f8f9fa" }}>
            <th style={{ padding: "8px 12px", textAlign: "left", borderBottom: "2px solid #dee2e6" }}>День</th>
            {slotNames.map((sn) => (
              <th key={sn} style={{ padding: "8px 12px", textAlign: "left", borderBottom: "2px solid #dee2e6" }}>{sn}</th>
            ))}
            <th style={{ padding: "8px 12px", textAlign: "left", borderBottom: "2px solid #dee2e6" }}>Уборка</th>
          </tr>
        </thead>
        <tbody>
          {activeDays.map((dow) => (
            <tr key={dow} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: "8px 12px", fontWeight: 600 }}>{DOW_RU[dow]}</td>
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
                  <td key={sn} style={{ padding: "8px 12px", background: bg }}>
                    {isReplacement && `${EMOJI_SWAP} `}
                    {isProblem && `${EMOJI_WARN} `}
                    {name}
                    {isReplacement && slot?.replaced_user_id && (
                      <span style={{ fontSize: 11, color: "#666" }}> (за {getName(slot.replaced_user_id)})</span>
                    )}
                  </td>
                );
              })}
              <td style={{ padding: "8px 12px" }}>
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
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
      <thead>
        <tr style={{ background: "#f8f9fa" }}>
          <th style={thStyle}>Сотрудник</th>
          <th style={thStyle}>Часы</th>
          <th style={thStyle}>Смены</th>
          <th style={thStyle}>Уборки</th>
          <th style={thStyle}>Доп.</th>
          <th style={thStyle}>Итого</th>
        </tr>
      </thead>
      <tbody>
        {timesheet.employees.map((emp, idx) => (
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
              <td style={{ ...tdStyle, fontWeight: 600 }}>{fmtRub(emp.total_pay)}</td>
            </tr>
            {expandedIdx === idx && (
              <tr>
                <td colSpan={6} style={{ padding: "8px 16px", background: "#f8f9fa", fontSize: 13 }}>
                  <div>Всего часов: {emp.shift_hours} | Эфф.: {emp.effective_hours} | Ставка: {emp.rate} \u20BD/ч</div>
                  {emp.problem_shifts > 0 && <div style={{ color: "#d32f2f" }}>Проблемных смен: {emp.problem_shifts}</div>}
                  {emp.total_before_rounding !== emp.total_pay && (
                    <div>До округления: {fmtRub(emp.total_before_rounding)}</div>
                  )}
                </td>
              </tr>
            )}
          </React.Fragment>
        ))}
        <tr style={{ background: "#e8f5e9", fontWeight: 700 }}>
          <td style={tdStyle}>Итого</td>
          <td style={tdStyle}>{timesheet.totals.total_hours}ч</td>
          <td colSpan={3} />
          <td style={tdStyle}>{fmtRub(timesheet.totals.total_pay)}</td>
        </tr>
      </tbody>
    </table>
  );
};

const thStyle: React.CSSProperties = { padding: "8px 12px", textAlign: "left", borderBottom: "2px solid #dee2e6" };
const tdStyle: React.CSSProperties = { padding: "8px 12px" };

// ControlButtons
const ControlButtons: React.FC<{
  weekState: WeekState | null;
  chatId: string;
  userId: string;
  onAction: () => void;
}> = ({ weekState, chatId, userId, onAction }) => {
  const [loading, setLoading] = React.useState(false);

  const doAction = async (text: string) => {
    setLoading(true);
    try {
      await postJSON("/debug/send", { chat_id: chatId, user_id: userId, text });
      onAction();
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const doBuildSchedule = async () => {
    setLoading(true);
    try {
      await postJSON("/debug/build-schedule", { chat_id: chatId, user_id: userId });
      onAction();
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const state = weekState?.state || "COLLECTING";

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button
        onClick={() => doAction("WEEK_OPEN")}
        disabled={loading || state !== "CLOSED"}
        style={btnStyle("#007bff")}
      >
        Начать сбор
      </button>
      <button
        onClick={doBuildSchedule}
        disabled={loading || state !== "COLLECTING"}
        style={btnStyle("#28a745")}
      >
        Собрать график
      </button>
      <button
        onClick={() => doAction("WEEK_LOCK")}
        disabled={loading || state !== "ACTIVE"}
        style={btnStyle("#6c757d")}
      >
        Закрыть неделю
      </button>
    </div>
  );
};

function btnStyle(color: string): React.CSSProperties {
  return {
    padding: "8px 16px",
    background: color,
    color: "#fff",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 500,
    opacity: 1,
  };
}

// NotificationFeed
const NotificationFeed: React.FC<{ events: any[] }> = ({ events }) => {
  if (!events.length) return <div style={{ color: "#999", padding: 8 }}>Нет событий</div>;

  return (
    <div style={{ maxHeight: 200, overflowY: "auto", fontSize: 13 }}>
      {events.slice(0, 20).map((ev, i) => (
        <div key={i} style={{ padding: "4px 0", borderBottom: "1px solid #f0f0f0" }}>
          <span style={{ color: "#999", marginRight: 8 }}>
            {ev.received_at ? new Date(ev.received_at).toLocaleTimeString("ru") : ""}
          </span>
          <strong>{ev.user_id}</strong>: {ev.text?.slice(0, 60)}
        </div>
      ))}
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

// ---- Main DirectorPanel ----

export const DirectorPanel: React.FC = () => {
  const chatId = "debug_chat";
  const userId = "admin1";

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
  const [activeSection, setActiveSection] = React.useState<"schedule" | "payroll" | "settings">("schedule");

  // Employee form modal state
  const [empFormOpen, setEmpFormOpen] = React.useState(false);
  const [empFormEdit, setEmpFormEdit] = React.useState(false);
  const [empFormData, setEmpFormData] = React.useState<EmployeeFormData>(EMPTY_FORM);

  // Debounced save for settings
  const settingSaveTimers = React.useRef<Record<string, NodeJS.Timeout>>({});
  // Debounced save for employees
  const empSaveTimers = React.useRef<Record<string, NodeJS.Timeout>>({});
  // Track if initial week detection has run
  const initialWeekDetected = React.useRef(false);

  const loadWeekData = React.useCallback(async (ws: string) => {
    const errors: string[] = [];

    const [schedRes, wsRes, tsRes, empRes, settRes, evRes] = await Promise.all([
      fetchJSON(`/debug/schedule?chat_id=${chatId}&week_start=${ws}`).catch((e) => { errors.push(`Расписание: ${e.message}`); return null; }),
      fetchJSON(`/debug/week_state?chat_id=${chatId}&week_start=${ws}`).catch((e) => { errors.push(`Статус недели: ${e.message}`); return null; }),
      fetchJSON(`/debug/timesheet?chat_id=${chatId}&week_start=${ws}`).catch((e) => { errors.push(`Зарплаты: ${e.message}`); return null; }),
      fetchJSON("/api/employees").catch((e) => { errors.push(`Сотрудники: ${e.message}`); return null; }),
      fetchJSON("/api/settings?tenant_id=dev").catch((e) => { errors.push(`Настройки: ${e.message}`); return null; }),
      fetchJSON(`/events?chat_id=${chatId}&limit=30`).catch((e) => { errors.push(`События: ${e.message}`); return null; }),
    ]);

    if (schedRes) setSchedule(schedRes);
    if (wsRes?.week_state) setWeekState(wsRes.week_state);
    if (tsRes?.timesheet) setTimesheet(tsRes.timesheet);
    setEmployees(empRes?.employees || []);
    setSettings(settRes?.settings || {});
    setEvents(evRes?.events || []);

    setError(errors.length > 0 ? errors.join("; ") : "");
    setLoading(false);
  }, []);

  // On mount: detect available weeks, auto-select latest if current week is empty
  React.useEffect(() => {
    (async () => {
      try {
        const weeksRes = await fetchJSON(`/debug/weeks?chat_id=${chatId}`).catch(() => null);
        const weeks: string[] = weeksRes?.weeks || [];
        setAvailableWeeks(weeks);

        if (!initialWeekDetected.current && weeks.length > 0) {
          initialWeekDetected.current = true;
          const today = getMonday();
          // If current week has data, use it; otherwise use the latest available
          const bestWeek = weeks.includes(today) ? today : weeks[0];
          setWeekStart(bestWeek);
          await loadWeekData(bestWeek);
          return;
        }
      } catch {
        // ignore
      }
      initialWeekDetected.current = true;
      await loadWeekData(weekStart);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Reload when weekStart changes (after initial load)
  const prevWeek = React.useRef(weekStart);
  React.useEffect(() => {
    if (prevWeek.current !== weekStart && initialWeekDetected.current) {
      prevWeek.current = weekStart;
      setLoading(true);
      loadWeekData(weekStart);
    }
  }, [weekStart, loadWeekData]);

  // Auto-refresh every 30s
  React.useEffect(() => {
    const interval = setInterval(() => loadWeekData(weekStart), 30000);
    return () => clearInterval(interval);
  }, [weekStart, loadWeekData]);

  const goWeek = (delta: number) => setWeekStart((ws) => shiftWeek(ws, delta));

  const handleSettingChange = (key: string, value: any) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    // Debounced save
    if (settingSaveTimers.current[key]) clearTimeout(settingSaveTimers.current[key]);
    settingSaveTimers.current[key] = setTimeout(async () => {
      try {
        await putJSON(`/api/settings/${key}`, { value, tenant_id: "dev" });
      } catch (e) {
        console.error("Failed to save setting", key, e);
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
        console.error("Failed to save employee", id, field, e);
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
    await loadWeekData(weekStart);
  };

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontSize: 18 }}>
        Загрузка...
      </div>
    );
  }

  const stateInfo = STATE_LABELS[weekState?.state || "COLLECTING"] || { label: weekState?.state, color: "#666" };

  const sectionBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: "10px 20px",
    background: active ? "#007bff" : "transparent",
    color: active ? "#fff" : "#007bff",
    border: active ? "none" : "1px solid #007bff",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 500,
  });

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "16px 20px", fontFamily: "system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Панель директора</h1>
          <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>
            ShiftLedger | {new Date().toLocaleDateString("ru")}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{
            display: "inline-block",
            padding: "4px 12px",
            borderRadius: 12,
            background: stateInfo.color,
            color: "#fff",
            fontSize: 13,
            fontWeight: 500,
          }}>
            {stateInfo.label}
          </div>
          {weekState?.hasGaps && (
            <div style={{ fontSize: 12, color: "#d32f2f", marginTop: 4 }}>Есть незакрытые смены</div>
          )}
        </div>
      </div>

      {/* Week navigation */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
        marginBottom: 16, padding: "8px 0",
      }}>
        <button onClick={() => goWeek(-1)} style={navBtnStyle} title="Предыдущая неделя">{"\u2190"}</button>
        <div style={{ textAlign: "center", minWidth: 180 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{fmtWeekRange(weekStart)}</div>
          <div style={{ fontSize: 12, color: "#666" }}>
            {weekStart}
            {availableWeeks.includes(weekStart) && (
              <span style={{ color: "#28a745", marginLeft: 6 }}>есть данные</span>
            )}
            {!availableWeeks.includes(weekStart) && availableWeeks.length > 0 && (
              <span style={{ color: "#999", marginLeft: 6 }}>нет данных</span>
            )}
          </div>
        </div>
        <button onClick={() => goWeek(1)} style={navBtnStyle} title="Следующая неделя">{"\u2192"}</button>
        {weekStart !== getMonday() && (
          <button
            onClick={() => setWeekStart(getMonday())}
            style={{ ...navBtnStyle, fontSize: 12, padding: "4px 10px" }}
            title="Текущая неделя"
          >
            Сегодня
          </button>
        )}
      </div>

      {error && (
        <div style={{ padding: 12, background: "#ffebee", color: "#c62828", borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Control buttons */}
      <div style={{ marginBottom: 16 }}>
        <ControlButtons weekState={weekState} chatId={chatId} userId={userId} onAction={() => loadWeekData(weekStart)} />
      </div>

      {/* Section tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button style={sectionBtnStyle(activeSection === "schedule")} onClick={() => setActiveSection("schedule")}>
          Расписание
        </button>
        <button style={sectionBtnStyle(activeSection === "payroll")} onClick={() => setActiveSection("payroll")}>
          Зарплаты
        </button>
        <button style={sectionBtnStyle(activeSection === "settings")} onClick={() => setActiveSection("settings")}>
          Настройки
        </button>
      </div>

      {/* Active section */}
      <div style={{ background: "#fff", border: "1px solid #dee2e6", borderRadius: 8, marginBottom: 16 }}>
        {activeSection === "schedule" && (
          <div>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #eee", fontWeight: 600, fontSize: 15 }}>
              Расписание {schedule?.week_start && `на неделю ${schedule.week_start}`}
            </div>
            <LiveScheduleGrid schedule={schedule} employees={employees} />
            {(schedule?.gaps?.length ?? 0) > 0 && (
              <div style={{ padding: "8px 16px", background: "#fff3e0", fontSize: 13 }}>
                Пробелов: {schedule?.gaps?.length}
              </div>
            )}
          </div>
        )}

        {activeSection === "payroll" && (
          <div>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #eee", fontWeight: 600, fontSize: 15 }}>
              Зарплаты {timesheet?.week_start && `за неделю ${timesheet.week_start}`}
            </div>
            <PayrollTable timesheet={timesheet} employees={employees} />
          </div>
        )}

        {activeSection === "settings" && (
          <div style={{ padding: 16 }}>
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

      {/* Notifications feed */}
      <div style={{ background: "#fff", border: "1px solid #dee2e6", borderRadius: 8, marginBottom: 16 }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #eee", fontWeight: 600, fontSize: 15 }}>
          Последние события
        </div>
        <div style={{ padding: "8px 16px" }}>
          <NotificationFeed events={events} />
        </div>
      </div>

      {/* Link back to simulator */}
      <div style={{ textAlign: "center", padding: 8, fontSize: 13 }}>
        <a href="/" style={{ color: "#007bff" }}>Симулятор чата</a>
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
    </div>
  );
};
