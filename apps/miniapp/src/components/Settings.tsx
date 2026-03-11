import React from "react";
import {
  getEmployees, createEmployee, updateEmployee, deleteEmployee,
  getSettings, updateSetting, getBotMode, setBotMode, getCatalog,
  getGroups, updateGroupJunior, updateGroupField,
  type Employee, type CatalogItem, type GroupConfig,
} from "../api";
import { haptic } from "../telegram";
import { useToast } from "../App";

type Tab = "shifts" | "employees" | "catalog" | "cleanings" | "branches" | "rates" | "groups" | "bot";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "shifts", label: "Смены" },
  { id: "employees", label: "Сотрудники" },
  { id: "rates", label: "Ставки" },
  { id: "catalog", label: "Каталог" },
  { id: "groups", label: "Группы" },
  { id: "cleanings", label: "Уборки" },
  { id: "branches", label: "Филиалы" },
  { id: "bot", label: "Бот" },
];

const DAYS_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const DAYS_KEY = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export const Settings: React.FC<{ isOwner: boolean }> = ({ isOwner }) => {
  const [tab, setTab] = React.useState<Tab>("shifts");

  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Настройки</div>

      {/* Scrollable tab bar */}
      <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", marginBottom: 14, paddingBottom: 4 }}>
        <div style={{ display: "flex", gap: 4, minWidth: "max-content" }}>
          {TABS.map((t) => (
            <button key={t.id}
              className={tab === t.id ? "btn" : "btn btn-secondary"}
              style={{ fontSize: 12, padding: "7px 12px", whiteSpace: "nowrap" }}
              onClick={() => { haptic("light"); setTab(t.id); }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "shifts" && <ShiftsTab />}
      {tab === "employees" && <EmployeesTab isOwner={isOwner} />}
      {tab === "rates" && <RatesTab isOwner={isOwner} />}
      {tab === "catalog" && <CatalogTab isOwner={isOwner} />}
      {tab === "groups" && <GroupsTab isOwner={isOwner} />}
      {tab === "cleanings" && <CleaningsTab />}
      {tab === "branches" && <BranchesTab />}
      {tab === "bot" && isOwner && <BotModeTab />}
      {tab === "bot" && !isOwner && (
        <div className="card" style={{ textAlign: "center", color: "var(--tg-hint)" }}>Только для владельца</div>
      )}
    </div>
  );
};

/* ── Shifts ── */

const ShiftsTab: React.FC = () => {
  const toast = useToast();
  const [mFrom, setMFrom] = React.useState("10:00");
  const [mTo, setMTo] = React.useState("13:00");
  const [eFrom, setEFrom] = React.useState("18:00");
  const [eTo, setETo] = React.useState("21:00");
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    getSettings()
      .then((d) => {
        if (d["shifts.morning.from"]) setMFrom(d["shifts.morning.from"]);
        if (d["shifts.morning.to"]) setMTo(d["shifts.morning.to"]);
        if (d["shifts.evening.from"]) setEFrom(d["shifts.evening.from"]);
        if (d["shifts.evening.to"]) setETo(d["shifts.evening.to"]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    haptic("medium"); setSaving(true);
    try {
      await Promise.all([
        updateSetting("shifts.morning.from", mFrom),
        updateSetting("shifts.morning.to", mTo),
        updateSetting("shifts.evening.from", eFrom),
        updateSetting("shifts.evening.to", eTo),
      ]);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e: any) { toast(e.message, "error"); }
    setSaving(false);
  };

  if (loading) return <div className="loading">Загрузка...</div>;

  return (
    <>
      <div className="card">
        <div className="card-title">Утренняя смена</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <TimeInput value={mFrom} onChange={setMFrom} label="С" />
          <span style={{ color: "var(--tg-hint)" }}>&mdash;</span>
          <TimeInput value={mTo} onChange={setMTo} label="До" />
        </div>
      </div>
      <div className="card">
        <div className="card-title">Вечерняя смена</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <TimeInput value={eFrom} onChange={setEFrom} label="С" />
          <span style={{ color: "var(--tg-hint)" }}>&mdash;</span>
          <TimeInput value={eTo} onChange={setETo} label="До" />
        </div>
      </div>
      <button className="btn" disabled={saving} onClick={save} style={saved ? { background: "rgba(52,199,89,0.9)" } : {}}>
        {saving ? "..." : saved ? "\u2705 Сохранено" : "Сохранить"}
      </button>
    </>
  );
};

const TimeInput: React.FC<{ value: string; onChange: (v: string) => void; label: string }> = ({ value, onChange, label }) => (
  <div style={{ flex: 1 }}>
    <div style={{ fontSize: 11, color: "var(--tg-hint)", marginBottom: 4 }}>{label}</div>
    <input type="time" value={value} onChange={(e) => onChange(e.target.value)} style={fieldStyle} />
  </div>
);

/* ── Employees (inline edit + swipe delete) ── */

const ROLES: Record<string, string> = {
  owner: "Владелец", director: "Директор", admin: "Администратор",
  senior: "Старший", junior: "Младший", staff: "Сотрудник",
};

const SKILL_LEVELS: Record<string, string> = {
  beginner: "Начинающий", intermediate: "Средний", advanced: "Продвинутый", expert: "Эксперт",
};

const EmployeesTab: React.FC<{ isOwner: boolean }> = ({ isOwner }) => {
  const toast = useToast();
  const [employees, setEmployees] = React.useState<Employee[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [editData, setEditData] = React.useState<Partial<Employee>>({});
  const [saving, setSaving] = React.useState(false);
  const [showAdd, setShowAdd] = React.useState(false);
  const [swipedId, setSwipedId] = React.useState<string | null>(null);
  const touchStart = React.useRef<{ x: number; id: string } | null>(null);

  const load = () => {
    setLoading(true);
    getEmployees(true).then(setEmployees).catch(() => {}).finally(() => setLoading(false));
  };
  React.useEffect(load, []);

  const startEdit = (emp: Employee) => {
    if (!isOwner) return;
    haptic("light");
    setEditing(emp.id);
    setEditData({
      name: emp.name, role: emp.role,
      skill_level: emp.skill_level || "beginner",
      rate_per_hour: emp.rate_per_hour || 0,
      min_hours_per_week: emp.min_hours_per_week || 0,
      max_hours_per_week: emp.max_hours_per_week || 0,
      branch: emp.branch || "",
      auto_schedule: emp.auto_schedule !== false,
      telegram_user_id: emp.telegram_user_id || "",
    });
    setSwipedId(null);
  };

  const saveEdit = async (id: string) => {
    if (!editData.name) return;
    haptic("medium"); setSaving(true);
    try { await updateEmployee(id, editData); load(); setEditing(null); toast("Сохранено", "success"); }
    catch (e: any) { toast(e.message, "error"); }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    haptic("heavy");
    if (!confirm("Удалить сотрудника?")) return;
    try { await deleteEmployee(id); load(); toast("Удалён", "success"); } catch (e: any) { toast(e.message, "error"); }
    setSwipedId(null);
  };

  const onTouchStartRow = (e: React.TouchEvent, id: string) => {
    touchStart.current = { x: e.touches[0].clientX, id };
  };
  const onTouchEndRow = (e: React.TouchEvent) => {
    if (!touchStart.current) return;
    const dx = e.changedTouches[0].clientX - touchStart.current.x;
    if (dx < -60) { setSwipedId(touchStart.current.id); haptic("light"); }
    else if (dx > 30) setSwipedId(null);
    touchStart.current = null;
  };

  if (loading) return <div className="loading">Загрузка...</div>;

  return (
    <>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {employees.length === 0 ? (
          <div style={{ padding: 14, textAlign: "center", color: "var(--tg-hint)" }}>Нет сотрудников</div>
        ) : (
          employees.map((emp, i) => (
            <div key={emp.id} style={{ position: "relative", overflow: "hidden" }}>
              {/* Delete bg */}
              <div style={{
                position: "absolute", right: 0, top: 0, bottom: 0, width: 70,
                background: "var(--tg-destructive)", display: "flex", alignItems: "center", justifyContent: "center",
                color: "#fff", fontSize: 13, fontWeight: 600,
              }} onClick={() => handleDelete(emp.id)}>
                Удалить
              </div>

              <div
                onTouchStart={(e) => onTouchStartRow(e, emp.id)}
                onTouchEnd={onTouchEndRow}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "12px 14px", background: "var(--tg-section-bg)",
                  borderBottom: i < employees.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none",
                  transform: swipedId === emp.id ? "translateX(-70px)" : "translateX(0)",
                  transition: "transform 0.2s",
                }}
                onClick={() => editing !== emp.id && startEdit(emp)}
              >
                {editing === emp.id ? (
                  <div style={{ flex: 1 }}>
                    <input value={editData.name || ""} onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                      style={{ ...fieldStyle, marginBottom: 6, width: "100%" }} placeholder="Имя" />
                    <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                      <select value={editData.role || "staff"}
                        onChange={(e) => setEditData({ ...editData, role: e.target.value })}
                        style={{ ...fieldStyle, flex: 1 }}>
                        {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                      <select value={editData.skill_level || "beginner"}
                        onChange={(e) => setEditData({ ...editData, skill_level: e.target.value })}
                        style={{ ...fieldStyle, flex: 1 }}>
                        {Object.entries(SKILL_LEVELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </div>
                    <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 10, color: "var(--tg-hint)", marginBottom: 2 }}>Ставка/ч</div>
                        <input type="number" value={editData.rate_per_hour || ""} onChange={(e) => setEditData({ ...editData, rate_per_hour: Number(e.target.value) })}
                          style={{ ...fieldStyle, width: "100%" }} placeholder="0" />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 10, color: "var(--tg-hint)", marginBottom: 2 }}>Мин ч/нед</div>
                        <input type="number" value={editData.min_hours_per_week || ""} onChange={(e) => setEditData({ ...editData, min_hours_per_week: Number(e.target.value) })}
                          style={{ ...fieldStyle, width: "100%" }} placeholder="0" />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 10, color: "var(--tg-hint)", marginBottom: 2 }}>Макс ч/нед</div>
                        <input type="number" value={editData.max_hours_per_week || ""} onChange={(e) => setEditData({ ...editData, max_hours_per_week: Number(e.target.value) })}
                          style={{ ...fieldStyle, width: "100%" }} placeholder="0" />
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                      <input value={editData.branch || ""} onChange={(e) => setEditData({ ...editData, branch: e.target.value })}
                        style={{ ...fieldStyle, flex: 1 }} placeholder="Филиал" />
                      <input value={editData.telegram_user_id || ""} onChange={(e) => setEditData({ ...editData, telegram_user_id: e.target.value })}
                        style={{ ...fieldStyle, flex: 1 }} placeholder="Telegram ID" />
                    </div>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginBottom: 8, color: "var(--tg-text)" }}>
                      <input type="checkbox" checked={editData.auto_schedule !== false}
                        onChange={(e) => setEditData({ ...editData, auto_schedule: e.target.checked })} />
                      Автоматическое расписание
                    </label>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="btn" disabled={saving} onClick={() => saveEdit(emp.id)} style={{ flex: 1, fontSize: 13, padding: "8px" }}>
                        {saving ? "..." : "OK"}
                      </button>
                      <button className="btn btn-secondary" onClick={() => setEditing(null)} style={{ flex: 1, fontSize: 13, padding: "8px" }}>
                        Отмена
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 15 }}>{emp.name}</div>
                      <div style={{ fontSize: 12, color: "var(--tg-hint)", marginTop: 1 }}>{ROLES[emp.role] || emp.role}</div>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--tg-hint)" }}>
                      {emp.branch || ""} {emp.skill_level ? `\u00B7 ${emp.skill_level}` : ""}
                    </div>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {isOwner && (
        <>
          <button className="btn" onClick={() => { haptic("light"); setShowAdd(true); }} style={{ marginTop: 8, fontSize: 14 }}>
            + Добавить сотрудника
          </button>
          {showAdd && <AddEmployeeSheet onClose={() => setShowAdd(false)} onDone={() => { setShowAdd(false); load(); }} />}
        </>
      )}
    </>
  );
};

/* ── Add Employee Sheet ── */

const AddEmployeeSheet: React.FC<{ onClose: () => void; onDone: () => void }> = ({ onClose, onDone }) => {
  const toast = useToast();
  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState("staff");
  const [saving, setSaving] = React.useState(false);
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => { requestAnimationFrame(() => setVisible(true)); }, []);
  const close = () => { setVisible(false); setTimeout(onClose, 250); };

  const save = async () => {
    if (!name) return;
    haptic("medium"); setSaving(true);
    try { await createEmployee({ name, role }); toast("Создан", "success"); onDone(); } catch (e: any) { toast(e.message, "error"); }
    setSaving(false);
  };

  return (
    <>
      <div onClick={close} style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 200,
        opacity: visible ? 1 : 0, transition: "opacity 0.25s",
      }} />
      <div style={{
        position: "fixed", bottom: 0, left: "50%",
        transform: `translateX(-50%) translateY(${visible ? 0 : 300}px)`,
        width: "100%", maxWidth: 390, background: "var(--tg-section-bg)",
        borderRadius: "16px 16px 0 0", zIndex: 201,
        transition: "transform 0.3s cubic-bezier(0.2, 0, 0, 1)",
        paddingBottom: "env(safe-area-inset-bottom, 16px)",
      }}>
        <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 4px" }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.2)" }} />
        </div>
        <div style={{ padding: "8px 16px 16px" }}>
          <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 12 }}>Новый сотрудник</div>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Имя"
            style={{ ...fieldStyle, width: "100%", marginBottom: 8 }} />
          <select value={role} onChange={(e) => setRole(e.target.value)}
            style={{ ...fieldStyle, width: "100%", marginBottom: 12 }}>
            {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button className="btn" disabled={saving || !name} onClick={save}>
            {saving ? "..." : "Создать"}
          </button>
        </div>
      </div>
    </>
  );
};

/* ── Rates Tab ── */

const RatesTab: React.FC<{ isOwner: boolean }> = ({ isOwner }) => {
  const toast = useToast();
  const [employees, setEmployees] = React.useState<Employee[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState<string | null>(null);
  const [rates, setRates] = React.useState<Record<string, string>>({});

  const load = () => {
    setLoading(true);
    getEmployees(true).then((emps) => {
      setEmployees(emps);
      const r: Record<string, string> = {};
      emps.forEach((e) => { r[e.id] = String(e.rate_per_hour || 0); });
      setRates(r);
    }).catch(() => {}).finally(() => setLoading(false));
  };
  React.useEffect(load, []);

  const save = async (id: string) => {
    haptic("medium"); setSaving(id);
    try {
      await updateEmployee(id, {
        rate_per_hour: Number(rates[id]) || 0,
        min_hours_per_week: employees.find((e) => e.id === id)?.min_hours_per_week,
      });
    } catch (e: any) { toast(e.message, "error"); }
    setSaving(null);
  };

  if (loading) return <div className="loading">Загрузка...</div>;

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      {employees.map((emp, i) => (
        <div key={emp.id} style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 14px",
          borderBottom: i < employees.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none",
        }}>
          <div style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{emp.name}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input value={rates[emp.id] || ""} onChange={(e) => setRates({ ...rates, [emp.id]: e.target.value })}
              type="number" placeholder="0"
              disabled={!isOwner}
              style={{ ...fieldStyle, width: 70, textAlign: "right", fontSize: 14, padding: "6px 8px" }}
              onBlur={() => isOwner && save(emp.id)} />
            <span style={{ color: "var(--tg-hint)", fontSize: 12 }}>{"\u20BD"}/ч</span>
            {saving === emp.id && <span style={{ fontSize: 11, color: "var(--tg-hint)" }}>...</span>}
          </div>
        </div>
      ))}
    </div>
  );
};

/* ── Catalog Tab (CRUD) ── */

const CatalogTab: React.FC<{ isOwner: boolean }> = ({ isOwner }) => {
  const toast = useToast();
  const [items, setItems] = React.useState<CatalogItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [newName, setNewName] = React.useState("");
  const [newPrice, setNewPrice] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const load = () => {
    setLoading(true);
    getCatalog().then(setItems).catch(() => {}).finally(() => setLoading(false));
  };
  React.useEffect(load, []);

  const saveCatalog = async (updated: CatalogItem[]) => {
    setSaving(true);
    try { await updateSetting("extra_work_catalog", updated); setItems(updated); }
    catch (e: any) { toast(e.message, "error"); }
    setSaving(false);
  };

  const addItem = () => {
    if (!newName || !newPrice) return;
    haptic("medium");
    const item: CatalogItem = { id: `ew_${Date.now()}`, name: newName, price: Number(newPrice) };
    saveCatalog([...items, item]);
    setNewName(""); setNewPrice("");
  };

  const removeItem = (id: string) => {
    haptic("medium");
    saveCatalog(items.filter((i) => i.id !== id));
  };

  if (loading) return <div className="loading">Загрузка...</div>;

  return (
    <>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {items.length === 0 ? (
          <div style={{ padding: 14, textAlign: "center", color: "var(--tg-hint)" }}>Каталог пуст</div>
        ) : (
          items.map((item, i) => (
            <div key={item.id} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "12px 14px",
              borderBottom: i < items.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none",
            }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{item.name}</div>
                <div style={{ fontSize: 13, color: "var(--tg-hint)" }}>{item.price} {"\u20BD"}</div>
              </div>
              {isOwner && (
                <button onClick={() => removeItem(item.id)} style={{
                  background: "rgba(255,59,48,0.15)", border: "none", borderRadius: 8,
                  padding: "6px 10px", color: "var(--tg-destructive)", fontSize: 13,
                  cursor: "pointer",
                }}>
                  {"\u2715"}
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {isOwner && (
        <div className="card" style={{ marginTop: 8 }}>
          <div className="card-title">Добавить</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Название"
              style={{ ...fieldStyle, flex: 2 }} />
            <input value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder={"\u20BD"} type="number"
              style={{ ...fieldStyle, flex: 1 }} />
          </div>
          <button className="btn" disabled={saving || !newName || !newPrice} onClick={addItem}
            style={{ marginTop: 8, fontSize: 14 }}>
            {saving ? "..." : "+ Добавить"}
          </button>
        </div>
      )}
    </>
  );
};

/* ── Groups (Paraplan requires_junior) ── */

const GroupsTab: React.FC<{ isOwner: boolean }> = ({ isOwner }) => {
  const toast = useToast();
  const [groups, setGroups] = React.useState<GroupConfig[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [toggling, setToggling] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [drafts, setDrafts] = React.useState<Record<string, Record<string, string>>>({});

  React.useEffect(() => {
    getGroups().then(setGroups).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const toggle = async (g: GroupConfig) => {
    if (!isOwner || toggling) return;
    haptic("light");
    setToggling(g.paraplan_id);
    const newVal = !g.requires_junior;
    setGroups((prev) => prev.map((x) => x.paraplan_id === g.paraplan_id ? { ...x, requires_junior: newVal } : x));
    try {
      await updateGroupJunior(g.paraplan_id, newVal);
      toast(newVal ? "\u{1F465} Нужен помощник" : "\u{1F464} Без помощника", "success");
    } catch (e: any) {
      setGroups((prev) => prev.map((x) => x.paraplan_id === g.paraplan_id ? { ...x, requires_junior: !newVal } : x));
      toast(e.message, "error");
    }
    setToggling(null);
  };

  const savePriceField = async (g: GroupConfig, field: string, value: string) => {
    const num = value === "" ? null : Number(value);
    if (value !== "" && isNaN(num as number)) return;
    try {
      await updateGroupField(g.paraplan_id, field, num);
      setGroups((prev) => prev.map((x) => x.paraplan_id === g.paraplan_id ? { ...x, [field]: num } : x));
    } catch (e: any) { toast(e.message, "error"); }
  };

  const getDraft = (id: string, field: string, fallback: any) => {
    return drafts[id]?.[field] ?? (fallback != null ? String(fallback) : "");
  };

  const setDraft = (id: string, field: string, val: string) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], [field]: val } }));
  };

  if (loading) return <div className="loading">Загрузка...</div>;

  if (groups.length === 0) {
    return <div className="card" style={{ textAlign: "center", color: "var(--tg-hint)" }}>Группы не настроены</div>;
  }

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}>
        <div style={{ fontSize: 12, color: "var(--tg-section-header)", fontWeight: 600 }}>ГРУППА</div>
        <div style={{ fontSize: 12, color: "var(--tg-section-header)", fontWeight: 600 }}>ПОМОЩНИК</div>
      </div>
      {groups.map((g, i) => {
        const isExpanded = expanded === g.paraplan_id;
        const disc = g.discount_pct || 0;
        const isSingleOnly = g.price_type === "single";
        return (
        <div key={g.paraplan_id} style={{
          borderBottom: i < groups.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none",
          opacity: toggling === g.paraplan_id ? 0.5 : 1,
        }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "10px 14px",
          }}
            onClick={() => { haptic("light"); setExpanded(isExpanded ? null : g.paraplan_id); }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{g.name}</div>
              <div style={{ fontSize: 11, color: "var(--tg-hint)" }}>
                {g.prefix}
                {isSingleOnly ? "" : g.subscription_price ? ` \u00B7 ${g.subscription_price}\u20BD` : ""}
                {g.single_price ? ` \u00B7 ${g.single_price}\u20BD${isSingleOnly ? "" : "/раз"}` : ""}
                {disc > 0 ? ` \u00B7 -${disc}%` : ""}
              </div>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); toggle(g); }}
              disabled={!isOwner || toggling !== null}
              style={{
                padding: "6px 12px", borderRadius: 8, border: "none", cursor: isOwner ? "pointer" : "default",
                background: g.requires_junior ? "rgba(52,199,89,0.15)" : "rgba(255,149,0,0.15)",
                color: g.requires_junior ? "rgba(52,199,89,1)" : "rgba(255,149,0,1)",
                fontSize: 14, fontWeight: 600, transition: "all 0.15s",
              }}
            >
              {g.requires_junior ? "\u{1F465}" : "\u{1F464}"}
            </button>
          </div>
          {isExpanded && isOwner && (
            <div style={{ padding: "0 14px 12px", display: "flex", gap: 6 }}>
              {!isSingleOnly && (
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: "var(--tg-hint)", marginBottom: 2 }}>Абонемент</div>
                <input type="number" placeholder="0"
                  value={getDraft(g.paraplan_id, "subscription_price", g.subscription_price)}
                  onChange={(e) => setDraft(g.paraplan_id, "subscription_price", e.target.value)}
                  onBlur={(e) => savePriceField(g, "subscription_price", e.target.value)}
                  style={{ ...fieldStyle, width: "100%", fontSize: 13, padding: "6px 8px" }} />
              </div>
              )}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: "var(--tg-hint)", marginBottom: 2 }}>Разовое</div>
                <input type="number" placeholder="0"
                  value={getDraft(g.paraplan_id, "single_price", g.single_price)}
                  onChange={(e) => setDraft(g.paraplan_id, "single_price", e.target.value)}
                  onBlur={(e) => savePriceField(g, "single_price", e.target.value)}
                  style={{ ...fieldStyle, width: "100%", fontSize: 13, padding: "6px 8px" }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: "var(--tg-hint)", marginBottom: 2 }}>Скидка %</div>
                <input type="number" placeholder="0" min="0" max="100"
                  value={getDraft(g.paraplan_id, "discount_pct", g.discount_pct)}
                  onChange={(e) => setDraft(g.paraplan_id, "discount_pct", e.target.value)}
                  onBlur={(e) => savePriceField(g, "discount_pct", e.target.value)}
                  style={{ ...fieldStyle, width: "100%", fontSize: 13, padding: "6px 8px" }} />
              </div>
            </div>
          )}
          {isExpanded && isOwner && disc > 0 && (g.subscription_price || g.single_price) && (
            <div style={{ padding: "0 14px 10px", fontSize: 12, color: "var(--tg-hint)" }}>
              {g.subscription_price ? `${g.subscription_price} \u2192 ${Math.round(g.subscription_price * (1 - disc / 100))}\u20BD` : ""}
              {g.subscription_price && g.single_price ? " \u00B7 " : ""}
              {g.single_price ? `${g.single_price} \u2192 ${Math.round(g.single_price * (1 - disc / 100))}\u20BD` : ""}
            </div>
          )}
        </div>
        );
      })}
    </div>
  );
};

/* ── Cleanings 7x2 Grid ── */

const CleaningsTab: React.FC = () => {
  const [grid, setGrid] = React.useState<Record<string, boolean>>({});
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    getSettings()
      .then((d) => {
        const g = d["cleanings.grid"] || {};
        setGrid(g);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const toggle = async (key: string) => {
    haptic("light");
    const next = { ...grid, [key]: !grid[key] };
    setGrid(next);
    setSaving(true);
    try { await updateSetting("cleanings.grid", next); } catch {}
    setSaving(false);
  };

  if (loading) return <div className="loading">Загрузка...</div>;

  return (
    <div className="card">
      <div className="card-title">Расписание уборок {saving && "(сохранение...)"}</div>
      <div style={{ display: "grid", gridTemplateColumns: "60px repeat(7, 1fr)", gap: 6, fontSize: 12 }}>
        {/* Header */}
        <div />
        {DAYS_SHORT.map((d) => (
          <div key={d} style={{ textAlign: "center", fontWeight: 600, color: "var(--tg-hint)" }}>{d}</div>
        ))}

        {/* Morning row */}
        <div style={{ display: "flex", alignItems: "center", fontWeight: 600, color: "var(--tg-hint)", fontSize: 11 }}>Утро</div>
        {DAYS_KEY.map((d) => {
          const key = `${d}_morning`;
          return (
            <div key={key} style={{ display: "flex", justifyContent: "center" }}>
              <Checkbox checked={!!grid[key]} onChange={() => toggle(key)} />
            </div>
          );
        })}

        {/* Evening row */}
        <div style={{ display: "flex", alignItems: "center", fontWeight: 600, color: "var(--tg-hint)", fontSize: 11 }}>Вечер</div>
        {DAYS_KEY.map((d) => {
          const key = `${d}_evening`;
          return (
            <div key={key} style={{ display: "flex", justifyContent: "center" }}>
              <Checkbox checked={!!grid[key]} onChange={() => toggle(key)} />
            </div>
          );
        })}
      </div>
    </div>
  );
};

const Checkbox: React.FC<{ checked: boolean; onChange: () => void }> = ({ checked, onChange }) => (
  <button onClick={onChange} style={{
    width: 28, height: 28, borderRadius: 6,
    border: checked ? "none" : "2px solid rgba(255,255,255,0.2)",
    background: checked ? "rgba(52,199,89,0.8)" : "transparent",
    display: "flex", alignItems: "center", justifyContent: "center",
    cursor: "pointer", color: "#fff", fontSize: 14, fontWeight: 700,
  }}>
    {checked ? "\u2713" : ""}
  </button>
);

/* ── Branches ── */

const BranchesTab: React.FC = () => {
  const toast = useToast();
  const [branches, setBranches] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [newBranch, setNewBranch] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    getSettings()
      .then((d) => setBranches(d["branches"] || ["Основной"]))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const saveBranches = async (list: string[]) => {
    setSaving(true);
    try { await updateSetting("branches", list); setBranches(list); }
    catch (e: any) { toast(e.message, "error"); }
    setSaving(false);
  };

  const add = () => {
    if (!newBranch) return;
    haptic("medium");
    saveBranches([...branches, newBranch]);
    setNewBranch("");
  };

  const remove = (idx: number) => {
    haptic("medium");
    saveBranches(branches.filter((_, i) => i !== idx));
  };

  if (loading) return <div className="loading">Загрузка...</div>;

  return (
    <>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {branches.map((b, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "12px 14px",
            borderBottom: i < branches.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none",
          }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>{b}</span>
            {branches.length > 1 && (
              <button onClick={() => remove(i)} style={{
                background: "rgba(255,59,48,0.15)", border: "none", borderRadius: 8,
                padding: "6px 10px", color: "var(--tg-destructive)", fontSize: 13, cursor: "pointer",
              }}>{"\u2715"}</button>
            )}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <input value={newBranch} onChange={(e) => setNewBranch(e.target.value)} placeholder="Новый филиал"
          style={{ ...fieldStyle, flex: 1 }} />
        <button className="btn" disabled={saving || !newBranch} onClick={add} style={{ width: "auto", padding: "10px 18px", fontSize: 14 }}>
          {saving ? "..." : "+"}
        </button>
      </div>
    </>
  );
};

/* ── Bot Mode ── */

const BotModeTab: React.FC = () => {
  const toast = useToast();
  const [mode, setMode] = React.useState("manual");
  const [loading, setLoading] = React.useState(true);
  const [switching, setSwitching] = React.useState(false);

  React.useEffect(() => {
    getBotMode().then((d) => setMode(d.mode)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const change = async (m: string) => {
    if (m === mode) return;
    haptic("medium"); setSwitching(true);
    try { const r = await setBotMode(m); setMode(r.mode); } catch (e: any) { toast(e.message, "error"); }
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
          <button key={m.id} disabled={switching} onClick={() => change(m.id)}
            className="card"
            style={{
              display: "flex", alignItems: "center", gap: 12, width: "100%",
              textAlign: "left", cursor: "pointer", opacity: switching ? 0.5 : 1,
              border: active ? "2px solid var(--tg-link)" : "2px solid transparent",
            }}
          >
            <div style={{ fontSize: 28, lineHeight: 1 }}>{m.icon}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{m.label}</div>
              <div style={{ fontSize: 12, color: "var(--tg-hint)", marginTop: 2 }}>{m.desc}</div>
            </div>
            {active && <div style={{ color: "var(--tg-link)", fontSize: 18, fontWeight: 700 }}>{"\u2713"}</div>}
          </button>
        );
      })}
    </div>
  );
};

/* ── Shared ── */

const fieldStyle: React.CSSProperties = {
  padding: "8px 10px", borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "var(--tg-bg)", color: "var(--tg-text)",
  fontSize: 15, fontFamily: "inherit",
};
