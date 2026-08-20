export class ProviderError extends Error {
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = this.constructor.name;
    this.code = options.code ?? "provider_error";
    this.status = options.status ?? null;
    this.transient = options.transient ?? false;
    this.retryAfter = options.retryAfter ?? null;
    this.responseCode = options.responseCode ?? null;
  }
}

export class ProviderConfigError extends ProviderError {
  constructor(message, options = {}) {
    super(message, { ...options, code: "configuration" });
  }
}

export class ProviderAuthError extends ProviderError {
  constructor(message, options = {}) {
    super(message, { ...options, code: "authentication" });
  }
}

export class ProviderAccessError extends ProviderError {
  constructor(message, options = {}) {
    super(message, { ...options, code: "access_denied" });
  }
}

export class ProviderRateLimitError extends ProviderError {
  constructor(message, options = {}) {
    super(message, { ...options, code: "rate_limited", transient: true });
  }
}

export class ProviderNetworkError extends ProviderError {
  constructor(message, options = {}) {
    super(message, { ...options, code: options.code ?? "network", transient: options.transient ?? true });
  }
}

export class ProviderParseError extends ProviderError {
  constructor(message, options = {}) {
    super(message, { ...options, code: "invalid_response" });
  }
}

export class ProviderComplianceError extends ProviderError {
  constructor(message, options = {}) {
    super(message, { ...options, code: "compliance" });
  }
}

export function sanitizeErrorMessage(value) {
  return String(value ?? "Unknown provider error")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [REDACTED]")
    .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, "Basic [REDACTED]")
    .replace(/([?&](?:access_token|api_?key|apikey|token|key|password|client_secret|signature|sig|x-amz-(?:credential|signature|security-token))=)[^&\s]+/gi, "$1[REDACTED]");
}

export function classifyProviderError(error) {
  if (error instanceof ProviderError) return error;
  const status = error?.status;
  const options = { status, cause: error, retryAfter: error?.retryAfter };
  if (status === 401) return new ProviderAuthError("HTTP 401 Unauthorized", options);
  if (status === 403) return new ProviderAccessError("HTTP 403 Forbidden", options);
  if (status === 429) return new ProviderRateLimitError("HTTP 429 Too Many Requests", options);
  if (typeof status === "number" && status >= 500) {
    return new ProviderNetworkError(`HTTP ${status}`, options);
  }
  if (error?.name === "AbortError" || error?.name === "TimeoutError") {
    return new ProviderNetworkError("Request timed out", { ...options, code: "timeout" });
  }
  return new ProviderError(sanitizeErrorMessage(error?.message ?? error), options);
}

export function errorDiagnostic(error) {
  const classified = classifyProviderError(error);
  return {
    code: classified.code,
    message: sanitizeErrorMessage(classified.message),
    status: classified.status,
    transient: classified.transient
  };
}
