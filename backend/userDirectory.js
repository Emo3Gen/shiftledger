/**
 * UserDirectory: единый источник пользователей
 * 
 * Маппинг между внутренними ID (u1, u2...) и slug/displayName
 */

export const UserDirectory = {
  /**
   * Sync employees from DB into in-memory UserDirectory.
   * Called on server startup. If DB is unavailable, keeps hardcoded defaults.
   */
  async syncFromDB(employeeService) {
    try {
      const employees = await employeeService.getAll();
      if (!employees || employees.length === 0) return;

      for (const emp of employees) {
        const entry = {
          id: emp.id,
          slug: emp.id,
          displayName: emp.name,
          ratePerHour: Number(emp.rate_per_hour) || 0,
          role: emp.role || "staff",
          minHours: Number(emp.min_hours_per_week) || 0,
        };
        this.users.set(emp.id, entry);
      }
      console.log(`[UserDirectory] Synced ${employees.length} employees from DB`);
    } catch (err) {
      console.warn("[UserDirectory] Failed to sync from DB, using hardcoded defaults:", err.message);
    }
  },

  // Internal ID -> User info
  users: new Map([
    ["u1", { id: "u1", slug: "isa", displayName: "Иса", ratePerHour: 280, role: "junior", minHours: 22 }],
    ["u2", { id: "u2", slug: "daria", displayName: "Дарина", ratePerHour: 280, role: "junior", minHours: 20 }],
    ["u3", { id: "u3", slug: "ksu", displayName: "Ксюша", ratePerHour: 280, role: "junior", minHours: 0 }],
    ["u4", { id: "u4", slug: "karina", displayName: "Карина", ratePerHour: 280, role: "senior", minHours: 0 }],
    // Legacy/test users
    ["isa", { id: "u1", slug: "isa", displayName: "Иса", ratePerHour: 280, role: "junior", minHours: 22 }],
    ["daria", { id: "u2", slug: "daria", displayName: "Дарина", ratePerHour: 280, role: "junior", minHours: 20 }],
    ["ksu", { id: "u3", slug: "ksu", displayName: "Ксюша", ratePerHour: 280, role: "junior", minHours: 0 }],
    ["karina", { id: "u4", slug: "karina", displayName: "Карина", ratePerHour: 280, role: "senior", minHours: 0 }],
    // System users
    ["senior1", { id: "senior1", slug: "senior1", displayName: "Старший 1", ratePerHour: 350, role: "senior", minHours: 0 }],
    ["owner1", { id: "owner1", slug: "owner1", displayName: "Владелец", ratePerHour: 0, role: "owner", minHours: 0 }],
    ["admin1", { id: "admin1", slug: "admin1", displayName: "Админ", ratePerHour: 0, role: "admin", minHours: 0 }],
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
};
