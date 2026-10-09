/**
 * Widgets compartidos por el reproductor web y el editor del panel:
 * cintillo de noticias y reloj con fecha. La app Android replica el mismo aspecto.
 */
(function (root) {
  'use strict';

  const FONTS = {
    sans: { family: "system-ui, Roboto, 'Segoe UI', Arial, sans-serif", label: 'Sans (Roboto/Arial)' },
    condensed: { family: "'Roboto Condensed', 'Arial Narrow', 'Liberation Sans Narrow', sans-serif", label: 'Condensada' },
    light: { family: "system-ui, Roboto, 'Segoe UI', Arial, sans-serif", weight: 300, label: 'Fina' },
    black: { family: "system-ui, Roboto, 'Segoe UI', Arial, sans-serif", weight: 900, label: 'Extra gruesa' },
    serif: { family: "Georgia, 'Noto Serif', 'Times New Roman', serif", label: 'Con serifa (Georgia)' },
    mono: { family: "'Roboto Mono', Consolas, 'Courier New', monospace", label: 'Monoespaciada' },
    casual: { family: "'Comic Sans MS', 'Comic Neue', casual, cursive", label: 'Informal' },
    cursive: { family: "'Brush Script MT', 'Dancing Script', cursive", label: 'Manuscrita' },
  };

  function applyFont(el, font, bold) {
    const f = FONTS[font] || FONTS.sans;
    el.style.fontFamily = f.family;
    el.style.fontWeight = f.weight || (bold ? 700 : 400);
  }

  function rgba(hex, opacity) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    const a = Math.max(0, Math.min(100, opacity === undefined ? 100 : Number(opacity))) / 100;
    if (!m) return `rgba(0,0,0,${a})`;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  /**
   * Cintillo en movimiento.
   * @param fill true = ocupa todo el contenedor (zona de un layout); false = barra arriba/abajo
   * @param unit unidad de tamaño ('vh' en pantalla, 'cqh' o px en el editor)
   */
  function makeTicker(container, t, fill, unit = 'vh') {
    const box = document.createElement('div');
    box.className = 'ticker';
    const size = Number(t.size) || 4.4;
    box.style.background = rgba(t.bg, t.opacity);
    box.style.color = t.color || '#fff';
    if (fill) {
      box.style.top = '0';
      box.style.bottom = '0';
    } else {
      box.style.height = size * 1.8 + unit;
      box.style[t.position === 'top' ? 'top' : 'bottom'] = '0';
    }
    const track = document.createElement('div');
    track.className = 'ticker-track';
    track.style.fontSize = size + unit;
    applyFont(track, t.font, t.bold !== false);
    track.textContent = `${t.text}     •     `.repeat(3);
    box.append(track);
    container.append(box);
    requestAnimationFrame(() => {
      const dist = track.scrollWidth;
      track.style.animation = `ticker ${Math.max(5, dist / (t.speed || 80))}s linear infinite`;
    });
    return { el: box, stop: () => box.remove() };
  }

  const pad = (n) => String(n).padStart(2, '0');
  function formatTime(d, c) {
    let h = d.getHours();
    let suffix = '';
    if (c.format === '12') {
      suffix = h < 12 ? ' a. m.' : ' p. m.';
      h = h % 12 || 12;
    }
    return `${c.format === '12' ? h : pad(h)}:${pad(d.getMinutes())}${c.seconds ? ':' + pad(d.getSeconds()) : ''}${suffix}`;
  }
  function formatDate(d) {
    const s = d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /** Reloj con fecha. */
  function makeClock(container, c, now = () => new Date(), unit = 'vh') {
    const box = document.createElement('div');
    box.className = 'clock';
    box.style.background = rgba(c.bg, c.opacity);
    box.style.color = c.color || '#fff';
    box.style.textAlign = c.align || 'center';
    applyFont(box, c.font, true);
    const time = document.createElement('div');
    time.className = 'time';
    time.style.fontSize = (Number(c.size) || 8) + unit;
    const date = document.createElement('div');
    date.className = 'date';
    date.style.fontSize = (Number(c.size) || 8) * 0.38 + unit;
    box.append(time);
    if (c.date !== false) box.append(date);
    container.append(box);
    const tick = () => {
      const d = now();
      time.textContent = formatTime(d, c);
      date.textContent = formatDate(d);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return { el: box, stop: () => (clearInterval(timer), box.remove()) };
  }

  root.PCWidgets = { FONTS, applyFont, rgba, makeTicker, makeClock, formatTime, formatDate };
})(typeof self !== 'undefined' ? self : this);
