import React from "react";
import { fmtNum, fmtRub } from "./shared";

export interface PayrollTableProps {
  timesheet: any;
  weekStartISO: string;
  periodMode: "week" | "first_half" | "second_half" | "full_month";
}

const RU_MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

function getTimesheetTitle(timesheet: any, weekStartISO: string, periodMode: string): string {
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
}

export const PayrollTable: React.FC<PayrollTableProps> = ({ timesheet, weekStartISO, periodMode }) => {
  if (!timesheet) {
    return <div className="empty">Табель не загружен. Нажмите "Показать табель" в Debug панели.</div>;
  }

  const hasInterBranch = timesheet.employees?.some((e: any) => (e.inter_branch_pay || 0) > 0);

  return (
    <div style={{ fontSize: "0.8em", padding: "8px" }}>
      <div style={{ marginBottom: "8px", fontWeight: "bold" }}>
        {getTimesheetTitle(timesheet, weekStartISO, periodMode)}
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
              {hasInterBranch && <th style={{ textAlign: "right", padding: "2px 3px" }}>Межф.</th>}
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
                {hasInterBranch && <td style={{ textAlign: "right", padding: "2px 3px" }}>{(emp.inter_branch_pay || 0) > 0 ? fmtNum(emp.inter_branch_pay) : "\u2014"}</td>}
                <td style={{ textAlign: "right", padding: "2px 3px", fontWeight: "bold" }}>{fmtRub(emp.total_pay)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="empty">Нет данных. Нажмите "Показать табель" в Debug панели.</div>
      )}
    </div>
  );
};
