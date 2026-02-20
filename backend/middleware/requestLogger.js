import { randomUUID } from "crypto";
import logger from "../logger.js";

/**
 * Express middleware that logs every request with method, url, status, response time.
 * Attaches req.log = logger.child({ trace_id }) for downstream handlers.
 */
export function requestLogger(req, res, next) {
  const traceId = req.get("x-trace-id") || randomUUID();
  req.traceId = traceId;
  req.log = logger.child({ trace_id: traceId });

  const start = Date.now();

  res.on("finish", () => {
    const ms = Date.now() - start;
    const data = {
      method: req.method,
      url: req.originalUrl,
      status_code: res.statusCode,
      response_time_ms: ms,
    };

    if (res.statusCode >= 500) {
      req.log.error(data, "request error");
    } else if (res.statusCode >= 400) {
      req.log.warn(data, "request warning");
    } else {
      req.log.info(data, "request completed");
    }
  });

  next();
}
