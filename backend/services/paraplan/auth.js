/**
 * ParaplanAuthService — Cookie + CSRF authentication for Paraplan CRM.
 *
 * Flow:
 *   1. POST /api/public/login → session cookie
 *   2. GET /api/open/user → CSRF token + user data + companyId
 *   3. All requests: cookie + CSRF header
 *   4. On 401 → auto re-login
 */

import https from "https";
import http from "http";
import logger from "../../logger.js";

export class ParaplanAuthService {
  constructor(config) {
    this.baseUrl = config.baseUrl || "https://paraplancrm.ru";
    this.username = config.username;
    this.password = config.password;
    this.loginType = config.loginType || "KIDS_APP";

    this.cookies = [];
    this.csrfToken = null;
    this.user = null;
    this.companyId = null;
    this.isAuthenticated = false;
    this.lastLoginAt = null;

    this.maxRetries = 2;
    this.sessionCheckInterval = 30 * 60 * 1000; // 30 min
  }

  async authenticate() {
    logger.info("[paraplan-auth] Starting authentication...");
    await this._login();
    await this._fetchUser();
    this.isAuthenticated = true;
    this.lastLoginAt = Date.now();
    logger.info(
      { user: this.user?.name, companyId: this.companyId },
      "[paraplan-auth] Authenticated"
    );
    return { user: this.user, companyId: this.companyId, csrfToken: this.csrfToken };
  }

  async ensureAuth() {
    if (!this.isAuthenticated) {
      return this.authenticate();
    }
    if (Date.now() - this.lastLoginAt > this.sessionCheckInterval) {
      try {
        await this._fetchUser();
        this.lastLoginAt = Date.now();
      } catch (err) {
        if (err.statusCode === 401) {
          logger.info("[paraplan-auth] Session expired, re-authenticating...");
          return this.authenticate();
        }
        throw err;
      }
    }
  }

  async get(path, queryParams = {}) {
    await this.ensureAuth();
    return this._request("GET", path, null, queryParams);
  }

  // --- Private ---

  async _login() {
    const body = {
      username: this.username,
      password: this.password,
      loginType: this.loginType,
      rememberMe: true,
    };

    const response = await this._request("POST", "/api/public/login", body, {}, false);

    const errData = response.body;
    if (response.statusCode === 401 || errData?.success === false) {
      if (errData?.fieldErrorCodeList?.captcha || errData?.errors?.captcha) {
        throw new Error("[paraplan-auth] Captcha required! Wait 5-10 minutes.");
      }
      throw new Error(`[paraplan-auth] Login failed: ${JSON.stringify(errData)}`);
    }

    if (response.headers["set-cookie"]) {
      this.cookies = response.headers["set-cookie"].map((c) => c.split(";")[0]);
    }

    logger.info({ cookies: this.cookies.length }, "[paraplan-auth] Login successful");
    return response.body;
  }

  async _fetchUser() {
    const response = await this._request("GET", "/api/open/user", null, {}, true);

    if (response.statusCode === 401) {
      this.isAuthenticated = false;
      const err = new Error("Not authenticated");
      err.statusCode = 401;
      throw err;
    }

    const data = response.body;
    if (typeof data === "string") {
      throw new Error(`[paraplan-auth] Failed to fetch user: ${data.slice(0, 200)}`);
    }

    this.user = data.user || data;

    if (this.user?.currentCompanyId) {
      this.companyId = this.user.currentCompanyId;
    } else if (this.user?.companyId) {
      this.companyId = this.user.companyId;
    } else if (this.user?.companyList?.[0]?.id) {
      this.companyId = this.user.companyList[0].id;
    }

    if (response.headers["x-csrf-token"]) {
      this.csrfToken = response.headers["x-csrf-token"];
    }
    for (const cookie of this.cookies) {
      if (cookie.startsWith("XSRF-TOKEN=") || cookie.startsWith("csrf")) {
        this.csrfToken = cookie.split("=")[1];
      }
    }

    return data;
  }

  _request(method, path, body = null, queryParams = {}, withAuth = true, _redirectCount = 0) {
    return new Promise((resolve, reject) => {
      const url = new URL(this.baseUrl + path);

      for (const [key, value] of Object.entries(queryParams)) {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, value);
        }
      }

      const headers = {
        "Content-Type": "application/json",
        Accept: "application/json",
      };

      if (withAuth && this.cookies.length > 0) {
        headers["Cookie"] = this.cookies.join("; ");
      }

      if (withAuth && this.csrfToken && ["POST", "PATCH", "DELETE"].includes(method)) {
        headers["X-CSRF-TOKEN"] = this.csrfToken;
        headers["X-XSRF-TOKEN"] = this.csrfToken;
      }

      const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers,
      };

      const transport = url.protocol === "https:" ? https : http;

      const req = transport.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          // Follow redirects
          if ([301, 302, 307].includes(res.statusCode) && res.headers.location && _redirectCount < 3) {
            if (res.headers["set-cookie"]) {
              const newCookies = res.headers["set-cookie"].map((c) => c.split(";")[0]);
              for (const nc of newCookies) {
                const ncName = nc.split("=")[0];
                const idx = this.cookies.findIndex((c) => c.startsWith(ncName + "="));
                if (idx >= 0) this.cookies[idx] = nc;
                else this.cookies.push(nc);
              }
            }
            const redirectUrl = new URL(res.headers.location, url);
            const newPath = redirectUrl.pathname + redirectUrl.search;
            return this._request(method, newPath, body, {}, withAuth, _redirectCount + 1)
              .then(resolve)
              .catch(reject);
          }

          // Update cookies
          if (res.headers["set-cookie"]) {
            const newCookies = res.headers["set-cookie"].map((c) => c.split(";")[0]);
            for (const nc of newCookies) {
              const ncName = nc.split("=")[0];
              const idx = this.cookies.findIndex((c) => c.startsWith(ncName + "="));
              if (idx >= 0) this.cookies[idx] = nc;
              else this.cookies.push(nc);
            }
          }

          let parsedBody;
          try {
            parsedBody = JSON.parse(data);
          } catch {
            parsedBody = data;
          }

          resolve({ statusCode: res.statusCode, headers: res.headers, body: parsedBody });
        });
      });

      req.on("error", reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }
}
