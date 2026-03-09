/**
 * Schedule Image Generator — PNG matching the "live grid" style.
 *
 * Layout: columns = Пн–Вс, rows = Утро | Вечер
 * Style: yellow cells (#FFF8E1) with golden border (#FFD700),
 *        cleaning icon 🧹, today highlight, footer with hours.
 */

import { createCanvas } from "canvas";
import { UserDirectory } from "../userDirectory.js";

const DOW_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DOW_RU = { mon: "Пн", tue: "Вт", wed: "Ср", thu: "Чт", fri: "Пт", sat: "Сб", sun: "Вс" };

function pad2(n) { return String(n).padStart(2, "0"); }

function formatWeekRange(weekStart) {
  const s = new Date(weekStart + "T00:00:00Z");
  const e = new Date(s);
  e.setUTCDate(e.getUTCDate() + 6);
  return `${pad2(s.getUTCDate())}.${pad2(s.getUTCMonth() + 1)} – ${pad2(e.getUTCDate())}.${pad2(e.getUTCMonth() + 1)}.${s.getUTCFullYear()}`;
}

function dayDate(weekStart, dayIndex) {
  const d = new Date(weekStart + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + dayIndex);
  return `${pad2(d.getUTCDate())}.${pad2(d.getUTCMonth() + 1)}`;
}

function displayName(userId) {
  if (!userId) return "";
  return UserDirectory.getDisplayName(userId);
}

function fmtHours(h) {
  if (h == null) return "";
  return h % 1 === 0 ? `${h}.0` : h.toFixed(1);
}

function todayDow() {
  const now = new Date();
  const jsDay = now.getDay(); // 0=Sun..6=Sat
  const map = { 0: "sun", 1: "mon", 2: "tue", 3: "wed", 4: "thu", 5: "fri", 6: "sat" };
  return map[jsDay];
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/**
 * Generate a PNG Buffer of the schedule grid (live-grid style).
 */
export function generateScheduleImage(schedule) {
  if (!schedule || !schedule.slots || schedule.slots.length === 0) {
    return generateEmptyImage("Расписание пусто");
  }

  // Slot lookup: "dow:slotName" → slot
  const slotMap = {};
  for (const slot of schedule.slots) {
    slotMap[`${slot.dow}:${slot.slot_name || ""}`] = slot;
  }

  // Hours per user (for footer)
  const hoursByUser = new Map();
  for (const slot of schedule.slots) {
    if (!slot.user_id) continue;
    hoursByUser.set(slot.user_id, (hoursByUser.get(slot.user_id) || 0) + (slot.hours || 0));
  }

  const currentDow = todayDow();
  const weekStart = schedule.week_start || "";

  // --- Layout constants ---
  const px = 16;             // side padding
  const py = 12;             // top/bottom padding
  const slotLabelW = 70;    // "Утро"/"Вечер" column
  const dayColW = 128;      // each day column
  const headerH = 44;       // day header row height
  const rowH = 72;           // data row height
  const cellPad = 4;         // padding inside cell from grid lines
  const titleH = 30;         // title
  const titleGap = 8;
  const footerH = 22;
  const footerGap = 8;
  const cellRadius = 8;      // border-radius for cells

  const slotNames = ["Утро", "Вечер"];
  const numDays = 7;

  const totalW = px + slotLabelW + numDays * dayColW + px;
  const totalH = py + titleH + titleGap + headerH + slotNames.length * rowH + footerGap + footerH + py;

  const canvas = createCanvas(totalW, totalH);
  const ctx = canvas.getContext("2d");

  // White background
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, totalW, totalH);

  let y = py;

  // === TITLE ===
  ctx.fillStyle = "#333333";
  ctx.font = "bold 16px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const title = weekStart ? `График  ${formatWeekRange(weekStart)}` : "График";
  ctx.fillText(title, totalW / 2, y + titleH / 2);
  y += titleH + titleGap;

  // === HEADER ROW (day columns) ===
  const tableLeft = px;
  const tableTop = y;

  // Header background
  ctx.fillStyle = "#F5F5F5";
  ctx.fillRect(tableLeft, tableTop, totalW - px * 2, headerH);

  // "Слот" label
  ctx.fillStyle = "#555555";
  ctx.font = "bold 12px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Слот", tableLeft + slotLabelW / 2, tableTop + headerH / 2);

  // Day headers
  for (let d = 0; d < numDays; d++) {
    const dow = DOW_ORDER[d];
    const colX = tableLeft + slotLabelW + d * dayColW;
    const isToday = dow === currentDow;

    if (isToday) {
      ctx.fillStyle = "#e7f3ff";
      ctx.fillRect(colX, tableTop, dayColW, headerH);
      // Blue left border for today
      ctx.fillStyle = "#007bff";
      ctx.fillRect(colX, tableTop, 3, headerH);
    }

    ctx.fillStyle = isToday ? "#1976d2" : "#333333";
    ctx.font = "bold 13px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(DOW_RU[dow], colX + dayColW / 2, tableTop + headerH / 2 - 8);

    // Date below day name
    const dateStr = weekStart ? dayDate(weekStart, d) : "";
    ctx.fillStyle = isToday ? "#1976d2" : "#888888";
    ctx.font = "11px sans-serif";
    ctx.fillText(dateStr, colX + dayColW / 2, tableTop + headerH / 2 + 8);
  }

  // Header bottom line
  ctx.strokeStyle = "#E0E0E0";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(tableLeft, tableTop + headerH);
  ctx.lineTo(totalW - px, tableTop + headerH);
  ctx.stroke();

  y = tableTop + headerH;

  // === DATA ROWS (Утро, Вечер) ===
  for (let r = 0; r < slotNames.length; r++) {
    const slotName = slotNames[r];
    const rowY = y + r * rowH;

    // Slot label
    ctx.fillStyle = "#555555";
    ctx.font = "bold 13px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(slotName, tableLeft + slotLabelW / 2, rowY + rowH / 2);

    // Day cells
    for (let d = 0; d < numDays; d++) {
      const dow = DOW_ORDER[d];
      const slot = slotMap[`${dow}:${slotName}`];
      const colX = tableLeft + slotLabelW + d * dayColW;
      const isToday = dow === currentDow;

      // Today column highlight (subtle)
      if (isToday) {
        ctx.fillStyle = "rgba(231, 243, 255, 0.3)";
        ctx.fillRect(colX, rowY, dayColW, rowH);
      }

      const cellX = colX + cellPad;
      const cellY = rowY + cellPad;
      const cellW = dayColW - cellPad * 2;
      const cellH = rowH - cellPad * 2;

      if (slot && slot.user_id) {
        // --- Filled cell ---
        // Determine colors based on status
        let bgColor = "#FFF8E1";    // default: light yellow (PENDING)
        let borderColor = "#FFD700"; // golden

        if (slot.replaced_user_id) {
          bgColor = "#d0e8ff";       // light blue (replacement)
          borderColor = "#4a90d9";
        } else if (slot.status === "CONFIRMED") {
          bgColor = "#d4edda";       // light green
          borderColor = "#28a745";
        } else if (slot.status === "NEEDS_REPLACEMENT") {
          bgColor = "#fff3cd";
          borderColor = "#ff9800";
        } else if (slot.is_problem) {
          bgColor = "#f8d7da";       // light red
          borderColor = "#dc3545";
        }

        // Draw rounded rect background
        roundedRect(ctx, cellX, cellY, cellW, cellH, cellRadius);
        ctx.fillStyle = bgColor;
        ctx.fill();

        // Border
        roundedRect(ctx, cellX, cellY, cellW, cellH, cellRadius);
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Today blue left accent
        if (isToday) {
          ctx.fillStyle = "#007bff";
          roundedRect(ctx, cellX, cellY, 3, cellH, 2);
          ctx.fill();
        }

        // Name (bold, centered)
        const name = displayName(slot.user_id);
        let nameText = name;
        if (slot.status === "NEEDS_REPLACEMENT") nameText += " \u26A0\uFE0F";
        else if (slot.replaced_user_id) nameText += " \uD83D\uDD04";

        ctx.fillStyle = "#222222";
        ctx.font = "bold 14px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        const nameY = cellY + cellH / 2 - 10;
        ctx.fillText(nameText, cellX + cellW / 2, nameY);

        // Hours (smaller, grey)
        const hours = slot.hours;
        let hoursLine = hours != null ? `${fmtHours(hours)} ч` : "";
        if (slot.replaced_user_id) {
          hoursLine = `за ${displayName(slot.replaced_user_id)}`;
        }

        ctx.fillStyle = "#888888";
        ctx.font = "12px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(hoursLine, cellX + cellW / 2, nameY + 18);

        // Cleaning icon (bottom-right corner of cell)
        if (slot.cleaning_user_id && slot.cleaning_status && slot.cleaning_status !== "NOT_SCHEDULED") {
          ctx.font = "11px sans-serif";
          ctx.textAlign = "right";
          ctx.textBaseline = "bottom";
          ctx.fillStyle = "#8B4513";
          ctx.fillText("\uD83E\uDDF9", cellX + cellW - 4, cellY + cellH - 3);
        }

      } else {
        // --- Empty cell (dashed border) ---
        roundedRect(ctx, cellX, cellY, cellW, cellH, cellRadius);
        ctx.strokeStyle = "#E0E0E0";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);

        // "—" or "⚠️ Не назначен"
        ctx.fillStyle = "#dc3545";
        ctx.font = "12px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("\u26A0\uFE0F", cellX + cellW / 2, cellY + cellH / 2);
      }
    }

    // Row separator (light)
    if (r > 0) {
      ctx.strokeStyle = "#F0F0F0";
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(tableLeft, rowY);
      ctx.lineTo(totalW - px, rowY);
      ctx.stroke();
    }
  }

  // === FOOTER: hours summary ===
  const allUsers = UserDirectory.getAllUsers();
  const entries = allUsers
    .filter((u) => hoursByUser.has(u.id) || u.minHours > 0)
    .map((u) => ({
      name: u.displayName,
      hours: hoursByUser.get(u.id) || 0,
      minHours: u.minHours,
      underMin: u.minHours > 0 && (hoursByUser.get(u.id) || 0) < u.minHours,
    }));

  if (entries.length > 0) {
    const footerY = y + slotNames.length * rowH + footerGap;

    // Draw each entry, color-coding under-min
    const parts = entries.map((e) => {
      const h = fmtHours(e.hours);
      const minPart = e.minHours > 0 ? ` (мин.${e.minHours})` : "";
      const warn = e.underMin ? " \u26A0\uFE0F" : "";
      return { text: `${e.name}: ${h}ч${minPart}${warn}`, underMin: e.underMin };
    });

    // Measure total width to center
    ctx.font = "12px sans-serif";
    const separator = "   ";
    const fullText = parts.map((p) => p.text).join(separator);
    const fullW = ctx.measureText(fullText).width;
    let drawX = (totalW - fullW) / 2;

    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      ctx.fillStyle = p.underMin ? "#dc3545" : "#888888";
      ctx.font = p.underMin ? "bold 12px sans-serif" : "12px sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(p.text, drawX, footerY);
      drawX += ctx.measureText(p.text).width;

      if (i < parts.length - 1) {
        ctx.fillStyle = "#CCCCCC";
        ctx.font = "12px sans-serif";
        ctx.fillText(separator, drawX, footerY);
        drawX += ctx.measureText(separator).width;
      }
    }
  }

  return canvas.toBuffer("image/png");
}

function generateEmptyImage(text) {
  const canvas = createCanvas(400, 80);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, 400, 80);
  ctx.fillStyle = "#999999";
  ctx.font = "14px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 200, 40);
  return canvas.toBuffer("image/png");
}
