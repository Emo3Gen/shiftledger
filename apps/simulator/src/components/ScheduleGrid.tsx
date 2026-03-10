import React from "react";
import { UserDirectory, InfoTip } from "./shared";

export interface ScheduleGridProps {
  schedule: any;
  weekStartISO: string;
  senderRole: string;
  extrasMap: Map<string, any[]>;
  openSlotModal: (dow: string, slotName: string, from: string, to: string, userId: string | null, availableIds: string[], isLocked: boolean) => void;
}

function SlotCell({
  dow,
  slotName,
  defaultFrom,
  defaultTo,
  schedule,
  senderRole,
  extrasMap,
  openSlotModal,
}: {
  dow: string;
  slotName: string;
  defaultFrom: string;
  defaultTo: string;
  schedule: any;
  senderRole: string;
  extrasMap: Map<string, any[]>;
  openSlotModal: ScheduleGridProps["openSlotModal"];
}) {
  const slot = (schedule.slots || []).find(
    (s: any) => s.dow === dow && s.slot_name === slotName
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

  const cleaningUser = slot?.cleaning_user_id;
  const isEvening = slotName === "Вечер";

  return (
    <div
      key={`${dow}-${slotName}`}
      title={effectivelyLocked ? "Этот день прошёл" : isLocked ? "Этот день прошёл (редактирование задним числом)" : "Кликните для назначения"}
      onClick={() => {
        if (effectivelyLocked) return;
        openSlotModal(dow, slotName, slot?.from || defaultFrom, slot?.to || defaultTo, slot?.user_id || null, slot?.available_user_ids || [], isLocked);
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
          {isEvening && slot.cleaning_status && slot.cleaning_status !== "NOT_SCHEDULED" && (
            <div style={{
              fontSize: "0.8em",
              marginTop: "2px",
              padding: "1px 4px",
              borderRadius: "3px",
              color: slot.cleaning_status === "NEEDS_REPLACEMENT" ? "#856404" : slot.cleaning_status === "REPLACED" ? "#004085" : slot.cleaning_scheduled === false ? "#e65100" : "#8B4513",
              backgroundColor: slot.cleaning_status === "NEEDS_REPLACEMENT" ? "#fff3cd" : slot.cleaning_status === "REPLACED" ? "#d0e8ff" : "transparent",
              ...(slot.cleaning_scheduled === false ? { border: "1px solid #ff9800", borderRadius: "3px" } : {}),
            }}
              title={slot.cleaning_scheduled === false ? "Нештатная уборка" : undefined}
            >
              {slot.cleaning_status === "NEEDS_REPLACEMENT"
                ? `🧹 ${UserDirectory.getDisplayName(cleaningUser)} ⚠️`
                : slot.cleaning_status === "REPLACED"
                  ? `🧹 ${UserDirectory.getDisplayName(cleaningUser)} 🔄${slot.cleaning_original_user_id ? ` (за ${UserDirectory.getDisplayName(slot.cleaning_original_user_id)})` : ""}`
                  : cleaningUser && slot.cleaning_is_replacement
                    ? `🧹→${UserDirectory.getDisplayName(cleaningUser)}`
                    : "🧹"}
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
}

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export const ScheduleGrid: React.FC<ScheduleGridProps> = ({
  schedule,
  weekStartISO,
  senderRole,
  extrasMap,
  openSlotModal,
}) => {
  if (!schedule.slots) return null;

  const emptyCount = (schedule.slots || []).filter((s: any) => !s.user_id).length;

  return (
    <div style={{ marginBottom: "16px" }}>
      <div style={{ fontSize: "0.85em", marginBottom: "8px", fontWeight: "bold" }}>
        Живой график: <InfoTip text="Таблица смен на неделю. Зелёный=назначен, голубой=замена, розовый=проблема" />
      </div>
      {emptyCount > 0 && (
        <div style={{ padding: "6px 10px", marginBottom: 8, borderRadius: 4, fontSize: "0.8em", fontWeight: "bold", background: "#f8d7da", color: "#721c24", border: "1px solid #f5c6cb" }}>
          &#9888;&#65039; Есть {emptyCount} незакрытых смен
        </div>
      )}
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
        {DAYS.map((dowKey, i) => {
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
              <div>{DAY_LABELS[i]}<br /><small style={{ fontSize: "0.75em" }}>{dayDate}</small></div>
            </div>
          );
        })}

        {/* Morning slots */}
        <div style={{ padding: "4px", fontWeight: "bold" }}>Утро</div>
        {DAYS.map((dow) => (
          <SlotCell
            key={`${dow}-morning`}
            dow={dow}
            slotName="Утро"
            defaultFrom="10:00"
            defaultTo="13:00"
            schedule={schedule}
            senderRole={senderRole}
            extrasMap={extrasMap}
            openSlotModal={openSlotModal}
          />
        ))}

        {/* Evening slots */}
        <div style={{ padding: "4px", fontWeight: "bold" }}>Вечер</div>
        {DAYS.map((dow) => (
          <SlotCell
            key={`${dow}-evening`}
            dow={dow}
            slotName="Вечер"
            defaultFrom="18:00"
            defaultTo="21:00"
            schedule={schedule}
            senderRole={senderRole}
            extrasMap={extrasMap}
            openSlotModal={openSlotModal}
          />
        ))}
      </div>
    </div>
  );
};
