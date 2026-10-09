/**
 * Resolución de la programación (compartido por el servidor y el reproductor web).
 * La app Android implementa exactamente la misma lógica en Scheduler.kt.
 *
 * Reglas:
 *  - Un evento está activo si la fecha, el día de la semana y la franja horaria coinciden.
 *  - Franja con fin <= inicio => cruza la medianoche (p. ej. 22:00 → 06:00).
 *  - Sin hora de inicio/fin => todo el día.
 *  - Gana la prioridad más alta; los eventos empatados se reproducen intercalados.
 *  - Si no hay eventos activos se usa el contenido por defecto de la pantalla.
 *  - El contenido puede ser una lista ('p:<id>') o un layout ('l:<id>').
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PCSchedule = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function toMinutes(hhmm, fallback) {
    if (!hhmm) return fallback;
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
    if (!m) return fallback;
    return Math.min(24 * 60, parseInt(m[1], 10) * 60 + parseInt(m[2], 10));
  }

  function ymd(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function dayMatches(s, date) {
    const days = Array.isArray(s.days) ? s.days : [];
    if (days.length && !days.includes(date.getDay())) return false;
    const day = ymd(date);
    if (s.startDate && day < s.startDate) return false;
    if (s.endDate && day > s.endDate) return false;
    return true;
  }

  function isActive(s, now) {
    if (s.enabled === false) return false;
    const t = now.getHours() * 60 + now.getMinutes();
    const start = toMinutes(s.startTime, 0);
    const end = toMinutes(s.endTime, 24 * 60);
    if (start < end) return dayMatches(s, now) && t >= start && t < end;
    if (start === end) return dayMatches(s, now); // 24 h
    // Franja nocturna: parte de hoy (desde el inicio) o parte de ayer (hasta el fin)
    const yesterday = new Date(now.getTime());
    yesterday.setDate(yesterday.getDate() - 1);
    return (t >= start && dayMatches(s, now)) || (t < end && dayMatches(s, yesterday));
  }

  /** Clave del contenido de un evento: 'p:<id>' (lista) o 'l:<id>' (layout). */
  function contentKey(s) {
    if (!s) return '';
    if (s.content) return s.content;
    if (s.layoutId) return 'l:' + s.layoutId;
    if (s.playlistId) return 'p:' + s.playlistId;
    return '';
  }

  function normalizeKey(k) {
    if (!k) return '';
    return /^[pl]:/.test(k) ? k : 'p:' + k;
  }

  /**
   * @param schedules eventos aplicables a la pantalla
   * @param defaultContent clave del contenido por defecto ('p:id' / 'l:id')
   * @returns {{keys: string[], playlistIds: string[], scheduleIds: string[], source: 'schedule'|'default'|'none'}}
   */
  function resolve(schedules, defaultContent, now) {
    now = now || new Date();
    const active = (schedules || []).filter((s) => contentKey(s) && isActive(s, now));
    let keys = [];
    let ids = [];
    let source = 'none';
    if (active.length) {
      const top = Math.max(...active.map((s) => Number(s.priority) || 0));
      const winners = active.filter((s) => (Number(s.priority) || 0) === top);
      winners.forEach((s) => {
        const k = contentKey(s);
        if (!keys.includes(k)) keys.push(k);
      });
      ids = winners.map((s) => s.id);
      source = 'schedule';
    } else if (defaultContent) {
      keys = [normalizeKey(defaultContent)];
      source = 'default';
    }
    return { keys, playlistIds: keys.filter((k) => k.startsWith('p:')).map((k) => k.slice(2)), scheduleIds: ids, source };
  }

  return { resolve, isActive, toMinutes, ymd, contentKey, normalizeKey };
});
