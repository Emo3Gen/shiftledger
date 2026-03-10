import React from "react";
import { getEmployees, getBotMode, setBotMode, type Employee } from "../api";
import { haptic } from "../telegram";

type Tab = "shifts" | "employees" | "bot";

const TAB_ITEMS: Array<{ id: Tab; label: string }> = [
  { id: "shifts", label: "Смены" },
  { id: "employees", label: "Сотрудники" },
  { id: "bot", label: "Бот" },
];

export const Settings: React.FC<{ isOwner: boolean }> = ({ isOwner }) => {
  const [tab, setTab] = React.useState<Tab>("shifts");

  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Настройки</div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
        {TAB_ITEMS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? "btn" : "btn btn-secondary"}
            style={{ flex: 1, fontSize: 13, padding: "8px 4px" }}
            onClick={() => { haptic("light"); setTab(t.id); }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "shifts" && <ShiftsTab />}
      {tab === "employees" && <EmployeesTab />}
      {tab === "bot" && isOwner && <BotModeTab />}
      {tab === "bot" && !isOwner && (
        <div className="card" style={{ textAlign: "center", color: "var(--tg-hint)" }}>
          Только для владельца
        </div>
      )}
    </div>
  );
};

// --- Shifts tab ---

const ShiftsTab: React.FC = () => {
  const [morningFrom, setMorningFrom] = React.useState("10:00");
  const [morningTo, setMorningTo] = React.useState("13:00");
  const [eveningFrom, setEveningFrom] = React.useState("18:00");
  const [eveningTo, setEveningTo] = React.useState("21:00");
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    fetch("/api/miniapp/settings", {
      headers: { Authorization: `Bearer ${sessionStorage.getItem("miniapp_token")}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data["shifts.morning.from"]) setMorningFrom(data["shifts.morning.from"]);
        if (data["shifts.morning.to"]) setMorningTo(data["shifts.morning.to"]);
        if (data["shifts.evening.from"]) setEveningFrom(data["shifts.evening.from"]);
        if (data["shifts.evening.to"]) setEveningTo(data["shifts.evening.to"]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">Загрузка...</div>;

  return (
    <>
      <div className="card">
        <div className="card-title">Утренняя смена</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <TimeInput value={morningFrom} onChange={setMorningFrom} label="С" />
          <span style={{ color: "var(--tg-hint)" }}>&mdash;</span>
          <TimeInput value={morningTo} onChange={setMorningTo} label="До" />
        </div>
      </div>
      <div className="card">
        <div className="card-title">Вечерняя смена</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <TimeInput value={eveningFrom} onChange={setEveningFrom} label="С" />
          <span style={{ color: "var(--tg-hint)" }}>&mdash;</span>
          <TimeInput value={eveningTo} onChange={setEveningTo} label="До" />
        </div>
      </div>
    </>
  );
};

const TimeInput: React.FC<{ value: string; onChange: (v: string) => void; label: string }> = ({ value, onChange, label }) => (
  <div style={{ flex: 1 }}>
    <div style={{ fontSize: 11, color: "var(--tg-hint)", marginBottom: 4 }}>{label}</div>
    <input
      type="time"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%",
        padding: "8px 10px",
        borderRadius: 8,
        border: "1px solid rgba(255,255,255,0.12)",
        background: "var(--tg-bg)",
        color: "var(--tg-text)",
        fontSize: 15,
        fontFamily: "inherit",
      }}
    />
  </div>
);

// --- Employees tab ---

const EmployeesTab: React.FC = () => {
  const [employees, setEmployees] = React.useState<Employee[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    getEmployees()
      .then(setEmployees)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">Загрузка...</div>;

  const ROLE_LABELS: Record<string, string> = {
    owner: "Владелец",
    director: "Директор",
    admin: "Администратор",
    senior: "Старший",
    junior: "Младший",
    staff: "Сотрудник",
  };

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      {employees.length === 0 ? (
        <div style={{ padding: 14, textAlign: "center", color: "var(--tg-hint)" }}>
          Нет сотрудников
        </div>
      ) : (
        employees.map((emp, i) => (
          <div key={emp.id} style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 14px",
            borderBottom: i < employees.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none",
          }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{emp.name}</div>
              <div style={{ fontSize: 12, color: "var(--tg-hint)", marginTop: 1 }}>
                {ROLE_LABELS[emp.role] || emp.role}
              </div>
            </div>
            <div style={{
              fontSize: 11,
              padding: "3px 8px",
              borderRadius: 6,
              background: emp.role === "senior" ? "rgba(52,199,89,0.15)" : "rgba(255,255,255,0.08)",
              color: emp.role === "senior" ? "rgba(52,199,89,1)" : "var(--tg-hint)",
            }}>
              {emp.id}
            </div>
          </div>
        ))
      )}
    </div>
  );
};

// --- Bot mode tab ---

const BotModeTab: React.FC = () => {
  const [mode, setMode] = React.useState<string>("manual");
  const [loading, setLoading] = React.useState(true);
  const [switching, setSwitching] = React.useState(false);

  React.useEffect(() => {
    getBotMode()
      .then((d) => setMode(d.mode))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleChange = async (newMode: string) => {
    if (newMode === mode) return;
    haptic("medium");
    setSwitching(true);
    try {
      const result = await setBotMode(newMode);
      setMode(result.mode);
    } catch (e: any) {
      alert(e.message);
    }
    setSwitching(false);
  };

  if (loading) return <div className="loading">Загрузка...</div>;

  const modes = [
    { id: "manual", label: "Ручной", icon: "\u{270B}", desc: "Бот молчит, всё делаете вручную" },
    { id: "auto", label: "Авто", icon: "\u{1F916}", desc: "Бот публикует по расписанию" },
    { id: "debug", label: "Отладка", icon: "\u{1F41B}", desc: "Отправляет в личку администратора" },
  ];

  return (
    <div>
      {modes.map((m) => {
        const active = mode === m.id;
        return (
          <button
            key={m.id}
            disabled={switching}
            onClick={() => handleChange(m.id)}
            className="card"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              width: "100%",
              textAlign: "left",
              border: active ? "2px solid var(--tg-link)" : "2px solid transparent",
              cursor: "pointer",
              opacity: switching ? 0.5 : 1,
            }}
          >
            <div style={{ fontSize: 28, lineHeight: 1 }}>{m.icon}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{m.label}</div>
              <div style={{ fontSize: 12, color: "var(--tg-hint)", marginTop: 2 }}>{m.desc}</div>
            </div>
            {active && (
              <div style={{ color: "var(--tg-link)", fontSize: 18, fontWeight: 700 }}>{"\u2713"}</div>
            )}
          </button>
        );
      })}
    </div>
  );
};
