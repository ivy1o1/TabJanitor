import { CATEGORIES, ERROR_CODES, LIMITS } from './constants.js';

export class AppError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}

export function appError(code, message, details) {
  return new AppError(code, message, details);
}

export function ok(data) {
  return { ok: true, data };
}

export function err(error) {
  return {
    ok: false,
    error: {
      code: error.code || ERROR_CODES.INVALID_REQUEST,
      message: error.message || 'Unexpected error.',
      details: error.details || {},
    },
  };
}

export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isValidCategory(value) {
  return typeof value === 'string' && CATEGORIES.includes(value);
}

export function isValidConfidence(value) {
  return typeof value === 'number' && Number.isFinite(value)
    && value >= LIMITS.CONFIDENCE_MIN && value <= LIMITS.CONFIDENCE_MAX;
}

export function clampString(value, max) {
  if (typeof value !== 'string') return '';
  return value.length > max ? value.slice(0, max) : value;
}

// Optional numeric request fields must be bounded positive integers when supplied;
// omitted fields fall back to the documented default.
export function boundedInt(value, { name, min, max, fallback }) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw appError(ERROR_CODES.INVALID_REQUEST, `${name} must be an integer between ${min} and ${max}.`, {
      [name]: value,
      min,
      max,
    });
  }
  return value;
}
