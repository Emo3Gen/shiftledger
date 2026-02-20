/**
 * Zod validation middleware factories.
 */

/**
 * Validate req.body against a Zod schema.
 * On error: 400 { error: "Validation error", details: [...] }
 * On success: replaces req.body with parsed data, calls next()
 */
export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: "Validation error",
        details: result.error.issues,
      });
    }
    req.body = result.data;
    next();
  };
}

/**
 * Validate req.query against a Zod schema.
 */
export function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return res.status(400).json({
        error: "Validation error",
        details: result.error.issues,
      });
    }
    req.query = result.data;
    next();
  };
}

/**
 * Validate req.params against a Zod schema.
 */
export function validateParams(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      return res.status(400).json({
        error: "Validation error",
        details: result.error.issues,
      });
    }
    req.params = result.data;
    next();
  };
}
