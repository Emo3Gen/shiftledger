/**
 * ParaplanDataService — read-only API client for Paraplan CRM.
 *
 * Fetches schedule, groups, teachers. All responses are cached.
 */

import { ParaplanAuthService } from "./auth.js";
import { ParaplanCache } from "./cache.js";
import logger from "../../logger.js";

export class ParaplanDataService {
  constructor(config) {
    this.auth = new ParaplanAuthService({
      baseUrl: config.baseUrl,
      username: config.username,
      password: config.password,
      loginType: config.loginType || "KIDS_APP",
    });

    this.cache = new ParaplanCache({
      schedule: 5 * 60 * 1000,
      groups: 60 * 60 * 1000,
      teachers: 60 * 60 * 1000,
    });

    this.companyId = config.companyId || null;
    this.stats = { apiCalls: 0, cacheHits: 0, errors: 0, lastError: null };
  }

  async init() {
    const authResult = await this.auth.authenticate();
    if (!this.companyId) {
      this.companyId = authResult.companyId;
    }
    logger.info({ companyId: this.companyId }, "[paraplan] Initialized");
    return authResult;
  }

  /**
   * Public schedule for a date range (uses companyId).
   */
  async getPublicSchedule(dateFrom, dateTo) {
    const cacheKey = `schedule:${dateFrom}:${dateTo}`;
    const cached = this.cache.get(cacheKey, "schedule");
    if (cached) {
      this.stats.cacheHits++;
      return cached;
    }

    const [fromYear, fromMonth, fromDay] = this._parseDate(dateFrom);
    const [toYear, toMonth, toDay] = this._parseDate(dateTo);

    const data = await this._get(`/api/public/schedule/${this.companyId}`, {
      "from.year": fromYear, "from.month": fromMonth, "from.day": fromDay,
      "to.year": toYear, "to.month": toMonth, "to.day": toDay,
    });

    this.cache.set(cacheKey, data, "schedule");
    return data;
  }

  /**
   * All current groups (paginated).
   */
  async getGroups() {
    const cached = this.cache.get("groups:all", "groups");
    if (cached) {
      this.stats.cacheHits++;
      return cached;
    }

    const data = await this._get("/api/open/groups/paginated", {
      status: "CURRENT",
      type: "GROUP",
      size: 100,
    });

    this.cache.set("groups:all", data, "groups");
    return data;
  }

  /**
   * Minimal group info (id, name, studentCount).
   */
  async getGroupsMinInfo() {
    const cached = this.cache.get("groups:min", "groups");
    if (cached) {
      this.stats.cacheHits++;
      return cached;
    }

    const data = await this._get("/api/open/groups/min-info", {
      status: "CURRENT",
      type: "GROUP",
    });

    this.cache.set("groups:min", data, "groups");
    return data;
  }

  /**
   * Detailed group info (schedule, teachers, students).
   */
  async getGroupDetails(groupId) {
    const cacheKey = `group:${groupId}`;
    const cached = this.cache.get(cacheKey, "groups");
    if (cached) {
      this.stats.cacheHits++;
      return cached;
    }

    const data = await this._get(`/api/open/groups/${groupId}`);
    this.cache.set(cacheKey, data, "groups");
    return data;
  }

  /**
   * Company schedule breakdown with attendances.
   */
  async getCompanyScheduleBreakdown(dateFrom, dateTo) {
    const cacheKey = `breakdown:${dateFrom}:${dateTo}`;
    const cached = this.cache.get(cacheKey, "schedule");
    if (cached) {
      this.stats.cacheHits++;
      return cached;
    }

    const [fromYear, fromMonth, fromDay] = this._parseDate(dateFrom);
    const [toYear, toMonth, toDay] = this._parseDate(dateTo);

    const data = await this._get("/api/open/company/attendances/breakdown/all", {
      "from.year": fromYear, "from.month": fromMonth, "from.day": fromDay,
      "to.year": toYear, "to.month": toMonth, "to.day": toDay,
      groupStatus: "CURRENT",
    });

    this.cache.set(cacheKey, data, "schedule");
    return data;
  }

  /**
   * Teacher list.
   */
  async getTeachers() {
    const cached = this.cache.get("teachers:all", "teachers");
    if (cached) {
      this.stats.cacheHits++;
      return cached;
    }

    const data = await this._get("/api/open/teachers/min-info", { currentOnly: true });
    this.cache.set("teachers:all", data, "teachers");
    return data;
  }

  /**
   * Compensations (make-up lessons) for a date range.
   * Uses plannedRange dates and top-level page/size pagination.
   */
  async getCompensations(dateFrom, dateTo, page = 1, size = 50) {
    const cacheKey = `compensations:${dateFrom}:${dateTo}:${page}`;
    const cached = this.cache.get(cacheKey, "schedule");
    if (cached) {
      this.stats.cacheHits++;
      return cached;
    }

    const [fromYear, fromMonth, fromDay] = this._parseDate(dateFrom);
    const [toYear, toMonth, toDay] = this._parseDate(dateTo);

    const data = await this._get("/api/open/attendances/compensations", {
      "plannedRange.from.year": fromYear, "plannedRange.from.month": fromMonth, "plannedRange.from.day": fromDay,
      "plannedRange.to.year": toYear, "plannedRange.to.month": toMonth, "plannedRange.to.day": toDay,
      page,
      size,
    });

    this.cache.set(cacheKey, data, "schedule");
    return data;
  }

  /**
   * Subscription templates (abonement pricing).
   */
  async getSubscriptionTemplates() {
    const cached = this.cache.get("subscriptions", "groups");
    if (cached) {
      this.stats.cacheHits++;
      return cached;
    }

    const data = await this._get("/api/open/groups/subscriptionTemplates");
    this.cache.set("subscriptions", data, "groups");
    return data;
  }

  /**
   * Student subscriptions (abonements).
   */
  async getStudentSubscriptions(studentId) {
    const cacheKey = `student-subs:${studentId}`;
    const cached = this.cache.get(cacheKey, "groups");
    if (cached) {
      this.stats.cacheHits++;
      return cached;
    }

    const data = await this._get(`/api/open/students/${studentId}/subscriptions/paginated`, {
      size: 50,
    });

    this.cache.set(cacheKey, data, "groups");
    return data;
  }

  /**
   * Records for a specific date: schedule → groups → students → subscriptions → compensations.
   * Returns { date, records[], summary }.
   */
  async getRecordsForDate(dateStr) {
    const cacheKey = `records:${dateStr}`;
    const cached = this.cache.get(cacheKey, "schedule");
    if (cached) {
      this.stats.cacheHits++;
      return cached;
    }

    // 1. Schedule for the date
    const schedule = await this.getPublicSchedule(dateStr, dateStr);
    const dayItems = schedule?.scheduleList || schedule?.itemList || [];

    // 2. Parse group lessons
    const groupLessons = [];
    for (const item of dayItems) {
      const groupId = item.group?.id || item.groupId;
      const groupName = item.group?.name || item.groupName || "";
      const hour = item.startTime?.hour ?? item.time?.hour ?? 0;
      const minute = item.startTime?.minute ?? item.time?.minute ?? 0;
      const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      const duration = item.durationMinutes || item.duration || 60;
      const teacherName = item.teacher?.name || item.teacherList?.[0]?.name || "";
      if (groupId) {
        groupLessons.push({ groupId, groupName, time, duration, teacherName });
      }
    }

    // 3. Group details (parallel)
    const records = [];
    const uniqueGroupIds = [...new Set(groupLessons.map(gl => gl.groupId))];
    const groupDetailsMap = {};
    await Promise.all(uniqueGroupIds.map(async (gid) => {
      try {
        groupDetailsMap[gid] = await this.getGroupDetails(gid);
      } catch (err) {
        logger.warn({ err: err.message, groupId: gid }, "[records] Group details failed");
      }
    }));

    // 4. Compensations for the date
    let compensationList = [];
    try {
      const compData = await this.getCompensations(dateStr, dateStr);
      compensationList = compData?.itemList || compData?.content || compData?.compensationList || [];
      if (!Array.isArray(compensationList)) compensationList = [];
    } catch (err) {
      logger.warn({ err: err.message }, "[records] Compensations failed");
    }

    // 5. Build records
    const statusCounts = { active: 0, trial: 0, compensation: 0, unpaid: 0, frozen: 0 };

    for (const lesson of groupLessons) {
      const detail = groupDetailsMap[lesson.groupId];
      const group = detail?.group || detail;
      const studentList = group?.studentList || [];
      const teacherShort = lesson.teacherName
        ? lesson.teacherName.split(/\s+/).slice(0, 2).map((p, i) => i === 0 ? p : p[0] + ".").join(" ")
        : "";

      for (const student of studentList) {
        const studentName = student.name || `${student.surname || ""} ${student.firstName || ""}`.trim();
        const studentId = student.id;

        let status = "active";
        let subscription = null;

        if (studentId) {
          try {
            const subsData = await this.getStudentSubscriptions(studentId);
            const subs = subsData?.itemList || subsData?.content || [];
            if (Array.isArray(subs) && subs.length > 0) {
              const activeSub = subs.find(s =>
                s.status === "ACTIVE" &&
                (s.group?.id === lesson.groupId || !s.group)
              ) || subs.find(s => s.status === "ACTIVE") || subs[0];

              if (activeSub) {
                const subType = (activeSub.type || "").toLowerCase();
                const isPaid = activeSub.paid !== false;
                const isFrozen = activeSub.status === "FROZEN";
                const isTrial = subType.includes("trial") || subType.includes("пробн");

                if (isFrozen) status = "frozen";
                else if (isTrial) status = "trial";
                else if (!isPaid) status = "unpaid";

                subscription = {
                  type: isTrial ? "trial" : (activeSub.name || subType || "monthly"),
                  name: activeSub.name || null,
                  remaining: activeSub.remainingLessons ?? activeSub.remaining ?? null,
                  paid: isPaid,
                };
              }
            }
          } catch {
            // Not critical — student just has no subscription data
          }
        }

        statusCounts[status] = (statusCounts[status] || 0) + 1;
        const record = {
          time: lesson.time,
          group: lesson.groupName,
          groupId: lesson.groupId,
          student: studentName,
          studentId: studentId || null,
          teacher: teacherShort,
          duration_minutes: lesson.duration,
          status,
        };
        if (subscription) record.subscription = subscription;
        records.push(record);
      }

      // Compensations into this group
      const groupComps = compensationList.filter(c => {
        const gId = c.plannedAttendeeGroup?.id || c.group?.id || c.groupId;
        return gId === lesson.groupId && c.status !== "SKIPPED";
      });

      for (const comp of groupComps) {
        const studentName = comp.student?.name || comp.studentName || "Неизвестно";
        const studentId = comp.student?.id || comp.studentId || null;
        const origGroup = comp.attendeeGroup?.name || comp.originalGroup?.name || null;

        statusCounts.compensation++;
        records.push({
          time: lesson.time,
          group: lesson.groupName,
          groupId: lesson.groupId,
          student: studentName,
          studentId,
          teacher: teacherShort,
          duration_minutes: lesson.duration,
          status: "compensation",
          subscription: {
            type: "compensation",
            original_group: origGroup,
            reason: comp.comment || comp.reason || null,
          },
        });
      }
    }

    records.sort((a, b) => a.time.localeCompare(b.time) || a.group.localeCompare(b.group));

    const result = {
      date: dateStr,
      records,
      summary: {
        total_records: records.length,
        by_status: statusCounts,
      },
    };

    this.cache.set(cacheKey, result, "schedule");
    return result;
  }

  /** Force invalidate all caches */
  invalidateAll() {
    return this.cache.invalidate();
  }

  // --- Helpers ---

  async _get(path, params = {}) {
    this.stats.apiCalls++;
    try {
      const response = await this.auth.get(path, params);
      if (response.statusCode >= 400) {
        this.stats.errors++;
        this.stats.lastError = { path, statusCode: response.statusCode };
        throw new Error(`Paraplan API ${response.statusCode}: ${JSON.stringify(response.body).slice(0, 200)}`);
      }
      return response.body;
    } catch (err) {
      this.stats.errors++;
      this.stats.lastError = { path, error: err.message };
      throw err;
    }
  }

  _parseDate(dateStr) {
    const d = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
    return [d.getFullYear(), d.getMonth() + 1, d.getDate()];
  }
}
