/**
 * UserDirectory: единый источник пользователей
 * 
 * Маппинг между внутренними ID (u1, u2...) и slug/displayName
 */

export const UserDirectory = {
  // Reference to employeeService, set during syncFromDB
  _employeeService: null,

  /**
   * Sync employees from DB into in-memory UserDirectory.
   * Called on server startup. Supabase is the single source of truth.
   * Hardcoded seed data is only used if Supabase table is empty (first run).
   */
  async syncFromDB(employeeService) {
    this._employeeService = employeeService;
    try {
      const employees = await employeeService.getAll();
      if (!employees || employees.length === 0) {
        // Supabase table is empty — no seeding from here, seed via migration
        return;
      }

      // Clear employee entries (keep system users) and reload from DB
      for (const key of [...this.users.keys()]) {
        if (key.startsWith("u") || ["isa", "daria", "ksu", "karina"].includes(key)) {
          this.users.delete(key);
        }
      }

      for (const emp of employees) {
        const entry = {
          id: emp.id,
          slug: emp.id,
          displayName: emp.name,
          ratePerHour: Number(emp.rate_per_hour) || 0,
          role: emp.role || "staff",
          minHours: Number(emp.min_hours_per_week) || 0,
          autoSchedule: emp.auto_schedule !== false,
          branch: emp.branch || "Архангельск",
          skillLevel: emp.skill_level || "beginner",
        };
        this.users.set(emp.id, entry);
      }
    } catch (err) {
      // fallback silently — hardcoded defaults remain for offline dev
    }
  },

  /**
   * Re-sync a single employee from DB after update.
   */
  async resyncEmployee(employee) {
    if (!employee) return;
    const entry = {
      id: employee.id,
      slug: employee.id,
      displayName: employee.name,
      ratePerHour: Number(employee.rate_per_hour) || 0,
      role: employee.role || "staff",
      minHours: Number(employee.min_hours_per_week) || 0,
      autoSchedule: employee.auto_schedule !== false,
      branch: employee.branch || "Архангельск",
    };
    this.users.set(employee.id, entry);
  },

  // Internal ID -> User info (fallback defaults for offline/first-run)
  users: new Map([
    ["u1", { id: "u1", slug: "isa", displayName: "Иса", ratePerHour: 280, role: "junior", minHours: 22, autoSchedule: true, branch: "Архангельск" }],
    ["u2", { id: "u2", slug: "daria", displayName: "Дарина", ratePerHour: 280, role: "junior", minHours: 20, autoSchedule: true, branch: "Архангельск" }],
    ["u3", { id: "u3", slug: "ksu", displayName: "Ксюша", ratePerHour: 280, role: "junior", minHours: 0, autoSchedule: true, branch: "Архангельск" }],
    ["u4", { id: "u4", slug: "karina", displayName: "Карина", ratePerHour: 280, role: "junior", minHours: 20, autoSchedule: true, branch: "Архангельск" }],
    // System users
    ["senior1", { id: "senior1", slug: "senior1", displayName: "Старший 1", ratePerHour: 350, role: "senior", minHours: 0, autoSchedule: true, branch: "Архангельск" }],
    ["owner1", { id: "owner1", slug: "owner1", displayName: "Владелец", ratePerHour: 0, role: "owner", minHours: 0, autoSchedule: true, branch: "Архангельск" }],
    ["admin1", { id: "admin1", slug: "admin1", displayName: "Админ", ratePerHour: 0, role: "admin", minHours: 0, autoSchedule: true, branch: "Архангельск" }],
  ]),
  
  /**
   * Получить user_id (внутренний ID) по slug или id
   * @param {string} identifier - slug или id пользователя
   * @returns {string|null} - внутренний ID (u1, u2...) или null если не найден
   */
  getUserId(identifier) {
    if (!identifier) return null;
    const user = this.users.get(identifier);
    if (!user) return null;
    // Возвращаем канонический ID (u1, u2...)
    return user.id.startsWith("u") ? user.id : identifier;
  },
  
  /**
   * Получить информацию о пользователе по ID или slug
   * @param {string} identifier - slug или id пользователя
   * @returns {Object|null} - информация о пользователе или null
   */
  getUser(identifier) {
    if (!identifier) return null;
    const user = this.users.get(identifier);
    if (!user) return null;
    // Возвращаем каноническую запись (с id = u1, u2...)
    const canonicalId = user.id.startsWith("u") ? user.id : identifier;
    const canonicalUser = this.users.get(canonicalId);
    return canonicalUser || user;
  },
  
  /**
   * Получить displayName по ID или slug
   * @param {string} identifier - slug или id пользователя
   * @returns {string} - displayName или identifier если не найден
   */
  getDisplayName(identifier) {
    const user = this.getUser(identifier);
    return user?.displayName || identifier;
  },
  
  /**
   * Получить ratePerHour по ID или slug
   * @param {string} identifier - slug или id пользователя
   * @returns {number} - ratePerHour или 0 если не найден
   */
  getRatePerHour(identifier) {
    const user = this.getUser(identifier);
    return user?.ratePerHour || 0;
  },
  
  /**
   * Получить все hourlyRates в формате { user_id: rate }
   * @returns {Object} - объект с hourlyRates для всех пользователей
   */
  getAllHourlyRates() {
    const rates = {};
    for (const [key, user] of this.users.entries()) {
      // Используем только канонические ID (u1, u2...)
      if (user.id.startsWith("u") || key.startsWith("u")) {
        const canonicalId = user.id.startsWith("u") ? user.id : key;
        if (!rates[canonicalId]) {
          rates[canonicalId] = user.ratePerHour;
        }
      }
    }
    return rates;
  },
  
  /**
   * Нормализовать user_id: привести slug к внутреннему ID
   * @param {string} identifier - slug или id пользователя
   * @returns {string} - нормализованный user_id (u1, u2...) или исходный если не найден
   */
  normalizeUserId(identifier) {
    if (!identifier) return identifier;
    const userId = this.getUserId(identifier);
    return userId || identifier; // Если не найден, возвращаем как есть
  },
  
  /**
   * Проверить, является ли пользователь junior
   * @param {string} identifier - slug или id пользователя
   * @returns {boolean}
   */
  isJunior(identifier) {
    const user = this.getUser(identifier);
    return user?.role === "junior";
  },
  
  /**
   * Проверить, является ли пользователь senior
   * @param {string} identifier - slug или id пользователя
   * @returns {boolean}
   */
  isSenior(identifier) {
    const user = this.getUser(identifier);
    return user?.role === "senior";
  },
  
  /**
   * Получить minHours для пользователя
   * @param {string} identifier - slug или id пользователя
   * @returns {number} - minHours или 0
   */
  getMinHours(identifier) {
    const user = this.getUser(identifier);
    return user?.minHours || 0;
  },
  
  /**
   * Получить список всех junior пользователей (по каноническим ID)
   * @returns {Array<string>} - массив user_id (u1, u2...)
   */
  getJuniorUserIds() {
    const juniorIds = [];
    for (const [key, user] of this.users.entries()) {
      if (user.role === "junior" && user.id.startsWith("u")) {
        if (!juniorIds.includes(user.id)) {
          juniorIds.push(user.id);
        }
      }
    }
    return juniorIds;
  },
  
  /**
   * Find user by display name (case-insensitive, supports Russian case forms).
   * Matches against displayName and common Russian declensions.
   * @param {string} name - display name to search for (e.g. "Дарину", "ксюша")
   * @returns {string|null} - canonical user_id or null
   */
  findByDisplayName(name) {
    if (!name) return null;
    const lower = name.toLowerCase().trim();
    const seen = new Set();
    for (const [, user] of this.users.entries()) {
      if (seen.has(user.id)) continue;
      seen.add(user.id);
      const dn = (user.displayName || "").toLowerCase();
      if (!dn) continue;
      // Exact match
      if (dn === lower) return user.id;
      // Russian accusative/genitive: remove last char and compare stem
      // e.g. "Дарину" → stem "дарин", displayName "Дарина" → stem "дарин"
      const stem = dn.length > 2 ? dn.slice(0, -1) : dn;
      const inputStem = lower.length > 2 ? lower.slice(0, -1) : lower;
      if (stem === inputStem && stem.length >= 2) return user.id;
    }
    return null;
  },

  /**
   * Получить список всех senior пользователей (по каноническим ID)
   * @returns {Array<string>} - массив user_id
   */
  getSeniorUserIds() {
    const seniorIds = [];
    for (const [key, user] of this.users.entries()) {
      if (user.role === "senior") {
        const canonicalId = user.id.startsWith("u") ? user.id : key;
        if (!seniorIds.includes(canonicalId)) {
          seniorIds.push(canonicalId);
        }
      }
    }
    return seniorIds;
  },

  /**
   * Проверить, участвует ли пользователь в автосборке графика
   * @param {string} identifier - slug или id пользователя
   * @returns {boolean}
   */
  isAutoSchedule(identifier) {
    const user = this.getUser(identifier);
    return user?.autoSchedule !== false;
  },

  /**
   * Получить филиал пользователя
   * @param {string} identifier - slug или id пользователя
   * @returns {string}
   */
  getBranch(identifier) {
    const user = this.getUser(identifier);
    return user?.branch || "Архангельск";
  },

  /**
   * Получить уровень квалификации пользователя
   * @param {string} identifier - slug или id пользователя
   * @returns {string} "beginner" | "experienced" | "guru"
   */
  getSkillLevel(identifier) {
    const user = this.getUser(identifier);
    return user?.skillLevel || "beginner";
  },

  /**
   * Получить всех уникальных пользователей (по каноническим ID)
   * @returns {Array<{id: string, displayName: string, slug: string}>}
   */
  getAllUsers() {
    const seen = new Set();
    const result = [];
    for (const [, user] of this.users.entries()) {
      const canonicalId = user.id.startsWith("u") ? user.id : null;
      if (!canonicalId || seen.has(canonicalId)) continue;
      seen.add(canonicalId);
      result.push({ id: canonicalId, displayName: user.displayName, slug: user.slug });
    }
    return result;
  },
};
