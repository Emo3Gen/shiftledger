/**
 * Zod validation middleware factories.
 *
 * Express 5 makes req.query and req.params read-only (getters).
 * We validate input but store parsed data on req._validated* instead of
 * overwriting the read-only properties. For req.body (writable), we still
 * replace it with Zod-parsed data.
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
 * Express 5: req.query is read-only, so we store parsed data on req._validatedQuery
 * and also copy parsed values onto the existing query object where possible.
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
    // Store validated data for handlers that need coerced values
    req._validatedQuery = result.data;
    next();
  };
}

/**
 * Validate req.params against a Zod schema.
 * Express 5: req.params may be read-only, so we store on req._validatedParams.
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
    req._validatedParams = result.data;
    next();
  };
}
