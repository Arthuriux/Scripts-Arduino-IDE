'use strict';
const crypto = require('crypto');

const SESSION_COOKIE = 'pc_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 h

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  const ref = Buffer.from(hash, 'hex');
  return ref.length === test.length && crypto.timingSafeEqual(ref, test);
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function parseCookies(header) {
  const out = {};
  String(header || '')
    .split(';')
    .forEach((part) => {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    });
  return out;
}

/** Sesiones de administración en memoria (se pierden al reiniciar: basta con volver a entrar). */
class Sessions {
  constructor() {
    this.map = new Map();
  }
  create(userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    this.map.set(token, { userId, expires: Date.now() + SESSION_TTL_MS });
    return token;
  }
  get(token) {
    const s = token && this.map.get(token);
    if (!s) return null;
    if (s.expires < Date.now()) {
      this.map.delete(token);
      return null;
    }
    s.expires = Date.now() + SESSION_TTL_MS;
    return s;
  }
  destroy(token) {
    this.map.delete(token);
  }
}

module.exports = { SESSION_COOKIE, SESSION_TTL_MS, hashPassword, verifyPassword, sha256, parseCookies, Sessions };
