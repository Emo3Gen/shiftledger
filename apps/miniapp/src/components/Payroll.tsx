import React from "react";
import {
  getPayroll, addExtraPay, approveExtraWork, rejectExtraWork, getCatalog,
  type PayrollData, type PayrollEmployee, type CatalogItem,
} from "../api";
import { haptic } from "../telegram";

function fmtRub(n: number): string {
  if (!n) return "0 \u20BD";
  const s = Math.round(n).toString();
  const parts = [];
  for (let i = s.length; i > 0; i -= 3) parts.unshift(s.slice(Math.max(0, i - 3), i));
  return parts.join("\u2009") + " \u20BD";
}

function getMonday(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

type Period = "week" | "first_half" | "second_half" | "month";
const PERIOD_LABELS: Record<Period, string> = {
  week: "Неделя", first_half: "1\u201315", second_half: "16\u201331", month: "Месяц",
};

export const Payroll: React.FC = () => {
  const [period, setPeriod] = React.useState<Period>("week");
  const [data, setData] = React.useState<PayrollData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [detail, setDetail] = React.useState<PayrollEmployee | null>(null);

  const load = React.useCallback(async (p: Period) => {
    setLoading(true);
    try { setData(await getPayroll(getMonday(), p)); } catch {}
    setLoading(false);
  }, []);

  React.useEffect(() => { load(period); }, [period, load]);

  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Табель</div>

      {/* Period selector */}
      <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
        {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
          <button key={p}
            className={period === p ? "btn" : "btn btn-secondary"}
            style={{ flex: 1, fontSize: 12, padding: "7px 2px" }}
            onClick={() => { haptic("light"); setPeriod(p); }}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>

      {data && <div style={{ fontSize: 13, color: "var(--tg-hint)", marginBottom: 10 }}>{data.period}</div>}

      {loading ? (
        <div className="loading">Загрузка...</div>
      ) : !data ? (
        <div className="error-box">Не удалось загрузить</div>
      ) : (
        <>
          {/* Totals */}
          <div className="kpi-grid" style={{ marginBottom: 10 }}>
            <div className="kpi-item">
              <div className="kpi-value">{fmtRub(data.totals.total_pay)}</div>
              <div className="kpi-label">ФОТ</div>
            </div>
            <div className="kpi-item">
              <div className="kpi-value">{data.totals.total_hours.toFixed(0)}</div>
              <div className="kpi-label">Часов</div>
            </div>
          </div>

          {/* Table */}
          {data.employees.length === 0 ? (
            <div className="card" style={{ textAlign: "center", color: "var(--tg-hint)" }}>Нет данных</div>
          ) : (
            <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
              <div className="card" style={{ padding: 0, overflow: "hidden", minWidth: 480 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
                      {["Сотрудник", "Часы", "Смены", "Уборки", "Допы", "Итого"].map((h) => (
                        <th key={h} style={{
                          textAlign: h === "Сотрудник" ? "left" : "right",
                          padding: "10px 6px", fontWeight: 600, color: "var(--tg-hint)",
                          fontSize: 11, whiteSpace: "nowrap",
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.employees.map((emp, i) => {
                      const extras = emp.extra_work_approved_pay + emp.extra_pay_total;
                      const pendingCount = emp.extra_work.filter((w) => w.status === "pending").length;
                      return (
                        <tr key={emp.user_id}
                          onClick={() => { haptic("light"); setDetail(emp); }}
                          style={{
                            borderBottom: i < data.employees.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none",
                            cursor: "pointer",
                          }}
                        >
                          <td style={{ padding: "10px 6px" }}>
                            <div style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{emp.name}</div>
                            {emp.problem_shifts > 0 && (
                              <div style={{ fontSize: 11, color: "var(--tg-destructive)" }}>
                                {"\u26A0\uFE0F"} {emp.problem_shifts} пробл.
                              </div>
                            )}
                          </td>
                          <td style={{ textAlign: "right", padding: "10px 6px" }}>{emp.effective_hours.toFixed(1)}</td>
                          <td style={{ textAlign: "right", padding: "10px 6px" }}>{fmtRub(emp.shift_pay)}</td>
                          <td style={{ textAlign: "right", padding: "10px 6px" }}>
                            {emp.cleaning_count > 0 ? (
                              <span>{emp.cleaning_count}<span style={{ color: "var(--tg-hint)", fontSize: 11 }}> ({fmtRub(emp.cleaning_pay)})</span></span>
                            ) : "\u2014"}
                          </td>
                          <td style={{ textAlign: "right", padding: "10px 6px" }}>
                            {extras > 0 ? (
                              <span>
                                {fmtRub(extras)}
                                {pendingCount > 0 && (
                                  <span style={{ fontSize: 10, color: "rgba(255,204,0,1)", marginLeft: 2 }}>
                                    +{pendingCount}
                                  </span>
                                )}
                              </span>
                            ) : "\u2014"}
                          </td>
                          <td style={{ textAlign: "right", padding: "10px 6px", fontWeight: 700 }}>
                            {fmtRub(emp.total_pay)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {detail && (
        <PayrollDetail
          employee={detail}
          onClose={() => setDetail(null)}
          onReload={() => load(period)}
        />
      )}
    </div>
  );
};

/* ── Employee Breakdown Sheet ── */

const PayrollDetail: React.FC<{
  employee: PayrollEmployee;
  onClose: () => void;
  onReload: () => void;
}> = ({ employee: emp, onClose, onReload }) => {
  const [visible, setVisible] = React.useState(false);
  const [dragY, setDragY] = React.useState(0);
  const [showAdd, setShowAdd] = React.useState(false);
  const [actionId, setActionId] = React.useState<string | null>(null);
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

  const act = async (fn: () => Promise<any>, id: string) => {
    haptic("medium");
    setActionId(id);
    try { await fn(); onReload(); close(); } catch (e: any) { alert(e.message); }
    setActionId(null);
  };

  const rows: Array<{ label: string; value: string; bold?: boolean }> = [
    { label: "Ставка", value: `${emp.rate} \u20BD/ч` },
    { label: "Часы (смены)", value: `${emp.shift_hours.toFixed(1)} \u2192 ${emp.effective_hours.toFixed(1)}` },
    { label: "Оплата смен", value: fmtRub(emp.shift_pay) },
  ];
  if (emp.problem_shifts > 0) rows.push({ label: "\u26A0\uFE0F Проблемных", value: String(emp.problem_shifts) });
  if (emp.cleaning_count > 0) rows.push({ label: "\u{1F9F9} Уборки", value: `${emp.cleaning_count} = ${fmtRub(emp.cleaning_pay)}` });
  if (emp.extra_classes_count > 0) rows.push({ label: "\u{1F4DA} Доп. занятия", value: `${emp.extra_classes_count} (${emp.extra_classes_total_kids} дет.) = ${fmtRub(emp.extra_classes_total_pay)}` });
  if (emp.inter_branch_hours > 0) rows.push({ label: "\u{1F504} Межфилиал", value: `${emp.inter_branch_hours.toFixed(1)}ч = ${fmtRub(emp.inter_branch_pay)}` });
  if (emp.extra_work_approved_pay > 0) rows.push({ label: "Допработы", value: fmtRub(emp.extra_work_approved_pay) });
  if (emp.extra_pay_total > 0) rows.push({ label: "Доплаты", value: fmtRub(emp.extra_pay_total) });
  rows.push({ label: "ИТОГО", value: fmtRub(emp.total_pay), bold: true });

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
          width: "100%", maxWidth: 390, maxHeight: "85vh",
          background: "var(--tg-section-bg)", borderRadius: "16px 16px 0 0", zIndex: 201,
          transition: dragY ? "none" : "transform 0.3s cubic-bezier(0.2, 0, 0, 1)",
          overflowY: "auto", paddingBottom: "env(safe-area-inset-bottom, 16px)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 4px" }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.2)" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 16px 12px" }}>
          <div style={{ fontWeight: 700, fontSize: 17 }}>{emp.name}</div>
          <button onClick={close} style={{
            background: "rgba(255,255,255,0.1)", border: "none", borderRadius: "50%",
            width: 32, height: 32, fontSize: 16, cursor: "pointer", color: "var(--tg-hint)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>{"\u2715"}</button>
        </div>

        {/* Breakdown rows */}
        <div style={{ padding: "0 16px" }}>
          {rows.map((r, i) => (
            <div key={i} style={{
              display: "flex", justifyContent: "space-between", padding: "8px 0",
              borderBottom: i < rows.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none",
              fontWeight: r.bold ? 700 : 400, fontSize: r.bold ? 16 : 14,
            }}>
              <span>{r.label}</span>
              <span>{r.value}</span>
            </div>
          ))}
        </div>

        {/* Extra work list */}
        {emp.extra_work.length > 0 && (
          <div style={{ padding: "12px 16px 0" }}>
            <div className="card-title">Допработы</div>
            {emp.extra_work.map((w) => (
              <div key={w.id} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.06)",
              }}>
                <div>
                  <div style={{ fontSize: 14 }}>{w.work_name}</div>
                  <div style={{ fontSize: 11, color: "var(--tg-hint)" }}>
                    {w.status === "pending" ? "\u23F3 Ожидает" : w.status === "approved" ? "\u2705 Одобрено" : "\u274C Отклонено"}
                    {w.date && ` \u00B7 ${w.date}`}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{fmtRub(w.price)}</span>
                  {w.status === "pending" && (
                    <>
                      <button disabled={!!actionId}
                        onClick={() => act(() => approveExtraWork(w.id), w.id)}
                        style={approveBtn}>{"\u2713"}</button>
                      <button disabled={!!actionId}
                        onClick={() => act(() => rejectExtraWork(w.id), w.id)}
                        style={rejectBtn}>{"\u2715"}</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Extra pay list */}
        {emp.extra_pay.length > 0 && (
          <div style={{ padding: "12px 16px 0" }}>
            <div className="card-title">Доплаты</div>
            {emp.extra_pay.map((p) => (
              <div key={p.id} style={{
                display: "flex", justifyContent: "space-between", padding: "6px 0",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
              }}>
                <span style={{ fontSize: 13 }}>{p.comment || "Доплата"}</span>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{fmtRub(p.amount)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Add button */}
        <div style={{ padding: "12px 16px" }}>
          <button className="btn btn-secondary" onClick={() => { haptic("light"); setShowAdd(true); }} style={{ fontSize: 14 }}>
            + Добавить допработу / доплату
          </button>
        </div>
      </div>

      {showAdd && (
        <AddExtraSheet
          userId={emp.user_id} userName={emp.name}
          onClose={() => setShowAdd(false)}
          onDone={() => { setShowAdd(false); onReload(); close(); }}
        />
      )}
    </>
  );
};

/* ── Add Extra Work/Pay Sheet ── */

const AddExtraSheet: React.FC<{
  userId: string; userName: string;
  onClose: () => void; onDone: () => void;
}> = ({ userId, userName, onClose, onDone }) => {
  const [catalog, setCatalog] = React.useState<CatalogItem[]>([]);
  const [tab, setTab] = React.useState<"work" | "pay">("work");
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [visible, setVisible] = React.useState(false);
  const [customName, setCustomName] = React.useState("");
  const [customPrice, setCustomPrice] = React.useState("");
  const [payAmount, setPayAmount] = React.useState("");
  const [payComment, setPayComment] = React.useState("");

  React.useEffect(() => {
    getCatalog().then(setCatalog).catch(() => {}).finally(() => setLoading(false));
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const close = () => { setVisible(false); setTimeout(onClose, 250); };

  const addWork = async (name: string, price: number, typeId?: string) => {
    haptic("medium"); setSaving(true);
    try { await addExtraPay({ user_id: userId, work_type_id: typeId || name, work_name: name, price }); onDone(); }
    catch (e: any) { alert(e.message); }
    setSaving(false);
  };

  const addPay = async () => {
    if (!payAmount) return;
    haptic("medium"); setSaving(true);
    try { await addExtraPay({ user_id: userId, amount: Number(payAmount), comment: payComment || undefined }); onDone(); }
    catch (e: any) { alert(e.message); }
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
        width: "100%", maxWidth: 390, maxHeight: "65vh",
        background: "var(--tg-bg)", borderRadius: "16px 16px 0 0", zIndex: 301,
        transition: "transform 0.3s cubic-bezier(0.2, 0, 0, 1)",
        overflowY: "auto", paddingBottom: "env(safe-area-inset-bottom, 16px)",
      }}>
        <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 4px" }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.2)" }} />
        </div>
        <div style={{ padding: "4px 16px 8px", fontWeight: 700, fontSize: 17 }}>{userName}</div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, padding: "0 16px 12px" }}>
          <button className={tab === "work" ? "btn" : "btn btn-secondary"} style={{ flex: 1, fontSize: 13, padding: "8px 4px" }}
            onClick={() => setTab("work")}>Допработа</button>
          <button className={tab === "pay" ? "btn" : "btn btn-secondary"} style={{ flex: 1, fontSize: 13, padding: "8px 4px" }}
            onClick={() => setTab("pay")}>Доплата</button>
        </div>

        {loading ? <div className="loading">...</div> : tab === "work" ? (
          <div style={{ padding: "0 16px" }}>
            {catalog.map((item) => (
              <button key={item.id} disabled={saving} onClick={() => addWork(item.name, item.price, item.id)}
                style={{
                  display: "flex", justifyContent: "space-between", width: "100%", padding: "12px 0",
                  background: "none", border: "none", borderBottom: "1px solid rgba(255,255,255,0.06)",
                  cursor: "pointer", color: "var(--tg-text)", fontSize: 15, opacity: saving ? 0.4 : 1,
                }}>
                <span>{item.name}</span>
                <span style={{ color: "var(--tg-hint)" }}>{item.price} {"\u20BD"}</span>
              </button>
            ))}
            <div style={{ display: "flex", gap: 8, paddingTop: 12 }}>
              <input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="Своя работа"
                style={{ ...inpStyle, flex: 2 }} />
              <input value={customPrice} onChange={(e) => setCustomPrice(e.target.value)} placeholder={"\u20BD"} type="number"
                style={{ ...inpStyle, flex: 1 }} />
            </div>
            <button className="btn" disabled={saving || !customName || !customPrice}
              onClick={() => addWork(customName, Number(customPrice))} style={{ marginTop: 8, fontSize: 14 }}>
              {saving ? "..." : "Добавить"}
            </button>
          </div>
        ) : (
          <div style={{ padding: "0 16px" }}>
            <input value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="Сумма \u20BD" type="number"
              style={{ ...inpStyle, width: "100%", marginBottom: 8 }} />
            <input value={payComment} onChange={(e) => setPayComment(e.target.value)} placeholder="Комментарий (опц.)"
              style={{ ...inpStyle, width: "100%", marginBottom: 8 }} />
            <button className="btn" disabled={saving || !payAmount} onClick={addPay} style={{ fontSize: 14 }}>
              {saving ? "..." : "Добавить доплату"}
            </button>
          </div>
        )}
      </div>
    </>
  );
};

const inpStyle: React.CSSProperties = {
  padding: "10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)",
  background: "var(--tg-secondary-bg)", color: "var(--tg-text)", fontSize: 15,
  fontFamily: "inherit",
};

const approveBtn: React.CSSProperties = {
  padding: "4px 8px", borderRadius: 6, border: "none",
  background: "rgba(52,199,89,0.2)", color: "rgba(52,199,89,1)",
  fontSize: 12, cursor: "pointer",
};

const rejectBtn: React.CSSProperties = {
  padding: "4px 8px", borderRadius: 6, border: "none",
  background: "rgba(255,59,48,0.2)", color: "var(--tg-destructive)",
  fontSize: 12, cursor: "pointer",
};
