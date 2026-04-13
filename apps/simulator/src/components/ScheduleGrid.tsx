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
    ? "#F0EDE6"
    : slot?.status === "NEEDS_REPLACEMENT"
      ? "#FFF8E0"
      : slot?.replaced_user_id
        ? "#F0F4FF"
        : slot?.status === "CONFIRMED"
          ? "#FFFFF0"
          : slot?.status === "PENDING"
            ? "#FFF8E0"
            : "#FFF0F0";
  const borderColor =
    slot?.status === "NEEDS_REPLACEMENT"
      ? "#E8C840"
      : slot?.replaced_user_id
        ? "#A0B8D8"
        : slot?.status === "CONFIRMED"
          ? "#E8C840"
          : slot?.status === "PENDING"
            ? "#E8C840"
            : "#D4A0A0";

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
        border: `1.5px solid ${borderColor}`,
        borderRadius: "8px",
        minHeight: "50px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        cursor: effectivelyLocked ? "default" : "pointer",
        position: "relative",
        ...(effectivelyLocked ? { opacity: 0.6 } : isLocked ? { opacity: 0.85 } : {}),
        ...(isToday ? { borderLeft: "3px solid #5C3D1E" } : {}),
      }}
    >
      {slot?.user_id ? (
        <>
          <div style={{ fontSize: "12px", fontWeight: 500, color: "#2A1F0E", marginBottom: "2px" }}>
            {slot.status === "NEEDS_REPLACEMENT"
              ? `${UserDirectory.getDisplayName(slot.user_id)} \u26A0\uFE0F`
              : slot.replaced_user_id
                ? `${UserDirectory.getDisplayName(slot.user_id)} \uD83D\uDD04`
                : UserDirectory.getDisplayName(slot.user_id)}
          </div>
          <div style={{ fontSize: "10px", color: "#9A8E7E", marginTop: "2px" }}>
            {slot.status === "NEEDS_REPLACEMENT"
              ? "ищем замену"
              : slot.replaced_user_id
                ? `(за ${UserDirectory.getDisplayName(slot.replaced_user_id)})`
                : slot.hours != null ? `${slot.hours.toFixed(1)} ч` : "\u2014"}
            {slot.is_problem && slot.status !== "NEEDS_REPLACEMENT" && " \u26A0\uFE0F"}
          </div>
          {slot.skill_mismatch && (
            <div style={{ fontSize: "0.7em", color: "#C75050" }} title={`Требуется: ${slot.skill_mismatch.required}, у сотрудника: ${slot.skill_mismatch.actual}`}>
              {"\u26A0"} квалиф.
            </div>
          )}
          {isEvening && slot.cleaning_status && slot.cleaning_status !== "NOT_SCHEDULED" && (
            <div
              style={{
                position: "absolute",
                bottom: 5,
                right: 6,
              }}
              title={cleaningUser ? `Уборка: ${UserDirectory.getDisplayName(cleaningUser)}` : "Уборка"}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 1v8M4 6l3 3 3-3M3 11h8" stroke={slot.cleaning_status === "NEEDS_REPLACEMENT" ? "#E8C840" : "#9A8E7E"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
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
        <div style={{ color: "#C75050", fontWeight: 500, fontSize: "11px" }}>{"\u26A0\uFE0F"} Не назначен</div>
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
      <div style={{ fontSize: "0.85em", marginBottom: "8px", fontWeight: 600, color: "#2A1F0E" }}>
        Живой график: <InfoTip text="Таблица смен на неделю. Жёлтая рамка=назначен, голубая=замена, красная=проблема" />
      </div>
      {emptyCount > 0 && (
        <div style={{ padding: "6px 10px", marginBottom: 8, borderRadius: 6, fontSize: "0.8em", fontWeight: 500, background: "#FFF0F0", color: "#C75050", border: "1px solid #D4A0A0" }}>
          {"\u26A0\uFE0F"} Есть {emptyCount} незакрытых смен
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
        <div style={{ fontWeight: 600, padding: "4px", color: "#2A1F0E" }}>Слот</div>
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
              fontWeight: 600, padding: "4px", textAlign: "center", color: "#2A1F0E",
              ...(isToday ? { borderLeft: "3px solid #5C3D1E", background: "#F0E8DC", color: "#5C3D1E" } : {}),
            }}>
              <div>{DAY_LABELS[i]}<br /><small style={{ fontSize: "0.75em", color: "#9A8E7E" }}>{dayDate}</small></div>
            </div>
          );
        })}

        {/* Morning slots */}
        <div style={{ padding: "4px", fontWeight: 600, color: "#2A1F0E" }}>Утро</div>
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
        <div style={{ padding: "4px", fontWeight: 600, color: "#2A1F0E" }}>Вечер</div>
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
