export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const optionalQueryString = (req, key) => {
  const value = req.query[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new HttpError(400, `Query param '${key}' must be a single string`);
  }
  return value;
};

export const requireTrimmedString = (value, field) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `'${field}' is required`);
  }
  return value.trim();
};

// Case-insensitive lookup used for duplicate checks, mirroring the mobile add* validations.
export const findOneCaseInsensitive = (Model, filter) =>
  Model.findOne(filter).collation({ locale: "en", strength: 2 }).lean();

const resolveStatus = (err) => {
  if (err instanceof HttpError) return err.status;
  if (err?.name === "ValidationError" || err?.name === "CastError") return 400;
  if (err?.code === 11000) return 409;
  // body-parser errors (malformed JSON, payload too large) carry an exposable 4xx status
  if (err?.expose && Number.isInteger(err.status)) return err.status;
  return 500;
};

export const errorHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);

  const status = resolveStatus(err);
  if (status >= 500) {
    console.error(`[${req.method} ${req.originalUrl}] Unhandled error:`, err);
    return res.status(status).json({ error: "Internal server error" });
  }

  const message = err?.code === 11000 ? "Duplicate record" : err.message;
  res.status(status).json({ error: message });
};
