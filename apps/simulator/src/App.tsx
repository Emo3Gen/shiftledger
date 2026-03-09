import React from "react";

// ---- Visibility & Scale Infrastructure ----

const ALL_SECTIONS = [
  { id: "tenants", label: "Тенанты/роли" },
  { id: "dialogs", label: "Диалоги" },
  { id: "chat", label: "Чат сотрудников" },
  { id: "employees", label: "Сотрудники" },
  { id: "payroll", label: "Табель зарплат" },
  { id: "roster_users", label: "Сотрудники для расчёта" },
  { id: "active_tasks", label: "Требуются действия" },
  { id: "debug_header", label: "Debug: статус + события + факты" },
  { id: "schedule_v0", label: "Schedule v0" },
  { id: "live_grid", label: "Живой график" },
  { id: "details", label: "Детали (назначения, конфликты)" },
  { id: "schedule_controls", label: "Управление графиком" },
  { id: "scenarios", label: "Тестовые сценарии" },
  { id: "tech_commands", label: "Технические команды" },
  { id: "notifications", label: "Уведомления" },
  { id: "week_status", label: "Статус недели (JSON)" },
  { id: "confirm_facts", label: "Подтверждение факта" },
  { id: "paraplan", label: "Параплан" },
  { id: "settings", label: "Настройки" },
] as const;

type SectionId = typeof ALL_SECTIONS[number]["id"];

const PRESET_DIRECTOR: SectionId[] = [
  "tenants", "debug_header", "details", "tech_commands", "week_status",
  "dialogs", "roster_users", "active_tasks", "confirm_facts",
];

function loadVisibility(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem("panel_visibility");
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveVisibility(v: Record<string, boolean>) {
  localStorage.setItem("panel_visibility", JSON.stringify(v));
}

function loadScale(): number {
  try {
    const raw = localStorage.getItem("panel_scale");
    return raw ? Number(raw) : 1;
  } catch { return 1; }
}

function loadColWidths(): [number, number, number] {
  try {
    const raw = localStorage.getItem("panel_col_widths");
    if (raw) { const p = JSON.parse(raw); if (Array.isArray(p) && p.length === 3) return p as [number, number, number]; }
  } catch {}
  return [18, 40, 42]; // default percentages
}

const DEFAULT_COLLAPSED: Record<string, boolean> = {
  settings: true,
  paraplan: true,
  payroll: true,
};
function loadCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem("panel_collapsed");
    return raw ? { ...DEFAULT_COLLAPSED, ...JSON.parse(raw) } : { ...DEFAULT_COLLAPSED };
  } catch { return { ...DEFAULT_COLLAPSED }; }
}

function saveCollapsed(c: Record<string, boolean>) {
  localStorage.setItem("panel_collapsed", JSON.stringify(c));
}

// ToggleSection: wraps a section with collapse ▼/▶ toggle
const ToggleSection: React.FC<{
  id: string;
  vis: Record<string, boolean>;
  collapsed: Record<string, boolean>;
  onHide: (id: string) => void;
  onToggleCollapse: (id: string) => void;
  children: React.ReactNode;
  style?: React.CSSProperties;
  tag?: "section" | "div" | "aside";
}> = ({ id, vis, collapsed, onHide, onToggleCollapse, children, style, tag }) => {
  if (vis[id] === false) return null;
  const isCollapsed = collapsed[id] === true;
  const Tag = tag || "section";
  // Extract the first child (heading) to always show it
  const childArray = React.Children.toArray(children);
  const heading = childArray[0];
  const rest = childArray.slice(1);
  return (
    <Tag style={{ position: "relative", ...style }}>
      <div
        onClick={() => onToggleCollapse(id)}
        style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 4, userSelect: "none" }}
      >
        <span style={{ fontSize: 10, color: "#999", width: 12, flexShrink: 0 }}>{isCollapsed ? "\u25B6" : "\u25BC"}</span>
        {heading}
      </div>
      {!isCollapsed && rest}
    </Tag>
  );
};

// InfoTip: small ⓘ icon with hover tooltip
const InfoTip: React.FC<{ text: string }> = ({ text }) => {
  const [show, setShow] = React.useState(false);
  return (
    <span
      style={{ position: "relative", display: "inline-block", marginLeft: 4, cursor: "help" }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onClick={() => setShow((p) => !p)}
    >
      <span style={{ fontSize: 13, color: "#aaa", userSelect: "none" }}>{"\u24D8"}</span>
      {show && (
        <span style={{
          position: "absolute", left: "50%", top: "100%", transform: "translateX(-50%)",
          marginTop: 4, padding: "6px 10px", background: "#fff", border: "1px solid #ddd",
          borderRadius: 4, boxShadow: "0 2px 8px rgba(0,0,0,0.15)", fontSize: 12,
          color: "#333", lineHeight: 1.4, maxWidth: 250, minWidth: 150, whiteSpace: "normal",
          zIndex: 50, pointerEvents: "none",
        }}>{text}</span>
      )}
    </span>
  );
};

// SettingsDrawer: gear icon + panel with checkboxes, presets, scale slider
const SettingsDrawer: React.FC<{
  vis: Record<string, boolean>;
  onToggle: (id: string, val: boolean) => void;
  onPreset: (hidden: SectionId[]) => void;
  onShowAll: () => void;
  scale: number;
  onScale: (s: number) => void;
}> = ({ vis, onToggle, onPreset, onShowAll, scale, onScale }) => {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        title="Настройки видимости"
        style={{
          background: "none", border: "1px solid #ccc", borderRadius: 4,
          cursor: "pointer", fontSize: 16, padding: "2px 6px", lineHeight: 1,
        }}
      >{"\u2699"}</button>
      {open && (
        <div style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: 300, maxWidth: "90vw",
          background: "#fff", borderLeft: "2px solid #007bff", zIndex: 1000,
          boxShadow: "-4px 0 16px rgba(0,0,0,0.15)", overflowY: "auto", padding: 12,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <strong style={{ fontSize: 14 }}>Видимость секций</strong>
            <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer" }}>{"\u00D7"}</button>
          </div>

          {/* Presets */}
          <div style={{ display: "flex", gap: 4, marginBottom: 10, flexWrap: "wrap" }}>
            <button onClick={() => onPreset(PRESET_DIRECTOR)} style={presetBtnStyle("#007bff")}>Директор</button>
            <button onClick={onShowAll} style={presetBtnStyle("#28a745")}>Разработчик</button>
          </div>

          {/* Scale slider */}
          <div style={{ marginBottom: 12, padding: "6px 0", borderBottom: "1px solid #eee" }}>
            <div style={{ fontSize: 12, marginBottom: 4 }}>Масштаб: {Math.round(scale * 100)}%</div>
            <input
              type="range" min="70" max="150" value={Math.round(scale * 100)}
              onChange={(e) => onScale(Number(e.target.value) / 100)}
              style={{ width: "100%" }}
            />
          </div>

          {/* Section checkboxes */}
          {ALL_SECTIONS.map((sec) => (
            <label key={sec.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: 4, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={vis[sec.id] !== false}
                onChange={(e) => onToggle(sec.id, e.target.checked)}
              />
              {sec.label}
            </label>
          ))}
        </div>
      )}
      {/* Backdrop */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.2)", zIndex: 999 }}
        />
      )}
    </>
  );
};

function presetBtnStyle(color: string): React.CSSProperties {
  return {
    padding: "3px 10px", fontSize: 12, background: color, color: "#fff",
    border: "none", borderRadius: 4, cursor: "pointer",
  };
}

// HelpModal: instruction overlay
const HelpModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  if (!open) return null;
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 2000 }} />
      <div style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
        background: "#fff", borderRadius: 8, padding: "20px 24px", maxWidth: 520, width: "90vw",
        maxHeight: "80vh", overflowY: "auto", zIndex: 2001, boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <strong style={{ fontSize: 16 }}>Как работать с ShiftLedger</strong>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer" }}>{"\u00D7"}</button>
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          <p><strong>Цикл недели:</strong></p>
          <ol style={{ paddingLeft: 20, margin: "4px 0 12px" }}>
            <li><strong>Начать сбор</strong> — открывает неделю, сотрудники сообщают когда могут работать</li>
            <li><strong>Собрать график</strong> — алгоритм распределяет смены по доступности и минимальным часам</li>
            <li><strong>Закрыть неделю</strong> — фиксирует график и рассчитывает зарплаты</li>
          </ol>
          <p><strong>Чат сотрудников:</strong></p>
          <p style={{ margin: "4px 0" }}>Выберите сотрудника и отправьте сообщение. Примеры:</p>
          <ul style={{ paddingLeft: 20, margin: "4px 0 12px" }}>
            <li><code>могу пн утро</code> — доступность</li>
            <li><code>не могу чт вечер</code> — недоступность</li>
            <li><code>уборка вт</code> — отметить уборку</li>
            <li><code>доп ср 10 детей</code> — доп.занятие</li>
          </ul>
          <p><strong>Живой график:</strong></p>
          <p style={{ margin: "4px 0 12px" }}>Зелёный = подтверждён, жёлтый/оранжевый ⚠️ = ищем замену, голубой 🔄 = замена, розовый = не назначен</p>
          <p><strong>Зарплаты:</strong></p>
          <p style={{ margin: "4px 0 12px" }}>Часы × ставка + уборки + доп.занятия = итого (округление вверх до сотен)</p>
          <p><strong>Тестовые сценарии:</strong></p>
          <ul style={{ paddingLeft: 20, margin: "4px 0 12px" }}>
            <li><strong>A</strong> — базовый график</li>
            <li><strong>B</strong> — с заменами, уборками и допами</li>
            <li><strong>C</strong> — полный цикл от сбора до закрытия</li>
          </ul>
          <p><strong>Настройка видимости:</strong></p>
          <p style={{ margin: "4px 0" }}>Нажмите ⚙️ чтобы скрыть/показать секции панели</p>
        </div>
      </div>
    </>
  );
};

type Tenant = {
  tenant_id: string;
};

type DialogSummary = {
  chat_id: string;
  last_ts?: string;
  last_text?: string;
};

// Функция для перевода статусов недели на русский (3 состояния)
function translateWeekState(state: string): { label: string; color: string; emoji: string } {
  const map: Record<string, { label: string; color: string; emoji: string }> = {
    COLLECTING: { label: "Сбор доступности", color: "#007bff", emoji: "🔵" },
    ACTIVE: { label: "График активен", color: "#28a745", emoji: "🟢" },
    CLOSED: { label: "Неделя закрыта", color: "#6c757d", emoji: "⚪" },
  };
  return map[state] || { label: state, color: "#666", emoji: "❓" };
}

// UserDirectory для отображения имен сотрудников
const UserDirectory = {
  users: new Map<string, { id: string; displayName: string; ratePerHour: number; role: string; minHours: number }>([
    ["u1", { id: "u1", displayName: "Иса", ratePerHour: 280, role: "junior", minHours: 22 }],
    ["u2", { id: "u2", displayName: "Дарина", ratePerHour: 280, role: "junior", minHours: 20 }],
    ["u3", { id: "u3", displayName: "Ксюша", ratePerHour: 280, role: "junior", minHours: 0 }],
    ["u4", { id: "u4", displayName: "Карина", ratePerHour: 280, role: "junior", minHours: 20 }],
    ["isa", { id: "u1", displayName: "Иса", ratePerHour: 280, role: "junior", minHours: 22 }],
    ["daria", { id: "u2", displayName: "Дарина", ratePerHour: 280, role: "junior", minHours: 20 }],
    ["ksu", { id: "u3", displayName: "Ксюша", ratePerHour: 280, role: "junior", minHours: 0 }],
    ["karina", { id: "u4", displayName: "Карина", ratePerHour: 280, role: "junior", minHours: 20 }],
  ]),
  getDisplayName(userId: string): string {
    const user = this.users.get(userId);
    if (user) return user.displayName;
    // Если не найден, показываем с пометкой
    return `Неизвестный сотрудник (${userId})`;
  },
  getAllUsers(): Array<{ id: string; displayName: string; ratePerHour: number; role: string; minHours: number }> {
    const seen = new Set<string>();
    const result: Array<{ id: string; displayName: string; ratePerHour: number; role: string; minHours: number }> = [];
    for (const [key, user] of this.users.entries()) {
      if (user.id.startsWith("u") && !seen.has(user.id)) {
        seen.add(user.id);
        result.push(user);
      }
    }
    return result.sort((a, b) => a.id.localeCompare(b.id));
  },
};

// Formatting helpers for payroll table
function fmtNum(n: number | null | undefined): string {
  if (n == null) return "0";
  // Show 1 decimal for non-integer, none for integer
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}
function fmtRub(n: number | null | undefined): string {
  if (n == null || n === 0) return "0 ₽";
  const s = Math.round(n).toString();
  // Add thousands separator (space)
  const parts = [];
  for (let i = s.length; i > 0; i -= 3) {
    parts.unshift(s.slice(Math.max(0, i - 3), i));
  }
  return parts.join("\u2009") + " ₽"; // thin space separator
}

export const App: React.FC = () => {
  const [tenants, setTenants] = React.useState<Tenant[]>([]);
  const [selectedTenant, setSelectedTenant] = React.useState<string | null>(null);
  const [dialogs, setDialogs] = React.useState<DialogSummary[]>([]);
  const [selectedChatId, setSelectedChatId] = React.useState<string | null>(null);
  const [events, setEvents] = React.useState<any[]>([]);
  const [inputText, setInputText] = React.useState("");
  const [senderRole, setSenderRole] = React.useState<string>("staff");
  const [senderUserId, setSenderUserId] = React.useState<string>("u1");
  const [lastSend, setLastSend] = React.useState<{
    event?: any;
    facts?: any[];
    facts_count?: number;
  } | null>(null);
  const [backendOk, setBackendOk] = React.useState<boolean | null>(null);
  const [schedule, setSchedule] = React.useState<{
    week_start?: string;
    assignments?: any[];
    gaps?: any[];
    conflicts?: any[];
    slots?: any[];
  } | null>(null);
  const [weekStateResp, setWeekStateResp] = React.useState<any>(null);
  const [weekStateErr, setWeekStateErr] = React.useState<string>("");
  const [timesheet, setTimesheet] = React.useState<any>(null);
  const [timesheetErr, setTimesheetErr] = React.useState<string>("");
  const [weekStartISO, setWeekStartISO] = React.useState<string>(() => {
    const today = new Date();
    const dow = today.getDay();
    const diff = dow === 0 ? -6 : 1 - dow;
    const mon = new Date(today);
    mon.setDate(today.getDate() + diff);
    return mon.toISOString().split("T")[0];
  });
  const [buildingSchedule, setBuildingSchedule] = React.useState(false);
  const [reminders, setReminders] = React.useState<Map<string, NodeJS.Timeout>>(new Map());
  const [escalations, setEscalations] = React.useState<Map<string, NodeJS.Timeout>>(new Map());
  const [pendingUsers, setPendingUsers] = React.useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = React.useState<"schedule" | "timesheet" | "empty">("schedule");
  const [expandedEmpIdx, setExpandedEmpIdx] = React.useState<number | null>(null);
  
  // ActiveTasks: неблокирующие задачи вместо эскалаций
  type TaskStatus = "OPEN" | "RESOLVED";
  type TaskSeverity = "warning" | "error";
  interface ActiveTask {
    id: string;
    title: string;
    severity: TaskSeverity;
    createdAt: number;
    updatedAt: number;
    status: TaskStatus;
    counter: number;
    nextReminderAt: number; // timestamp для кулдауна
    payload?: {
      comment?: string;
      reason?: string;
      userId?: string;
      weekStart?: string;
    };
  }
  const [activeTasks, setActiveTasks] = React.useState<Map<string, ActiveTask>>(new Map());
  // Track problem reports per user to show confirmation banners
  const [problemReported, setProblemReported] = React.useState<Map<string, { reported: boolean; timestamp: number; message: string }>>(new Map());
  const [weekStart, setWeekStart] = React.useState<string>(() => {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(today);
    monday.setDate(today.getDate() + diff);
    return monday.toISOString().split("T")[0];
  });
  const [lastError, setLastError] = React.useState<string | null>(null);
  const [factsPerEvent, setFactsPerEvent] = React.useState<Map<number, any[]>>(new Map());
  const chatEndRef = React.useRef<HTMLDivElement>(null);

  // Toast notifications
  const [toast, setToast] = React.useState<{ text: string; type: "ok" | "err" } | null>(null);
  const toastTimer = React.useRef<any>(null);
  const showToast = (text: string, type: "ok" | "err" = "ok") => {
    setToast({ text, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  };

  // Sending / action loading
  const [sending, setSending] = React.useState(false);
  const [actionLoading, setActionLoading] = React.useState<string | null>(null);

  // Help modal
  const [helpOpen, setHelpOpen] = React.useState(false);

  // Settings section
  const [settingsTab, setSettingsTab] = React.useState<"shifts" | "staff" | "rates" | "branches" | "catalog" | "cleaning" | "groups">("shifts");
  const [groupsConfig, setGroupsConfig] = React.useState<any[]>([]);
  const [groupsLoading, setGroupsLoading] = React.useState(false);
  const [emogenPrices, setEmogenPrices] = React.useState<{ groups: any[]; meta: any } | null>(null);
  const [emogenLoading, setEmogenLoading] = React.useState(false);
  const [emogenError, setEmogenError] = React.useState<string | null>(null);
  const [emogenSaving, setEmogenSaving] = React.useState<string | null>(null);
  const emogenFetched = React.useRef(false);
  const [periodMode, setPeriodMode] = React.useState<"week" | "first_half" | "second_half" | "full_month">("week");
  const [extraWorkItems, setExtraWorkItems] = React.useState<any[]>([]);
  const [extraPayItems, setExtraPayItems] = React.useState<any[]>([]);
  const [showExtraPayModal, setShowExtraPayModal] = React.useState<{ user_id: string; name: string; dow?: string; slot?: string } | null>(null);
  const [modalSuccess, setModalSuccess] = React.useState<string | null>(null);
  const [modalShowAddForm, setModalShowAddForm] = React.useState(false);
  const [pendingExtraWork, setPendingExtraWork] = React.useState<any[]>([]);
  const [apiSettings, setApiSettings] = React.useState<Record<string, any>>({});
  const [apiEmployees, setApiEmployees] = React.useState<any[]>([]);
  const [savedEmployeeIds, setSavedEmployeeIds] = React.useState<Record<string, boolean>>({});
  const empPendingChanges = React.useRef<Record<string, Record<string, any>>>({});
  const empDebounceTimers = React.useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Slot assignment modal
  const [slotModal, setSlotModal] = React.useState<{
    dow: string; slotName: string; from: string; to: string;
    currentUserId: string | null; dayLabel: string; slotLabel: string;
    availableUserIds: string[];
    isLocked?: boolean;
  } | null>(null);
  const [slotModalSelectedUser, setSlotModalSelectedUser] = React.useState<string>("");
  const [publishStatus, setPublishStatus] = React.useState<"idle" | "publishing" | "success" | "error">("idle");
  const [testPublishStatus, setTestPublishStatus] = React.useState<"idle" | "sending" | "success" | "error">("idle");
  const [paymentsStatus, setPaymentsStatus] = React.useState<"idle" | "sending" | "success" | "error">("idle");
  const [testPaymentsStatus, setTestPaymentsStatus] = React.useState<"idle" | "sending" | "success" | "error">("idle");

  // Paraplan integration state
  const [paraplanStatus, setParaplanStatus] = React.useState<any>(null);
  const [paraplanHours, setParaplanHours] = React.useState<any>(null);
  const [paraplanRefreshing, setParaplanRefreshing] = React.useState(false);

  // Visibility, collapse & scale
  const [vis, setVis] = React.useState<Record<string, boolean>>(loadVisibility);
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>(loadCollapsed);
  const [uiScale, setUiScale] = React.useState<number>(loadScale);
  const [colWidths, setColWidths] = React.useState<[number, number, number]>(loadColWidths);
  const draggingCol = React.useRef<number | null>(null);

  // Vertical chat height resize
  const [chatHeight, setChatHeight] = React.useState<number>(() => {
    try {
      const raw = localStorage.getItem("chat_height");
      return raw ? Math.max(150, Number(raw)) : 350;
    } catch { return 350; }
  });
  const draggingChatH = React.useRef<boolean>(false);
  const chatTopRef = React.useRef<HTMLDivElement>(null);

  const toggleVis = (id: string, val: boolean) => {
    setVis((prev) => { const next = { ...prev, [id]: val }; saveVisibility(next); return next; });
  };
  const hideSection = (id: string) => toggleVis(id, false);
  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => { const next = { ...prev, [id]: !prev[id] }; saveCollapsed(next); return next; });
  };
  const applyPreset = (hidden: SectionId[]) => {
    const next: Record<string, boolean> = {};
    for (const sec of ALL_SECTIONS) next[sec.id] = !hidden.includes(sec.id);
    setVis(next); saveVisibility(next);
  };
  const showAll = () => { setVis({}); saveVisibility({}); };
  const changeScale = (s: number) => { setUiScale(s); localStorage.setItem("panel_scale", String(s)); };

  // Sync --ui-scale CSS variable with uiScale state
  React.useEffect(() => {
    document.documentElement.style.setProperty("--ui-scale", String(uiScale));
  }, [uiScale]);

  // Mobile tab navigation
  const [mobileTab, setMobileTab] = React.useState<"chat" | "schedule" | "settings">("chat");

  // Column resize
  React.useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (draggingCol.current === null) return;
      const totalW = window.innerWidth;
      const pct = (e.clientX / totalW) * 100;
      setColWidths((prev) => {
        const next = [...prev] as [number, number, number];
        if (draggingCol.current === 0) {
          const clamped = Math.max(12, Math.min(40, pct));
          const delta = clamped - prev[0];
          next[0] = clamped;
          next[1] = prev[1] - delta;
        } else if (draggingCol.current === 1) {
          const clamped = Math.max(prev[0] + 20, Math.min(85, pct));
          next[1] = clamped - prev[0];
          next[2] = 100 - clamped;
        }
        return next;
      });
    };
    const onUp = () => {
      if (draggingCol.current !== null) {
        draggingCol.current = null;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        setColWidths((prev) => { localStorage.setItem("panel_col_widths", JSON.stringify(prev)); return prev; });
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  const startColDrag = (idx: number) => {
    draggingCol.current = idx;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  // Vertical chat height resize
  React.useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingChatH.current || !chatTopRef.current) return;
      const rect = chatTopRef.current.getBoundingClientRect();
      const parentEl = chatTopRef.current.parentElement;
      const maxH = parentEl ? parentEl.clientHeight * 0.8 : 600;
      const newH = Math.max(150, Math.min(maxH, e.clientY - rect.top));
      setChatHeight(newH);
    };
    const onUp = () => {
      if (draggingChatH.current) {
        draggingChatH.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        setChatHeight((h) => { localStorage.setItem("chat_height", String(h)); return h; });
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  const startChatDrag = () => {
    draggingChatH.current = true;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  };

  // Выбранные сотрудники для расчета графика
  const [selectedRosterUsers, setSelectedRosterUsers] = React.useState<Set<string>>(() => {
    // Загружаем из localStorage или используем всех по умолчанию
    const stored = localStorage.getItem("roster_selected_users");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        return new Set(parsed);
      } catch {
        // Если ошибка парсинга, используем всех
      }
    }
    // По умолчанию выбираем всех junior сотрудников
    return new Set(UserDirectory.getAllUsers().filter(u => u.role === "junior").map(u => u.id));
  });

  // Проверка backend /health
  React.useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/health");
        setBackendOk(res.ok);
      } catch {
        setBackendOk(false);
      }
    })();
    // Load Paraplan status
    (async () => {
      try {
        const res = await fetch("/api/paraplan/status");
        const data = await res.json();
        if (data.ok) setParaplanStatus(data);
      } catch { /* ignore */ }
      try {
        const res = await fetch("/api/paraplan/hours");
        const data = await res.json();
        if (data.ok) setParaplanHours(data);
      } catch { /* ignore */ }
    })();
  }, []);

  // Загрузка tenants из /debug/tenants
  React.useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/debug/tenants");
        const data = await res.json();
        const t: Tenant[] = data.tenants ?? [];
        setTenants(t);
        if (t.length > 0) {
          // Prefer "emu" (main) tenant, fall back to first
          const preferred = t.find(x => x.tenant_id === "emu") || t[0];
          setSelectedTenant(preferred.tenant_id);
        }
      } catch (e) {
        console.error("Failed to load tenants", e);
      }
    })();
  }, []);

  // Загрузка dialogs для выбранного tenant
  React.useEffect(() => {
    if (!selectedTenant) return;
    (async () => {
      try {
        const res = await fetch(
          `/debug/dialogs?tenant_id=${encodeURIComponent(selectedTenant)}`,
        );
        const data = await res.json();
        const ds: DialogSummary[] = data.dialogs ?? [];
        setDialogs(ds);
        if (ds.length > 0) {
          // Prefer Telegram group chats (negative IDs or tg_ prefix)
          const tgChat = ds.find(d => d.chat_id.startsWith("-") || d.chat_id.startsWith("tg_"));
          const bestChat = (tgChat || ds[0]).chat_id;
          // Auto-select if no chat selected or current chat not in the new dialog list
          if (!selectedChatId || !ds.some(d => d.chat_id === selectedChatId)) {
            setSelectedChatId(bestChat);
          }
        }
      } catch (e) {
        console.error("Failed to load dialogs", e);
      }
    })();
  }, [selectedTenant]);

  // Загрузка событий для выбранного диалога
  React.useEffect(() => {
    if (!selectedTenant || !selectedChatId) return;
    (async () => {
      try {
        const res = await fetch(
          `/debug/dialog/${encodeURIComponent(selectedChatId)}?tenant_id=${encodeURIComponent(
            selectedTenant,
          )}`,
        );
        const data = await res.json();
        setEvents(data.events ?? []);
        // Build facts-per-event map
        if (data.facts) {
          const fmap = new Map<number, any[]>();
          for (const f of data.facts) {
            const eid = f.event_id;
            if (!fmap.has(eid)) fmap.set(eid, []);
            fmap.get(eid)!.push(f);
          }
          setFactsPerEvent(fmap);
        }
      } catch (e) {
        console.error("Failed to load dialog events", e);
      }
    })();
  }, [selectedTenant, selectedChatId, lastSend]);

  // Auto-load schedule when chat or week changes
  React.useEffect(() => {
    if (!selectedChatId) return;
    (async () => {
      try {
        const url = `/debug/schedule?chat_id=${encodeURIComponent(selectedChatId)}&week_start=${encodeURIComponent(weekStartISO)}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          setSchedule(data);
        }
      } catch (e) {
        console.error("[auto-refresh schedule]", e);
      }
    })();
  }, [selectedChatId, weekStartISO]);

  // Load settings from API
  React.useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/settings");
        const data = await res.json();
        if (data.ok) setApiSettings(data.settings || {});
      } catch (e) { console.error("Failed to load settings", e); }
    })();
  }, []);

  // Load Emogen prices once when groups tab is selected
  React.useEffect(() => {
    if (settingsTab !== "groups" || emogenFetched.current) return;
    emogenFetched.current = true;
    setEmogenLoading(true);
    setEmogenError(null);
    fetch("/api/emogen/groups").then(r => {
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json();
    }).then(d => {
      setEmogenPrices(d);
    }).catch((e) => {
      setEmogenError("Emogen недоступен: " + e.message);
    }).finally(() => setEmogenLoading(false));
  }, [settingsTab]);

  // Load employees from API
  const loadEmployees = React.useCallback(async () => {
    try {
      const res = await fetch("/api/employees");
      const data = await res.json();
      if (data.ok) setApiEmployees(data.employees || []);
    } catch (e) { console.error("Failed to load employees", e); }
  }, []);

  React.useEffect(() => {
    loadEmployees();
  }, [loadEmployees]);

  const saveSetting = async (key: string, value: any) => {
    try {
      await fetch(`/api/settings/${encodeURIComponent(key)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value, tenant_id: "dev" }),
      });
      setApiSettings((prev) => ({ ...prev, [key]: value }));
    } catch (e) { console.error("Failed to save setting", e); }
  };

  const saveEmployee = async (emp: any) => {
    if (!emp || !emp.id) { console.error("No employee to save"); return false; }
    const payload: Record<string, any> = {};
    if (emp.name !== undefined) payload.name = String(emp.name);
    if (emp.role !== undefined) payload.role = String(emp.role);
    if (emp.rate_per_hour !== undefined) payload.rate_per_hour = Number(emp.rate_per_hour);
    if (emp.min_hours_per_week !== undefined) payload.min_hours_per_week = Number(emp.min_hours_per_week);
    if (emp.auto_schedule !== undefined) payload.auto_schedule = Boolean(emp.auto_schedule);
    if (emp.branch !== undefined) payload.branch = String(emp.branch);
    if (emp.skill_level !== undefined) payload.skill_level = String(emp.skill_level);
    if (emp.telegram_user_id !== undefined) payload.telegram_user_id = emp.telegram_user_id ? String(emp.telegram_user_id) : null;
    console.log("=== SAVE EMPLOYEE ===", emp.id, JSON.stringify(payload));
    try {
      const res = await fetch(`/api/employees/${encodeURIComponent(emp.id)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      console.log("=== RESPONSE ===", res.status, text);
      if (!res.ok) {
        alert("Ошибка сохранения: " + res.status + " " + text);
        return false;
      }
      await loadEmployees();
      return true;
    } catch (err: any) {
      console.error("=== FETCH ERROR ===", err);
      alert("Ошибка сети: " + err.message);
      return false;
    }
  };

  const inlineEditEmployee = (empId: string, field: string, value: any) => {
    // Update local state immediately for responsive UI
    setApiEmployees((prev) => prev.map((e) => e.id === empId ? { ...e, [field]: value } : e));
    // Accumulate pending changes
    if (!empPendingChanges.current[empId]) empPendingChanges.current[empId] = {};
    empPendingChanges.current[empId][field] = value;
    // Debounce API save
    if (empDebounceTimers.current[empId]) clearTimeout(empDebounceTimers.current[empId]);
    empDebounceTimers.current[empId] = setTimeout(async () => {
      const changes = empPendingChanges.current[empId];
      delete empPendingChanges.current[empId];
      if (!changes) return;
      const ok = await saveEmployee({ id: empId, ...changes });
      if (ok) {
        setSavedEmployeeIds((prev) => ({ ...prev, [empId]: true }));
        setTimeout(() => setSavedEmployeeIds((prev) => ({ ...prev, [empId]: false })), 1200);
      }
    }, 500);
  };

  const createEmployee = async (emp: { id: string; name: string; role?: string; rate_per_hour?: number }) => {
    try {
      const res = await fetch("/api/employees", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(emp),
      });
      const data = await res.json();
      if (data.ok) setApiEmployees((prev) => [...prev, data.employee]);
      return data;
    } catch (e) { console.error("Failed to create employee", e); return { ok: false }; }
  };

  const deleteEmployee = async (empId: string) => {
    if (!window.confirm(`Удалить сотрудника ${empId}?`)) return;
    try {
      const res = await fetch(`/api/employees/${encodeURIComponent(empId)}`, { method: "DELETE" });
      const data = await res.json();
      if (data.ok) {
        setApiEmployees((prev) => prev.map((e) => e.id === empId ? { ...e, is_active: false } : e));
      }
    } catch (e) { console.error("Failed to delete employee", e); }
  };

  // Auto-scroll chat on new messages
  React.useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  // Monitor pending confirmations and set up reminders/escalations
  React.useEffect(() => {
    if (!schedule || !schedule.slots) return;

    // Clear existing timers
    for (const timeout of reminders.values()) clearTimeout(timeout);
    for (const timeout of escalations.values()) clearTimeout(timeout);
    setReminders(new Map());
    setEscalations(new Map());

    // Find users with pending slots
    const pendingByUser = new Map<string, number>();
    for (const slot of schedule.slots) {
      if (slot.user_id && slot.status === "PENDING") {
        pendingByUser.set(slot.user_id, (pendingByUser.get(slot.user_id) || 0) + 1);
      }
    }

    setPendingUsers(new Set(pendingByUser.keys()));

    // Автоматически закрываем задачи UNCONFIRMED для пользователей, которые подтвердили
    // И создаём задачи GAP для незаполненных слотов
    setActiveTasks((prev) => {
      const next = new Map(prev);
      
      // Закрываем UNCONFIRMED задачи для подтвердивших пользователей
      for (const [taskId, task] of prev.entries()) {
        if (taskId.startsWith("UNCONFIRMED:") && task.status === "OPEN") {
          const parts = taskId.split(":");
          const taskWeekStart = parts[1];
          const taskUserId = parts[2];
          // Если пользователь больше не в pending или неделя изменилась - закрываем задачу
          if (taskWeekStart !== weekStartISO || !pendingByUser.has(taskUserId)) {
            next.set(taskId, { ...task, status: "RESOLVED" });
          }
        }
      }
      
      // Создаём/обновляем задачи GAP для незаполненных слотов
      const emptySlots = (schedule.slots || []).filter((s: any) => s.status === "EMPTY");
      const now = Date.now();
      for (const slot of emptySlots) {
        const taskId = `GAP:${weekStartISO}:${slot.dow}:${slot.from}:${slot.to}`;
        const existing = next.get(taskId);
        if (!existing || existing.status === "RESOLVED") {
          // Создаём новую задачу
          next.set(taskId, {
            id: taskId,
            title: `Незаполненная смена: ${slot.slot_name} ${slot.dow} ${slot.from}-${slot.to}`,
            severity: "error",
            createdAt: now,
            updatedAt: now,
            status: "OPEN",
            counter: 1,
            nextReminderAt: now + 60000,
          });
        } else if (existing.status === "OPEN") {
          // Обновляем существующую (с кулдауном)
          const timeSinceLastUpdate = now - existing.updatedAt;
          if (timeSinceLastUpdate >= 60000) {
            next.set(taskId, {
              ...existing,
              counter: existing.counter + 1,
              updatedAt: now,
              nextReminderAt: now + 60000,
            });
          }
        }
      }
      
      // Закрываем GAP задачи для заполненных слотов
      for (const [taskId, task] of prev.entries()) {
        if (taskId.startsWith("GAP:") && task.status === "OPEN") {
          const parts = taskId.split(":");
          const taskWeekStart = parts[1];
          const taskDow = parts[2];
          const taskFrom = parts[3];
          const taskTo = parts[4];
          // Проверяем, заполнен ли этот слот
          const isFilled = (schedule.slots || []).some(
            (s: any) =>
              s.dow === taskDow &&
              s.from === taskFrom &&
              s.to === taskTo &&
              s.status !== "EMPTY"
          );
          if (taskWeekStart !== weekStartISO || isFilled) {
            next.set(taskId, { ...task, status: "RESOLVED" });
          }
        }
      }
      
      return next;
    });

    // Set up reminders (T1 = 30 seconds) and escalations (T2 = 60 seconds)
    for (const [userId, count] of pendingByUser.entries()) {
      const reminderId = `reminder_${userId}`;
      const escalationId = `escalation_${userId}`;

      // T1: Reminder after 30 seconds (только логируем, не блокируем)
      const reminderTimeout = setTimeout(() => {
        console.log(`[REMINDER] ${userId} не подтвердил график (${count} смен)`);
        // Не показываем alert, только логируем
      }, 30000); // 30 seconds

      // T2: Escalation after 60 seconds (создаём задачу вместо alert)
      const escalationTimeout = setTimeout(() => {
        console.log(`[ESCALATION] ${userId} не подтвердил график`);
        // Создаём/обновляем задачу вместо блокирующего alert
        const taskId = `UNCONFIRMED:${weekStartISO}:${userId}`;
        const now = Date.now();
        setActiveTasks((prev) => {
          const next = new Map(prev);
          const existing = next.get(taskId);
          if (existing && existing.status === "OPEN") {
            // Обновляем существующую задачу (дедупликация)
            const timeSinceLastUpdate = now - existing.updatedAt;
            if (timeSinceLastUpdate >= 60000) {
              // Кулдаун: обновляем только если прошло >= 60 секунд
              next.set(taskId, {
                ...existing,
                counter: existing.counter + 1,
                updatedAt: now,
                nextReminderAt: now + 60000, // следующий кулдаун через 60 секунд
              });
            } else {
              // В пределах кулдауна - только логируем, не обновляем UI
              console.log(`[ESCALATION] Task ${taskId} skipped (cooldown: ${Math.ceil((60000 - timeSinceLastUpdate) / 1000)}s remaining)`);
            }
          } else {
            // Создаём новую задачу
            next.set(taskId, {
              id: taskId,
              title: `${userId} не подтвердил график`,
              severity: "warning",
              createdAt: now,
              updatedAt: now,
              status: "OPEN",
              counter: 1,
              nextReminderAt: now + 60000,
            });
          }
          return next;
        });
      }, 60000); // 60 seconds

      setReminders((prev) => {
        const next = new Map(prev);
        next.set(reminderId, reminderTimeout);
        return next;
      });
      setEscalations((prev) => {
        const next = new Map(prev);
        next.set(escalationId, escalationTimeout);
        return next;
      });
    }

    // Cleanup on unmount
    return () => {
      for (const timeout of reminders.values()) clearTimeout(timeout);
      for (const timeout of escalations.values()) clearTimeout(timeout);
    };
  }, [schedule, weekStartISO]);

  // Helper: load dialog events
  const loadDialogEvents = async (chatId: string, tenantId: string) => {
    try {
      const res = await fetch(
        `/debug/dialog/${encodeURIComponent(chatId)}?tenant_id=${encodeURIComponent(tenantId)}`,
      );
      const data = await res.json();
      setEvents(data.events ?? []);
      if (data.facts) {
        const fmap = new Map<number, any[]>();
        for (const f of data.facts) {
          const eid = f.event_id;
          if (!fmap.has(eid)) fmap.set(eid, []);
          fmap.get(eid)!.push(f);
        }
        setFactsPerEvent(fmap);
      }
    } catch (e) {
      console.error("Failed to load dialog events", e);
      setLastError(`Failed to load events: ${String(e)}`);
    }
  };

  // Current user_id based on sender role and selected user
  // Owner and admin act on behalf of the selected employee
  const currentUserId =
    senderRole === "senior" ? "senior1"
    : senderRole === "admin" ? "admin1"
    : senderUserId;

  // Helper: refresh week state
  const refreshWeekState = async () => {
    try {
      setWeekStateErr("");
      if (!selectedChatId) {
        setWeekStateErr("no chat selected");
        return;
      }

      const weekStart = weekStartISO || "2026-02-09";
      const url = `/debug/week_state?chat_id=${encodeURIComponent(selectedChatId)}&week_start=${encodeURIComponent(weekStart)}`;

      const res = await fetch(url);
      const text = await res.text();
      if (!res.ok) {
        setWeekStateErr(`HTTP ${res.status}: ${text.slice(0, 200)}`);
        setWeekStateResp(null);
        return;
      }

      const json = JSON.parse(text);
      setWeekStateResp(json);
    } catch (e: any) {
      setWeekStateErr(String(e?.message || e));
      setWeekStateResp(null);
    }
  };

  // Helper: refresh schedule grid
  const refreshSchedule = async () => {
    if (!selectedChatId) return;
    try {
      const url = `/debug/schedule?chat_id=${encodeURIComponent(selectedChatId)}&week_start=${encodeURIComponent(weekStartISO)}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setSchedule(data);
      }
    } catch (e) {
      console.error("[refreshSchedule]", e);
    }
  };

  // Helper: send debug message
  const debugSend = async (
    text: string,
    roleOverride?: "staff" | "senior" | "owner" | "admin",
  ) => {
    if (!selectedTenant || !selectedChatId) return;
    const role = roleOverride ?? senderRole;
    const user_id =
      role === "senior"
        ? "senior1"
        : role === "admin"
          ? "admin1"
          : senderUserId;

    const payload = { tenant_id: selectedTenant, chat_id: selectedChatId, user_id, text, meta: { role } };
    console.log("[debugSend]", payload);

    try {
      const res = await fetch("/debug/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const responseText = await res.text();
      console.log("[debugSend] response:", res.status, responseText.slice(0, 300));

      if (!res.ok) {
        setLastError(`HTTP ${res.status}: ${responseText.slice(0, 200)}`);
        showToast(`Ошибка: HTTP ${res.status}`, "err");
        return null;
      }

      let json: any;
      try {
        json = JSON.parse(responseText);
      } catch {
        setLastError(`Ответ не JSON: ${responseText.slice(0, 100)}`);
        showToast("Ошибка: ответ не JSON", "err");
        return null;
      }

      if (json.ok) {
        setLastSend({
          event: json.event,
          facts: json.facts ?? [],
          facts_count: json.facts_count ?? 0,
        });
        setLastError(null);
        const factsCount = json.facts_count ?? json.facts?.length ?? 0;
        showToast(`Отправлено (${factsCount} факт${factsCount === 1 ? "" : factsCount < 5 ? "а" : "ов"})`, "ok");
      } else {
        setLastError(`Send failed: ${json.error || "unknown error"}`);
        showToast(`Ошибка: ${json.error || "unknown"}`, "err");
      }

      // Refresh chat, week state, and schedule grid (live update)
      await loadDialogEvents(selectedChatId, selectedTenant);
      await refreshWeekState();
      await refreshSchedule();
      return json;
    } catch (e) {
      console.error("[debugSend] exception:", e);
      setLastError(`Ошибка отправки: ${String(e)}. Проверьте что бэкенд запущен (node backend/server.js)`);
      showToast("Ошибка подключения к серверу", "err");
    }
  };

  // Period date helpers
  const getPeriodDates = (mode: string, refDate: string) => {
    const d = new Date(refDate);
    const y = d.getFullYear();
    const m = d.getMonth();
    const lastDay = new Date(y, m + 1, 0).getDate();
    if (mode === "first_half") return { start: `${y}-${String(m+1).padStart(2,"0")}-01`, end: `${y}-${String(m+1).padStart(2,"0")}-15` };
    if (mode === "second_half") return { start: `${y}-${String(m+1).padStart(2,"0")}-16`, end: `${y}-${String(m+1).padStart(2,"0")}-${lastDay}` };
    if (mode === "full_month") return { start: `${y}-${String(m+1).padStart(2,"0")}-01`, end: `${y}-${String(m+1).padStart(2,"0")}-${lastDay}` };
    return null; // week mode
  };

  const loadTimesheet = async (modeOverride?: string) => {
    try {
      setTimesheetErr("");
      if (!selectedChatId) {
        setTimesheetErr("no chat selected");
        return;
      }

      const mode = modeOverride ?? periodMode;
      const weekStart = weekStartISO || "2026-02-09";
      const roleParam = senderRole === "staff" ? `&role=staff&user_id=${encodeURIComponent(currentUserId)}` : "";

      let url: string;
      const periodDates = getPeriodDates(mode, weekStart);
      if (periodDates) {
        url = `/debug/timesheet-period?chat_id=${encodeURIComponent(selectedChatId)}&period_start=${periodDates.start}&period_end=${periodDates.end}${roleParam}`;
      } else {
        url = `/debug/timesheet?chat_id=${encodeURIComponent(selectedChatId)}&week_start=${encodeURIComponent(weekStart)}${roleParam}`;
      }

      const res = await fetch(url);
      const text = await res.text();
      if (!res.ok) {
        setTimesheetErr(`HTTP ${res.status}: ${text.slice(0, 200)}`);
        setTimesheet(null);
        return;
      }

      const json = JSON.parse(text);
      setTimesheet(json.timesheet);

      // Also load pending extra work for approval section
      if (senderRole !== "staff") {
        loadPendingExtraWork();
      }
    } catch (e: any) {
      setTimesheetErr(String(e?.message || e));
      setTimesheet(null);
    }
  };

  // Reload timesheet when role or sender changes
  React.useEffect(() => {
    if (selectedChatId && timesheet) {
      loadTimesheet();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [senderRole, senderUserId]);

  const loadPendingExtraWork = async () => {
    try {
      const r = await fetch(`/api/extra-work?chat_id=${encodeURIComponent(selectedChatId || "director")}&status=pending`);
      const d = await r.json();
      if (d.ok) setPendingExtraWork(d.items || []);
    } catch (e) { console.error("loadPendingExtraWork", e); }
  };

  const approveExtraWork = async (id: string) => {
    try {
      const res = await fetch(`/api/extra-work/${id}/approve`, { method: "PUT" });
      const data = await res.json().catch(() => ({}));
      const workName = data?.extra_work?.fact_payload?.work_name || "допработа";
      const price = data?.extra_work?.fact_payload?.price;
      const priceStr = price ? ` (${price}\u20BD)` : "";
      showToast(`\u2705 Утверждено: ${workName}${priceStr}`);
      setModalSuccess(`Утверждено: ${workName}${priceStr}`);
      loadPendingExtraWork();
      loadTimesheet();
      setTimeout(() => { setShowExtraPayModal(null); setModalSuccess(null); }, 1500);
    } catch (e) { console.error("approveExtraWork", e); }
  };

  const rejectExtraWork = async (id: string) => {
    try {
      const res = await fetch(`/api/extra-work/${id}/reject`, { method: "PUT" });
      const data = await res.json().catch(() => ({}));
      const workName = data?.extra_work?.fact_payload?.work_name || "допработа";
      showToast(`\u274C Отклонено: ${workName}`);
      setModalSuccess(`Отклонено: ${workName}`);
      loadPendingExtraWork();
      loadTimesheet();
      setTimeout(() => { setShowExtraPayModal(null); setModalSuccess(null); }, 1500);
    } catch (e) { console.error("rejectExtraWork", e); }
  };

  const addExtraPay = async (user_id: string, amount: number, comment: string) => {
    try {
      // Compute date from weekStart + dow offset (if modal has dow)
      const DOW_OFFSET: Record<string, number> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };
      let payDate = new Date().toISOString().slice(0, 10);
      if (showExtraPayModal?.dow && weekStartISO) {
        const ws = new Date(weekStartISO + "T00:00:00Z");
        ws.setUTCDate(ws.getUTCDate() + (DOW_OFFSET[showExtraPayModal.dow] ?? 0));
        payDate = ws.toISOString().slice(0, 10);
      }
      const res = await fetch("/api/extra-pay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_id, amount, date: payDate, comment, chat_id: selectedChatId || "director" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const empName = showExtraPayModal?.name || user_id;
      const label = comment || "доп";
      setModalSuccess(`${amount}\u20BD \u2014 ${label}`);
      showToast(`Доп добавлен для ${empName}: ${amount}\u20BD`);
      loadTimesheet();
      setTimeout(() => { setShowExtraPayModal(null); setModalSuccess(null); }, 1500);
    } catch (e: any) {
      showToast(`Ошибка: ${e?.message || e}`, "err");
    }
  };

  const deleteExtraItem = async (item: { id?: number; type: string; label: string; amount: number }) => {
    if (!item.id) return;
    if (!window.confirm(`Удалить ${item.label} ${item.amount}\u20BD?`)) return;
    try {
      const endpoint = item.type === "work" ? `/api/extra-work/${item.id}` : `/api/extra-pay/${item.id}`;
      const res = await fetch(endpoint, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast(`Удалено: ${item.label} ${item.amount}\u20BD`);
      loadTimesheet();
      loadPendingExtraWork();
    } catch (e: any) {
      showToast(`Ошибка удаления: ${e?.message || e}`, "err");
    }
  };

  // Extras lookup: "dow|user_id" -> items for grid cell icons
  const extrasMap = React.useMemo(() => {
    const map = new Map<string, Array<{ id?: number; type: string; label: string; amount: number; status: string }>>();
    const DOW_FROM_DATE: Record<number, string> = { 1: "mon", 2: "tue", 3: "wed", 4: "thu", 5: "fri", 6: "sat", 0: "sun" };
    const ws = schedule?.week_start || weekStartISO;
    if (!ws) return map;
    const wsDate = new Date(ws + "T00:00:00Z");
    for (const emp of (timesheet?.employees || [])) {
      for (const ew of (emp.extra_work || [])) {
        if (!ew.date) continue;
        const d = new Date(ew.date + "T00:00:00Z");
        const dow = DOW_FROM_DATE[d.getUTCDay()];
        if (!dow) continue;
        const diff = (d.getTime() - wsDate.getTime()) / 86400000;
        if (diff < 0 || diff > 6) continue;
        const key = `${dow}|${emp.user_id}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push({ id: ew.id, type: "work", label: ew.work_name || "Допработа", amount: ew.price || 0, status: ew.status || "pending" });
      }
      for (const ep of (emp.extra_pay || [])) {
        if (!ep.date) continue;
        const d = new Date(ep.date + "T00:00:00Z");
        const dow = DOW_FROM_DATE[d.getUTCDay()];
        if (!dow) continue;
        const diff = (d.getTime() - wsDate.getTime()) / 86400000;
        if (diff < 0 || diff > 6) continue;
        const key = `${dow}|${emp.user_id}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push({ id: ep.id, type: "pay", label: ep.comment || "Доп", amount: ep.amount || 0, status: "approved" });
      }
    }
    return map;
  }, [timesheet, schedule, weekStartISO]);

  const openExtraPayModal = (data: { user_id: string; name: string; dow?: string; slot?: string }) => {
    setModalSuccess(null);
    setModalShowAddForm(false);
    setShowExtraPayModal(data);
  };

  const openSlotModal = (dow: string, slotName: string, from: string, to: string, currentUserId: string | null, availableUserIds: string[], isLocked = false) => {
    const DOW_LABELS: Record<string, string> = { mon: "Пн", tue: "Вт", wed: "Ср", thu: "Чт", fri: "Пт", sat: "Сб", sun: "Вс" };
    const DOW_OFFSET: Record<string, number> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };
    const ws = new Date(weekStartISO + "T00:00:00");
    ws.setDate(ws.getDate() + (DOW_OFFSET[dow] ?? 0));
    const dd = String(ws.getDate()).padStart(2, "0");
    const mm = String(ws.getMonth() + 1).padStart(2, "0");
    const dayLabel = `${DOW_LABELS[dow] || dow} ${dd}.${mm}`;
    setSlotModal({ dow, slotName, from, to, currentUserId, dayLabel, slotLabel: slotName, availableUserIds, isLocked });
    setSlotModalSelectedUser(currentUserId || "");
  };

  return (
    <div className="app-root" style={{ gridTemplateColumns: `${colWidths[0]}% 4px ${colWidths[1]}% 4px ${colWidths[2]}%` }}>
      {backendOk === false && (
        <div className="empty" style={{ position: "absolute", top: 0, left: 0, right: 0 }}>
          Backend /health не отвечает
        </div>
      )}
      {/* Settings drawer + Help button */}
      <div style={{ position: "fixed", top: 4, right: 4, zIndex: 100, display: "flex", gap: 4 }}>
        <button
          onClick={() => setHelpOpen(true)}
          title="Инструкция по работе с ShiftLedger"
          style={{ background: "none", border: "1px solid #ccc", borderRadius: 4, cursor: "pointer", fontSize: 16, padding: "2px 6px", lineHeight: 1 }}
        >?</button>
        <SettingsDrawer vis={vis} onToggle={toggleVis} onPreset={applyPreset} onShowAll={showAll} scale={uiScale} onScale={changeScale} />
      </div>
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
      {/* Toast notification */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)",
          padding: "8px 16px", borderRadius: 6, fontSize: 13, zIndex: 2000,
          background: toast.type === "ok" ? "#28a745" : "#dc3545", color: "#fff",
          boxShadow: "0 2px 12px rgba(0,0,0,0.25)", pointerEvents: "none",
        }}>{toast.text}</div>
      )}
      {/* Mobile tab bar */}
      <div className="mobile-tab-bar">
        <button className={mobileTab === "chat" ? "active" : ""} onClick={() => setMobileTab("chat")}>Чат</button>
        <button className={mobileTab === "schedule" ? "active" : ""} onClick={() => setMobileTab("schedule")}>График</button>
        <button className={mobileTab === "settings" ? "active" : ""} onClick={() => setMobileTab("settings")}>Настройки</button>
      </div>
      {/* Левая колонка: Tenants + Dialogs */}
      <aside className={`pane pane-left${mobileTab !== "chat" ? " mobile-hidden" : ""}`}>
        {vis["tenants"] !== false && (
          <div className="pane-header" style={{ position: "relative" }}>
            <div onClick={() => toggleCollapse("tenants")} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 4, userSelect: "none" }}>
              <span style={{ fontSize: 10, color: "#999" }}>{collapsed["tenants"] ? "\u25B6" : "\u25BC"}</span>
              <h2 style={{ margin: 0 }}>Тенанты</h2>
            </div>
            {!collapsed["tenants"] && <div style={{ display: "flex", gap: "4px", alignItems: "center", flexWrap: "wrap" }}>
              <select
                value={selectedTenant ?? ""}
                onChange={(e) => setSelectedTenant(e.target.value || null)}
              >
                {tenants.map((t) => (
                  <option key={t.tenant_id} value={t.tenant_id}>
                    {t.tenant_id}
                  </option>
                ))}
              </select>
              <span style={{ color: "#999", fontSize: 12 }}>|</span>
              <label style={{ fontSize: 12, color: "#666" }}>Чат:</label>
              <select
                value={selectedChatId ?? ""}
                onChange={(e) => setSelectedChatId(e.target.value || null)}
                style={{ fontSize: 12 }}
              >
                {dialogs.map((d) => (
                  <option key={d.chat_id} value={d.chat_id}>
                    {d.chat_id === "dev_seed_chat" ? "Эмулятор" : d.chat_id.startsWith("tg_") ? `Telegram (${d.chat_id.replace("tg_", "")})` : d.chat_id}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  const newTenant = prompt("Введите имя нового tenant:");
                  if (newTenant && newTenant.trim()) {
                    setSelectedTenant(newTenant.trim());
                  }
                }}
              >
                + Tenant
              </button>
            </div>}
          </div>
        )}
        {vis["dialogs"] !== false && (
          <div className="pane-content" style={{ position: "relative" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
              <div onClick={() => toggleCollapse("dialogs")} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 4, userSelect: "none" }}>
                <span style={{ fontSize: 10, color: "#999" }}>{collapsed["dialogs"] ? "\u25B6" : "\u25BC"}</span>
                <h3 style={{ margin: 0 }}>Диалоги <InfoTip text="Список чатов. Выберите чат для просмотра сообщений" /></h3>
              </div>
              {!collapsed["dialogs"] && <button
                type="button"
                onClick={() => {
                  const newId = `chat_${Date.now().toString(36)}`;
                  setSelectedChatId(newId);
                  setEvents([]);
                  setDialogs((prev) => [{ chat_id: newId }, ...prev]);
                }}
                style={{ fontSize: "0.8em", padding: "2px 8px" }}
              >
                + Чат
              </button>}
            </div>
            {!collapsed["dialogs"] && <>
              {dialogs.length === 0 && <div className="empty">Нет диалогов</div>}
              <ul className="dialog-list">
                {dialogs.map((d) => (
                  <li
                    key={d.chat_id}
                    className={
                      d.chat_id === selectedChatId ? "dialog-item selected" : "dialog-item"
                    }
                    onClick={() => setSelectedChatId(d.chat_id)}
                  >
                    <div className="dialog-title">{d.chat_id}</div>
                    <div className="dialog-meta">
                      <span>{(d.last_text ?? "").length > 50 ? (d.last_text!.slice(0, 50) + "...") : (d.last_text ?? "")}</span>
                      {d.last_ts && <span>{new Date(d.last_ts).toLocaleString("ru-RU")}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            </>}
          </div>
        )}
      </aside>

      {/* Resize handle: left-center */}
      <div className="resize-handle" onMouseDown={() => startColDrag(0)} />

      {/* Центр: Chat window */}
      <main className={`pane pane-center${mobileTab !== "chat" ? " mobile-hidden" : ""}`}>
        <div className="pane-header">
          <h2>Чат <InfoTip text="Лента сообщений сотрудников. Введите сообщение внизу и нажмите Отправить" /></h2>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <label>
              Роль:
              <select
                value={senderRole}
                onChange={(e) => setSenderRole(e.target.value)}
                style={{ marginLeft: "4px" }}
              >
                <option value="staff">staff</option>
                <option value="senior">senior</option>
                <option value="owner">owner</option>
                <option value="admin">admin</option>
              </select>
            </label>
          </div>
        </div>
        <div className="pane-content chat-content">
          {/* Верхнее окно: Chat messages */}
          {vis["chat"] !== false && <div ref={chatTopRef} className="chat-window-top" style={{ flex: "none", height: chatHeight }}>
            <div className="chat-messages">
              {events.length === 0 ? (
                <div className="empty" style={{ alignSelf: "center", marginTop: "2rem" }}>
                  Выберите диалог или отправьте первое сообщение.
                </div>
              ) : (
                events.map((ev) => {
                  const isSystem = ev.user_id === "system" || ev.role === "system" || ev.meta?.system_message;
                  if (isSystem) {
                    return (
                      <div key={ev.id} style={{
                        textAlign: "center",
                        padding: "4px 12px",
                        margin: "4px 0",
                        fontSize: "0.8em",
                        fontStyle: "italic",
                        color: "#666",
                        backgroundColor: "#f0f0f0",
                        borderRadius: "8px",
                        maxWidth: "80%",
                        alignSelf: "center",
                        marginLeft: "auto",
                        marginRight: "auto",
                      }}>
                        {ev.text}
                      </div>
                    );
                  }
                  const isSelf = ev.user_id === currentUserId;
                  const evFacts = factsPerEvent.get(ev.id);
                  const ts = ev.received_at ? new Date(ev.received_at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "";
                  return (
                    <div key={ev.id} className={`chat-bubble ${isSelf ? "self" : "other"}`}>
                      <div className="bubble-header">
                        <span>{UserDirectory.getDisplayName(ev.user_id)} ({ev.user_id})</span>
                        <span>{ts}{evFacts && evFacts.length > 0 ? (evFacts.some((f: any) => f.fact_type === "SHIFT_REPLACEMENT") ? " 🔄" : " ✅") : ""}</span>
                      </div>
                      <div className="bubble-text">{ev.text}</div>
                    </div>
                  );
                })
              )}
              <div ref={chatEndRef} />
            </div>
            <form
              className="chat-input"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!inputText.trim() || sending) return;
                const text = inputText.trim();
                setInputText("");
                setSending(true);
                try {
                  await debugSend(text);
                } finally {
                  setSending(false);
                }
              }}
            >
              <select
                value={senderUserId}
                onChange={(e) => setSenderUserId(e.target.value)}
                disabled={sending}
                style={{ fontSize: "var(--font-sm)", padding: "var(--pad-xs) var(--pad-sm)", minWidth: 80 }}
              >
                {UserDirectory.getAllUsers().map((u) => (
                  <option key={u.id} value={u.id}>{u.displayName}</option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Введите сообщение..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                disabled={sending}
                style={{ flex: 1 }}
              />
              <button type="submit" disabled={sending || !inputText.trim() || !selectedTenant || !selectedChatId}>
                {sending ? "Отправка..." : "Отправить"}
              </button>
            </form>
          </div>}

          {/* Горизонтальный resize-handle между чатом и нижней секцией */}
          <div
            className="resize-handle-h"
            onMouseDown={startChatDrag}
          />

          {/* Нижнее окно: Сотрудники и Табель */}
          <div className="chat-window-bottom">
            {vis["payroll"] !== false && (
            <div style={{ borderBottom: "1px solid #ddd", overflow: "auto", position: "relative" }}>
              <div onClick={() => toggleCollapse("payroll")} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 6, userSelect: "none", padding: "6px 10px", background: collapsed["payroll"] ? "#f8f8f8" : "#eef3fb", borderBottom: collapsed["payroll"] ? "none" : "1px solid #d8e2f0" }}>
                <span style={{ fontSize: 10, color: "#888", transition: "transform 0.15s", display: "inline-block", transform: collapsed["payroll"] ? "rotate(-90deg)" : "rotate(0deg)" }}>{"\u25BC"}</span>
                <h3 style={{ margin: 0, fontSize: "var(--font-sm)", flex: 1 }}>Табель расчета зарплаты</h3>
              </div>
              {!collapsed["payroll"] && <>{timesheet ? (
                <div style={{ fontSize: "0.8em", padding: "8px" }}>
                  <div style={{ marginBottom: "8px", fontWeight: "bold" }}>
                    {(() => {
                      const RU_MONTHS = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
                      const ws = weekStartISO || timesheet.week_start;
                      const d = new Date(ws + "T12:00:00");
                      const dd = (dt: Date) => String(dt.getDate()).padStart(2, "0");
                      const mm = (dt: Date) => String(dt.getMonth() + 1).padStart(2, "0");
                      if (periodMode === "full_month") {
                        return `Табель за ${RU_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
                      }
                      if (periodMode === "first_half") {
                        const start = new Date(d.getFullYear(), d.getMonth(), 1);
                        const end = new Date(d.getFullYear(), d.getMonth(), 15);
                        return `Табель за период: ${dd(start)}.${mm(start)} \u2013 ${dd(end)}.${mm(end)}.${end.getFullYear()}`;
                      }
                      if (periodMode === "second_half") {
                        const start = new Date(d.getFullYear(), d.getMonth(), 16);
                        const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
                        const end = new Date(d.getFullYear(), d.getMonth(), lastDay);
                        return `Табель за период: ${dd(start)}.${mm(start)} \u2013 ${dd(end)}.${mm(end)}.${end.getFullYear()}`;
                      }
                      // week mode
                      const weD = new Date(d); weD.setDate(weD.getDate() + 6);
                      return `Табель за неделю: ${dd(d)}.${mm(d)} \u2013 ${dd(weD)}.${mm(weD)}.${weD.getFullYear()}`;
                    })()}
                  </div>
                  {timesheet.totals && (
                    <div style={{ marginBottom: "8px", padding: "4px", backgroundColor: "#f0f0f0", borderRadius: "4px" }}>
                      <strong>Итого:</strong> {fmtNum(timesheet.totals.total_hours)} ч, {fmtRub(timesheet.totals.total_pay)}
                    </div>
                  )}
                  {timesheet.employees && timesheet.employees.length > 0 ? (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.7em" }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid #ccc" }}>
                          <th style={{ textAlign: "left", padding: "2px 3px" }}>Имя</th>
                          <th style={{ textAlign: "right", padding: "2px 3px" }}>Часы</th>
                          <th style={{ textAlign: "right", padding: "2px 3px" }}>Пробл.</th>
                          <th style={{ textAlign: "right", padding: "2px 3px" }}>Эфф.ч</th>
                          <th style={{ textAlign: "right", padding: "2px 3px" }}>Смены ₽</th>
                          <th style={{ textAlign: "right", padding: "2px 3px" }}>Уб.</th>
                          <th style={{ textAlign: "right", padding: "2px 3px" }}>Уб. ₽</th>
                          <th style={{ textAlign: "right", padding: "2px 3px" }}>Допы</th>
                          <th style={{ textAlign: "right", padding: "2px 3px" }}>Дети</th>
                          <th style={{ textAlign: "right", padding: "2px 3px" }}>Допы ₽</th>
                          <th style={{ textAlign: "right", padding: "2px 3px" }}>Доп₽</th>
                          {timesheet.employees.some((e: any) => (e.inter_branch_pay || 0) > 0) && <th style={{ textAlign: "right", padding: "2px 3px" }}>{"\u041C\u0435\u0436\u0444."}</th>}
                          <th style={{ textAlign: "right", padding: "2px 3px", fontWeight: "bold" }}>Итого ₽</th>
                        </tr>
                      </thead>
                      <tbody>
                        {timesheet.employees.map((emp: any, idx: number) => (
                          <tr key={idx} style={{ borderBottom: "1px solid #eee" }}>
                            <td style={{ padding: "2px 3px" }}>{emp.name || emp.user_id}</td>
                            <td style={{ textAlign: "right", padding: "2px 3px" }}>{fmtNum(emp.shift_hours)}</td>
                            <td style={{ textAlign: "right", padding: "2px 3px", color: emp.problem_shifts > 0 ? "#dc3545" : undefined }}>{emp.problem_shifts}</td>
                            <td style={{ textAlign: "right", padding: "2px 3px" }}>{fmtNum(emp.effective_hours)}</td>
                            <td style={{ textAlign: "right", padding: "2px 3px" }}>{fmtRub(emp.shift_pay)}</td>
                            <td style={{ textAlign: "right", padding: "2px 3px" }}>{emp.cleaning_count}</td>
                            <td style={{ textAlign: "right", padding: "2px 3px" }}>{fmtRub(emp.cleaning_pay)}</td>
                            <td style={{ textAlign: "right", padding: "2px 3px" }}>{emp.extra_classes_count ?? emp.extra_classes?.length ?? 0}</td>
                            <td style={{ textAlign: "right", padding: "2px 3px" }}>{emp.extra_classes_total_kids ?? 0}</td>
                            <td style={{ textAlign: "right", padding: "2px 3px" }}>{fmtRub(emp.extra_classes_total_pay ?? emp.extra_pay ?? 0)}</td>
                            <td style={{ textAlign: "right", padding: "2px 3px" }}>{(() => { const sum = (emp.extra_work_approved_pay || 0) + (emp.extra_pay_total || 0); return sum > 0 ? fmtRub(sum) : "\u2014"; })()}</td>
                            {timesheet.employees.some((e: any) => (e.inter_branch_pay || 0) > 0) && <td style={{ textAlign: "right", padding: "2px 3px" }}>{(emp.inter_branch_pay || 0) > 0 ? fmtNum(emp.inter_branch_pay) : "\u2014"}</td>}
                            <td style={{ textAlign: "right", padding: "2px 3px", fontWeight: "bold" }}>{fmtRub(emp.total_pay)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="empty">Нет данных. Нажмите "Показать табель" в Debug панели.</div>
                  )}
                </div>
              ) : (
                <div className="empty">Табель не загружен. Нажмите "Показать табель" в Debug панели.</div>
              )}</>}
            </div>
            )}

            {/* Настройки */}
            {vis["settings"] !== false && (
            <div style={{ borderBottom: "1px solid #ddd", position: "relative", overflow: "auto" }}>
              <div onClick={() => toggleCollapse("settings")} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 6, userSelect: "none", padding: "6px 10px", background: collapsed["settings"] ? "#f8f8f8" : "#eef3fb", borderBottom: collapsed["settings"] ? "none" : "1px solid #d8e2f0" }}>
                <span style={{ fontSize: 10, color: "#888", transition: "transform 0.15s", display: "inline-block", transform: collapsed["settings"] ? "rotate(-90deg)" : "rotate(0deg)" }}>{"\u25BC"}</span>
                <h3 style={{ margin: 0, fontSize: "var(--font-sm)", flex: 1 }}>Настройки</h3>
              </div>
              {!collapsed["settings"] && <div style={{ padding: "8px" }}>
              {/* Sub-tabs */}
              <div style={{ display: "flex", gap: 2, marginBottom: 6, borderBottom: "1px solid #ddd", flexWrap: "wrap" }}>
                {(["shifts", "staff", "rates", "branches", "catalog", "cleaning", "groups"] as const).map((t) => (
                  <button key={t} onClick={() => {
                    setSettingsTab(t);
                    if (t === "groups" && groupsConfig.length === 0) {
                      setGroupsLoading(true);
                      fetch(`/api/paraplan/groups-config?tenant_id=${selectedTenant || "dev"}`).then(r => r.json()).then(d => {
                        if (d.ok) setGroupsConfig(d.groups || []);
                      }).catch(() => {}).finally(() => setGroupsLoading(false));
                    }
                  }} style={{
                    padding: "3px 8px", border: "none", fontSize: "var(--font-xs)", cursor: "pointer",
                    background: settingsTab === t ? "#007bff" : "transparent",
                    color: settingsTab === t ? "#fff" : "#666", borderRadius: "3px 3px 0 0",
                  }}>{{ shifts: "\u0421\u043C\u0435\u043D\u044B", staff: "\u0421\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u0438", rates: "\u0421\u0442\u0430\u0432\u043A\u0438", branches: "\u0424\u0438\u043B\u0438\u0430\u043B\u044B", catalog: "\u041A\u0430\u0442\u0430\u043B\u043E\u0433", cleaning: "\u0423\u0431\u043E\u0440\u043A\u0438", groups: "\u0413\u0440\u0443\u043F\u043F\u044B" }[t]}</button>
                ))}
              </div>

              {/* Смены */}
              {settingsTab === "shifts" && (
                <div style={{ fontSize: "var(--font-xs)" }}>
                  {[
                    { label: "Утренняя", prefix: "shifts.morning" },
                    { label: "Вечерняя", prefix: "shifts.evening" },
                  ].map((shift) => (
                    <div key={shift.prefix} style={{ marginBottom: 6 }}>
                      <div style={{ fontWeight: "bold", marginBottom: 2 }}>{shift.label}</div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <label>с <input type="text" value={apiSettings[`${shift.prefix}.from`] || ""} style={{ width: 50, fontSize: "var(--font-xs)", padding: "1px 3px" }}
                          onChange={(e) => setApiSettings((p) => ({ ...p, [`${shift.prefix}.from`]: e.target.value }))}
                          onBlur={(e) => saveSetting(`${shift.prefix}.from`, e.target.value)}
                        /></label>
                        <label>до <input type="text" value={apiSettings[`${shift.prefix}.to`] || ""} style={{ width: 50, fontSize: "var(--font-xs)", padding: "1px 3px" }}
                          onChange={(e) => setApiSettings((p) => ({ ...p, [`${shift.prefix}.to`]: e.target.value }))}
                          onBlur={(e) => saveSetting(`${shift.prefix}.to`, e.target.value)}
                        /></label>
                        <span style={{ color: "#666" }}>
                          {(() => {
                            const from = apiSettings[`${shift.prefix}.from`] || "0:00";
                            const to = apiSettings[`${shift.prefix}.to`] || "0:00";
                            const [fh, fm] = from.split(":").map(Number);
                            const [th, tm] = to.split(":").map(Number);
                            const h = (th * 60 + (tm || 0) - fh * 60 - (fm || 0)) / 60;
                            return h > 0 ? `${h.toFixed(1)} ч` : "—";
                          })()}
                        </span>
                      </div>
                    </div>
                  ))}
                  <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid #ddd" }}>
                    <div style={{ fontWeight: "bold", marginBottom: 4 }}>Автосбор графика</div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <input
                          type="checkbox"
                          checked={!!apiSettings["schedule.auto_collect_enabled"]}
                          onChange={(e) => {
                            const val = e.target.checked;
                            setApiSettings((p) => ({ ...p, "schedule.auto_collect_enabled": val }));
                            saveSetting("schedule.auto_collect_enabled", val);
                          }}
                        />
                        Автоматический сбор графика
                      </label>
                    </div>
                    {apiSettings["schedule.auto_collect_enabled"] && (
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <span>День недели:</span>
                        <select
                          value={apiSettings["schedule.auto_collect_day"] || "fri"}
                          style={{ fontSize: "var(--font-xs)", padding: "1px 3px" }}
                          onChange={(e) => {
                            const val = e.target.value;
                            setApiSettings((p) => ({ ...p, "schedule.auto_collect_day": val }));
                            saveSetting("schedule.auto_collect_day", val);
                          }}
                        >
                          {[
                            { value: "mon", label: "Пн" },
                            { value: "tue", label: "Вт" },
                            { value: "wed", label: "Ср" },
                            { value: "thu", label: "Чт" },
                            { value: "fri", label: "Пт" },
                            { value: "sat", label: "Сб" },
                            { value: "sun", label: "Вс" },
                          ].map((d) => (
                            <option key={d.value} value={d.value}>{d.label}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Сотрудники */}
              {settingsTab === "staff" && (
                <div style={{ fontSize: "var(--font-xs)" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--font-xs)" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid #ccc" }}>
                        <th style={{ textAlign: "left", padding: "2px 3px" }}>ID</th>
                        <th style={{ textAlign: "left", padding: "2px 3px" }}>Имя</th>
                        <th style={{ textAlign: "left", padding: "2px 3px" }}>Роль</th>
                        <th style={{ textAlign: "left", padding: "2px 3px" }}>Квалиф.</th>
                        <th style={{ textAlign: "right", padding: "2px 3px" }}>₽/ч</th>
                        <th style={{ textAlign: "right", padding: "2px 3px" }}>Мин.ч</th>
                        <th style={{ textAlign: "center", padding: "2px 3px" }}>Авто</th>
                        <th style={{ textAlign: "left", padding: "2px 3px" }}>Филиал</th>
                        <th style={{ textAlign: "left", padding: "2px 3px" }}>TG ID</th>
                        <th style={{ padding: "2px 3px" }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {apiEmployees.filter((e) => e.is_active).map((emp) => {
                        const inputStyle = { fontSize: "var(--font-xs)", padding: "1px 3px", border: "1px solid #ddd", borderRadius: 3, background: "#fafafa", width: "100%", boxSizing: "border-box" as const };
                        return (
                        <tr key={emp.id} style={{ borderBottom: "1px solid #eee" }}>
                          <td style={{ padding: "2px 3px", color: "#999", fontSize: "var(--font-xs)" }}>{emp.id}</td>
                          <td style={{ padding: "2px 3px" }}>
                            <input type="text" value={emp.name ?? ""} style={{ ...inputStyle, fontWeight: 500 }}
                              onChange={(e) => inlineEditEmployee(emp.id, "name", e.target.value)} />
                          </td>
                          <td style={{ padding: "2px 3px" }}>
                            <select value={emp.role || "junior"} style={{ ...inputStyle }}
                              onChange={(e) => inlineEditEmployee(emp.id, "role", e.target.value)}>
                              <option value="junior">junior</option>
                              <option value="senior">senior</option>
                            </select>
                          </td>
                          <td style={{ padding: "2px 3px" }}>
                            <select value={emp.skill_level || "beginner"} style={{ ...inputStyle }}
                              onChange={(e) => inlineEditEmployee(emp.id, "skill_level", e.target.value)}>
                              <option value="beginner">Нач.</option>
                              <option value="experienced">Опыт</option>
                              <option value="guru">Гуру</option>
                            </select>
                          </td>
                          <td style={{ padding: "2px 3px" }}>
                            <input type="number" value={emp.rate_per_hour ?? ""} style={{ ...inputStyle, textAlign: "right", width: 50 }}
                              onChange={(e) => inlineEditEmployee(emp.id, "rate_per_hour", Number(e.target.value))} />
                          </td>
                          <td style={{ padding: "2px 3px" }}>
                            <input type="number" value={emp.min_hours_per_week ?? ""} style={{ ...inputStyle, textAlign: "right", width: 40 }}
                              onChange={(e) => inlineEditEmployee(emp.id, "min_hours_per_week", Number(e.target.value))} />
                          </td>
                          <td style={{ textAlign: "center", padding: "2px 3px" }}>
                            <input type="checkbox" checked={emp.auto_schedule !== false}
                              onChange={(e) => inlineEditEmployee(emp.id, "auto_schedule", e.target.checked)} />
                          </td>
                          <td style={{ padding: "2px 3px" }}>
                            <select value={emp.branch || "Архангельск"} style={{ ...inputStyle }}
                              onChange={(e) => inlineEditEmployee(emp.id, "branch", e.target.value)}>
                              {(apiSettings.branches || ["Архангельск", "Северодвинск"]).map((b: string) => (
                                <option key={b} value={b}>{b}</option>
                              ))}
                            </select>
                          </td>
                          <td style={{ padding: "2px 3px" }}>
                            <input type="text" value={emp.telegram_user_id ?? ""} placeholder="—" style={{ ...inputStyle, width: 70, color: "#666" }}
                              onChange={(e) => inlineEditEmployee(emp.id, "telegram_user_id", e.target.value || null)} />
                          </td>
                          <td style={{ padding: "2px 3px", whiteSpace: "nowrap" }}>
                            {savedEmployeeIds[emp.id] && <span style={{ color: "#28a745", marginRight: 3 }} title="Сохранено">&#10003;</span>}
                            <button onClick={() => deleteEmployee(emp.id)} style={{ fontSize: "var(--font-xs)", padding: "1px 5px", cursor: "pointer", color: "#dc3545", background: "none", border: "1px solid #dc3545", borderRadius: 3 }}>{"\u00D7"}</button>
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <button onClick={() => {
                    const existing = apiEmployees.map((e) => e.id).filter((id) => /^u\d+$/.test(id)).map((id) => Number(id.slice(1)));
                    const nextNum = existing.length > 0 ? Math.max(...existing) + 1 : 5;
                    const newId = `u${nextNum}`;
                    createEmployee({ id: newId, name: "\u041D\u043E\u0432\u044B\u0439 \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A", role: "junior", rate_per_hour: 250 });
                  }} style={{ marginTop: 4, fontSize: "var(--font-xs)", padding: "2px 8px", cursor: "pointer" }}>+ Добавить сотрудника</button>
                </div>
              )}

              {/* Ставки */}
              {settingsTab === "rates" && (
                <div style={{ fontSize: "var(--font-xs)", display: "flex", flexDirection: "column", gap: 4 }}>
                  {[
                    { key: "pay.default_rate", label: "Ставка по умолч. (₽/ч)" },
                    { key: "pay.cleaning_rate", label: "Уборка (₽)" },
                    { key: "pay.extra_class_base", label: "Доп.занятие база (₽)" },
                    { key: "pay.extra_class_threshold", label: "Порог детей" },
                    { key: "pay.extra_class_per_kid", label: "За ребёнка сверх (₽)" },
                    { key: "pay.rounding_step", label: "Округление (₽)" },
                    { key: "pay.inter_branch_bonus", label: "Межфилиал (₽/смена)" },
                  ].map((item) => (
                    <div key={item.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span>{item.label}</span>
                      <input type="number" value={apiSettings[item.key] ?? ""} style={{ width: 70, fontSize: "var(--font-xs)", padding: "1px 3px", textAlign: "right" }}
                        onChange={(e) => setApiSettings((p) => ({ ...p, [item.key]: Number(e.target.value) }))}
                        onBlur={(e) => saveSetting(item.key, Number(e.target.value))}
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Филиалы */}
              {settingsTab === "branches" && (
                <div style={{ fontSize: "var(--font-xs)", display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>Филиал этого графика:</span>
                    <select value={apiSettings["schedule.default_branch"] || "Архангельск"}
                      style={{ fontSize: "var(--font-xs)", padding: "1px 3px" }}
                      onChange={(e) => saveSetting("schedule.default_branch", e.target.value)}>
                      {(apiSettings.branches || ["Архангельск", "Северодвинск"]).map((b: string) => (
                        <option key={b} value={b}>{b}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ borderTop: "1px solid #eee", paddingTop: 6 }}>
                    {(apiSettings.branches || ["Архангельск", "Северодвинск"]).map((b: string) => (
                      <div key={b} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 0" }}>
                        <span>{b}</span>
                        <button style={{ fontSize: "var(--font-xs)", padding: "0 4px", cursor: "pointer", border: "1px solid #ccc", background: "none", borderRadius: 3 }}
                          onClick={() => {
                            const usedBy = apiEmployees.filter((e) => e.is_active && (e.branch || "Архангельск") === b);
                            if (usedBy.length > 0) {
                              alert(`Нельзя удалить: филиал привязан к ${usedBy.length} сотр. (${usedBy.map((e: any) => e.name).join(", ")})`);
                              return;
                            }
                            const current = apiSettings.branches || ["Архангельск", "Северодвинск"];
                            if (current.length <= 1) { alert("Нужен хотя бы один филиал"); return; }
                            const updated = current.filter((x: string) => x !== b);
                            saveSetting("branches", updated);
                            if (apiSettings["schedule.default_branch"] === b) {
                              saveSetting("schedule.default_branch", updated[0]);
                            }
                          }}
                        >{"\u00D7"}</button>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <input id="new-branch-input" type="text" placeholder="Новый филиал" style={{ flex: 1, fontSize: "var(--font-xs)", padding: "2px 4px" }} />
                    <button style={{ fontSize: "var(--font-xs)", padding: "2px 6px", cursor: "pointer" }}
                      onClick={() => {
                        const inp = document.getElementById("new-branch-input") as HTMLInputElement;
                        const val = inp?.value?.trim();
                        if (!val) return;
                        const current = apiSettings.branches || ["Архангельск", "Северодвинск"];
                        if (current.includes(val)) { alert("Такой филиал уже есть"); return; }
                        saveSetting("branches", [...current, val]);
                        inp.value = "";
                      }}
                    >+ Добавить</button>
                  </div>
                </div>
              )}

              {/* Каталог работ */}
              {settingsTab === "catalog" && (
                <div style={{ fontSize: "var(--font-xs)", display: "flex", flexDirection: "column", gap: 4 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--font-xs)" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid #ccc" }}>
                        <th style={{ textAlign: "left", padding: "2px 3px" }}>Название</th>
                        <th style={{ textAlign: "right", padding: "2px 3px" }}>Стоимость</th>
                        <th style={{ padding: "2px 3px", width: 30 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {(apiSettings.extra_work_catalog || []).map((item: any, idx: number) => (
                        <tr key={item.id || idx} style={{ borderBottom: "1px solid #eee" }}>
                          <td style={{ padding: "2px 3px" }}>
                            <input value={item.name} style={{ fontSize: "var(--font-xs)", width: "100%", border: "1px solid #ddd", padding: "1px 3px" }}
                              onChange={(e) => {
                                const catalog = [...(apiSettings.extra_work_catalog || [])];
                                catalog[idx] = { ...catalog[idx], name: e.target.value };
                                setApiSettings((p) => ({ ...p, extra_work_catalog: catalog }));
                              }}
                              onBlur={() => saveSetting("extra_work_catalog", apiSettings.extra_work_catalog)}
                            />
                          </td>
                          <td style={{ textAlign: "right", padding: "2px 3px" }}>
                            <input type="number" value={item.price} style={{ fontSize: "var(--font-xs)", width: 60, textAlign: "right", border: "1px solid #ddd", padding: "1px 3px" }}
                              onChange={(e) => {
                                const catalog = [...(apiSettings.extra_work_catalog || [])];
                                catalog[idx] = { ...catalog[idx], price: Number(e.target.value) };
                                setApiSettings((p) => ({ ...p, extra_work_catalog: catalog }));
                              }}
                              onBlur={() => saveSetting("extra_work_catalog", apiSettings.extra_work_catalog)}
                            />
                          </td>
                          <td style={{ padding: "2px 3px", textAlign: "center" }}>
                            <button style={{ fontSize: "var(--font-xs)", cursor: "pointer", border: "1px solid #ccc", background: "none", borderRadius: 3, padding: "0 3px" }}
                              onClick={() => {
                                const catalog = (apiSettings.extra_work_catalog || []).filter((_: any, i: number) => i !== idx);
                                saveSetting("extra_work_catalog", catalog);
                              }}
                            >{"\u00D7"}</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ display: "flex", gap: 4 }}>
                    <input id="new-catalog-name" type="text" placeholder="Название" style={{ flex: 1, fontSize: "var(--font-xs)", padding: "2px 4px" }} />
                    <input id="new-catalog-price" type="number" placeholder="₽" style={{ width: 60, fontSize: "var(--font-xs)", padding: "2px 4px" }} />
                    <button style={{ fontSize: "var(--font-xs)", padding: "2px 6px", cursor: "pointer" }}
                      onClick={() => {
                        const nameInp = document.getElementById("new-catalog-name") as HTMLInputElement;
                        const priceInp = document.getElementById("new-catalog-price") as HTMLInputElement;
                        const name = nameInp?.value?.trim();
                        const price = Number(priceInp?.value) || 0;
                        if (!name) return;
                        const catalog = [...(apiSettings.extra_work_catalog || [])];
                        const id = name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-zа-яё0-9_]/gi, "");
                        catalog.push({ id, name, price });
                        saveSetting("extra_work_catalog", catalog);
                        nameInp.value = "";
                        priceInp.value = "";
                      }}
                    >+ Добавить</button>
                  </div>
                </div>
              )}

              {/* Уборки */}
              {settingsTab === "cleaning" && (() => {
                const DEFAULT_CS: Record<string, { morning: boolean; evening: boolean }> = {
                  mon: { morning: false, evening: true },
                  tue: { morning: false, evening: true },
                  wed: { morning: false, evening: true },
                  thu: { morning: false, evening: true },
                  fri: { morning: false, evening: true },
                  sat: { morning: false, evening: true },
                  sun: { morning: false, evening: false },
                };
                const cs: Record<string, { morning: boolean; evening: boolean }> = apiSettings.cleaning_schedule || DEFAULT_CS;
                const DOW_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
                const DOW_LABELS: Record<string, string> = { mon: "\u041F\u043D", tue: "\u0412\u0442", wed: "\u0421\u0440", thu: "\u0427\u0442", fri: "\u041F\u0442", sat: "\u0421\u0431", sun: "\u0412\u0441" };
                const toggleCleaning = (dow: string, slot: "morning" | "evening") => {
                  const updated = { ...cs };
                  for (const d of DOW_KEYS) {
                    updated[d] = { ...(updated[d] || { morning: false, evening: false }) };
                  }
                  updated[dow] = { ...updated[dow], [slot]: !updated[dow]?.[slot] };
                  setApiSettings((p) => ({ ...p, cleaning_schedule: updated }));
                  saveSetting("cleaning_schedule", updated);
                };
                return (
                  <div style={{ fontSize: "var(--font-xs)" }}>
                    <table style={{ borderCollapse: "collapse", fontSize: "var(--font-xs)" }}>
                      <thead>
                        <tr>
                          <th style={{ padding: "2px 6px" }}></th>
                          {DOW_KEYS.map((d) => (
                            <th key={d} style={{ padding: "2px 6px", textAlign: "center" }}>{DOW_LABELS[d]}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td style={{ padding: "2px 6px", fontWeight: "bold" }}>{"\u0423\u0442\u0440\u043E"}</td>
                          {DOW_KEYS.map((d) => (
                            <td key={d} style={{ padding: "2px 6px", textAlign: "center" }}>
                              <input type="checkbox" checked={cs[d]?.morning ?? false} onChange={() => toggleCleaning(d, "morning")} />
                            </td>
                          ))}
                        </tr>
                        <tr>
                          <td style={{ padding: "2px 6px", fontWeight: "bold" }}>{"\u0412\u0435\u0447\u0435\u0440"}</td>
                          {DOW_KEYS.map((d) => (
                            <td key={d} style={{ padding: "2px 6px", textAlign: "center" }}>
                              <input type="checkbox" checked={cs[d]?.evening ?? false} onChange={() => toggleCleaning(d, "evening")} />
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                );
              })()}

              {/* Группы Параплан */}
              {settingsTab === "groups" && (() => {
                const saveGroupField = async (paraplanId: string, field: string, value: any) => {
                  const updated = groupsConfig.map((gc: any) =>
                    gc.paraplan_id === paraplanId ? { ...gc, [field]: value } : gc
                  );
                  setGroupsConfig(updated);
                  try {
                    await fetch("/api/paraplan/groups-config", {
                      method: "PUT",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ tenant_id: selectedTenant || "dev", groups: updated }),
                    });
                  } catch (e) { console.error(e); }
                };
                return (
                <div style={{ fontSize: "var(--font-xs)" }}>
                  <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
                    <button
                      disabled={groupsLoading}
                      style={{ padding: "3px 10px", fontSize: "var(--font-xs)", cursor: groupsLoading ? "wait" : "pointer", background: "#f5f5f5", border: "1px solid #ccc", borderRadius: 4 }}
                      onClick={async () => {
                        setGroupsLoading(true);
                        try {
                          const res = await fetch("/api/paraplan/sync-groups", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenant_id: selectedTenant || "dev" }) });
                          const data = await res.json();
                          if (data.ok) setGroupsConfig(data.groups || []);
                        } catch (e) { console.error(e); }
                        setGroupsLoading(false);
                      }}
                    >{groupsLoading ? "\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430..." : "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0438\u0437 \u041F\u0430\u0440\u0430\u043F\u043B\u0430\u043D\u0430"}</button>
                    <span style={{ color: "#888" }}>{groupsConfig.length} {"\u0433\u0440\u0443\u043F\u043F"}</span>
                  </div>

                  {/* ── Цены (Emogen) ─────────────────────────── */}
                  <div style={{ marginTop: 4 }}>
                    <div style={{ fontWeight: "bold", marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
                      {"\u0426\u0435\u043D\u044B (\u0431\u043E\u0442)"}
                      {emogenLoading && <span style={{ color: "#888", fontWeight: "normal" }}>{"\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430..."}</span>}
                      {emogenError && <>
                        <span style={{ color: "#c00", fontWeight: "normal", fontSize: "0.9em" }}>{emogenError}</span>
                        <button style={{ padding: "1px 6px", fontSize: "var(--font-xs)", cursor: "pointer", background: "#f5f5f5", border: "1px solid #ccc", borderRadius: 3 }} onClick={() => {
                          emogenFetched.current = false;
                          setEmogenError(null);
                          setSettingsTab("shifts");
                          setTimeout(() => setSettingsTab("groups"), 0);
                        }}>{"\u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u044C"}</button>
                      </>}
                      {emogenPrices && !emogenLoading && (
                        <button
                          style={{ padding: "1px 6px", fontSize: "var(--font-xs)", cursor: "pointer", background: "#f5f5f5", border: "1px solid #ccc", borderRadius: 3 }}
                          onClick={() => {
                            setEmogenLoading(true);
                            setEmogenError(null);
                            fetch("/api/emogen/groups").then(r => {
                              if (!r.ok) throw new Error(`${r.status}`);
                              return r.json();
                            }).then(d => setEmogenPrices(d))
                              .catch(e => setEmogenError("Emogen \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D: " + e.message))
                              .finally(() => setEmogenLoading(false));
                          }}
                        >{"\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C"}</button>
                      )}
                      {emogenSaving && <span style={{ color: "#888", fontWeight: "normal", fontSize: "0.85em" }}>{"\u0421\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0435 " + emogenSaving + "..."}</span>}
                    </div>

                    {emogenPrices && (() => {
                      const groups = emogenPrices.groups || [];
                      const meta = emogenPrices.meta || {};

                      const saveEmogenGroup = async (name: string, update: any) => {
                        setEmogenSaving(name);
                        try {
                          const r = await fetch(`/api/emogen/groups/${encodeURIComponent(name)}`, {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(update),
                          });
                          if (!r.ok) throw new Error(`${r.status}`);
                          const data = await r.json();
                          if (data.ok && data.group) {
                            setEmogenPrices((prev) => {
                              if (!prev) return prev;
                              const updated = prev.groups.map((gg: any) =>
                                gg.name === name ? { ...gg, ...data.group } : gg
                              );
                              return { ...prev, groups: updated };
                            });
                          }
                        } catch (e: any) {
                          console.error("Save emogen group error:", e);
                        }
                        setEmogenSaving(null);
                      };

                      return (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {groups.map((g: any) => {
                            const pgFirst = groupsConfig.find((gc: any) => gc.prefix === g.name);
                            return (
                            <div key={g.name} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0", borderBottom: "1px solid #f0f0f0" }}>
                              <span style={{ minWidth: 80, fontWeight: 500 }}>{g.name}</span>
                              <span style={{ minWidth: 80, color: "#888", fontSize: "0.9em" }}>{g.age}</span>
                              {pgFirst && (
                                <select value={pgFirst.required_skill_level || "any"} style={{ fontSize: "var(--font-xs)", padding: "0 2px" }}
                                  onChange={(e) => {
                                    const val = e.target.value === "any" ? null : e.target.value;
                                    const updated = groupsConfig.map((gc: any) =>
                                      gc.prefix === g.name ? { ...gc, required_skill_level: val } : gc
                                    );
                                    setGroupsConfig(updated);
                                    fetch("/api/paraplan/groups-config", {
                                      method: "PUT",
                                      headers: { "content-type": "application/json" },
                                      body: JSON.stringify({ tenant_id: selectedTenant || "dev", groups: updated }),
                                    }).catch(console.error);
                                  }}>
                                  <option value="any">{"\u043B\u044E\u0431\u043E\u0439"}</option>
                                  <option value="beginner">{"\u043D\u0430\u0447."}</option>
                                  <option value="experienced">{"\u043E\u043F\u044B\u0442"}</option>
                                  <option value="guru">{"\u0433\u0443\u0440\u0443"}</option>
                                </select>
                              )}
                              {g.trial_price != null && (
                                <>
                                  <label style={{ color: "#666", fontSize: "0.85em" }}>{"\u041F\u0440\u043E\u0431\u043D\u043E\u0435:"}</label>
                                  <input
                                    type="number"
                                    value={g.trial_price}
                                    style={{ width: 60, fontSize: "var(--font-xs)", padding: "1px 3px", textAlign: "right" }}
                                    onChange={(e) => {
                                      const val = Number(e.target.value);
                                      setEmogenPrices((prev) => {
                                        if (!prev) return prev;
                                        const updated = prev.groups.map((gg: any) =>
                                          gg.name === g.name ? { ...gg, trial_price: val } : gg
                                        );
                                        return { ...prev, groups: updated };
                                      });
                                    }}
                                    onBlur={(e) => {
                                      const val = Number(e.target.value);
                                      if (val > 0) saveEmogenGroup(g.name, { trial_price: val });
                                    }}
                                  />
                                  <span style={{ color: "#888", fontSize: "0.85em" }}>{"\u20BD"}</span>
                                </>
                              )}
                              {g.single_visit != null && (
                                <>
                                  <label style={{ color: "#666", fontSize: "0.85em" }}>{"\u0420\u0430\u0437\u043E\u0432\u043E\u0435:"}</label>
                                  <input
                                    type="number"
                                    value={g.single_visit}
                                    style={{ width: 60, fontSize: "var(--font-xs)", padding: "1px 3px", textAlign: "right" }}
                                    onChange={(e) => {
                                      const val = Number(e.target.value);
                                      setEmogenPrices((prev) => {
                                        if (!prev) return prev;
                                        const updated = prev.groups.map((gg: any) =>
                                          gg.name === g.name ? { ...gg, single_visit: val } : gg
                                        );
                                        return { ...prev, groups: updated };
                                      });
                                    }}
                                    onBlur={(e) => {
                                      const val = Number(e.target.value);
                                      if (val > 0) saveEmogenGroup(g.name, { single_visit: val });
                                    }}
                                  />
                                  <span style={{ color: "#888", fontSize: "0.85em" }}>{"\u20BD"}</span>
                                </>
                              )}
                            </div>
                          ); })}

                          {/* Meta: individual price, max trial visits */}
                          <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid #eee", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                            <span style={{ fontWeight: 500, color: "#555" }}>{"\u041E\u0431\u0449\u0438\u0435:"}</span>
                            <label style={{ display: "flex", alignItems: "center", gap: 4, color: "#666", fontSize: "0.85em" }}>
                              {"\u0418\u043D\u0434\u0438\u0432\u0438\u0434\u0443\u0430\u043B\u044C\u043D\u043E\u0435:"}
                              <span style={{ fontWeight: 500 }}>{meta.individual_price || "\u2014"} {"\u20BD"}</span>
                            </label>
                            <label style={{ display: "flex", alignItems: "center", gap: 4, color: "#666", fontSize: "0.85em" }}>
                              {"\u041C\u0430\u043A\u0441. \u043F\u0440\u043E\u0431\u043D\u044B\u0445:"}
                              <span style={{ fontWeight: 500 }}>{meta.max_trial_visits || "\u2014"}</span>
                            </label>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
                );
              })()}
              </div>}
            </div>
            )}

            {/* Параплан */}
            {vis["paraplan"] !== false && (
            <div style={{ borderBottom: "1px solid #ddd", position: "relative", overflow: "auto" }}>
              <div onClick={() => toggleCollapse("paraplan")} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 6, userSelect: "none", padding: "6px 10px", background: collapsed["paraplan"] ? "#f8f8f8" : "#eef3fb", borderBottom: collapsed["paraplan"] ? "none" : "1px solid #d8e2f0" }}>
                <span style={{ fontSize: 10, color: "#888", transition: "transform 0.15s", display: "inline-block", transform: collapsed["paraplan"] ? "rotate(-90deg)" : "rotate(0deg)" }}>{"\u25BC"}</span>
                <h3 style={{ margin: 0, fontSize: "var(--font-sm)", flex: 1 }}>
                  Параплан CRM
                  <span style={{ marginLeft: 8, fontSize: "0.75em", color: paraplanStatus?.ready ? "#4caf50" : paraplanStatus?.configured ? "#ff9800" : "#999" }}>
                    {paraplanStatus?.ready ? "\u2705" : paraplanStatus?.configured ? "\u26A0\uFE0F" : "\u274C"}
                    {paraplanStatus?.ready ? " \u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D" : paraplanStatus?.configured ? " \u0418\u043D\u0438\u0446\u0438\u0430\u043B\u0438\u0437\u0430\u0446\u0438\u044F..." : " \u041D\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043D"}
                  </span>
                </h3>
              </div>
              {!collapsed["paraplan"] && (
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
                            // Reload status and hours
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
                      {paraplanRefreshing ? "\u041E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0435..." : "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0438\u0437 \u041F\u0430\u0440\u0430\u043F\u043B\u0430\u043D\u0430"}
                    </button>
                    {paraplanStatus?.updatedAt && (
                      <span style={{ color: "#888" }}>
                        {"\u041E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u043E: "}{new Date(paraplanStatus.updatedAt).toLocaleTimeString("ru")}
                      </span>
                    )}
                    {paraplanStatus && (
                      <span style={{ color: "#888" }}>
                        | {paraplanStatus.groupCount || 0} {"групп"} | {paraplanStatus.daysWithHours || 0} {"дн. с часами"}
                      </span>
                    )}
                  </div>

                  {/* Hours table */}
                  {paraplanHours?.hours && (
                    <div style={{ marginTop: 4 }}>
                      <strong>{"\u0427\u0430\u0441\u044B \u0441\u043C\u0435\u043D \u0438\u0437 \u041F\u0430\u0440\u0430\u043F\u043B\u0430\u043D\u0430:"}</strong>
                      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 4, fontSize: "var(--font-xs)" }}>
                        <thead>
                          <tr style={{ borderBottom: "1px solid #ddd" }}>
                            <th style={{ textAlign: "left", padding: "2px 6px" }}>{"\u0414\u0435\u043D\u044C"}</th>
                            <th style={{ textAlign: "center", padding: "2px 6px" }}>{"\u0423\u0442\u0440\u043E"}</th>
                            <th style={{ textAlign: "center", padding: "2px 6px" }}>{"\u0412\u0435\u0447\u0435\u0440"}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((dow) => {
                            const RU: Record<string, string> = { mon: "\u041F\u043D", tue: "\u0412\u0442", wed: "\u0421\u0440", thu: "\u0427\u0442", fri: "\u041F\u0442", sat: "\u0421\u0431", sun: "\u0412\u0441" };
                            const dayData = paraplanHours.hours[dow];
                            if (!dayData) return (
                              <tr key={dow} style={{ borderBottom: "1px solid #f0f0f0" }}>
                                <td style={{ padding: "2px 6px", fontWeight: "bold" }}>{RU[dow]}</td>
                                <td style={{ textAlign: "center", padding: "2px 6px", color: "#ccc" }}>{"\u2014"}</td>
                                <td style={{ textAlign: "center", padding: "2px 6px", color: "#ccc" }}>{"\u2014"}</td>
                              </tr>
                            );
                            const renderSlot = (slot: any) => {
                              if (!slot) return <span style={{ color: "#ccc" }}>{"\u2014"}</span>;
                              const groups = slot.groups || [];
                              const excluded = groups.filter((g: any) => !g.included);
                              return (
                                <div>
                                  <strong>{slot.hours}{"ч"}</strong>
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
                            };
                            return (
                              <tr key={dow} style={{ borderBottom: "1px solid #f0f0f0", verticalAlign: "top" }}>
                                <td style={{ padding: "2px 6px", fontWeight: "bold" }}>{RU[dow]}</td>
                                <td style={{ padding: "2px 6px" }}>{renderSlot(dayData.morning)}</td>
                                <td style={{ padding: "2px 6px" }}>{renderSlot(dayData.evening)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {!paraplanStatus?.configured && (
                    <div style={{ color: "#999", padding: 8 }}>
                      {"\u0414\u043B\u044F \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F \u0443\u043A\u0430\u0436\u0438\u0442\u0435 PARAPLAN_LOGIN \u0438 PARAPLAN_PASSWORD \u0432 .env"}
                    </div>
                  )}
                </div>
              )}
            </div>
            )}

          </div>

          {/* Extra Pay Modal */}
          {showExtraPayModal && (() => {
            const DOW_RU: Record<string, string> = { mon: "Пн", tue: "Вт", wed: "Ср", thu: "Чт", fri: "Пт", sat: "Сб", sun: "Вс" };
            const dowLabel = showExtraPayModal.dow ? DOW_RU[showExtraPayModal.dow] || showExtraPayModal.dow : "";
            const catalog = (apiSettings?.extra_work_catalog || []) as Array<{ id: string; name: string; price: number }>;
            return (
            <>
              <div onClick={() => setShowExtraPayModal(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 1500 }} />
              <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", background: "#fff", borderRadius: 8, padding: 16, minWidth: 300, zIndex: 1501, boxShadow: "0 4px 16px rgba(0,0,0,0.2)" }}>
                {modalSuccess ? (
                  <div style={{ padding: "12px 8px", background: "#d4edda", color: "#155724", borderRadius: 4, textAlign: "center", fontSize: 14 }}>
                    {"\u2705"} Доп сохран\u0451н: {modalSuccess}
                  </div>
                ) : (
                <>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <strong>{showExtraPayModal.name}{dowLabel ? ` — ${dowLabel} ${showExtraPayModal.slot || ""}` : ""}</strong>
                  <button onClick={() => setShowExtraPayModal(null)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer" }}>{"\u00D7"}</button>
                </div>
                {/* Existing extras for this user+dow */}
                {(() => {
                  let allExtras: Array<{ id?: number; type: string; label: string; amount: number; status: string }> = [];
                  if (showExtraPayModal.dow) {
                    const key = `${showExtraPayModal.dow}|${showExtraPayModal.user_id}`;
                    allExtras = extrasMap.get(key) || [];
                  } else {
                    for (const [k, items] of extrasMap) {
                      if (k.endsWith(`|${showExtraPayModal.user_id}`)) {
                        allExtras.push(...items);
                      }
                    }
                  }
                  if (allExtras.length === 0) {
                    return <div style={{ fontSize: 13, color: "#888", marginBottom: 8 }}>Нет допработ</div>;
                  }
                  const statusIcon = (s: string) => s === "approved" ? "\u2705" : s === "pending" ? "\u23F3" : "\u274C";
                  return (
                    <div style={{ marginBottom: 10, fontSize: 13 }}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>Допработы:</div>
                      {allExtras.map((p, i) => (
                        <div key={p.id || i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0", borderTop: i > 0 ? "1px solid #eee" : "none" }}>
                          <span>{statusIcon(p.status)} {p.label} — {p.amount}{"\u20BD"}{p.status === "approved" ? " (утверждено)" : p.status === "rejected" ? " (отклонено)" : ""}</span>
                          <span style={{ display: "flex", gap: 4 }}>
                            {p.status === "pending" && p.type === "work" && (
                              <>
                                <button onClick={() => { if (p.id) approveExtraWork(String(p.id)); }} style={{ fontSize: 12, cursor: "pointer", padding: "1px 6px", background: "#d4edda", border: "1px solid #c3e6cb", borderRadius: 3 }}>{"\u2705"} Утв.</button>
                                <button onClick={() => { if (p.id) rejectExtraWork(String(p.id)); }} style={{ fontSize: 12, cursor: "pointer", padding: "1px 6px", background: "#f8d7da", border: "1px solid #f5c6cb", borderRadius: 3 }}>{"\u274C"} Откл.</button>
                              </>
                            )}
                            <button onClick={() => deleteExtraItem(p)} style={{ fontSize: 12, cursor: "pointer", padding: "1px 6px", background: "#f8f9fa", border: "1px solid #dee2e6", borderRadius: 3 }}>{"\uD83D\uDDD1\uFE0F"}</button>
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
                <hr style={{ border: "none", borderTop: "1px solid #ddd", margin: "8px 0" }} />
                {!modalShowAddForm ? (
                  <button onClick={() => setModalShowAddForm(true)} style={{ width: "100%", padding: "6px 12px", cursor: "pointer", background: "#f8f9fa", border: "1px solid #dee2e6", borderRadius: 4, fontSize: 13 }}>+ Добавить доп</button>
                ) : (
                <>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
                  {catalog.length > 0 && (
                    <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <span>Вид работы</span>
                      <select id="extra-pay-work-type" style={{ flex: 1, padding: "2px 4px", fontSize: 13 }} onChange={(e) => {
                        const sel = catalog.find(c => c.id === e.target.value);
                        if (sel) {
                          const amountEl = document.getElementById("extra-pay-amount") as HTMLInputElement;
                          if (amountEl) amountEl.value = String(sel.price);
                          const commentEl = document.getElementById("extra-pay-comment") as HTMLInputElement;
                          if (commentEl && !commentEl.value) commentEl.value = sel.name;
                        }
                      }}>
                        <option value="">Произвольный</option>
                        {catalog.map(c => <option key={c.id} value={c.id}>{c.name} ({c.price}{"\u20BD"})</option>)}
                      </select>
                    </label>
                  )}
                  <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <span>{"Сумма \u20BD"}</span>
                    <input id="extra-pay-amount" type="number" style={{ flex: 1, padding: "2px 4px", fontSize: 13 }} />
                  </label>
                  <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <span>Комментарий</span>
                    <input id="extra-pay-comment" type="text" style={{ flex: 1, padding: "2px 4px", fontSize: 13 }} />
                  </label>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
                  <button onClick={() => setModalShowAddForm(false)} style={{ padding: "4px 12px", cursor: "pointer" }}>Отмена</button>
                  <button onClick={() => {
                    const amount = Number((document.getElementById("extra-pay-amount") as HTMLInputElement)?.value) || 0;
                    const comment = (document.getElementById("extra-pay-comment") as HTMLInputElement)?.value || "";
                    if (amount > 0) addExtraPay(showExtraPayModal.user_id, amount, comment);
                  }} style={{ padding: "4px 12px", background: "#007bff", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>Сохранить</button>
                </div>
                </>
                )}
                </>
                )}
              </div>
            </>
            );
          })()}

          {/* Slot Assignment Modal */}
          {slotModal && (() => {
            const allUsers = UserDirectory.getAllUsers();
            const availSet = new Set(slotModal.availableUserIds || []);
            const shortFrom = slotModal.from.replace(/:00$/, "");
            const shortTo = slotModal.to.replace(/:00$/, "");
            return (
            <>
              <div onClick={() => setSlotModal(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 1500 }} />
              <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", background: "#fff", borderRadius: 8, padding: 16, minWidth: 320, maxWidth: 400, zIndex: 1501, boxShadow: "0 4px 16px rgba(0,0,0,0.2)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <strong>{slotModal.dayLabel} — {slotModal.slotLabel} ({shortFrom}–{shortTo})</strong>
                  <button onClick={() => setSlotModal(null)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer" }}>{"\u00D7"}</button>
                </div>

                {slotModal.isLocked && (
                  <div style={{ marginBottom: 12, padding: "6px 10px", background: "#fff3cd", border: "1px solid #ffc107", borderRadius: 4, fontSize: 12, color: "#856404" }}>
                    {"\u26A0\uFE0F"} Этот день уже прошёл. Изменения будут применены задним числом.
                  </div>
                )}

                <div style={{ marginBottom: 12, fontSize: 13 }}>
                  <span style={{ color: "#666" }}>Текущий: </span>
                  <strong>{slotModal.currentUserId ? UserDirectory.getDisplayName(slotModal.currentUserId) : "Не назначен"}</strong>
                </div>

                <div style={{ marginBottom: 8 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>Назначить:</label>
                  <select
                    value={slotModalSelectedUser}
                    onChange={(e) => setSlotModalSelectedUser(e.target.value)}
                    style={{ width: "100%", padding: "6px 8px", fontSize: 13, borderRadius: 4, border: "1px solid #ccc" }}
                  >
                    <option value="">— Не назначен —</option>
                    {allUsers.map((u) => {
                      const isAvail = availSet.has(u.id);
                      return (
                        <option key={u.id} value={u.id}>
                          {u.displayName} {isAvail ? "\u2705" : "\u26A0\uFE0F"}
                        </option>
                      );
                    })}
                  </select>
                </div>

                {/* Availability summary */}
                <div style={{ fontSize: 12, color: "#666", marginBottom: 12, lineHeight: 1.5 }}>
                  {(() => {
                    const avail = allUsers.filter(u => availSet.has(u.id));
                    const unavail = allUsers.filter(u => !availSet.has(u.id));
                    return (
                      <>
                        {avail.length > 0 && <div>Доступны: {avail.map(u => u.displayName).join(", ")}</div>}
                        {unavail.length > 0 && <div style={{ color: "#999" }}>Не заявлены: {unavail.map(u => u.displayName).join(", ")}</div>}
                      </>
                    );
                  })()}
                </div>

                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  {slotModal.currentUserId && (
                    <button
                      onClick={async () => {
                        if (!selectedChatId) return;
                        const fromH = slotModal.from.replace(/:00$/, "");
                        const toH = slotModal.to.replace(/:00$/, "");
                        const text = `UNASSIGN ${weekStartISO} ${slotModal.dow} ${fromH}-${toH}`;
                        await fetch("/debug/send", {
                          method: "POST",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({ tenant_id: selectedTenant, chat_id: selectedChatId, user_id: "admin1", text, meta: { role: "admin" } }),
                        });
                        setSlotModal(null);
                        await refreshSchedule();
                      }}
                      style={{ padding: "6px 12px", background: "#dc3545", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 13 }}
                    >
                      Убрать
                    </button>
                  )}
                  <button onClick={() => setSlotModal(null)} style={{ padding: "6px 12px", cursor: "pointer", fontSize: 13, border: "1px solid #ccc", borderRadius: 4 }}>Отмена</button>
                  <button
                    disabled={slotModalSelectedUser === (slotModal.currentUserId || "")}
                    onClick={async () => {
                      if (!selectedChatId) return;
                      const fromH = slotModal.from.replace(/:00$/, "");
                      const toH = slotModal.to.replace(/:00$/, "");
                      if (slotModalSelectedUser) {
                        const text = `ASSIGN ${weekStartISO} ${slotModal.dow} ${fromH}-${toH} ${slotModalSelectedUser}`;
                        await fetch("/debug/send", {
                          method: "POST",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({ tenant_id: selectedTenant, chat_id: selectedChatId, user_id: "admin1", text, meta: { role: "admin" } }),
                        });
                      } else {
                        const text = `UNASSIGN ${weekStartISO} ${slotModal.dow} ${fromH}-${toH}`;
                        await fetch("/debug/send", {
                          method: "POST",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({ tenant_id: selectedTenant, chat_id: selectedChatId, user_id: "admin1", text, meta: { role: "admin" } }),
                        });
                      }
                      setSlotModal(null);
                      await refreshSchedule();
                    }}
                    style={{
                      padding: "6px 12px", background: "#007bff", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 13,
                      ...(slotModalSelectedUser === (slotModal.currentUserId || "") ? { opacity: 0.5, cursor: "default" } : {}),
                    }}
                  >
                    Сохранить
                  </button>
                </div>

                {/* Link to extra pay modal if user assigned */}
                {slotModal.currentUserId && (
                  <div style={{ marginTop: 12, paddingTop: 8, borderTop: "1px solid #eee" }}>
                    <button
                      onClick={() => {
                        const uid = slotModal.currentUserId!;
                        const name = UserDirectory.getDisplayName(uid);
                        const slotLabel = slotModal.slotLabel.toLowerCase();
                        setSlotModal(null);
                        openExtraPayModal({ user_id: uid, name, dow: slotModal.dow, slot: slotLabel });
                      }}
                      style={{ width: "100%", padding: "4px 8px", cursor: "pointer", background: "#f8f9fa", border: "1px solid #dee2e6", borderRadius: 4, fontSize: 12, color: "#495057" }}
                    >
                      Допработы для {UserDirectory.getDisplayName(slotModal.currentUserId)}...
                    </button>
                  </div>
                )}
              </div>
            </>
            );
          })()}
        </div>
      </main>

      {/* Resize handle: center-right */}
      <div className="resize-handle" onMouseDown={() => startColDrag(1)} />

      {/* Правая колонка: Debug panel */}
      <aside className={`pane pane-right${mobileTab !== "schedule" && mobileTab !== "settings" ? " mobile-hidden" : ""}`}>
        <div className="pane-header">
          <h2>Debug</h2>
          <div style={{ fontSize: 12, opacity: 0.6 }}>UI_BUILD: week-commands-v1</div>
        </div>
        <div className="pane-content debug-content">
          <ToggleSection id="roster_users" vis={vis} collapsed={collapsed} onHide={hideSection} onToggleCollapse={toggleCollapse}>
            <h3>Сотрудники для расчёта <InfoTip text="Отметьте сотрудников которые участвуют в составлении графика" /></h3>
            <div style={{ fontSize: "0.85em", marginBottom: "8px" }}>
              Выберите сотрудников, которые будут учитываться при сборке графика:
            </div>
            {UserDirectory.getAllUsers().map((user) => (
              <label
                key={user.id}
                style={{ display: "flex", alignItems: "center", marginBottom: "4px", fontSize: "0.85em" }}
              >
                <input
                  type="checkbox"
                  checked={selectedRosterUsers.has(user.id)}
                  onChange={(e) => {
                    const newSet = new Set(selectedRosterUsers);
                    if (e.target.checked) {
                      newSet.add(user.id);
                    } else {
                      newSet.delete(user.id);
                    }
                    setSelectedRosterUsers(newSet);
                    // Сохраняем в localStorage
                    localStorage.setItem("roster_selected_users", JSON.stringify(Array.from(newSet)));
                  }}
                  style={{ marginRight: "6px" }}
                />
                <span>
                  {user.displayName} ({user.id}) - {user.role} - {user.ratePerHour}₽/ч
                </span>
              </label>
            ))}
            <div style={{ fontSize: "0.75em", color: "#666", marginTop: "8px" }}>
              Выбрано: {selectedRosterUsers.size} из {UserDirectory.getAllUsers().length}
            </div>
          </ToggleSection>
          <ToggleSection id="active_tasks" vis={vis} collapsed={collapsed} onHide={hideSection} onToggleCollapse={toggleCollapse}>
            <h3>Требуются действия ({Array.from(activeTasks.values()).filter((t) => t.status === "OPEN").length})</h3>
            {(() => {
              const openTasks = Array.from(activeTasks.values()).filter((t) => t.status === "OPEN");
              if (openTasks.length === 0) {
                return (
                  <div style={{ fontSize: "0.85em", color: "#28a745", marginTop: "8px" }}>
                    ✅ Нет активных задач
                  </div>
                );
              }
              return (
                <div style={{ marginTop: "8px" }}>
                  <details open>
                    <summary style={{ cursor: "pointer", fontSize: "0.85em", marginBottom: "4px", fontWeight: "bold" }}>
                      Список задач ({openTasks.length})
                    </summary>
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "4px" }}>
                      {openTasks.map((task) => (
                        <div
                          key={task.id}
                          style={{
                            padding: "8px",
                            backgroundColor: task.severity === "error" ? "#f8d7da" : "#fff3cd",
                            border: `1px solid ${task.severity === "error" ? "#dc3545" : "#ffc107"}`,
                            borderRadius: "4px",
                            fontSize: "0.8em",
                          }}
                        >
                          <div style={{ fontWeight: "bold", marginBottom: "4px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span>{task.title}</span>
                            {task.id.startsWith("PROBLEM:") && (
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveTasks((prev) => {
                                    const next = new Map(prev);
                                    const existing = next.get(task.id);
                                    if (existing) {
                                      next.set(task.id, { ...existing, status: "RESOLVED" });
                                    }
                                    return next;
                                  });
                                }}
                                style={{
                                  fontSize: "0.7em",
                                  padding: "2px 6px",
                                  backgroundColor: "#28a745",
                                  color: "white",
                                  border: "none",
                                  borderRadius: "2px",
                                  cursor: "pointer",
                                }}
                                title="Закрыть задачу (для админа)"
                              >
                                ✓ Закрыть
                              </button>
                            )}
                          </div>
                          {task.id.startsWith("PROBLEM:") && (
                            <div style={{ fontSize: "0.75em", color: "#856404", marginBottom: "4px", fontWeight: "bold" }}>
                              Статус: {task.status === "OPEN" ? "⏳ Ожидает решения админом" : "✅ Решено"}
                            </div>
                          )}
                          {task.payload?.reason && (
                            <div style={{ fontSize: "0.75em", color: "#666", marginBottom: "2px" }}>
                              Тип проблемы: <strong>{task.payload.reason}</strong>
                            </div>
                          )}
                          {task.payload?.comment && (
                            <div style={{ fontSize: "0.75em", color: "#666", marginBottom: "2px", fontStyle: "italic" }}>
                              Комментарий: "{task.payload.comment}"
                            </div>
                          )}
                          <div style={{ fontSize: "0.75em", color: "#666", marginBottom: "4px" }}>
                            Создано: {new Date(task.createdAt).toLocaleString("ru-RU")}
                            {task.counter > 1 && ` (обновлено ${task.counter} раз)`}
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              // Прокручиваем к соответствующему блоку
                              if (task.id.startsWith("UNCONFIRMED:")) {
                                const parts = task.id.split(":");
                                const taskUserId = parts[2];
                                const element = document.querySelector(`[data-user-confirm="${taskUserId}"]`);
                                if (element) {
                                  element.scrollIntoView({ behavior: "smooth", block: "center" });
                                  const originalBg = (element as HTMLElement).style.backgroundColor;
                                  (element as HTMLElement).style.backgroundColor = "#fff3cd";
                                  setTimeout(() => {
                                    (element as HTMLElement).style.backgroundColor = originalBg;
                                  }, 2000);
                                }
                              } else if (task.id.startsWith("PROBLEM:")) {
                                const parts = task.id.split(":");
                                const taskUserId = parts[2];
                                const element = document.querySelector(`[data-user-confirm="${taskUserId}"]`);
                                if (element) {
                                  element.scrollIntoView({ behavior: "smooth", block: "center" });
                                  const originalBg = (element as HTMLElement).style.backgroundColor;
                                  (element as HTMLElement).style.backgroundColor = "#fff3cd";
                                  setTimeout(() => {
                                    (element as HTMLElement).style.backgroundColor = originalBg;
                                  }, 2000);
                                }
                              } else if (task.id.startsWith("GAP:")) {
                                setActiveTab("empty");
                                setTimeout(() => {
                                  const element = document.querySelector('[data-tab="empty"]');
                                  if (element) {
                                    element.scrollIntoView({ behavior: "smooth", block: "center" });
                                  }
                                }, 100);
                              }
                            }}
                            style={{
                              fontSize: "0.75em",
                              padding: "2px 6px",
                              backgroundColor: "transparent",
                              border: "1px solid #666",
                              borderRadius: "2px",
                              cursor: "pointer",
                            }}
                          >
                            Показать в графике
                          </button>
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              );
            })()}
          </ToggleSection>
          <ToggleSection id="debug_header" vis={vis} collapsed={collapsed} onHide={hideSection} onToggleCollapse={toggleCollapse} tag="div">
            <section>
            <h3>Статус бэкенда <InfoTip text="Отладка: статус сервера и последнее обработанное событие" /></h3>
            <div className="empty">
              {backendOk === null
                ? "проверка..."
                : backendOk
                  ? "ok"
                  : "не отвечает"}
            </div>
            </section>
            <section>
            <h3>Последнее событие <InfoTip text="Отладка: последнее обработанное событие из чата" /></h3>
            <div className="empty">
              {lastSend?.event ? (
                <div style={{ fontSize: "0.85em" }}>
                  <div><strong>text:</strong> {lastSend.event.text}</div>
                  <div>id: {lastSend.event.id} | trace: {lastSend.event.trace_id?.slice(0, 8)}</div>
                  <div>received_at: {lastSend.event.received_at}</div>
                </div>
              ) : (
                "—"
              )}
            </div>
          </section>
          <section>
            <h3>Факты <InfoTip text="Отладка: распознанные факты из последнего сообщения" /></h3>
            <div className="empty">
              Распознано: {lastSend?.facts_count ?? lastSend?.facts?.length ?? 0}
            </div>
            {lastSend?.facts && lastSend.facts.length > 0 ? (
              lastSend.facts.map((f) => (
                <div key={f.id} className="empty" style={{ fontSize: "0.85em" }}>
                  <div>
                    <strong>{f.fact_type}</strong>
                  </div>
                  <div>{JSON.stringify(f.fact_payload)}</div>
                </div>
              ))
            ) : (
              <div className="empty">facts: 0</div>
            )}
            </section>
          </ToggleSection>
          <ToggleSection id="schedule_v0" vis={vis} collapsed={collapsed} onHide={hideSection} onToggleCollapse={toggleCollapse}>
            <h3>Schedule v0 <InfoTip text="Пересчитать — обновить график. Эталонная неделя — загрузить тестовые данные" /></h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: "8px" }}>
              <button
                type="button"
                title="Пересобрать расписание с учётом новых данных"
                onClick={async () => {
                  if (!selectedTenant || !selectedChatId) {
                    alert("Выберите tenant и chat");
                    return;
                  }
                  // Calculate Monday of current week
                  const today = new Date();
                  const dayOfWeek = today.getDay();
                  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Monday = 1
                  const monday = new Date(today);
                  monday.setDate(today.getDate() + diff);
                  const weekStart = monday.toISOString().split("T")[0]; // YYYY-MM-DD

                  try {
                    const res = await fetch(
                      `/debug/schedule?tenant_id=${encodeURIComponent(
                        selectedTenant,
                      )}&chat_id=${encodeURIComponent(selectedChatId)}&week_start=${weekStart}`,
                    );
                    const data = await res.json();
                    setSchedule(data);
                  } catch (e) {
                    console.error("Failed to load schedule", e);
                    setSchedule(null);
                  }
                }}
              >
                Пересчитать график
              </button>
              <button
                type="button"
                title="Отправить PNG графика в Telegram чат"
                disabled={publishStatus === "publishing"}
                style={{
                  background: publishStatus === "success" ? "#4CAF50" : publishStatus === "error" ? "#f44336" : "#0088cc",
                  color: "white", border: "none", padding: "4px 12px", borderRadius: 4,
                  cursor: publishStatus === "publishing" ? "wait" : "pointer",
                  opacity: publishStatus === "publishing" ? 0.7 : 1,
                  transition: "background 0.3s",
                }}
                onClick={async () => {
                  if (!selectedChatId) {
                    alert("Выберите chat");
                    return;
                  }
                  setPublishStatus("publishing");
                  try {
                    const res = await fetch("/api/schedule/publish", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({
                        chat_id: selectedChatId,
                        week_start: weekStartISO,
                        tenant_id: selectedTenant,
                      }),
                    });
                    const data = await res.json();
                    setPublishStatus(data.ok ? "success" : "error");
                  } catch {
                    setPublishStatus("error");
                  }
                  setTimeout(() => setPublishStatus("idle"), 3000);
                }}
              >
                {publishStatus === "publishing" ? "Публикуется..." :
                 publishStatus === "success" ? "Опубликовано" :
                 publishStatus === "error" ? "Ошибка" :
                 "Опубликовать в Telegram"}
              </button>
              <button
                type="button"
                title="Отправить PNG в личку (тест)"
                disabled={testPublishStatus === "sending"}
                style={{
                  background: testPublishStatus === "success" ? "#4CAF50" : testPublishStatus === "error" ? "#f44336" : "#999",
                  color: "white", border: "none", padding: "4px 8px", borderRadius: 4,
                  cursor: testPublishStatus === "sending" ? "wait" : "pointer",
                  opacity: testPublishStatus === "sending" ? 0.7 : 1,
                  fontSize: "var(--font-xs)",
                  transition: "background 0.3s",
                }}
                onClick={async () => {
                  setTestPublishStatus("sending");
                  try {
                    const res = await fetch("/api/schedule/publish-test", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({
                        chat_id: selectedChatId,
                        week_start: weekStartISO,
                        tenant_id: selectedTenant,
                        telegram_user_id: "319929790",
                      }),
                    });
                    const data = await res.json();
                    setTestPublishStatus(data.ok ? "success" : "error");
                  } catch {
                    setTestPublishStatus("error");
                  }
                  setTimeout(() => setTestPublishStatus("idle"), 3000);
                }}
              >
                {testPublishStatus === "sending" ? "..." :
                 testPublishStatus === "success" ? "✅" :
                 testPublishStatus === "error" ? "❌" :
                 "🧪 Тест"}
              </button>
              <button
                type="button"
                title="Отправить список оплат на завтра в Telegram"
                disabled={paymentsStatus === "sending"}
                style={{
                  background: paymentsStatus === "success" ? "#4CAF50" : paymentsStatus === "error" ? "#f44336" : "#ff9800",
                  color: "white", border: "none", padding: "4px 12px", borderRadius: 4,
                  cursor: paymentsStatus === "sending" ? "wait" : "pointer",
                  opacity: paymentsStatus === "sending" ? 0.7 : 1,
                  transition: "background 0.3s",
                }}
                onClick={async () => {
                  if (!selectedChatId) {
                    alert("Выберите chat");
                    return;
                  }
                  setPaymentsStatus("sending");
                  try {
                    const tomorrow = new Date();
                    tomorrow.setDate(tomorrow.getDate() + 1);
                    const dateStr = tomorrow.toISOString().slice(0, 10);
                    const res = await fetch("/api/payments/send-list", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({
                        chat_id: selectedChatId,
                        date: dateStr,
                      }),
                    });
                    const data = await res.json();
                    setPaymentsStatus(data.ok ? "success" : "error");
                    if (!data.ok) alert("Ошибка: " + (data.error || "unknown"));
                  } catch (e: any) {
                    setPaymentsStatus("error");
                    alert("Ошибка: " + e.message);
                  }
                  setTimeout(() => setPaymentsStatus("idle"), 3000);
                }}
              >
                {paymentsStatus === "sending" ? "Отправка..." :
                 paymentsStatus === "success" ? "Отправлено" :
                 paymentsStatus === "error" ? "Ошибка" :
                 "📋 Оплаты на завтра"}
              </button>
              <button
                type="button"
                title="Отправить оплаты в личку (тест)"
                disabled={testPaymentsStatus === "sending"}
                style={{
                  background: testPaymentsStatus === "success" ? "#4CAF50" : testPaymentsStatus === "error" ? "#f44336" : "#999",
                  color: "white", border: "none", padding: "4px 8px", borderRadius: 4,
                  cursor: testPaymentsStatus === "sending" ? "wait" : "pointer",
                  opacity: testPaymentsStatus === "sending" ? 0.7 : 1,
                  fontSize: "var(--font-xs)",
                  transition: "background 0.3s",
                }}
                onClick={async () => {
                  setTestPaymentsStatus("sending");
                  try {
                    const tomorrow = new Date();
                    tomorrow.setDate(tomorrow.getDate() + 1);
                    const dateStr = tomorrow.toISOString().slice(0, 10);
                    const res = await fetch("/api/payments/send-list", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({
                        chat_id: "319929790",
                        date: dateStr,
                      }),
                    });
                    const data = await res.json();
                    setTestPaymentsStatus(data.ok ? "success" : "error");
                  } catch {
                    setTestPaymentsStatus("error");
                  }
                  setTimeout(() => setTestPaymentsStatus("idle"), 3000);
                }}
              >
                {testPaymentsStatus === "sending" ? "..." :
                 testPaymentsStatus === "success" ? "✅" :
                 testPaymentsStatus === "error" ? "❌" :
                 "🧪 Тест"}
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!selectedTenant || !selectedChatId) {
                    alert("Выберите tenant и chat");
                    return;
                  }

                  // Calculate Monday of current week
                  const today = new Date();
                  const dayOfWeek = today.getDay();
                  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
                  const monday = new Date(today);
                  monday.setDate(today.getDate() + diff);
                  const weekStart = monday.toISOString().split("T")[0];

                  // Template: week slots with hours
                  const weekTemplate = [
                    { dow: "mon", morning: 5, evening: 6 },
                    { dow: "tue", morning: 5, evening: 6 },
                    { dow: "wed", morning: 4.5, evening: 6 },
                    { dow: "thu", morning: 5, evening: 5.5 },
                    { dow: "fri", morning: 5.5, evening: 6.5 },
                    { dow: "sat", morning: 6, evening: 6.5 },
                    { dow: "sun", morning: 5, evening: 6 },
                  ];

                  // Step 1: Open week
                  await debugSend(`OPEN_WEEK ${weekStart}`, "admin");
                  await new Promise((resolve) => setTimeout(resolve, 200));

                  // Helper function to send availability with specific user_id
                  const sendAvailability = async (user_id: string, role: string, dow: string, timeRange: string) => {
                    try {
                      const res = await fetch("/debug/send", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({
                          tenant_id: selectedTenant,
                          chat_id: selectedChatId,
                          user_id,
                          text: `AVAIL ${dow} ${timeRange}`,
                          meta: { role },
                        }),
                      });
                      const data = await res.json();
                      if (data.ok) {
                        setLastSend({
                          event: data.event,
                          facts: data.facts ?? [],
                          facts_count: data.facts_count ?? 0,
                        });
                      }
                    } catch (err) {
                      console.error("Failed to send availability", err);
                    }
                  };

                  // Step 2: Send availability for Иса (isa) - младший, минимум 22 часа
                  const isaAvailability = [
                    { dow: "mon", slot: "morning" },
                    { dow: "tue", slot: "morning" },
                    { dow: "thu", slot: "morning" },
                    { dow: "fri", slot: "morning" },
                    { dow: "sat", slot: "morning" },
                  ];
                  for (const avail of isaAvailability) {
                    const timeRange = avail.slot === "morning" ? "10-13" : "18-21";
                    await sendAvailability("isa", "staff", avail.dow, timeRange);
                    await new Promise((resolve) => setTimeout(resolve, 150));
                  }

                  // Step 3: Send availability for Дарина (daria) - младший, минимум 20 часов
                  const dariaAvailability = [
                    { dow: "mon", slot: "evening" },
                    { dow: "tue", slot: "evening" },
                    { dow: "wed", slot: "morning" },
                    { dow: "thu", slot: "morning" },
                    { dow: "sat", slot: "morning" },
                    { dow: "sun", slot: "evening" },
                  ];
                  for (const avail of dariaAvailability) {
                    const timeRange = avail.slot === "morning" ? "10-13" : "18-21";
                    await sendAvailability("daria", "staff", avail.dow, timeRange);
                    await new Promise((resolve) => setTimeout(resolve, 150));
                  }

                  // Step 4: Send availability for Ксюша (ksu) - младший, без минимума
                  const ksuAvailability = [
                    { dow: "tue", slot: "morning" },
                    { dow: "tue", slot: "evening" },
                    { dow: "wed", slot: "evening" },
                    { dow: "thu", slot: "evening" },
                    { dow: "fri", slot: "evening" },
                    { dow: "sun", slot: "morning" },
                  ];
                  for (const avail of ksuAvailability) {
                    const timeRange = avail.slot === "morning" ? "10-13" : "18-21";
                    await sendAvailability("ksu", "staff", avail.dow, timeRange);
                    await new Promise((resolve) => setTimeout(resolve, 150));
                  }

                  // Step 5: Send availability for Карина (karina) - junior, min 20h, все слоты
                  for (const day of weekTemplate) {
                    await sendAvailability("karina", "staff", day.dow, "10-13");
                    await new Promise((resolve) => setTimeout(resolve, 100));
                    await sendAvailability("karina", "staff", day.dow, "18-21");
                    await new Promise((resolve) => setTimeout(resolve, 100));
                  }

                  // Refresh events and schedule
                  await loadDialogEvents(selectedChatId, selectedTenant);
                  await refreshWeekState();
                  
                  alert("Эталонная неделя v1 загружена! Теперь можно нажать 'Собрать график (черновик)'");
                }}
                style={{ backgroundColor: "#e7f3ff", borderColor: "#0066cc" }}
                title="Загрузить предустановленный тестовый набор доступности"
              >
                Загрузить эталонную неделю v1
              </button>
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", gap: "4px", marginBottom: "8px", borderBottom: "1px solid #ddd" }}>
              <button
                type="button"
                onClick={() => setActiveTab("schedule")}
                style={{
                  padding: "4px 8px",
                  border: "none",
                  backgroundColor: activeTab === "schedule" ? "#007bff" : "transparent",
                  color: activeTab === "schedule" ? "white" : "#666",
                  cursor: "pointer",
                  borderRadius: "4px 4px 0 0",
                }}
              >
                График
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("timesheet")}
                style={{
                  padding: "4px 8px",
                  border: "none",
                  backgroundColor: activeTab === "timesheet" ? "#007bff" : "transparent",
                  color: activeTab === "timesheet" ? "white" : "#666",
                  cursor: "pointer",
                  borderRadius: "4px 4px 0 0",
                }}
              >
                Табель
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("empty")}
                style={{
                  padding: "4px 8px",
                  border: "none",
                  backgroundColor: activeTab === "empty" ? "#007bff" : "transparent",
                  color: activeTab === "empty" ? "white" : "#666",
                  cursor: "pointer",
                  borderRadius: "4px 4px 0 0",
                }}
              >
                Незаполненные
              </button>
            </div>

            {/* Tab Content: Schedule */}
            {activeTab === "schedule" && (
              <>
                {schedule && (
                  <div style={{ marginTop: "8px" }}>
                    <div style={{ fontSize: "0.85em", marginBottom: "8px", display: "inline-flex", alignItems: "center", gap: "8px" }}>
                      {(() => {
                        // Helper: local date to YYYY-MM-DD (avoids UTC timezone shift)
                        const localISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                        const navigateWeek = (delta: number) => {
                          const ws = new Date(weekStartISO + "T12:00:00");
                          ws.setDate(ws.getDate() + delta);
                          const dow = ws.getDay();
                          const diff = dow === 0 ? -6 : 1 - dow;
                          ws.setDate(ws.getDate() + diff);
                          const newISO = localISO(ws);
                          setWeekStartISO(newISO);
                          if (selectedChatId) {
                            fetch(`/debug/schedule?chat_id=${encodeURIComponent(selectedChatId)}&week_start=${encodeURIComponent(newISO)}`)
                              .then(r => r.ok ? r.json() : null).then(d => { if (d) setSchedule(d); });
                            fetch(`/debug/week_state?chat_id=${encodeURIComponent(selectedChatId)}&week_start=${encodeURIComponent(newISO)}`)
                              .then(r => r.ok ? r.json() : null).then(d => { if (d) setWeekStateResp(d); });
                          }
                        };
                        const wsD = new Date(weekStartISO + "T12:00:00");
                        const weD = new Date(wsD); weD.setDate(weD.getDate() + 6);
                        const dd = (d: Date) => String(d.getDate()).padStart(2, "0");
                        const mm = (d: Date) => String(d.getMonth() + 1).padStart(2, "0");
                        const rangeStr = `${dd(wsD)}.${mm(wsD)} \u2013 ${dd(weD)}.${mm(weD)}.${weD.getFullYear()}`;
                        return <>
                          <button type="button" onClick={() => navigateWeek(-7)}
                            style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid #ccc", cursor: "pointer", background: "#f5f5f5" }}>
                            &larr; Пред.
                          </button>
                          <span>Неделя: {rangeStr}</span>
                          <button type="button" onClick={() => navigateWeek(+7)}
                            style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid #ccc", cursor: "pointer", background: "#f5f5f5" }}>
                            След. &rarr;
                          </button>
                        </>;
                      })()}
                    </div>
                    
                    {/* Schedule Grid 7×2 */}
                    {vis["live_grid"] !== false && schedule.slots && (
                  <div style={{ marginBottom: "16px" }}>
                    <div style={{ fontSize: "0.85em", marginBottom: "8px", fontWeight: "bold" }}>
                      Живой график: <InfoTip text="Таблица смен на неделю. Зелёный=назначен, голубой=замена, розовый=проблема" />
                    </div>
                    {(() => {
                      const emptyCount = (schedule.slots || []).filter((s: any) => !s.user_id).length;
                      return emptyCount > 0 ? (
                        <div style={{ padding: "6px 10px", marginBottom: 8, borderRadius: 4, fontSize: "0.8em", fontWeight: "bold", background: "#f8d7da", color: "#721c24", border: "1px solid #f5c6cb" }}>
                          &#9888;&#65039; Есть {emptyCount} незакрытых смен
                        </div>
                      ) : null;
                    })()}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "80px repeat(7, 1fr)",
                        gap: "4px",
                        fontSize: "0.75em",
                      }}
                    >
                      {/* Header row */}
                      <div style={{ fontWeight: "bold", padding: "4px" }}>Слот</div>
                      {(["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const).map((dowKey, i) => {
                        const dayLabels = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
                        const isToday = schedule.today_dow === dowKey;
                        const dayDate = (() => {
                          const ws = new Date(weekStartISO + "T00:00:00");
                          ws.setDate(ws.getDate() + i);
                          const dd = String(ws.getDate()).padStart(2, "0");
                          const mm = String(ws.getMonth() + 1).padStart(2, "0");
                          return `${dd}.${mm}`;
                        })();
                        return (
                          <div key={i} style={{
                            fontWeight: "bold", padding: "4px", textAlign: "center",
                            ...(isToday ? { borderLeft: "3px solid #007bff", background: "#e7f3ff", color: "#1976d2" } : {}),
                          }}>
                            <div>{dayLabels[i]}<br/><small style={{ fontSize: "0.75em" }}>{dayDate}</small></div>
                          </div>
                        );
                      })}
                      
                      {/* Morning slots */}
                      <div style={{ padding: "4px", fontWeight: "bold" }}>Утро</div>
                      {["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((dow) => {
                        const slot = (schedule.slots || []).find(
                          (s: any) => s.dow === dow && s.slot_name === "Утро"
                        );
                        const isLocked = slot?.locked === true;
                        const canEditLocked = senderRole === "owner" || senderRole === "admin";
                        const effectivelyLocked = isLocked && !canEditLocked;
                        const isToday = schedule.today_dow === dow;
                        const bgColor = isLocked
                          ? "#f0f0f0"
                          : slot?.status === "NEEDS_REPLACEMENT"
                            ? "#fff3cd"
                            : slot?.replaced_user_id
                              ? "#d0e8ff"
                              : slot?.status === "CONFIRMED"
                                ? "#d4edda"
                                : slot?.status === "PENDING"
                                  ? "#fff3cd"
                                  : "#f8d7da";
                        const borderColor =
                          slot?.status === "NEEDS_REPLACEMENT"
                            ? "#ff9800"
                            : slot?.replaced_user_id
                              ? "#4a90d9"
                              : slot?.status === "CONFIRMED"
                                ? "#28a745"
                                : slot?.status === "PENDING"
                                  ? "#ffc107"
                                  : "#dc3545";
                        return (
                          <div
                            key={`${dow}-morning`}
                            title={effectivelyLocked ? "Этот день прошёл" : isLocked ? "Этот день прошёл (редактирование задним числом)" : "Кликните для назначения"}
                            onClick={() => {
                              if (effectivelyLocked) return;
                              openSlotModal(dow, "Утро", slot?.from || "10:00", slot?.to || "13:00", slot?.user_id || null, slot?.available_user_ids || [], isLocked);
                            }}
                            style={{
                              padding: "6px",
                              backgroundColor: bgColor,
                              border: `2px solid ${borderColor}`,
                              borderRadius: "4px",
                              minHeight: "50px",
                              display: "flex",
                              flexDirection: "column",
                              justifyContent: "center",
                              cursor: effectivelyLocked ? "default" : "pointer",
                              ...(effectivelyLocked ? { opacity: 0.6 } : isLocked ? { opacity: 0.85 } : {}),
                              ...(isToday ? { borderLeft: "3px solid #007bff" } : {}),
                            }}
                          >
                            {slot?.user_id ? (
                              <>
                                <div style={{ fontWeight: "bold", marginBottom: "4px" }}>
                                  {slot.status === "NEEDS_REPLACEMENT"
                                    ? `${UserDirectory.getDisplayName(slot.user_id)} ⚠️`
                                    : slot.replaced_user_id
                                      ? `${UserDirectory.getDisplayName(slot.user_id)} 🔄`
                                      : UserDirectory.getDisplayName(slot.user_id)}
                                </div>
                                <div style={{ fontSize: "0.75em", color: "#666" }}>
                                  {slot.status === "NEEDS_REPLACEMENT"
                                    ? "ищем замену"
                                    : slot.replaced_user_id
                                      ? `(за ${UserDirectory.getDisplayName(slot.replaced_user_id)})`
                                      : slot.hours != null ? `${slot.hours.toFixed(1)} ч` : "—"}
                                  {slot.is_problem && slot.status !== "NEEDS_REPLACEMENT" && " ⚠️"}
                                </div>
                                {slot.skill_mismatch && (
                                  <div style={{ fontSize: "0.7em", color: "#e65100" }} title={`Требуется: ${slot.skill_mismatch.required}, у сотрудника: ${slot.skill_mismatch.actual}`}>
                                    {"\u26A0"} квалиф.
                                  </div>
                                )}
                                {(() => {
                                  const cellExtras = extrasMap.get(`${dow}|${slot.user_id}`) || [];
                                  if (cellExtras.length === 0) return null;
                                  const hasPending = cellExtras.some(e => e.status === "pending");
                                  const tooltip = cellExtras.map(e => `${e.label} ${e.amount}\u20BD`).join(", ");
                                  return <div style={{ fontSize: "0.75em", marginTop: "1px" }} title={tooltip}>{hasPending ? "\u23F3" : "\uD83D\uDCB0"}</div>;
                                })()}
                              </>
                            ) : (
                              <div style={{ color: "#dc3545", fontWeight: "bold", fontSize: "0.85em" }}>&#9888;&#65039; Не назначен</div>
                            )}
                          </div>
                        );
                      })}

                      {/* Evening slots */}
                      <div style={{ padding: "4px", fontWeight: "bold" }}>Вечер</div>
                      {["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((dow) => {
                        const slot = (schedule.slots || []).find(
                          (s: any) => s.dow === dow && s.slot_name === "Вечер"
                        );
                        const isLocked = slot?.locked === true;
                        const canEditLocked = senderRole === "owner" || senderRole === "admin";
                        const effectivelyLocked = isLocked && !canEditLocked;
                        const isToday = schedule.today_dow === dow;
                        const bgColor = isLocked
                          ? "#f0f0f0"
                          : slot?.status === "NEEDS_REPLACEMENT"
                            ? "#fff3cd"
                            : slot?.replaced_user_id
                              ? "#d0e8ff"
                              : slot?.status === "CONFIRMED"
                                ? "#d4edda"
                                : slot?.status === "PENDING"
                                  ? "#fff3cd"
                                  : "#f8d7da";
                        const borderColor =
                          slot?.status === "NEEDS_REPLACEMENT"
                            ? "#ff9800"
                            : slot?.replaced_user_id
                              ? "#4a90d9"
                              : slot?.status === "CONFIRMED"
                                ? "#28a745"
                                : slot?.status === "PENDING"
                                  ? "#ffc107"
                                  : "#dc3545";
                        // Cleaning info for evening slots
                        const cleaningUser = slot?.cleaning_user_id;
                        const cleaningIsSwap = slot?.cleaning_is_replacement;
                        return (
                          <div
                            key={`${dow}-evening`}
                            title={effectivelyLocked ? "Этот день прошёл" : isLocked ? "Этот день прошёл (редактирование задним числом)" : "Кликните для назначения"}
                            onClick={() => {
                              if (effectivelyLocked) return;
                              openSlotModal(dow, "Вечер", slot?.from || "18:00", slot?.to || "21:00", slot?.user_id || null, slot?.available_user_ids || [], isLocked);
                            }}
                            style={{
                              padding: "6px",
                              backgroundColor: bgColor,
                              border: `2px solid ${borderColor}`,
                              borderRadius: "4px",
                              minHeight: "50px",
                              display: "flex",
                              flexDirection: "column",
                              justifyContent: "center",
                              cursor: effectivelyLocked ? "default" : "pointer",
                              ...(effectivelyLocked ? { opacity: 0.6 } : isLocked ? { opacity: 0.85 } : {}),
                              ...(isToday ? { borderLeft: "3px solid #007bff" } : {}),
                            }}
                          >
                            {slot?.user_id ? (
                              <>
                                <div style={{ fontWeight: "bold", marginBottom: "4px" }}>
                                  {slot.status === "NEEDS_REPLACEMENT"
                                    ? `${UserDirectory.getDisplayName(slot.user_id)} ⚠️`
                                    : slot.replaced_user_id
                                      ? `${UserDirectory.getDisplayName(slot.user_id)} 🔄`
                                      : UserDirectory.getDisplayName(slot.user_id)}
                                </div>
                                <div style={{ fontSize: "0.75em", color: "#666" }}>
                                  {slot.status === "NEEDS_REPLACEMENT"
                                    ? "ищем замену"
                                    : slot.replaced_user_id
                                      ? `(за ${UserDirectory.getDisplayName(slot.replaced_user_id)})`
                                      : slot.hours != null ? `${slot.hours.toFixed(1)} ч` : "—"}
                                  {slot.is_problem && slot.status !== "NEEDS_REPLACEMENT" && " ⚠️"}
                                </div>
                                {slot.cleaning_status && slot.cleaning_status !== "NOT_SCHEDULED" && (
                                <div style={{
                                  fontSize: "0.8em",
                                  marginTop: "2px",
                                  padding: "1px 4px",
                                  borderRadius: "3px",
                                  color: slot.cleaning_status === "NEEDS_REPLACEMENT" ? "#856404" : slot.cleaning_status === "REPLACED" ? "#004085" : slot.cleaning_scheduled === false ? "#e65100" : "#8B4513",
                                  backgroundColor: slot.cleaning_status === "NEEDS_REPLACEMENT" ? "#fff3cd" : slot.cleaning_status === "REPLACED" ? "#d0e8ff" : "transparent",
                                  ...(slot.cleaning_scheduled === false ? { border: "1px solid #ff9800", borderRadius: "3px" } : {}),
                                }}
                                  title={slot.cleaning_scheduled === false ? "\u041D\u0435\u0448\u0442\u0430\u0442\u043D\u0430\u044F \u0443\u0431\u043E\u0440\u043A\u0430" : undefined}
                                >
                                  {slot.cleaning_status === "NEEDS_REPLACEMENT"
                                    ? `\uD83E\uDDF9 ${UserDirectory.getDisplayName(cleaningUser)} \u26A0\uFE0F`
                                    : slot.cleaning_status === "REPLACED"
                                      ? `\uD83E\uDDF9 ${UserDirectory.getDisplayName(cleaningUser)} \uD83D\uDD04${slot.cleaning_original_user_id ? ` (\u0437\u0430 ${UserDirectory.getDisplayName(slot.cleaning_original_user_id)})` : ""}`
                                      : cleaningUser && cleaningIsSwap
                                        ? `\uD83E\uDDF9\u2192${UserDirectory.getDisplayName(cleaningUser)}`
                                        : "\uD83E\uDDF9"}
                                </div>
                                )}
                                {(() => {
                                  const cellExtras = extrasMap.get(`${dow}|${slot.user_id}`) || [];
                                  if (cellExtras.length === 0) return null;
                                  const hasPending = cellExtras.some(e => e.status === "pending");
                                  const tooltip = cellExtras.map(e => `${e.label} ${e.amount}\u20BD`).join(", ");
                                  return <div style={{ fontSize: "0.75em", marginTop: "1px" }} title={tooltip}>{hasPending ? "\u23F3" : "\uD83D\uDCB0"}</div>;
                                })()}
                              </>
                            ) : (
                              <div style={{ color: "#dc3545", fontWeight: "bold", fontSize: "0.85em" }}>&#9888;&#65039; Не назначен</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                    {/* Weekly hours summary */}
                    {schedule && schedule.slots && (() => {
                      const hoursByUser = new Map<string, number>();
                      for (const slot of schedule.slots as any[]) {
                        if (!slot.user_id) continue;
                        hoursByUser.set(slot.user_id, (hoursByUser.get(slot.user_id) || 0) + (slot.hours || 0));
                      }
                      const allUsers = UserDirectory.getAllUsers();
                      const entries = allUsers
                        .filter(u => hoursByUser.has(u.id) || u.minHours > 0)
                        .map(u => ({
                          id: u.id,
                          name: u.displayName,
                          hours: hoursByUser.get(u.id) || 0,
                          minHours: u.minHours,
                          underMin: u.minHours > 0 && (hoursByUser.get(u.id) || 0) < u.minHours,
                        }));
                      if (entries.length === 0) return null;
                      return (
                        <div style={{ fontSize: "0.8em", marginTop: "8px", padding: "8px 10px", borderRadius: 4, background: "#f8f9fa", border: "1px solid #dee2e6" }}>
                          <div style={{ fontWeight: "bold", marginBottom: "4px" }}>Часы за неделю:</div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                            {entries.map(e => (
                              <span key={e.id} style={{
                                padding: "2px 6px", borderRadius: 3,
                                background: e.underMin ? "#fff3cd" : "transparent",
                                border: e.underMin ? "1px solid #ffc107" : "1px solid transparent",
                              }}>
                                {e.name}: <strong>{e.hours.toFixed(1)}</strong>ч
                                {e.minHours > 0 && <span style={{ color: "#666" }}> (мин. {e.minHours})</span>}
                                {e.underMin && " \u26A0\uFE0F"}
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })()}

                    {!schedule || !schedule.slots ? (
                      <div style={{ fontSize: "0.85em", color: "#666", marginTop: "8px" }}>
                        График не загружен. Нажмите "Пересчитать график" или "Собрать график (черновик)".
                      </div>
                    ) : null}

                    {/* Legacy text view (collapsed by default) */}
                    {vis["details"] !== false && <details style={{ fontSize: "0.85em", marginTop: "8px" }}>
                      <summary style={{ cursor: "pointer", marginBottom: "4px" }}>
                        Детали (назначения, пробелы, конфликты) <InfoTip text="Подробности назначений, пробелы в графике, конфликты" />
                      </summary>
                      <div style={{ fontSize: "0.85em", marginBottom: "4px" }}>
                        <strong>Назначенные смены ({schedule.assignments?.length ?? 0}):</strong>
                      </div>
                      {schedule.assignments && schedule.assignments.length > 0 ? (
                        schedule.assignments.map((a, i) => (
                          <div key={i} className="empty" style={{ fontSize: "0.8em" }}>
                            {a.dow} {a.from}-{a.to}: {a.user_id} ({a.reason === "manual assignment" ? "ручное назначение" : a.reason})
                          </div>
                        ))
                      ) : (
                        <div className="empty" style={{ fontSize: "0.8em" }}>
                          Нет назначений
                        </div>
                      )}
                      <div style={{ fontSize: "0.85em", marginTop: "8px", marginBottom: "4px" }}>
                        <strong>Незакрытые смены ({schedule.gaps?.length ?? 0}):</strong>
                      </div>
                      {schedule.gaps && schedule.gaps.length > 0 ? (
                        schedule.gaps.map((g, i) => (
                          <div key={i} className="empty" style={{ fontSize: "0.8em" }}>
                            {g.dow} {g.from}-{g.to}: {g.reason}
                          </div>
                        ))
                      ) : (
                        <div className="empty" style={{ fontSize: "0.8em" }}>
                          Нет незакрытых смен
                        </div>
                      )}
                      <div style={{ fontSize: "0.85em", marginTop: "8px", marginBottom: "4px" }}>
                        <strong>Конфликты ({schedule.conflicts?.length ?? 0}):</strong>
                      </div>
                      {schedule.conflicts && schedule.conflicts.length > 0 ? (
                        schedule.conflicts.map((c, i) => (
                          <div key={i} className="empty" style={{ fontSize: "0.8em" }}>
                            {c.dow} {c.from}-{c.to}: {c.reason}
                          </div>
                        ))
                      ) : (
                        <div className="empty" style={{ fontSize: "0.8em" }}>
                          Нет конфликтов
                        </div>
                      )}
                    </details>}
                  </div>
                )}
                {!schedule && (
                  <div style={{ fontSize: "0.85em", color: "#666", marginTop: "8px" }}>
                    График не загружен. Нажмите "Пересчитать график" или "Собрать график (черновик)".
                  </div>
                )}
              </>
            )}

            {/* Tab Content: Timesheet */}
            {activeTab === "timesheet" && (
              <>
                <div style={{ marginBottom: "8px", display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                  {(["week", "first_half", "second_half", "full_month"] as const).map((m) => (
                    <button key={m} type="button"
                      style={{ padding: "3px 8px", fontSize: "0.75em", cursor: "pointer",
                        background: periodMode === m ? "#007bff" : "#e9ecef", color: periodMode === m ? "#fff" : "#333",
                        border: "none", borderRadius: 4 }}
                      onClick={() => { setPeriodMode(m); loadTimesheet(m); }}>
                      {{ week: "Неделя", first_half: "1\u201315", second_half: "16\u201331", full_month: "Весь месяц" }[m]}
                    </button>
                  ))}
                  <button type="button" title="Пересчитать табель" onClick={() => loadTimesheet()} style={{ padding: "3px 8px", fontSize: "0.75em" }}>
                    Пересчитать
                  </button>
                </div>

                {/* Pending extra work approvals (director only) */}
                {senderRole !== "staff" && pendingExtraWork.length > 0 && (
                  <div style={{ marginBottom: "8px", padding: "6px", background: "#fff3cd", borderRadius: 4, fontSize: "0.8em" }}>
                    <strong>Заявки на допработы ({pendingExtraWork.length})</strong>
                    {pendingExtraWork.map((ew: any) => (
                      <div key={ew.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 0" }}>
                        <span>{apiEmployees.find((e) => e.id === ew.user_id)?.name || ew.user_id}: {ew.fact_payload?.work_name} {ew.fact_payload?.price}₽</span>
                        <span style={{ display: "flex", gap: 4 }}>
                          <button onClick={() => approveExtraWork(ew.id)} style={{ fontSize: "0.8em", cursor: "pointer", padding: "1px 6px" }}>Утв.</button>
                          <button onClick={() => rejectExtraWork(ew.id)} style={{ fontSize: "0.8em", cursor: "pointer", padding: "1px 6px" }}>Откл.</button>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {timesheetErr && (
                  <div style={{ marginTop: "8px", fontSize: "0.8em", color: "red" }}>
                    Ошибка: {timesheetErr}
                  </div>
                )}
                {timesheet && (
                  <div style={{ marginTop: "8px" }}>
                    <div style={{ fontSize: "0.85em", marginBottom: "4px", fontWeight: "bold" }}>
                      {(() => {
                        const RU_MONTHS = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
                        const ws = weekStartISO || "2026-02-09";
                        const d = new Date(ws + "T12:00:00");
                        const dd = (dt: Date) => String(dt.getDate()).padStart(2, "0");
                        const mm = (dt: Date) => String(dt.getMonth() + 1).padStart(2, "0");
                        if (periodMode === "full_month") {
                          return `Табель за ${RU_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
                        }
                        if (periodMode === "first_half") {
                          const start = new Date(d.getFullYear(), d.getMonth(), 1);
                          const end = new Date(d.getFullYear(), d.getMonth(), 15);
                          return `Табель за период: ${dd(start)}.${mm(start)} \u2013 ${dd(end)}.${mm(end)}.${end.getFullYear()}`;
                        }
                        if (periodMode === "second_half") {
                          const start = new Date(d.getFullYear(), d.getMonth(), 16);
                          const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
                          const end = new Date(d.getFullYear(), d.getMonth(), lastDay);
                          return `Табель за период: ${dd(start)}.${mm(start)} \u2013 ${dd(end)}.${mm(end)}.${end.getFullYear()}`;
                        }
                        // week mode
                        const weD = new Date(d); weD.setDate(weD.getDate() + 6);
                        return `Табель за неделю: ${dd(d)}.${mm(d)} \u2013 ${dd(weD)}.${mm(weD)}.${weD.getFullYear()}`;
                      })()}
                    </div>
                    <div style={{ fontSize: "0.85em", marginBottom: "8px" }}>
                      <strong>Итого:</strong> {fmtNum(timesheet.totals?.total_hours)} ч, {fmtRub(timesheet.totals?.total_pay)}
                    </div>
                    <table
                      style={{
                        fontSize: "0.75em",
                        borderCollapse: "collapse",
                        width: "100%",
                        marginTop: "4px",
                      }}
                    >
                      <thead>
                        <tr style={{ borderBottom: "1px solid #ccc" }}>
                          <th style={{ textAlign: "left", padding: "2px 3px" }}>Имя</th>
                          <th style={{ textAlign: "right", padding: "2px 3px" }}>Часы</th>
                          <th style={{ textAlign: "right", padding: "2px 3px" }}>Пробл.</th>
                          <th style={{ textAlign: "right", padding: "2px 3px" }}>Эфф.ч</th>
                          <th style={{ textAlign: "right", padding: "2px 3px" }}>Смены ₽</th>
                          <th style={{ textAlign: "right", padding: "2px 3px" }}>Уб.</th>
                          <th style={{ textAlign: "right", padding: "2px 3px" }}>Уб. ₽</th>
                          <th style={{ textAlign: "right", padding: "2px 3px" }}>Зан.</th>
                          <th style={{ textAlign: "right", padding: "2px 3px" }}>Дети</th>
                          <th style={{ textAlign: "right", padding: "2px 3px" }}>Зан.₽</th>
                          <th style={{ textAlign: "right", padding: "2px 3px" }}>Доп₽</th>
                          {timesheet.employees?.some((e: any) => (e.inter_branch_pay || 0) > 0) && <th style={{ textAlign: "right", padding: "2px 3px" }}>{"\u041C\u0435\u0436\u0444."}</th>}
                          <th style={{ textAlign: "right", padding: "2px 3px", fontWeight: "bold" }}>Итого ₽</th>
                        </tr>
                      </thead>
                      <tbody>
                        {timesheet.employees?.map((emp: any, idx: number) => {
                          const showIB = timesheet.employees?.some((e: any) => (e.inter_branch_pay || 0) > 0);
                          return (
                          <React.Fragment key={idx}>
                            <tr
                              style={{ borderBottom: "1px solid #eee", cursor: "pointer", background: expandedEmpIdx === idx ? "#f0f7ff" : undefined }}
                              onClick={() => setExpandedEmpIdx(expandedEmpIdx === idx ? null : idx)}
                            >
                              <td style={{ padding: "2px 3px" }}>{expandedEmpIdx === idx ? "▼" : "▶"} {emp.name || emp.user_id}</td>
                              <td style={{ textAlign: "right", padding: "2px 3px" }}>{fmtNum(emp.shift_hours)}</td>
                              <td style={{ textAlign: "right", padding: "2px 3px", color: emp.problem_shifts > 0 ? "#dc3545" : undefined }}>{emp.problem_shifts}</td>
                              <td style={{ textAlign: "right", padding: "2px 3px" }}>{fmtNum(emp.effective_hours)}</td>
                              <td style={{ textAlign: "right", padding: "2px 3px" }}>{fmtRub(emp.shift_pay)}</td>
                              <td style={{ textAlign: "right", padding: "2px 3px" }}>{emp.cleaning_count}</td>
                              <td style={{ textAlign: "right", padding: "2px 3px" }}>{fmtRub(emp.cleaning_pay)}</td>
                              <td style={{ textAlign: "right", padding: "2px 3px" }}>{emp.extra_classes_count ?? emp.extra_classes?.length ?? 0}</td>
                              <td style={{ textAlign: "right", padding: "2px 3px" }}>{emp.extra_classes_total_kids ?? 0}</td>
                              <td style={{ textAlign: "right", padding: "2px 3px" }}>{fmtRub(emp.extra_classes_total_pay ?? 0)}</td>
                              <td style={{ textAlign: "right", padding: "2px 3px" }}>{(() => { const sum = (emp.extra_work_approved_pay || 0) + (emp.extra_pay_total || 0); return sum > 0 ? fmtRub(sum) : "\u2014"; })()}</td>
                              {showIB && <td style={{ textAlign: "right", padding: "2px 3px" }}>{(emp.inter_branch_pay || 0) > 0 ? fmtRub(emp.inter_branch_pay) : "\u2014"}</td>}
                              <td style={{ textAlign: "right", padding: "2px 3px", fontWeight: "bold" }}>{fmtRub(emp.total_pay)}</td>
                            </tr>
                            {expandedEmpIdx === idx && (
                              <tr>
                                <td colSpan={showIB ? 13 : 12} style={{ padding: "8px 12px", background: "#f8f9fa", fontSize: "0.85em" }}>
                                  <div><strong>Смены:</strong> {emp.shift_hours}ч × {emp.rate}₽/ч = {fmtRub(emp.shift_pay)}</div>
                                  {emp.problem_shifts > 0 && (
                                    <div style={{ color: "#dc3545" }}>
                                      <strong>Проблемные:</strong> {emp.problem_shifts} шт, −{emp.problem_deduction_hours}ч → эфф. {fmtNum(emp.effective_hours)}ч
                                    </div>
                                  )}
                                  {emp.cleaning_count > 0 && (
                                    <div><strong>Уборки:</strong> {emp.cleaning_count} × {emp.cleaning_count > 0 ? fmtRub(emp.cleaning_pay / emp.cleaning_count) : 0} = {fmtRub(emp.cleaning_pay)}</div>
                                  )}
                                  {(emp.inter_branch_pay || 0) > 0 && (
                                    <div><strong>Межфилиал:</strong> {fmtRub(emp.inter_branch_pay)}</div>
                                  )}
                                  {emp.extra_classes && emp.extra_classes.length > 0 && (
                                    <div>
                                      <strong>Доп.занятия:</strong>
                                      {emp.extra_classes.map((ec: any, i: number) => {
                                        const DOW_RU: Record<string, string> = { mon: "Пн", tue: "Вт", wed: "Ср", thu: "Чт", fri: "Пт", sat: "Сб", sun: "Вс" };
                                        const d = DOW_RU[ec.dow] || ec.dow || "—";
                                        const kids = ec.kids_count ?? "—";
                                        return <div key={i} style={{ marginLeft: 12 }}>{d}: {kids} детей → {fmtRub(ec.pay)}</div>;
                                      })}
                                    </div>
                                  )}
                                  {((emp.extra_work && emp.extra_work.length > 0) || (emp.extra_pay && emp.extra_pay.length > 0)) && (
                                    <div>
                                      <strong>Доплаты:</strong>
                                      {(emp.extra_work || []).map((ew: any, i: number) => (
                                        <div key={`ew${i}`} style={{ marginLeft: 12, color: ew.status === "rejected" ? "#999" : undefined }}>
                                          {ew.status === "approved" ? "\u2705" : ew.status === "rejected" ? "\u274C" : "\u23F3"}{" "}
                                          {ew.work_name} \u2014 {fmtRub(ew.price)}
                                          {ew.date ? ` (${ew.date})` : ""}
                                          {ew.status === "pending" ? " \u2014 \u043E\u0436\u0438\u0434\u0430\u0435\u0442 \u0443\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0438\u044F" : ""}
                                          {ew.comment ? ` \u2014 ${ew.comment}` : ""}
                                        </div>
                                      ))}
                                      {(emp.extra_pay || []).map((ep: any, i: number) => (
                                        <div key={`ep${i}`} style={{ marginLeft: 12 }}>
                                          {"\uD83D\uDCBC"} {ep.comment || "Доп"} \u2014 {fmtRub(ep.amount)}
                                          {ep.date ? ` (${ep.date})` : ""}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  <div style={{ marginTop: 4, fontWeight: "bold" }}>
                                    Итого: {emp.total_before_rounding !== emp.total_pay
                                      ? `${fmtRub(emp.total_before_rounding)} → ${fmtRub(emp.total_pay)} (округл.)`
                                      : fmtRub(emp.total_pay)}
                                  </div>
                                  {senderRole !== "staff" && (
                                    <button style={{ marginTop: 4, fontSize: "0.8em", padding: "2px 8px", cursor: "pointer" }}
                                      onClick={(ev) => { ev.stopPropagation(); openExtraPayModal({ user_id: emp.user_id, name: emp.name }); }}>
                                      + Доп
                                    </button>
                                  )}
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                    <div style={{ marginTop: "12px" }}>
                      <div style={{ fontSize: "0.85em", marginBottom: "4px" }}>
                        <strong>Команды табеля:</strong>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          onClick={() => debugSend(`CONFIRM_TIMESHEET ${weekStartISO}`, "admin")}
                        >
                          Подтвердить табель
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Tab Content: Empty Slots */}
            {activeTab === "empty" && (
              <>
                <div data-tab="empty"></div>
                {schedule && schedule.slots ? (
                  (() => {
                    const emptySlots = schedule.slots.filter((s: any) => s.status === "EMPTY");
                    const DOW_NAMES: Record<string, string> = {
                      mon: "Понедельник",
                      tue: "Вторник",
                      wed: "Среда",
                      thu: "Четверг",
                      fri: "Пятница",
                      sat: "Суббота",
                      sun: "Воскресенье",
                    };
                    return (
                      <div style={{ marginTop: "8px" }}>
                        {emptySlots.length === 0 ? (
                          <div style={{ fontSize: "0.85em", color: "#28a745" }}>
                            ✅ Все смены заполнены
                          </div>
                        ) : (
                          <div>
                            <div style={{ fontSize: "0.85em", marginBottom: "8px", color: "#666" }}>
                              Найдено незаполненных смен: {emptySlots.length}
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                              {emptySlots.map((slot: any, idx: number) => (
                                <div
                                  key={idx}
                                  style={{
                                    padding: "8px",
                                    backgroundColor: "#f8d7da",
                                    border: "1px solid #dc3545",
                                    borderRadius: "4px",
                                    fontSize: "0.85em",
                                  }}
                                >
                                  <div style={{ fontWeight: "bold" }}>
                                    {DOW_NAMES[slot.dow] || slot.dow} · {slot.slot_name}
                                  </div>
                                  <div style={{ color: "#666", marginTop: "2px" }}>
                                    {slot.from} - {slot.to}
                                    {slot.hours != null ? ` (${slot.hours.toFixed(1)} ч)` : " (—)"}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()
                ) : (
                  <div style={{ fontSize: "0.85em", color: "#666", marginTop: "8px" }}>
                    График не загружен. Нажмите "Пересчитать график" или "Собрать график (черновик)".
                  </div>
                )}
              </>
            )}

            {lastError && (
              <div style={{ marginTop: "8px", fontSize: "0.8em", color: "red" }}>
                Error: {lastError}
              </div>
            )}
          </ToggleSection>
          <ToggleSection id="schedule_controls" vis={vis} collapsed={collapsed} onHide={hideSection} onToggleCollapse={toggleCollapse}>
            <h3>Управление графиком <InfoTip text="Начать сбор → Собрать график → Закрыть неделю. Дата = понедельник недели" /></h3>
            <div style={{ marginBottom: "8px" }}>
              <input
                type="text"
                placeholder="2026-02-09"
                value={weekStartISO}
                onChange={(e) => setWeekStartISO(e.target.value)}
                style={{ width: "100%", fontSize: "0.8em", padding: "2px" }}
              />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: "8px" }}>
              <button
                type="button"
                title="Копирует прошлую неделю как черновик и собирает график"
                disabled={actionLoading === "propose"}
                onClick={async () => {
                  if (!selectedChatId) { showToast("Выберите chat", "err"); return; }
                  setActionLoading("propose");
                  console.log("[PROPOSE] Предложить график", { chat_id: selectedChatId, week_start: weekStartISO });
                  try {
                    // 1. Open week
                    await debugSend(`OPEN_WEEK ${weekStartISO}`, "admin");
                    // 2. Build schedule (uses existing availability or copies from facts)
                    const res = await fetch("/debug/build-schedule", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ chat_id: selectedChatId, week_start: weekStartISO, user_id: "admin1" }),
                    });
                    const data = await res.json();
                    console.log("[PROPOSE] build-schedule:", res.status, data);
                    if (res.ok && data.ok !== false) {
                      await debugSend(`PROPOSE ${weekStartISO}`, "admin");
                      await refreshWeekState();
                      await refreshSchedule();
                      setActiveTab("schedule");
                      showToast(`График предложен: ${data.assignments_created || 0} назначений, ${data.gaps || 0} пробелов`, "ok");
                    } else {
                      showToast(`Ошибка: ${data.error || "unknown"}`, "err");
                    }
                  } catch (e: any) {
                    console.error("[PROPOSE]", e);
                    showToast(`Ошибка: ${e?.message || e}`, "err");
                  } finally {
                    setActionLoading(null);
                  }
                }}
                style={{ backgroundColor: "#007bff", color: "#fff", border: "none", borderRadius: 4, padding: "4px 12px", cursor: "pointer" }}
              >
                {actionLoading === "propose" ? "Сборка..." : "Предложить график"}
              </button>
              <button
                type="button"
                title="Фиксирует график и считает зарплаты"
                disabled={actionLoading === "lock"}
                onClick={async () => {
                  setActionLoading("lock");
                  console.log("[LOCK] Зафиксировать", weekStartISO);
                  try {
                    await debugSend(`LOCK ${weekStartISO}`, "admin");
                    await refreshWeekState();
                    await loadTimesheet();
                    showToast("Неделя зафиксирована, табель пересчитан", "ok");
                  } catch (e: any) {
                    showToast(`Ошибка: ${e?.message || e}`, "err");
                  } finally {
                    setActionLoading(null);
                  }
                }}
                style={{ backgroundColor: "#28a745", color: "#fff", border: "none", borderRadius: 4, padding: "4px 12px", cursor: "pointer" }}
              >
                {actionLoading === "lock" ? "Фиксация..." : "Зафиксировать"}
              </button>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: "8px" }}>
              <button
                type="button"
                title="Открывает новую неделю для сбора доступности"
                disabled={actionLoading === "open"}
                onClick={async () => {
                  setActionLoading("open");
                  try {
                    await debugSend(`OPEN_WEEK ${weekStartISO}`, "admin");
                    await refreshWeekState();
                    showToast("Неделя открыта для сбора", "ok");
                  } finally { setActionLoading(null); }
                }}
                style={{ fontSize: "0.8em" }}
              >
                {actionLoading === "open" ? "..." : "Начать сбор"}
              </button>
              <button
                type="button"
                title="Удалить все факты и события недели, создать WEEK_OPEN заново"
                disabled={actionLoading === "reset"}
                onClick={async () => {
                  if (!window.confirm(`Обнулить неделю ${weekStartISO}? Все факты и события будут удалены.`)) return;
                  setActionLoading("reset");
                  try {
                    const res = await fetch("/api/reset-week", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ week_start: weekStartISO, chat_id: selectedChatId }),
                    });
                    const data = await res.json();
                    if (data.ok) {
                      showToast(`Неделя ${weekStartISO} обнулена (${data.facts_deleted} фактов удалено)`, "ok");
                      await refreshWeekState();
                    } else {
                      showToast("Ошибка: " + (data.error || "unknown"), "error");
                    }
                  } catch (e) { showToast("Ошибка сети", "error"); }
                  finally { setActionLoading(null); }
                }}
                style={{ fontSize: "0.8em", color: "#dc3545" }}
              >
                {actionLoading === "reset" ? "..." : "Обнулить неделю"}
              </button>
              <button
                type="button"
                title="Рассчитать зарплаты за неделю"
                disabled={actionLoading === "timesheet"}
                onClick={async () => {
                  setActionLoading("timesheet");
                  try {
                    await loadTimesheet();
                    showToast("Табель пересчитан", "ok");
                  } finally { setActionLoading(null); }
                }}
                style={{ fontSize: "0.8em" }}
              >
                {actionLoading === "timesheet" ? "..." : "Показать табель"}
              </button>
              <button
                type="button"
                title="Открыть сбор графика на следующую неделю (авто)"
                disabled={actionLoading === "auto-collect"}
                onClick={async () => {
                  if (!selectedChatId) { showToast("Выберите chat", "err"); return; }
                  setActionLoading("auto-collect");
                  try {
                    const res = await fetch("/api/schedule/auto-collect", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ chat_id: selectedChatId, tenant_id: selectedTenant }),
                    });
                    const data = await res.json();
                    if (data.ok) {
                      showToast(`Сбор открыт на ${data.week_start}`, "ok");
                      setWeekStartISO(data.week_start);
                      await refreshWeekState();
                      await refreshSchedule();
                    } else {
                      showToast(`Ошибка: ${data.error || "unknown"}`, "err");
                    }
                  } catch (e: any) {
                    showToast(`Ошибка: ${e?.message || e}`, "err");
                  } finally {
                    setActionLoading(null);
                  }
                }}
                style={{ fontSize: "0.8em", backgroundColor: "#17a2b8", color: "#fff", border: "none", borderRadius: 4, padding: "4px 8px", cursor: "pointer" }}
              >
                {actionLoading === "auto-collect" ? "..." : "Открыть сбор на след. неделю"}
              </button>
            </div>
            {vis["scenarios"] !== false && <div style={{ marginTop: "12px", padding: "8px", border: "1px solid #007bff", borderRadius: "4px", backgroundColor: "#e7f3ff" }}>
              <div style={{ fontSize: "0.85em", fontWeight: "bold", marginBottom: "8px" }}>Тестовые сценарии <InfoTip text="A=базовый, B=замены+уборки+допы, C=полный цикл" /></div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <button
                  type="button"
                  title="Базовый: 4 сотрудника, доступность, сборка графика"
                  style={{ fontSize: "0.8em", padding: "4px 8px", backgroundColor: "#007bff", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}
                  onClick={async () => {
                    console.log("[SCENARIO A] Сборка графика");
                    if (!selectedChatId || !selectedTenant) {
                      alert("Выберите chat и tenant");
                      return;
                    }
                    try {
                        // 1. Загрузить эталонную неделю
                        console.log("[SCENARIO A] Шаг 1: Загрузка эталонной недели");
                        await debugSend(`OPEN_WEEK ${weekStartISO}`, "admin");
                        // Isa availability
                        await debugSend(`AVAIL ${weekStartISO} mon 10-13`, "staff");
                        await debugSend(`AVAIL ${weekStartISO} tue 10-13`, "staff");
                        await debugSend(`AVAIL ${weekStartISO} thu 10-13`, "staff");
                        await debugSend(`AVAIL ${weekStartISO} fri 10-13`, "staff");
                        await debugSend(`AVAIL ${weekStartISO} sat 10-13`, "staff");
                        // Darina availability
                        await debugSend(`AVAIL ${weekStartISO} mon 18-21`, "staff");
                        await debugSend(`AVAIL ${weekStartISO} tue 18-21`, "staff");
                        await debugSend(`AVAIL ${weekStartISO} wed 10-13`, "staff");
                        await debugSend(`AVAIL ${weekStartISO} thu 10-13`, "staff");
                        await debugSend(`AVAIL ${weekStartISO} sat 10-13`, "staff");
                        await debugSend(`AVAIL ${weekStartISO} sun 18-21`, "staff");
                        
                        // 2. Собрать график
                        console.log("[SCENARIO A] Шаг 2: Сборка графика");
                        const buildRes = await fetch("/debug/build-schedule", {
                          method: "POST",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({
                            chat_id: selectedChatId,
                            week_start: weekStartISO,
                            user_id: "admin1",
                          }),
                        });
                        const buildData = await buildRes.json();
                        if (buildRes.ok && buildData.ok !== false) {
                          setSchedule(buildData.schedule);
                          // Transition to ACTIVE
                          await debugSend(`PROPOSE ${weekStartISO}`, "admin");
                          await refreshWeekState();
                          const scheduleRes = await fetch(
                            `/debug/schedule?chat_id=${encodeURIComponent(selectedChatId)}&week_start=${encodeURIComponent(weekStartISO)}`,
                          );
                          const scheduleData = await scheduleRes.json();
                          setSchedule(scheduleData);
                          console.log("[SCENARIO A] ✅ Ожидаемый результат: график собран, статус ACTIVE");
                          alert("Сценарий A завершён. Проверьте: график собран, статус ACTIVE (🟢)");
                        }
                      } catch (e: any) {
                        console.error("[SCENARIO A] Ошибка:", e);
                        alert(`Ошибка: ${String(e?.message || e)}`);
                      }
                    }}
                  >
                    Сценарий A: Сборка графика
                  </button>
                  <button
                    type="button"
                    title="Расширенный: замены смен, уборки, доп.занятия"
                    style={{ fontSize: "0.8em", padding: "4px 8px", backgroundColor: "#28a745", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}
                    onClick={async () => {
                      console.log("[SCENARIO B] Замена смены (4 замены)");
                      if (!selectedChatId || !selectedTenant) {
                        alert("Выберите chat и tenant");
                        return;
                      }
                      try {
                        const sendMsg = async (userId: string, text: string) => {
                          await fetch("/debug/send", {
                            method: "POST",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({
                              tenant_id: selectedTenant,
                              chat_id: selectedChatId,
                              user_id: userId,
                              text,
                              meta: { role: "staff" },
                            }),
                          });
                          await new Promise((r) => setTimeout(r, 250));
                        };

                        // Шаг 0: Сначала собрать график (Сценарий A)
                        console.log("[SCENARIO B] Шаг 0: Сборка графика (Сценарий A)");
                        await debugSend(`OPEN_WEEK ${weekStartISO}`, "admin");
                        // Иса (u1) — утренние смены
                        await sendMsg("u1", `AVAIL ${weekStartISO} mon 10-13`);
                        await sendMsg("u1", `AVAIL ${weekStartISO} tue 10-13`);
                        await sendMsg("u1", `AVAIL ${weekStartISO} thu 10-13`);
                        await sendMsg("u1", `AVAIL ${weekStartISO} fri 10-13`);
                        await sendMsg("u1", `AVAIL ${weekStartISO} sat 10-13`);
                        // Дарина (u2) — вечерние + доп
                        await sendMsg("u2", `AVAIL ${weekStartISO} mon 18-21`);
                        await sendMsg("u2", `AVAIL ${weekStartISO} tue 18-21`);
                        await sendMsg("u2", `AVAIL ${weekStartISO} wed 10-13`);
                        await sendMsg("u2", `AVAIL ${weekStartISO} thu 10-13`);
                        await sendMsg("u2", `AVAIL ${weekStartISO} sat 10-13`);
                        await sendMsg("u2", `AVAIL ${weekStartISO} sun 18-21`);
                        // Ксюша (u3) — вечерние (для замен)
                        await sendMsg("u3", `AVAIL ${weekStartISO} wed 18-21`);
                        await sendMsg("u3", `AVAIL ${weekStartISO} thu 18-21`);
                        await sendMsg("u3", `AVAIL ${weekStartISO} fri 18-21`);
                        await sendMsg("u3", `AVAIL ${weekStartISO} sun 10-13`);
                        // Карина (u4) — вечерние
                        await sendMsg("u4", `AVAIL ${weekStartISO} sat 18-21`);
                        await sendMsg("u4", `AVAIL ${weekStartISO} fri 18-21`);

                        const buildRes = await fetch("/debug/build-schedule", {
                          method: "POST",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({
                            chat_id: selectedChatId,
                            week_start: weekStartISO,
                            user_id: "admin1",
                          }),
                        });
                        const buildData = await buildRes.json();
                        if (!buildRes.ok || buildData.ok === false) {
                          alert(`Ошибка сборки: ${buildData.error || "unknown"}`);
                          return;
                        }
                        setSchedule(buildData.schedule);
                        await debugSend(`PROPOSE ${weekStartISO}`, "admin");
                        await refreshWeekState();

                        // Шаг 1: Замена 1 — Иса не может в чт утро → Ксюша выходит
                        console.log("[SCENARIO B] Замена 1: Иса → Ксюша (чт утро)");
                        await sendMsg("u1", "девочки, не могу в четверг утро, кто сможет?");
                        await sendMsg("u3", "я смогу выйти в чт утро");

                        // Шаг 2: Замена 2 — Дарина не может в пн вечер → Карина выходит
                        console.log("[SCENARIO B] Замена 2: Дарина → Карина (пн вечер)");
                        await sendMsg("u2", "не смогу в понедельник вечер, подмените пожалуйста");
                        await sendMsg("u4", "могу в пн вечер, подменю");

                        // Шаг 3: Замена 3 — Ксюша не может в ср утро → Иса выходит
                        console.log("[SCENARIO B] Замена 3: Ксюша → Иса (ср утро)");
                        await sendMsg("u3", "в среду утро не получится, кто может?");
                        await sendMsg("u1", "я выйду в ср утро");

                        // Шаг 4: Замена 4 — Карина не может в пт вечер → Дарина выходит
                        console.log("[SCENARIO B] Замена 4: Карина → Дарина (пт вечер)");
                        await sendMsg("u4", "пт вечер не смогу, кто свободен?");
                        await sendMsg("u2", "я смогу в пт вечер");

                        // Шаг 5: Уборки
                        console.log("[SCENARIO B] Уборки");
                        await sendMsg("u2", "убралась во вторник");
                        await sendMsg("u3", "уборку в среду за меня сделает Карина");
                        await sendMsg("u4", "убралась в среду");
                        await sendMsg("u1", "убрался в четверг");

                        // Шаг 6: Доп занятия
                        console.log("[SCENARIO B] Доп занятия");
                        await sendMsg("u1", "доп занятие пн 12 детей");
                        await sendMsg("u2", "допы ср 5 детей");
                        await sendMsg("u4", "провела доп пт 10 детей");

                        // Обновить данные
                        await loadDialogEvents(selectedChatId, selectedTenant);
                        await refreshWeekState();
                        const scheduleRes = await fetch(
                          `/debug/schedule?chat_id=${encodeURIComponent(selectedChatId)}&week_start=${encodeURIComponent(weekStartISO)}`,
                        );
                        const scheduleData = await scheduleRes.json();
                        setSchedule(scheduleData);

                        // Count replacements
                        const replacements = (scheduleData.slots || []).filter((s: any) => s.replaced_user_id);
                        console.log("[SCENARIO B] ✅ Замены в графике:", replacements.length);
                        alert(`Сценарий B завершён (4 замены + уборки + допы).\nЗамены: ${replacements.length}\n• чт утро: Ксюша за Иса\n• пн вечер: Карина за Дарина\n• ср утро: Иса за Ксюша/Дарина\n• пт вечер: Дарина за Карина\nУборки: u2 вт, u4 ср (за u3), u1 чт\nДопы: u1 пн 12д, u2 ср 5д, u4 пт 10д\nПроверьте 🔄 и 🧹 в графике.`);
                      } catch (e: any) {
                        console.error("[SCENARIO B] Ошибка:", e);
                        alert(`Ошибка: ${String(e?.message || e)}`);
                      }
                    }}
                  >
                    Сценарий B: Замены + Уборки + Допы
                  </button>
                  <button
                    type="button"
                    title="Полный цикл: сбор -> график -> замены -> закрытие"
                    style={{ fontSize: "0.8em", padding: "4px 8px", backgroundColor: "#ffc107", color: "black", border: "none", borderRadius: "4px", cursor: "pointer" }}
                    onClick={async () => {
                      console.log("[SCENARIO C] Зарплата (полный цикл)");
                      if (!selectedChatId || !selectedTenant) {
                        alert("Выберите chat и tenant");
                        return;
                      }
                      try {
                        const sendMsg = async (userId: string, text: string) => {
                          await fetch("/debug/send", {
                            method: "POST",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({
                              tenant_id: selectedTenant,
                              chat_id: selectedChatId,
                              user_id: userId,
                              text,
                              meta: { role: "staff" },
                            }),
                          });
                          await new Promise((r) => setTimeout(r, 250));
                        };

                        // Шаг 1: Запустить Сценарий A (сбор доступности + черновик)
                        console.log("[SCENARIO C] Шаг 1: Сбор доступности");
                        await debugSend(`OPEN_WEEK ${weekStartISO}`, "admin");
                        // Иса (u1) — утренние
                        await sendMsg("u1", `AVAIL ${weekStartISO} mon 10-13`);
                        await sendMsg("u1", `AVAIL ${weekStartISO} tue 10-13`);
                        await sendMsg("u1", `AVAIL ${weekStartISO} wed 10-13`);
                        await sendMsg("u1", `AVAIL ${weekStartISO} thu 10-13`);
                        await sendMsg("u1", `AVAIL ${weekStartISO} fri 10-13`);
                        await sendMsg("u1", `AVAIL ${weekStartISO} sat 10-13`);
                        // Дарина (u2) — вечерние + доп
                        await sendMsg("u2", `AVAIL ${weekStartISO} mon 18-21`);
                        await sendMsg("u2", `AVAIL ${weekStartISO} tue 18-21`);
                        await sendMsg("u2", `AVAIL ${weekStartISO} wed 10-13`);
                        await sendMsg("u2", `AVAIL ${weekStartISO} thu 10-13`);
                        await sendMsg("u2", `AVAIL ${weekStartISO} sat 10-13`);
                        await sendMsg("u2", `AVAIL ${weekStartISO} sun 18-21`);
                        // Ксюша (u3) — вечерние
                        await sendMsg("u3", `AVAIL ${weekStartISO} wed 18-21`);
                        await sendMsg("u3", `AVAIL ${weekStartISO} thu 18-21`);
                        await sendMsg("u3", `AVAIL ${weekStartISO} fri 18-21`);
                        await sendMsg("u3", `AVAIL ${weekStartISO} sun 10-13`);
                        // Карина (u4) — вечерние
                        await sendMsg("u4", `AVAIL ${weekStartISO} sat 18-21`);
                        await sendMsg("u4", `AVAIL ${weekStartISO} fri 18-21`);

                        // Собрать график
                        console.log("[SCENARIO C] Шаг 2: Сборка графика");
                        const buildRes = await fetch("/debug/build-schedule", {
                          method: "POST",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({
                            chat_id: selectedChatId,
                            week_start: weekStartISO,
                            user_id: "admin1",
                          }),
                        });
                        const buildData = await buildRes.json();
                        if (!buildRes.ok || buildData.ok === false) {
                          alert(`Ошибка сборки: ${buildData.error || "unknown"}`);
                          return;
                        }
                        setSchedule(buildData.schedule);
                        await debugSend(`PROPOSE ${weekStartISO}`, "admin");
                        await refreshWeekState();

                        // Шаг 3: Замены (из Сценария B)
                        console.log("[SCENARIO C] Шаг 3: 4 замены");
                        await sendMsg("u1", "девочки, не могу в четверг утро, кто сможет?");
                        await sendMsg("u3", "я смогу выйти в чт утро");
                        await sendMsg("u2", "не смогу в понедельник вечер, подмените пожалуйста");
                        await sendMsg("u4", "могу в пн вечер, подменю");
                        await sendMsg("u3", "в среду утро не получится, кто может?");
                        await sendMsg("u1", "я выйду в ср утро");
                        await sendMsg("u4", "пт вечер не смогу, кто свободен?");
                        await sendMsg("u2", "я смогу в пт вечер");

                        // Шаг 4: Уборки
                        console.log("[SCENARIO C] Шаг 4: Уборки");
                        await sendMsg("u2", "убралась во вторник");
                        await sendMsg("u3", "уборку в среду за меня сделает Карина");
                        await sendMsg("u4", "убралась в среду");
                        await sendMsg("u1", "убрался в четверг");

                        // Шаг 5: Доп занятия
                        console.log("[SCENARIO C] Шаг 5: Доп занятия");
                        await sendMsg("u1", "доп занятие пн 12 детей");
                        await sendMsg("u2", "допы ср 5 детей");
                        await sendMsg("u4", "провела доп пт 10 детей");

                        // Шаг 6: Пересчитать график и табель
                        console.log("[SCENARIO C] Шаг 6: Пересчёт");
                        await loadDialogEvents(selectedChatId, selectedTenant);
                        await refreshWeekState();
                        const scheduleRes = await fetch(
                          `/debug/schedule?chat_id=${encodeURIComponent(selectedChatId)}&week_start=${encodeURIComponent(weekStartISO)}`,
                        );
                        const scheduleData = await scheduleRes.json();
                        setSchedule(scheduleData);
                        await loadTimesheet();

                        console.log("[SCENARIO C] ✅ Полный цикл завершён");
                        alert("Сценарий C завершён (полный цикл).\n• Доступность → Черновик → Замены → Уборки → Допы → Табель\nПроверьте табель с уборками и допами.");
                      } catch (e: any) {
                        console.error("[SCENARIO C] Ошибка:", e);
                        alert(`Ошибка: ${String(e?.message || e)}`);
                      }
                    }}
                  >
                    Сценарий C: Полный цикл
                  </button>
                </div>
              </div>}
            {vis["tech_commands"] !== false && <div style={{ fontSize: "0.75em", color: "#666", marginTop: "8px" }}>
              <div>Технические команды <InfoTip text="Отладочные команды для ручного управления графиком" /></div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: "4px" }}>
                <button
                  type="button"
                  style={{ fontSize: "0.7em", padding: "2px 4px" }}
                  onClick={() => debugSend(`DECLARE_GAP ${weekStartISO} thu 18-21`, "staff")}
                >
                  DECLARE_GAP
                </button>
                <button
                  type="button"
                  style={{ fontSize: "0.7em", padding: "2px 4px" }}
                  onClick={() => debugSend(`ASSIGN ${weekStartISO} thu 18-21 u2`, "senior")}
                >
                  ASSIGN
                </button>
                <button
                  type="button"
                  style={{ fontSize: "0.7em", padding: "2px 4px" }}
                  onClick={() => debugSend(`APPROVE_OVERTIME ${weekStartISO} thu 18-21`, "owner")}
                >
                  APPROVE_OVERTIME
                </button>
                <button
                  type="button"
                  style={{ fontSize: "0.7em", padding: "2px 4px", backgroundColor: "#ffc107", color: "black", border: "none", borderRadius: "2px" }}
                  onClick={() => debugSend(`PROBLEM ${weekStartISO} mon 10-13 u1 late`, "admin")}
                >
                  PROBLEM (пн утро u1)
                </button>
                <button
                  type="button"
                  style={{ fontSize: "0.7em", padding: "2px 4px", backgroundColor: "#dc3545", color: "white", border: "none", borderRadius: "2px" }}
                  onClick={async () => {
                    try {
                      const chatParam = selectedChatId ? `?chat_id=${encodeURIComponent(selectedChatId)}` : "";
                      await Promise.all([
                        fetch(`/api/extra-work/clear${chatParam}`, { method: "DELETE" }),
                        fetch(`/api/extra-pay/clear${chatParam}`, { method: "DELETE" }),
                      ]);
                      showToast("Все допы удалены");
                      loadTimesheet();
                      loadPendingExtraWork();
                    } catch (e: any) {
                      showToast(`Ошибка: ${e?.message || e}`, "err");
                    }
                  }}
                >
                  {"\uD83D\uDDD1\uFE0F"} Очистить все допы
                </button>
              </div>
            </div>}
          </ToggleSection>
          <ToggleSection id="notifications" vis={vis} collapsed={collapsed} onHide={hideSection} onToggleCollapse={toggleCollapse}>
            <h3>Уведомления <InfoTip text="Системные уведомления и предупреждения" /></h3>
            {(() => {
              // Build notifications from events/facts
              const notifications: Array<{ icon: string; text: string; ts: string }> = [];

              // Scan events for replacement-related facts
              for (const [eventId, facts] of factsPerEvent.entries()) {
                const ev = events.find((e: any) => e.id === eventId);
                const ts = ev?.received_at ? new Date(ev.received_at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "";

                for (const f of facts) {
                  if (f.fact_type === "SHIFT_AVAILABILITY") {
                    const userName = UserDirectory.getDisplayName(ev?.user_id || f.user_id || "");
                    const dayName = ({ mon: "Пн", tue: "Вт", wed: "Ср", thu: "Чт", fri: "Пт", sat: "Сб", sun: "Вс" } as Record<string, string>)[f.fact_payload?.dow] || f.fact_payload?.dow;
                    notifications.push({
                      icon: "📋",
                      text: `${userName}: доступность ${dayName} ${f.fact_payload?.from}-${f.fact_payload?.to}`,
                      ts,
                    });
                  } else if (f.fact_type === "SHIFT_UNAVAILABILITY" && f.fact_payload?.needs_replacement) {
                    const userName = UserDirectory.getDisplayName(ev?.user_id || f.user_id || "");
                    const dayName = ({ mon: "Пн", tue: "Вт", wed: "Ср", thu: "Чт", fri: "Пт", sat: "Сб", sun: "Вс" } as Record<string, string>)[f.fact_payload?.dow] || f.fact_payload?.dow;
                    notifications.push({
                      icon: "⚠️",
                      text: `${dayName} ${f.fact_payload?.from}-${f.fact_payload?.to}: ${userName} не может, ищем замену`,
                      ts,
                    });
                  } else if (f.fact_type === "SHIFT_REPLACEMENT") {
                    const userName = UserDirectory.getDisplayName(ev?.user_id || f.user_id || "");
                    const dayName = ({ mon: "Пн", tue: "Вт", wed: "Ср", thu: "Чт", fri: "Пт", sat: "Сб", sun: "Вс" } as Record<string, string>)[f.fact_payload?.dow] || f.fact_payload?.dow;
                    notifications.push({
                      icon: "✅",
                      text: `${dayName} ${f.fact_payload?.from}-${f.fact_payload?.to}: ${userName} вышла на замену`,
                      ts,
                    });
                  }
                }
              }

              // Show last 10 notifications (most recent first)
              const recent = notifications.slice(-10).reverse();

              return (
                <div style={{ marginTop: "8px" }}>
                  {recent.length === 0 ? (
                    <div style={{ fontSize: "0.85em", color: "#666" }}>
                      Нет уведомлений. Отправьте сообщения в чат.
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      {recent.map((n, idx) => (
                        <div
                          key={idx}
                          style={{
                            padding: "6px 8px",
                            backgroundColor: n.icon === "⚠️" ? "#fff3cd" : n.icon === "✅" ? "#d4edda" : "#e7f3ff",
                            borderRadius: "4px",
                            fontSize: "0.8em",
                            display: "flex",
                            gap: "6px",
                            alignItems: "flex-start",
                          }}
                        >
                          <span>{n.icon}</span>
                          <span style={{ flex: 1 }}>{n.text}</span>
                          <span style={{ fontSize: "0.75em", color: "#666", whiteSpace: "nowrap" }}>{n.ts}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </ToggleSection>
          <ToggleSection id="week_status" vis={vis} collapsed={collapsed} onHide={hideSection} onToggleCollapse={toggleCollapse}>
            <h3>Статус недели <InfoTip text="Отладка: JSON-состояние текущей недели" /></h3>
            <button
              type="button"
              title="Запросить актуальный статус недели с сервера"
              onClick={refreshWeekState}
            >
              Обновить статус
            </button>
            {weekStateErr && (
              <div style={{ marginTop: "8px", fontSize: "0.8em", color: "red" }}>
                Ошибка: {weekStateErr}
              </div>
            )}
            {weekStateResp && (
              <div style={{ marginTop: "8px" }}>
                {(() => {
                  const ws = translateWeekState(weekStateResp.week_state?.state || "");
                  return (
                    <div style={{ fontSize: "0.85em", marginBottom: "4px", display: "flex", alignItems: "center", gap: "6px" }}>
                      <strong>Статус:</strong>
                      <span style={{ color: ws.color, fontWeight: "bold" }}>{ws.emoji} {ws.label}</span>
                    </div>
                  );
                })()}
                {weekStateResp.week_state?.required_actions &&
                  weekStateResp.week_state.required_actions.length > 0 && (
                    <div style={{ fontSize: "0.85em", marginTop: "4px" }}>
                      <strong>Требуются действия:</strong>{" "}
                      {weekStateResp.week_state.required_actions
                        .map((action: string) => {
                          if (action.includes("uncovered shifts")) return "Незакрытые смены — нужна замена";
                          if (action.includes("replacement")) return "Нужна замена на смену";
                          return action;
                        })
                        .join(", ")}
                    </div>
                  )}
                {weekStateResp.week_state?.gaps_open &&
                  weekStateResp.week_state.gaps_open.length > 0 && (
                    <div style={{ fontSize: "0.85em", marginTop: "4px" }}>
                      <strong>Незакрытые смены:</strong>{" "}
                      {weekStateResp.week_state.gaps_open
                        .map((gap: any) => `${gap.dow} ${gap.from}-${gap.to}`)
                        .join(", ")}
                    </div>
                  )}
                <pre
                  style={{
                    fontSize: "0.75em",
                    marginTop: "8px",
                    padding: "4px",
                    backgroundColor: "#f5f5f5",
                    maxHeight: "300px",
                    overflow: "auto",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {JSON.stringify(weekStateResp, null, 2)}
                </pre>
              </div>
            )}
          </ToggleSection>
          <ToggleSection id="confirm_facts" vis={vis} collapsed={collapsed} onHide={hideSection} onToggleCollapse={toggleCollapse}>
            <h3>Подтверждение факта (проблемные смены)</h3>
            {schedule && schedule.slots && (() => {
              // Find problematic shifts that need fact confirmation
              // A shift is problematic if:
              // - is_problematic === true
              // - shift date has passed (for v1, we'll show all problematic shifts)
              const problematicSlots = schedule.slots.filter((slot: any) => 
                slot.is_problematic && slot.user_id && slot.status === "CONFIRMED"
              );

              if (problematicSlots.length === 0) {
                return (
                  <div style={{ fontSize: "0.85em", color: "#666", marginTop: "8px" }}>
                    Нет проблемных смен, требующих подтверждения факта
                  </div>
                );
              }

              return (
                <div style={{ marginTop: "8px" }}>
                  {problematicSlots.map((slot: any, idx: number) => {
                    const slotKey = `${slot.dow}|${slot.from}|${slot.to}`;
                    return (
                      <div key={idx} style={{ marginBottom: "12px", padding: "8px", border: "1px solid #ddd", borderRadius: "4px", backgroundColor: "#fff3cd" }}>
                        <div style={{ fontSize: "0.85em", fontWeight: "bold", marginBottom: "4px" }}>
                          {slot.user_id}: {slot.dow} {slot.from}-{slot.to} ({slot.hours?.toFixed(1)} ч)
                        </div>
                        <div style={{ fontSize: "0.75em", marginBottom: "8px", color: "#666" }}>
                          Причины: {slot.problem_reasons?.join(", ") || "проблемная смена"}
                        </div>
                        <div style={{ fontSize: "0.75em", marginBottom: "8px", color: "#666" }}>
                          Смена прошла как планировалось?
                        </div>
                        <div style={{ display: "flex", gap: "8px" }}>
                          <button
                            type="button"
                            onClick={async () => {
                              console.log("[CONFIRM_SHIFT_FACT] Clicked OK for", slot.user_id, slot.dow, slot.from, slot.to);
                              if (!selectedTenant || !selectedChatId) {
                                alert("Выберите tenant и chat");
                                return;
                              }
                              try {
                                const res = await fetch("/debug/send", {
                                  method: "POST",
                                  headers: { "content-type": "application/json" },
                                  body: JSON.stringify({
                                    tenant_id: selectedTenant,
                                    chat_id: selectedChatId,
                                    user_id: slot.user_id,
                                    text: `CONFIRM_SHIFT_FACT ${weekStartISO} ${slot.dow} ${slot.from.replace(":00", "")}-${slot.to.replace(":00", "")} ok`,
                                    meta: { role: "staff" },
                                  }),
                                });
                                const data = await res.json();
                                console.log("[CONFIRM_SHIFT_FACT] Response:", data);
                                if (data.ok) {
                                  setLastSend({
                                    event: data.event,
                                    facts: data.facts ?? [],
                                    facts_count: data.facts_count ?? 0,
                                  });
                                  // Reload schedule immediately
                                  const scheduleRes = await fetch(
                                    `/debug/schedule?chat_id=${encodeURIComponent(selectedChatId)}&week_start=${encodeURIComponent(weekStartISO)}`,
                                  );
                                  const scheduleData = await scheduleRes.json();
                                  console.log("[CONFIRM_SHIFT_FACT] Schedule reloaded:", scheduleData);
                                  setSchedule(scheduleData);
                                  // Also reload timesheet
                                  await loadTimesheet();
                                  await loadDialogEvents(selectedChatId, selectedTenant);
                                } else {
                                  console.error("[CONFIRM_SHIFT_FACT] Failed:", data);
                                  alert(`Ошибка: ${data.error || "unknown"}`);
                                }
                              } catch (err: any) {
                                console.error("[CONFIRM_SHIFT_FACT] Error:", err);
                                alert(`Ошибка: ${String(err?.message || err)}`);
                              }
                            }}
                            style={{ backgroundColor: "#28a745", color: "white", border: "none", padding: "4px 8px", borderRadius: "4px", cursor: "pointer" }}
                          >
                            ✅ Да, всё ок
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              // For v1, we'll use a simple reason
                              const reason = prompt("Укажите причину проблемы (кратко):", "проблема");
                              if (reason === null) return; // User cancelled
                              const res = await fetch("/debug/send", {
                                method: "POST",
                                headers: { "content-type": "application/json" },
                                body: JSON.stringify({
                                  tenant_id: selectedTenant,
                                  chat_id: selectedChatId,
                                  user_id: slot.user_id,
                                  text: `CONFIRM_SHIFT_FACT ${weekStartISO} ${slot.dow} ${slot.from.replace(":00", "")}-${slot.to.replace(":00", "")} problem ${reason}`,
                                  meta: { role: "staff" },
                                }),
                              });
                              const data = await res.json();
                              if (data.ok) {
                                setLastSend({
                                  event: data.event,
                                  facts: data.facts ?? [],
                                  facts_count: data.facts_count ?? 0,
                                });
                              }
                              if (selectedChatId && selectedTenant) {
                                await loadDialogEvents(selectedChatId, selectedTenant);
                              }
                              await loadTimesheet();
                              // Reload schedule
                              if (selectedChatId) {
                                const scheduleRes = await fetch(
                                  `/debug/schedule?chat_id=${encodeURIComponent(selectedChatId)}&week_start=${encodeURIComponent(weekStartISO)}`,
                                );
                                const scheduleData = await scheduleRes.json();
                                setSchedule(scheduleData);
                              }
                            }}
                            style={{ backgroundColor: "#dc3545", color: "white", border: "none", padding: "4px 8px", borderRadius: "4px", cursor: "pointer" }}
                          >
                            ⚠️ Была проблема
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </ToggleSection>
        </div>
      </aside>
    </div>
  );
};

