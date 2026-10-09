/* PubliCast CMS — panel de administración (JavaScript sin dependencias) */
'use strict';

// ---------------------------------------------------------------- utilidades
const $ = (sel, root = document) => root.querySelector(sel);

/** Crea elementos del DOM de forma segura (el texto nunca se interpreta como HTML). */
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === false) return;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'selected' || k === 'disabled' || k === 'muted') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  });
  children.flat(Infinity).forEach((c) => {
    if (c === null || c === undefined || c === false) return;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  });
  return el;
}

/** Sustituye el contenido de un elemento ignorando los hijos vacíos (null/false). */
function mount(el, ...children) {
  el.replaceChildren(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
}

async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && url !== '/api/login') {
    showLogin();
    throw new Error('Sesión expirada');
  }
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

function toast(msg, isError) {
  const t = h('div', { class: 'toast' + (isError ? ' err' : '') }, msg);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), isError ? 6000 : 3000);
}

async function guard(fn) {
  try {
    return await fn();
  } catch (e) {
    toast(e.message, true);
  }
}

function modal(content, { wide } = {}) {
  const card = $('#modal-card');
  card.className = 'modal-card' + (wide ? ' wide' : '');
  mount(card, content);
  $('#modal').classList.remove('hidden');
}
function closeModal() {
  $('#modal').classList.add('hidden');
  mount($('#modal-card'));
}
$('#modal').addEventListener('mousedown', (e) => {
  if (e.target.id === 'modal') closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

function confirmBox(text) {
  return new Promise((resolve) => {
    const done = (v) => {
      closeModal();
      resolve(v);
    };
    modal(
      h(
        'div',
        null,
        h('h2', null, 'Confirmar'),
        h('p', null, text),
        h(
          'div',
          { class: 'modal-foot' },
          h('button', { class: 'btn', onclick: () => done(false) }, 'Cancelar'),
          h('button', { class: 'btn primary', onclick: () => done(true) }, 'Aceptar')
        )
      )
    );
  });
}

const fmtBytes = (b) => {
  if (!b) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  return (b / 1024 ** i).toFixed(i ? 1 : 0) + ' ' + u[i];
};
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('es') : '—');
const fmtDur = (s) => {
  s = Math.round(s || 0);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  return hh ? `${hh} h ${mm} min` : mm ? `${mm} min ${s % 60} s` : `${s} s`;
};
const ago = (iso) => {
  if (!iso) return 'nunca';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return `hace ${Math.max(s, 0)} s`;
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
};
const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const TYPE_LABEL = { image: 'Imagen', video: 'Video', web: 'Página web', text: 'Texto', html: 'HTML local' };
const TYPE_ICON = { image: '🖼️', video: '🎬', web: '🌐', text: '🔤', html: '📄' };

function field(label, input, hint) {
  return h('label', null, label, input, hint ? h('small', { class: 'muted' }, hint) : null);
}
function formData(form) {
  const out = {};
  new FormData(form).forEach((v, k) => (out[k] = v));
  return out;
}
function playlistOptions(playlists, selected, emptyLabel = '— Ninguna —') {
  return [h('option', { value: '' }, emptyLabel), ...playlists.map((p) => h('option', { value: p.id, selected: p.id === selected }, p.name))];
}

/** Catálogo de contenidos que se pueden asignar: listas y layouts. */
async function loadCatalog() {
  const [playlists, layouts, media, groups] = await Promise.all([api('GET', '/api/playlists'), api('GET', '/api/layouts'), api('GET', '/api/media'), api('GET', '/api/groups')]);
  return { playlists, layouts, media, groups, byId: new Map(media.map((m) => [m.id, m])) };
}

/** <option> para elegir una lista ('p:id') o un layout ('l:id'). */
function contentOptions(cat, selected, emptyLabel = '— Ninguno —') {
  return [
    emptyLabel === null ? null : h('option', { value: '' }, emptyLabel),
    cat.playlists.length ? h('optgroup', { label: 'Listas de reproducción' }, cat.playlists.map((p) => h('option', { value: 'p:' + p.id, selected: 'p:' + p.id === selected }, p.name))) : null,
    cat.layouts.length ? h('optgroup', { label: 'Layouts (pantalla dividida)' }, cat.layouts.map((l) => h('option', { value: 'l:' + l.id, selected: 'l:' + l.id === selected }, '🧩 ' + l.name))) : null,
  ];
}

function contentRecord(key, cat) {
  if (!key) return null;
  if (key.startsWith('p:')) return cat.playlists.find((p) => p.id === key.slice(2)) || null;
  if (key.startsWith('l:')) return cat.layouts.find((l) => l.id === key.slice(2)) || null;
  return null;
}
function contentLabel(key, cat) {
  const r = contentRecord(key, cat);
  if (!r) return key ? '(eliminado)' : '—';
  return (key.startsWith('l:') ? '🧩 ' : '') + r.name;
}

/** Miniatura de una lista (su primer contenido visual) o de un layout (sus zonas dibujadas). */
function playlistThumb(p, cat, cls = 'cthumb') {
  const m = p && p.items.map((i) => cat.byId.get(i.mediaId)).find((x) => x && (x.type === 'image' || x.type === 'video' || x.type === 'text'))
    || (p && cat.byId.get(p.items[0]?.mediaId));
  const el = h('div', { class: cls, style: { background: p?.background || '#000' } });
  if (!m) el.append(h('span', null, '🎞️'));
  else if (m.type === 'image') el.append(h('img', { src: m.url, loading: 'lazy', alt: '' }));
  else if (m.type === 'video') el.append(h('video', { src: m.url + '#t=1', muted: true, preload: 'metadata' }));
  else if (m.type === 'text') el.append(h('div', { class: 'ttext', style: { background: m.text?.bg, color: m.text?.accent } }, m.text?.title || 'Aa'));
  else el.append(h('span', null, TYPE_ICON[m.type] || '❔'));
  return el;
}
function contentThumb(key, cat) {
  const r = contentRecord(key, cat);
  if (!r) return h('div', { class: 'cthumb' }, h('span', null, '—'));
  if (key.startsWith('p:')) return playlistThumb(r, cat);
  const box = h('div', { class: 'cthumb layout' + (r.orientation === 'portrait' ? ' portrait' : ''), style: { background: r.background } });
  r.regions
    .slice()
    .sort((a, b) => a.z - b.z)
    .forEach((reg) => {
      const cell = h('div', { class: 'creg', style: { left: reg.x + '%', top: reg.y + '%', width: reg.w + '%', height: reg.h + '%' } });
      if (reg.type === 'playlist') cell.append(playlistThumb(cat.playlists.find((p) => p.id === reg.playlistId), cat, 'cfill'));
      else cell.append(h('div', { class: 'cfill widget', style: { background: PCWidgets.rgba((reg.ticker || reg.clock)?.bg, Math.max(40, (reg.ticker || reg.clock)?.opacity ?? 100)) } }, reg.type === 'clock' ? '🕒' : '📰'));
      box.append(cell);
    });
  return box;
}

function previewContent(key, title, portrait) {
  modal(
    h(
      'div',
      null,
      h('h2', null, 'Vista previa: ' + title),
      h('iframe', { class: 'preview-frame' + (portrait ? ' portrait' : ''), src: '/player/?preview=' + encodeURIComponent(key) }),
      h('div', { class: 'modal-foot' }, h('button', { class: 'btn', onclick: closeModal }, 'Cerrar'))
    ),
    { wide: true }
  );
}

function thumbFor(m, cls = 'thumb') {
  if (m.type === 'image') return h('div', { class: cls }, h('img', { src: m.url, loading: 'lazy', alt: '' }), cls === 'thumb' ? h('span', { class: 'type' }, 'Imagen') : null);
  if (m.type === 'video')
    return h('div', { class: cls }, h('video', { src: m.url + '#t=1', muted: true, preload: 'metadata' }), cls === 'thumb' ? h('span', { class: 'type' }, 'Video') : null);
  if (m.type === 'text' && cls === 'thumb')
    return h(
      'div',
      { class: 'thumb text', style: { background: m.text?.bg, color: m.text?.color } },
      h('div', null, h('b', { style: { color: m.text?.accent } }, m.text?.title || ''), h('div', null, (m.text?.body || '').slice(0, 80))),
      h('span', { class: 'type' }, 'Texto')
    );
  if (m.type === 'html' && cls === 'thumb')
    return h('div', { class: 'thumb html' }, h('iframe', { src: m.url, loading: 'lazy', tabindex: '-1', sandbox: 'allow-scripts', title: m.name }), h('span', { class: 'type' }, 'HTML'));
  return h('div', { class: cls }, TYPE_ICON[m.type] || '❔', cls === 'thumb' ? h('span', { class: 'type' }, TYPE_LABEL[m.type]) : null);
}

// ---------------------------------------------------------------- tema claro / oscuro
function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  try {
    localStorage.setItem('publicast.theme', t);
  } catch {}
  document.querySelectorAll('[data-theme-opt]').forEach((b) => b.classList.toggle('on', b.dataset.themeOpt === t));
}
document.querySelectorAll('[data-theme-opt]').forEach((b) => b.addEventListener('click', () => applyTheme(b.dataset.themeOpt)));
try {
  applyTheme(localStorage.getItem('publicast.theme') || 'auto');
} catch {
  applyTheme('auto');
}

// ---------------------------------------------------------------- sesión / router
let refreshTimer = null;

function showLogin() {
  clearInterval(refreshTimer);
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#login-error').textContent = '';
  try {
    const me = await api('POST', '/api/login', formData(e.target));
    startApp(me);
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
});

$('#logout').addEventListener('click', async () => {
  await api('POST', '/api/logout').catch(() => {});
  showLogin();
});

function startApp(me) {
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#whoami').textContent = '👤 ' + me.username;
  if (me.defaultPassword) setTimeout(() => toast('⚠️ Está usando la contraseña por defecto. Cámbiela en Ajustes.', true), 600);
  route();
}

const pages = {};
function route() {
  clearInterval(refreshTimer);
  const name = (location.hash.replace(/^#\//, '') || 'panel').split('/')[0];
  const page = pages[name] ? name : 'panel';
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.page === page));
  const main = $('#main');
  mount(main, h('p', { class: 'muted' }, 'Cargando…'));
  guard(() => pages[page](main));
}
window.addEventListener('hashchange', route);

function pageHead(title, subtitle, ...actions) {
  return h('div', { class: 'page-head' }, h('div', null, h('h1', null, title), subtitle ? h('div', { class: 'muted' }, subtitle) : null), h('div', { class: 'actions' }, actions));
}

// ---------------------------------------------------------------- Panel
pages.panel = async (main) => {
  const render = async () => {
    const [d, cat] = await Promise.all([api('GET', '/api/dashboard'), loadCatalog()]);
    const c = d.counts;
    mount(main, 
      pageHead('Panel', 'Resumen de su red de pantallas', h('a', { class: 'btn', href: '#/anuncio' }, '📢 Anuncio inmediato'), h('a', { class: 'btn primary', href: '#/pantallas' }, '+ Agregar pantalla')),
      h(
        'div',
        { class: 'kpis' },
        kpi(`${c.online}/${c.displays - c.pending}`, 'Pantallas en línea'),
        kpi(c.pending, 'Pendientes de autorizar'),
        kpi(c.media, 'Contenidos'),
        kpi(c.playlists, 'Listas'),
        kpi(c.layouts, 'Layouts'),
        kpi(c.walls, 'Videowalls'),
        kpi(c.schedules, 'Eventos programados'),
        kpi(c.plays24h, 'Reproducciones (24 h)'),
        kpi(fmtBytes(c.storage), 'Almacenamiento')
      ),
      h('div', { class: 'card' }, h('h2', null, 'Estado de las pantallas'), displaysTable(d.displays, true, null, cat)),
      !c.displays
        ? h(
            'div',
            { class: 'card' },
            h('h2', null, 'Primeros pasos'),
            h(
              'ol',
              null,
              h('li', null, 'Suba imágenes o videos en ', h('a', { href: '#/biblioteca' }, 'Biblioteca'), '.'),
              h('li', null, 'Cree una ', h('a', { href: '#/listas' }, 'lista de reproducción'), ' con esos contenidos.'),
              h('li', null, 'Instale la app PubliCast Player en el dispositivo Android e indique la dirección de este servidor: ', h('code', null, location.origin)),
              h('li', null, 'Introduzca en ', h('a', { href: '#/pantallas' }, 'Pantallas'), ' el código de 6 dígitos que aparece en el dispositivo.'),
              h('li', null, 'Opcional: programe horarios en ', h('a', { href: '#/programacion' }, 'Programación'), '.')
            ),
            h('p', null, 'Consulte la guía completa en ', h('a', { href: '#/ayuda' }, '❓ Cómo usar'), '.')
          )
        : null
    );
  };
  await render();
  refreshTimer = setInterval(() => render().catch(() => {}), 10000);
};
const kpi = (value, label) => h('div', { class: 'kpi' }, h('b', null, value), h('span', null, label));

function statusBadge(d) {
  if (!d.authorized) return h('span', { class: 'badge warn' }, `Pendiente · ${d.code}`);
  return d.online ? h('span', null, h('span', { class: 'dot ok' }), 'En línea') : h('span', { class: 'muted' }, h('span', { class: 'dot' }), 'Desconectada');
}

/** Miniatura de una pantalla: su última captura real o, si no hay, el contenido que debería mostrar. */
function displayThumb(d, cat) {
  const box = h('div', { class: 'dthumb', title: 'Vista previa', onclick: () => cat && displayPreview(d, cat) });
  if (d.hasScreenshot) box.append(h('img', { src: `/api/displays/${d.id}/screenshot?t=${encodeURIComponent(d.screenshotAt || '')}`, alt: '', loading: 'lazy' }));
  else if (cat && d.nowKeys?.[0]) box.append(contentThumb(d.nowKeys[0], cat));
  else box.append(h('span', null, '🖥️'));
  if (d.hasScreenshot) box.append(h('span', { class: 'dthumb-tag' }, '📸 ' + ago(d.screenshotAt)));
  return box;
}

/** Vista previa de una pantalla: captura real del dispositivo y simulación en vivo de su contenido. */
function displayPreview(d, cat) {
  const shot = h('div', { class: 'shot' });
  const info = h('div', { class: 'muted' });
  let last = d.screenshotAt;
  const drawShot = (at) => {
    mount(shot, at ? h('img', { src: `/api/displays/${d.id}/screenshot?t=${Date.now()}`, alt: 'Captura de la pantalla' }) : h('div', { class: 'empty' }, 'Todavía no hay captura. Pulse "Capturar ahora" (requiere la app Android 1.3 o superior).'));
    info.textContent = at ? 'Captura ' + ago(at) + ' · ' + fmtDate(at) : '';
  };
  const capture = () =>
    guard(async () => {
      const r = await api('POST', `/api/displays/${d.id}/command`, { type: 'screenshot' });
      if (!r.delivered) return toast('La pantalla no está conectada en este momento', true);
      info.textContent = 'Solicitando captura…';
      for (let i = 0; i < 15; i++) {
        await new Promise((res) => setTimeout(res, 1000));
        const fresh = (await api('GET', '/api/displays')).find((x) => x.id === d.id);
        if (fresh?.screenshotAt && fresh.screenshotAt !== last) {
          last = fresh.screenshotAt;
          return drawShot(last);
        }
      }
      info.textContent = 'La pantalla no envió la captura (actualice la app a la versión 1.3).';
    });
  const key = d.nowKeys?.[0];
  const portrait = contentRecord(key, cat)?.orientation === 'portrait';
  modal(
    h(
      'div',
      null,
      h('h2', null, `Vista previa: ${d.number ? '#' + d.number + ' ' : ''}${d.name}`),
      h('div', { class: 'muted', style: { marginBottom: '12px' } }, d.nowPlaying?.length ? 'Reproduciendo: ' + d.nowPlaying.join(', ') : 'Sin contenido asignado'),
      h(
        'div',
        { class: 'preview-pair' },
        h('div', null, h('h3', null, '📸 Lo que muestra la pantalla (captura real)'), shot, h('div', { class: 'actions', style: { marginTop: '8px' } }, h('button', { class: 'btn small primary', onclick: capture }, '📸 Capturar ahora'), info)),
        h('div', null, h('h3', null, '▶ Simulación en vivo del contenido'), key ? h('iframe', { class: 'preview-frame' + (portrait ? ' portrait' : ''), src: '/player/?preview=' + encodeURIComponent(key) }) : h('div', { class: 'empty' }, 'Sin contenido'))
      ),
      h('div', { class: 'modal-foot' }, h('button', { class: 'btn', onclick: closeModal }, 'Cerrar'))
    ),
    { wide: true }
  );
  drawShot(d.screenshotAt);
}

function displaysTable(list, compact, onEdit, cat) {
  if (!list.length) return h('div', { class: 'empty' }, 'Todavía no hay pantallas. Instale la app en un dispositivo Android para registrarlo.');
  return h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      null,
      h('thead', null, h('tr', null, h('th', null, 'Vista'), h('th', null, 'Pantalla'), h('th', null, 'Estado'), h('th', null, 'Reproduciendo ahora'), h('th', null, 'Última conexión'), compact ? null : h('th', null, 'Dispositivo'), compact ? null : h('th', null, ''))),
      h(
        'tbody',
        null,
        list.map((d) =>
          h(
            'tr',
            null,
            h('td', { class: 'thumb-td' }, displayThumb(d, cat)),
            h(
              'td',
              null,
              h('div', { class: 'dname' }, d.number ? h('span', { class: 'dnum', title: 'Número de pantalla (Identificar)' }, d.number) : null, h('b', null, d.name)),
              d.location ? h('div', { class: 'muted' }, d.location) : null,
              d.group ? h('div', { class: 'muted' }, '🏢 ' + d.group) : null,
              d.wall ? h('div', { class: 'muted' }, `🧱 ${d.wall.name} · fila ${d.wall.row + 1}, col. ${d.wall.col + 1}`) : null
            ),
            h('td', null, statusBadge(d)),
            h(
              'td',
              null,
              d.status?.currentItem ? h('div', null, '▶ ', d.status.currentItem) : null,
              h('div', { class: 'muted' }, d.nowPlaying.length ? d.nowPlaying.join(', ') + (d.nowSource === 'schedule' ? ' (programado)' : ' (por defecto)') : 'Sin contenido asignado')
            ),
            h('td', null, ago(d.lastSeen), d.ip ? h('div', { class: 'muted' }, d.ip) : null),
            compact ? null : h('td', { class: 'muted' }, [d.info?.model, d.info?.resolution, d.info?.appVersion && 'v' + d.info.appVersion].filter(Boolean).join(' · ')),
            compact ? null : h('td', null, onEdit ? onEdit(d) : null)
          )
        )
      )
    )
  );
}

// ---------------------------------------------------------------- Pantallas
let groupFilter = '';
pages.pantallas = async (main) => {
  const render = async () => {
    const [all, cat] = await Promise.all([api('GET', '/api/displays'), loadCatalog()]);
    const pending = all.filter((d) => !d.authorized);
    const displays = all.filter((d) => groupFilter === '' || (groupFilter === '-' ? !d.groupId : d.groupId === groupFilter));
    const filterSel = h(
      'select',
      { style: { width: 'auto' } },
      h('option', { value: '' }, `Todas las sucursales (${all.length})`),
      cat.groups.map((g) => h('option', { value: g.id, selected: groupFilter === g.id }, `🏢 ${g.name} (${all.filter((d) => d.groupId === g.id).length})`)),
      h('option', { value: '-', selected: groupFilter === '-' }, `Sin sucursal (${all.filter((d) => !d.groupId).length})`)
    );
    filterSel.addEventListener('change', () => {
      groupFilter = filterSel.value;
      render();
    });
    mount(main, 
      pageHead(
        'Pantallas',
        'Dispositivos Android que reproducen su contenido',
        h('button', { class: 'btn', title: 'Cada pantalla muestra su número en grande, como en Windows', onclick: identifyAll }, '🔢 Identificar todas'),
        h('a', { class: 'btn', href: '#/videowall' }, '🧱 Videowall')
      ),
      h(
        'div',
        { class: 'grid cols-2' },
        h(
          'div',
          { class: 'card' },
          h('h2', null, 'Autorizar una pantalla nueva'),
          h('p', { class: 'muted' }, 'Abra PubliCast Player en el dispositivo, escriba la dirección del servidor y se mostrará un código de 6 dígitos.'),
          authorizeForm(cat, pending, render)
        ),
        h(
          'div',
          { class: 'card' },
          h('h2', null, 'Conectar un dispositivo'),
          h('p', null, 'Dirección del servidor para la app:'),
          h('p', null, h('code', null, location.origin)),
          h('p', { class: 'muted' }, 'También puede usar cualquier navegador (Smart TV, PC, Raspberry Pi) abriendo ', h('a', { href: '/player/', target: '_blank' }, location.origin + '/player/')),
          h('p', null, h('a', { class: 'btn', href: '/download/publicast-player.apk' }, '⬇️ Descargar APK para Android'))
        )
      ),
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'page-head' }, h('h2', { style: { margin: 0 } }, 'Pantallas'), filterSel),
        displaysTable(displays, false, (d) =>
          h(
            'div',
            { class: 'actions' },
            d.authorized ? h('button', { class: 'btn small', onclick: () => displayPreview(d, cat) }, '👁 Vista previa') : null,
            d.authorized ? h('button', { class: 'btn small', onclick: () => editDisplay(d, cat, render) }, 'Editar') : null,
            d.authorized ? h('button', { class: 'btn small', title: 'Muestra el número y el nombre en la pantalla', onclick: () => command(d, { type: 'identify' }) }, 'Identificar') : null,
            d.authorized ? h('button', { class: 'btn small', onclick: () => command(d, { type: 'reload' }) }, 'Recargar') : null,
            h(
              'button',
              {
                class: 'btn small danger',
                onclick: async () => {
                  if (!(await confirmBox(`¿Eliminar la pantalla "${d.name}"? Deberá volver a emparejarse.`))) return;
                  await guard(() => api('DELETE', '/api/displays/' + d.id));
                  render();
                },
              },
              'Eliminar'
            )
          ),
          cat
        )
      )
    );
  };
  await render();
  refreshTimer = setInterval(() => {
    if ($('#modal').classList.contains('hidden') && !document.activeElement?.closest('form, select')) render().catch(() => {});
  }, 10000);
};

async function identifyAll() {
  await guard(async () => {
    const r = await api('POST', '/api/displays/identify-all', { seconds: 15 });
    toast(`Mostrando el número en ${r.delivered} de ${r.total} pantalla(s)`, !r.delivered);
  });
}

function authorizeForm(cat, pending, after) {
  const form = h(
    'form',
    { class: 'form' },
    field('Código mostrado en la pantalla', h('input', { name: 'code', class: 'code-input', inputmode: 'numeric', maxlength: 6, placeholder: '000000', required: true, autocomplete: 'off' })),
    h('div', { class: 'row' }, field('Nombre', h('input', { name: 'name', placeholder: 'Ej. Vitrina entrada' })), field('Contenido por defecto', h('select', { name: 'defaultContent' }, contentOptions(cat))), field('Sucursal', h('select', { name: 'groupId' }, h('option', { value: '' }, '— Sin sucursal —'), cat.groups.map((g) => h('option', { value: g.id, selected: g.id === groupFilter }, g.name))))),
    h('button', { class: 'btn primary', type: 'submit' }, 'Autorizar pantalla'),
    pending.length ? h('p', { class: 'muted' }, 'Pendientes ahora: ', pending.map((p) => `${p.code} (${p.name})`).join(', ')) : null
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    guard(async () => {
      const d = await api('POST', '/api/displays/authorize', formData(form));
      toast(`Pantalla "${d.name}" autorizada`);
      after();
    });
  });
  return form;
}

async function command(d, payload) {
  await guard(async () => {
    const r = await api('POST', `/api/displays/${d.id}/command`, payload);
    toast(r.delivered ? 'Comando enviado' : 'La pantalla no está conectada en este momento', !r.delivered);
  });
}

function editDisplay(d, cat, after) {
  const form = h(
    'form',
    { class: 'form' },
    h('h2', null, 'Editar pantalla'),
    h('div', { class: 'row' }, field('Nombre', h('input', { name: 'name', value: d.name, required: true })), h('div', { class: 'shrink' }, field('Número', h('input', { name: 'number', type: 'number', min: 1, value: d.number || '', style: { width: '90px' } })))),
    field('Sucursal', h('select', { name: 'groupId' }, h('option', { value: '' }, '— Sin sucursal —'), cat.groups.map((g) => h('option', { value: g.id, selected: g.id === d.groupId }, g.name))), h('a', { href: '#/sucursales', onclick: closeModal }, 'Administrar sucursales')),
    field('Ubicación', h('input', { name: 'location', value: d.location || '', placeholder: 'Ej. Sucursal centro, planta baja' })),
    field('Contenido por defecto', h('select', { name: 'defaultContent' }, contentOptions(cat, d.defaultContent)), d.wall ? 'Esta pantalla forma parte de un videowall: si el videowall tiene contenido, se usa ése.' : 'Se reproduce cuando no hay ningún evento programado activo.'),
    field(
      'Orientación',
      h(
        'select',
        { name: 'orientation' },
        [
          ['auto', 'Automática'],
          ['landscape', 'Horizontal'],
          ['portrait', 'Vertical'],
          ['reverseLandscape', 'Horizontal invertida'],
          ['reversePortrait', 'Vertical invertida'],
        ].map(([v, l]) => h('option', { value: v, selected: (d.orientation || 'auto') === v }, l))
      )
    ),
    field(
      'Rendimiento',
      h(
        'select',
        { name: 'performance' },
        [
          ['auto', 'Automático (recomendado): modo ligero en Fire TV y equipos de menos de 2,5 GB de RAM'],
          ['lite', 'Modo ligero: Fire TV Stick, TV Box económicos'],
          ['high', 'Alta calidad: transiciones completas y GIF animados'],
        ].map(([v, l]) => h('option', { value: v, selected: (d.performance || 'auto') === v }, l))
      ),
      'El modo ligero usa el decodificador de video más eficiente, reduce las animaciones y reproduce video en una sola zona del layout.'
    ),
    h('h3', null, 'Información del dispositivo'),
    h('div', { class: 'muted' }, Object.entries(d.info || {}).map(([k, v]) => h('div', null, `${k}: ${v}`))),
    d.status?.error ? h('p', { class: 'error' }, 'Último error: ' + d.status.error) : null,
    h('div', { class: 'modal-foot' }, h('button', { type: 'button', class: 'btn', onclick: closeModal }, 'Cancelar'), h('button', { class: 'btn primary', type: 'submit' }, 'Guardar'))
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    guard(async () => {
      await api('PUT', '/api/displays/' + d.id, formData(form));
      closeModal();
      toast('Pantalla actualizada');
      after();
    });
  });
  modal(form);
}

// ---------------------------------------------------------------- Biblioteca
let systemInfo = { ffmpeg: false };

pages.biblioteca = async (main) => {
  let filter = 'all';
  systemInfo = await api('GET', '/api/system').catch(() => ({ ffmpeg: false }));
  const grid = h('div', { class: 'media-grid' });
  const load = async () => {
    const media = await api('GET', '/api/media');
    const list = media.filter((m) => filter === 'all' || m.type === filter).reverse();
    clearInterval(refreshTimer);
    if (media.some((m) => m.optimizing)) refreshTimer = setInterval(() => load().catch(() => {}), 5000);
    mount(grid, ...(list.length ? list.map((m) => mediaCard(m, load)) : [h('div', { class: 'empty' }, 'No hay contenidos todavía.')]));
  };

  const fileInput = h('input', { type: 'file', multiple: true, accept: 'image/*,video/*', class: 'hidden' });
  const bar = h('div');
  const progress = h('div', { class: 'progress hidden' }, bar);
  const status = h('div', { class: 'muted' });
  const drop = h('div', { class: 'dropzone', onclick: () => fileInput.click() }, h('div', { style: { fontSize: '28px' } }, '⬆️'), h('b', null, 'Arrastre aquí imágenes o videos'), h('div', null, 'o haga clic para seleccionarlos (JPG, PNG, GIF, WebP, MP4, WebM…)'), progress, status);
  const doUpload = (files) => {
    if (!files.length) return;
    const fd = new FormData();
    [...files].forEach((f) => fd.append('files', f));
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/media/upload');
    progress.classList.remove('hidden');
    status.textContent = `Subiendo ${files.length} archivo(s)…`;
    xhr.upload.onprogress = (e) => e.lengthComputable && (bar.style.width = (e.loaded / e.total) * 100 + '%');
    xhr.onload = () => {
      progress.classList.add('hidden');
      bar.style.width = 0;
      let data = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status === 200) {
        status.textContent = '';
        toast(`${data.length} archivo(s) subido(s)`);
        load();
      } else {
        status.textContent = '';
        toast(data.error || 'Error al subir', true);
      }
    };
    xhr.onerror = () => toast('Error de red al subir', true);
    xhr.send(fd);
  };
  fileInput.addEventListener('change', () => doUpload(fileInput.files));
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    doUpload(e.dataTransfer.files);
  });

  const filters = h(
    'div',
    { class: 'actions' },
    [
      ['all', 'Todos'],
      ['image', 'Imágenes'],
      ['video', 'Videos'],
      ['web', 'Web'],
      ['html', 'HTML'],
      ['text', 'Texto'],
    ].map(([v, l]) =>
      h(
        'button',
        {
          class: 'btn small' + (v === filter ? ' primary' : ''),
          onclick: (e) => {
            filter = v;
            filters.querySelectorAll('button').forEach((b) => b.classList.remove('primary'));
            e.target.classList.add('primary');
            load();
          },
        },
        l
      )
    )
  );

  mount(main, 
    pageHead(
      'Biblioteca',
      'Imágenes, videos, páginas web, HTML locales y mensajes de texto',
      h('button', { class: 'btn', onclick: () => htmlDialog(load) }, '📄 HTML local'),
      h('button', { class: 'btn', onclick: () => widgetEditor('web', null, load) }, '🌐 Página web'),
      h('button', { class: 'btn', onclick: () => widgetEditor('text', null, load) }, '🔤 Mensaje de texto')
    ),
    h('div', { class: 'card' }, drop, fileInput),
    h('div', { class: 'page-head' }, filters),
    grid
  );
  await load();
};

async function importHtmlPath(p, name, reload) {
  await guard(async () => {
    const r = await api('POST', '/api/media/html-path', { path: p, name });
    toast(`HTML importado (${r.files.length} archivo/s)` + (r.missing?.length ? ` · no se encontraron: ${r.missing.join(', ')}` : ''), !!r.missing?.length);
    reload();
  });
}

/** Sube un HTML suelto, una carpeta completa (con imágenes, CSS y JS) o importa una ruta del servidor. */
function htmlDialog(reload) {
  const fileIn = h('input', { type: 'file', accept: '.html,.htm', multiple: true, class: 'hidden' });
  const dirIn = h('input', { type: 'file', class: 'hidden', webkitdirectory: true, multiple: true });
  const pathIn = h('input', { placeholder: 'file:///C:/Users/SOPORTE/Documents/Proyectos/Publicast/SR-Digital-Pro-Futurista.html' });
  const nameIn = h('input', { placeholder: 'Nombre (opcional)' });
  const status = h('div', { class: 'muted' });
  const send = (files) => {
    if (!files.length) return;
    const fd = new FormData();
    if (nameIn.value) fd.append('name', nameIn.value);
    // El nombre incluye la ruta relativa dentro de la carpeta, para conservar img/, css/…
    [...files].forEach((f) => fd.append('files', f, f.webkitRelativePath || f.name));
    status.textContent = `Subiendo ${files.length} archivo(s)…`;
    fetch('/api/media/html', { method: 'POST', body: fd })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || 'Error al subir');
        closeModal();
        toast(`HTML "${data.name}" añadido (${data.files.length} archivo/s)`);
        reload();
      })
      .catch((e) => {
        status.textContent = '';
        toast(e.message, true);
      });
  };
  fileIn.addEventListener('change', () => send(fileIn.files));
  dirIn.addEventListener('change', () => send(dirIn.files));
  modal(
    h(
      'div',
      { class: 'form' },
      h('h2', null, '📄 Añadir HTML local'),
      h('p', { class: 'muted' }, 'Páginas HTML diseñadas por usted (menús, carteles animados, tableros…). Se guardan en el servidor y las pantallas las descargan para mostrarlas aunque no haya Internet.'),
      field('Nombre', nameIn),
      h(
        'div',
        { class: 'grid cols-2' },
        h('div', { class: 'card' }, h('h3', { style: { marginTop: 0 } }, 'Un archivo .html'), h('p', { class: 'muted' }, 'Si el HTML no usa imágenes ni archivos aparte.'), h('button', { class: 'btn primary', onclick: () => fileIn.click() }, '📄 Elegir archivo'), fileIn),
        h('div', { class: 'card' }, h('h3', { style: { marginTop: 0 } }, 'Una carpeta completa'), h('p', { class: 'muted' }, 'Incluye las imágenes, CSS y JS de la carpeta. Se abre su index.html (o el primer .html).'), h('button', { class: 'btn primary', onclick: () => dirIn.click() }, '📁 Elegir carpeta'), dirIn)
      ),
      h(
        'div',
        { class: 'card' },
        h('h3', { style: { marginTop: 0 } }, 'Ruta en el equipo del servidor'),
        h('p', { class: 'muted' }, 'Pegue una ruta como file:///C:/Users/…/pagina.html o C:\\Users\\…\\pagina.html. Debe existir en el equipo donde corre el servidor; se copian también las imágenes, estilos y scripts que use de su carpeta.'),
        h('div', { class: 'row' }, pathIn, h('button', { class: 'btn primary shrink', onclick: () => pathIn.value.trim() && (closeModal(), importHtmlPath(pathIn.value.trim(), nameIn.value, reload)) }, 'Importar'))
      ),
      status,
      h('div', { class: 'modal-foot' }, h('button', { class: 'btn', onclick: closeModal }, 'Cerrar'))
    ),
    { wide: true }
  );
}

function mediaCard(m, reload) {
  const thumb = thumbFor(m);
  // Guarda la duración real del video (necesaria para sincronizar videowalls)
  const v = thumb.querySelector('video');
  if (v && (!m.naturalDuration || !m.width))
    v.addEventListener('loadedmetadata', () => {
      const meta = { width: v.videoWidth, height: v.videoHeight };
      if (Number.isFinite(v.duration) && v.duration > 0) meta.naturalDuration = Math.round(v.duration);
      api('PUT', '/api/media/' + m.id, meta).catch(() => {});
    });
  // Avisos para equipos modestos (Fire TV Stick, TV Box): 4K y formatos que no se decodifican por hardware
  const ext = (m.file || '').split('.').pop().toLowerCase();
  const warnings = [];
  if (m.type === 'video' && !m.optimized) {
    if (m.width > 1920 || m.height > 1920) warnings.push(`Resolución ${m.width}×${m.height}: puede trabarse en Fire TV Stick y TV Box`);
    if (['webm', 'mkv', 'mov', 'ts', '3gp'].includes(ext)) warnings.push(`Formato .${ext}: use MP4 (H.264) para reproducir con fluidez`);
    if (m.size > 300 * 1048576) warnings.push('Archivo muy grande: tardará en descargarse en las pantallas');
  }
  if (m.type === 'image' && m.size > 8 * 1048576) warnings.push('Imagen muy pesada: redúzcala a 1920×1080');
  const dur = h('input', { type: 'number', min: 0, value: m.duration, style: { width: '80px' }, title: m.type === 'video' ? '0 = duración completa del video' : 'Segundos en pantalla' });
  dur.addEventListener('change', () => guard(() => api('PUT', '/api/media/' + m.id, { duration: dur.value }).then(() => toast('Duración guardada'))));
  return h(
    'div',
    { class: 'media-card' },
    thumb,
    h(
      'div',
      { class: 'meta' },
      h('div', { class: 'name', title: m.name }, m.name),
      m.naturalDuration ? h('div', { class: 'muted' }, 'Duración del video: ' + fmtDur(m.naturalDuration) + (m.width ? ` · ${m.width}×${m.height}` : '')) : null,
      m.optimized ? h('span', { class: 'badge ok' }, '⚡ Optimizado para TV') : null,
      m.optimizing ? h('span', { class: 'badge blue' }, '⏳ Optimizando… (puede tardar varios minutos)') : null,
      m.optimizeError ? h('div', { class: 'error small' }, 'No se pudo optimizar: ' + m.optimizeError) : null,
      warnings.map((w) => h('div', { class: 'warn-line' }, '⚠️ ' + w)),
      h('div', { class: 'muted' }, [TYPE_LABEL[m.type], m.size ? fmtBytes(m.size) : m.url, m.usedIn ? `en ${m.usedIn} lista(s)` : 'sin usar'].filter(Boolean).join(' · ')),
      h('div', { class: 'row' }, h('label', { class: 'shrink' }, 'Duración (s)', dur)),
      h(
        'div',
        { class: 'actions' },
        m.type === 'image' || m.type === 'video' || m.type === 'html' ? h('a', { class: 'btn small', href: m.url, target: '_blank' }, 'Ver') : null,
        m.type === 'video' && !m.optimizing && !m.optimized
          ? h(
              'button',
              {
                class: 'btn small' + (warnings.length ? ' primary' : ''),
                title: systemInfo.ffmpeg ? 'Convierte a MP4 H.264 1080p, el formato más fluido en Fire TV y TV Box' : 'Requiere ffmpeg instalado en el servidor',
                onclick: () =>
                  guard(async () => {
                    await api('POST', `/api/media/${m.id}/optimize`);
                    toast('Optimizando el video. Las pantallas recibirán la versión optimizada al terminar.');
                    reload();
                  }),
              },
              '⚡ Optimizar para TV'
            )
          : null,
        h(
          'button',
          {
            class: 'btn small',
            onclick: () => (m.type === 'web' || m.type === 'text' ? widgetEditor(m.type, m, reload) : renameMedia(m, reload)),
          },
          m.type === 'web' || m.type === 'text' ? 'Editar' : 'Renombrar'
        ),
        h(
          'button',
          {
            class: 'btn small danger',
            onclick: async () => {
              if (!(await confirmBox(`¿Eliminar "${m.name}"?${m.usedIn ? ' También se quitará de ' + m.usedIn + ' lista(s).' : ''}`))) return;
              await guard(() => api('DELETE', '/api/media/' + m.id));
              reload();
            },
          },
          'Eliminar'
        )
      )
    )
  );
}

function renameMedia(m, reload) {
  const form = h('form', { class: 'form' }, h('h2', null, 'Renombrar'), field('Nombre', h('input', { name: 'name', value: m.name, required: true })), h('div', { class: 'modal-foot' }, h('button', { type: 'button', class: 'btn', onclick: closeModal }, 'Cancelar'), h('button', { class: 'btn primary' }, 'Guardar')));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    guard(async () => {
      await api('PUT', '/api/media/' + m.id, formData(form));
      closeModal();
      reload();
    });
  });
  modal(form);
}

function widgetEditor(type, m, reload) {
  const t = m?.text || {};
  const preview = h('div', { class: 'thumb text', style: { borderRadius: '8px', aspectRatio: '16/9' } });
  const form = h(
    'form',
    { class: 'form' },
    h('h2', null, (m ? 'Editar ' : 'Nuevo ') + (type === 'web' ? 'contenido web' : 'mensaje de texto')),
    field('Nombre', h('input', { name: 'name', value: m?.name || '', placeholder: 'Nombre interno' })),
    type === 'web'
      ? field('Dirección (URL)', h('input', { name: 'url', type: 'text', value: m?.url || '', placeholder: 'https://…', required: true }), 'Se muestra a pantalla completa. Algunas webs bloquean ser mostradas dentro de otras páginas en el reproductor web; en la app Android funcionan todas.')
      : [
          field('Título', h('input', { name: 'title', value: t.title || '', placeholder: '¡Oferta del día!' })),
          field('Texto', h('textarea', { name: 'body', placeholder: '2x1 en todos los cafés de 8 a 10 h' }, t.body || '')),
          h(
            'div',
            { class: 'row' },
            field('Fondo', h('input', { type: 'color', name: 'bg', value: t.bg || '#0f172a' })),
            field('Texto', h('input', { type: 'color', name: 'color', value: t.color || '#ffffff' })),
            field('Título', h('input', { type: 'color', name: 'accent', value: t.accent || '#f59e0b' })),
            field('Alineación', h('select', { name: 'align' }, [['center', 'Centro'], ['left', 'Izquierda'], ['right', 'Derecha']].map(([v, l]) => h('option', { value: v, selected: (t.align || 'center') === v }, l))))
          ),
          h('div', null, h('b', null, 'Vista previa'), preview),
        ],
    field('Duración en pantalla (segundos)', h('input', { name: 'duration', type: 'number', min: 1, value: m?.duration || 15 })),
    h('div', { class: 'modal-foot' }, h('button', { type: 'button', class: 'btn', onclick: closeModal }, 'Cancelar'), h('button', { class: 'btn primary' }, 'Guardar'))
  );
  const updatePreview = () => {
    if (type !== 'text') return;
    const v = formData(form);
    Object.assign(preview.style, { background: v.bg, color: v.color, textAlign: v.align });
    mount(preview, h('div', null, h('div', { style: { color: v.accent, fontWeight: 800, fontSize: '22px' } }, v.title), h('div', { style: { whiteSpace: 'pre-wrap' } }, v.body)));
  };
  form.addEventListener('input', updatePreview);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = formData(form);
    const body = { type, name: v.name, duration: v.duration, url: v.url, text: { title: v.title, body: v.body, bg: v.bg, color: v.color, accent: v.accent, align: v.align } };
    // Una ruta local (file:///C:/… o C:\…) se importa al servidor como contenido HTML
    if (type === 'web' && !m && /^(file:|[a-z]:[\\/]|\/)/i.test(v.url || '')) {
      closeModal();
      return importHtmlPath(v.url, v.name, reload);
    }
    guard(async () => {
      if (m) await api('PUT', '/api/media/' + m.id, body);
      else await api('POST', '/api/media/widget', body);
      closeModal();
      toast('Guardado');
      reload();
    });
  });
  modal(form);
  updatePreview();
}

// ---------------------------------------------------------------- Listas
pages.listas = async (main) => {
  const [playlists, media, displays, schedules] = await Promise.all([api('GET', '/api/playlists'), api('GET', '/api/media'), api('GET', '/api/displays'), api('GET', '/api/schedules')]);
  const byId = new Map(media.map((m) => [m.id, m]));
  const id = location.hash.split('/')[2];
  if (id) {
    const p = id === 'nueva' ? null : playlists.find((x) => x.id === id);
    return playlistEditor(main, p, media, byId);
  }
  const totalDur = (p) => p.items.reduce((t, i) => t + Number(i.duration ?? byId.get(i.mediaId)?.duration ?? 0), 0);
  mount(main, 
    pageHead('Listas de reproducción', 'Secuencias de contenidos que se muestran en las pantallas', h('a', { class: 'btn primary', href: '#/listas/nueva' }, '+ Nueva lista')),
    h(
      'div',
      { class: 'card' },
      playlists.length
        ? h(
            'div',
            { class: 'table-wrap' },
            h(
              'table',
              null,
              h('thead', null, h('tr', null, h('th', null, 'Nombre'), h('th', null, 'Contenidos'), h('th', null, 'Duración del ciclo'), h('th', null, 'Uso'), h('th', null, 'Modificada'), h('th', null, ''))),
              h(
                'tbody',
                null,
                playlists.map((p) =>
                  h(
                    'tr',
                    null,
                    h('td', null, h('a', { href: '#/listas/' + p.id }, h('b', null, p.name)), p.ticker?.enabled ? h('span', { class: 'badge blue', style: { marginLeft: '8px' } }, 'cintillo') : null),
                    h('td', null, p.items.length),
                    h('td', null, fmtDur(totalDur(p)), p.items.some((i) => byId.get(i.mediaId)?.type === 'video' && !Number(i.duration ?? byId.get(i.mediaId)?.duration)) ? ' + videos' : ''),
                    h('td', { class: 'muted' }, `${displays.filter((d) => d.defaultContent === 'p:' + p.id).length} pantalla(s) · ${schedules.filter((s) => PCSchedule.contentKey(s) === 'p:' + p.id).length} evento(s)`),
                    h('td', { class: 'muted' }, fmtDate(p.updatedAt)),
                    h(
                      'td',
                      null,
                      h(
                        'div',
                        { class: 'actions' },
                        h('a', { class: 'btn small', href: '#/listas/' + p.id }, 'Editar'),
                        h('button', { class: 'btn small', onclick: () => previewPlaylist(p) }, 'Vista previa'),
                        h(
                          'button',
                          {
                            class: 'btn small danger',
                            onclick: async () => {
                              if (!(await confirmBox(`¿Eliminar la lista "${p.name}"? También se eliminarán sus eventos programados.`))) return;
                              await guard(() => api('DELETE', '/api/playlists/' + p.id));
                              route();
                            },
                          },
                          'Eliminar'
                        )
                      )
                    )
                  )
                )
              )
            )
          )
        : h('div', { class: 'empty' }, 'Aún no hay listas. Cree una y añada contenidos de la biblioteca.')
    )
  );
};

function previewPlaylist(p) {
  previewContent('p:' + p.id, p.name);
}

function playlistEditor(main, p, media, byId) {
  const state = {
    name: p?.name || '',
    transition: p?.transition || 'fade',
    transitionDuration: p?.transitionDuration || 800,
    fit: p?.fit || 'contain',
    background: p?.background || '#000000',
    ticker: { ...TICKER_DEFAULTS, enabled: false, ...(p?.ticker || {}) },
    items: (p?.items || []).map((i) => ({ ...i })),
  };
  const list = h('div', { class: 'items' });
  const summary = h('span', { class: 'muted' });

  const updateSummary = () => {
    const total = state.items.reduce((t, i) => t + Number(i.duration ?? byId.get(i.mediaId)?.duration ?? 0), 0);
    summary.textContent = `${state.items.length} contenido(s) · ciclo ≈ ${fmtDur(total)}`;
  };
  const renderItems = () => {
    updateSummary();
    if (!state.items.length) return mount(list, h('div', { class: 'empty' }, 'Lista vacía. Pulse "Añadir contenidos".'));
    mount(list, 
      ...state.items.map((it, idx) => {
        const m = byId.get(it.mediaId) || { name: '(eliminado)', type: '?' };
        const dur = h('input', { type: 'number', min: 0, value: it.duration ?? m.duration, title: m.type === 'video' ? '0 = duración completa' : 'segundos' });
        dur.addEventListener('input', () => {
          it.duration = Number(dur.value);
          updateSummary();
        });
        const row = h(
          'div',
          { class: 'item', draggable: 'true' },
          h('div', { class: 'handle', title: 'Arrastre para reordenar' }, '⋮⋮'),
          thumbFor(m, 'mini'),
          h('div', null, h('b', null, m.name), h('div', { class: 'muted' }, TYPE_LABEL[m.type] || '')),
          h('div', { class: 'item-fields' }, h('label', null, m.type === 'video' ? 'Segundos (0 = completo)' : 'Segundos', dur), h('label', null, 'Transición de entrada', itemTransition(it))),
          h(
            'div',
            { class: 'actions' },
            h('button', { class: 'btn small', disabled: idx === 0, onclick: () => move(idx, -1), title: 'Subir' }, '↑'),
            h('button', { class: 'btn small', disabled: idx === state.items.length - 1, onclick: () => move(idx, 1), title: 'Bajar' }, '↓'),
            h('button', { class: 'btn small', onclick: () => (state.items.splice(idx + 1, 0, { mediaId: it.mediaId, duration: it.duration }), renderItems()), title: 'Duplicar' }, '⧉'),
            h('button', { class: 'btn small danger', onclick: () => (state.items.splice(idx, 1), renderItems()), title: 'Quitar' }, '✕')
          )
        );
        row.addEventListener('dragstart', (e) => {
          row.classList.add('dragging');
          e.dataTransfer.setData('text/plain', String(idx));
        });
        row.addEventListener('dragend', () => row.classList.remove('dragging'));
        row.addEventListener('dragover', (e) => e.preventDefault());
        row.addEventListener('drop', (e) => {
          e.preventDefault();
          const from = Number(e.dataTransfer.getData('text/plain'));
          if (Number.isNaN(from) || from === idx) return;
          const [moved] = state.items.splice(from, 1);
          state.items.splice(idx, 0, moved);
          renderItems();
        });
        return row;
      })
    );
  };
  const move = (idx, dir) => {
    const [x] = state.items.splice(idx, 1);
    state.items.splice(idx + dir, 0, x);
    renderItems();
  };

  const picker = () => {
    const selected = new Set();
    const cards = media
      .slice()
      .reverse()
      .map((m) => {
        const c = h('div', { class: 'media-card selectable' }, thumbFor(m), h('div', { class: 'meta' }, h('div', { class: 'name' }, m.name), h('div', { class: 'muted' }, TYPE_LABEL[m.type])));
        c.addEventListener('click', () => {
          selected.has(m.id) ? selected.delete(m.id) : selected.add(m.id);
          c.classList.toggle('selected');
        });
        return c;
      });
    modal(
      h(
        'div',
        null,
        h('h2', null, 'Añadir contenidos'),
        media.length ? h('div', { class: 'media-grid' }, cards) : h('div', { class: 'empty' }, 'La biblioteca está vacía. ', h('a', { href: '#/biblioteca', onclick: closeModal }, 'Suba contenidos primero.')),
        h(
          'div',
          { class: 'modal-foot' },
          h('button', { class: 'btn', onclick: closeModal }, 'Cancelar'),
          h(
            'button',
            {
              class: 'btn primary',
              onclick: () => {
                media.filter((m) => selected.has(m.id)).forEach((m) => state.items.push({ mediaId: m.id, duration: m.duration }));
                closeModal();
                renderItems();
              },
            },
            'Añadir seleccionados'
          )
        )
      ),
      { wide: true }
    );
  };

  const bind = (input, setter) => {
    input.addEventListener('input', () => setter(input.type === 'checkbox' ? input.checked : input.value));
    return input;
  };
  const save = async () => {
    if (!state.name.trim()) return toast('Escriba un nombre para la lista', true);
    await guard(async () => {
      const saved = p ? await api('PUT', '/api/playlists/' + p.id, state) : await api('POST', '/api/playlists', state);
      toast('Lista guardada. Las pantallas se actualizarán en unos segundos.');
      if (!p) location.hash = '#/listas/' + saved.id;
      else route();
    });
  };

  mount(main, 
    pageHead(
      p ? 'Editar lista' : 'Nueva lista',
      h('a', { href: '#/listas' }, '← Volver a las listas'),
      p ? h('button', { class: 'btn', onclick: () => previewPlaylist(p) }, '▶ Vista previa') : null,
      h('button', { class: 'btn primary', onclick: save }, '💾 Guardar')
    ),
    h(
      'div',
      { class: 'card form' },
      h(
        'div',
        { class: 'row' },
        field('Nombre', bind(h('input', { value: state.name, placeholder: 'Ej. Promociones de octubre' }), (v) => (state.name = v))),
        field('Ajuste de imagen/video', bind(h('select', null, [['contain', 'Ajustar (sin recortar)'], ['cover', 'Rellenar (recortar)'], ['fill', 'Estirar']].map(([v, l]) => h('option', { value: v, selected: state.fit === v }, l))), (v) => (state.fit = v))),
        h('div', { class: 'shrink' }, field('Fondo', bind(h('input', { type: 'color', value: state.background }), (v) => (state.background = v))))
      )
    ),
    h('div', { class: 'card form' }, h('h2', null, '✨ Transiciones'), transitionEditor(state)),
    h('div', { class: 'card' }, h('div', { class: 'page-head' }, h('div', null, h('h2', null, 'Contenidos'), summary), h('button', { class: 'btn primary', onclick: picker }, '+ Añadir contenidos')), list),
    h('div', { class: 'card form' }, h('h2', null, 'Cintillo de noticias (texto en movimiento)'), tickerEditor(state.ticker, { toggle: true }))
  );
  renderItems();
}

// ---------------------------------------------------------------- Cintillo y reloj (editores reutilizables)
const TICKER_DEFAULTS = { text: '', speed: 80, bg: '#b91c1c', color: '#ffffff', font: 'sans', size: 4.4, opacity: 100, position: 'bottom', bold: true };
const CLOCK_DEFAULTS = { format: '24', seconds: false, date: true, font: 'sans', size: 8, color: '#ffffff', bg: '#000000', opacity: 60, align: 'center' };
const fontOptions = (sel) => Object.entries(PCWidgets.FONTS).map(([k, f]) => h('option', { value: k, selected: k === sel }, f.label));

/** Escala de la vista previa: el tamaño se expresa en % del alto de la pantalla. */
function previewBox(portrait) {
  return h('div', { class: 'wpreview' + (portrait ? ' portrait' : '') });
}

function bindObj(obj, key, input, onChange, parse = (v) => v) {
  const ev = input.tagName === 'SELECT' || input.type === 'checkbox' ? 'change' : 'input';
  input.addEventListener(ev, () => {
    obj[key] = input.type === 'checkbox' ? input.checked : parse(input.value);
    onChange();
  });
  return input;
}

/** Editor del cintillo: texto, velocidad, tipo de letra, tamaño, colores, transparencia y posición. */
function tickerEditor(t, { toggle = false, fill = false } = {}) {
  Object.keys(TICKER_DEFAULTS).forEach((k) => t[k] === undefined && (t[k] = TICKER_DEFAULTS[k]));
  const preview = previewBox();
  const draw = () => {
    preview.replaceChildren();
    preview.append(h('div', { class: 'wp-content' }, 'Contenido'));
    if (!toggle || t.enabled) {
      if (t.text) PCWidgets.makeTicker(preview, t, fill, 'cqh');
      else preview.append(h('div', { class: 'wp-hint' }, 'Escriba el texto del cintillo'));
    }
  };
  const B = (key, input, parse) => bindObj(t, key, input, draw, parse);
  const el = h(
    'div',
    { class: 'form' },
    toggle ? h('div', { class: 'checks' }, h('label', null, B('enabled', h('input', { type: 'checkbox', checked: t.enabled })), 'Mostrar el cintillo')) : null,
    field('Texto', B('text', h('textarea', { placeholder: 'Bienvenidos · Horario de 9 a 21 h · Siga nuestras redes @mitienda' }, t.text)), 'Separe los mensajes con " · ". Se repite continuamente.'),
    h(
      'div',
      { class: 'row' },
      field('Tipo de letra', B('font', h('select', null, fontOptions(t.font)))),
      field('Tamaño de letra (% del alto)', B('size', h('input', { type: 'number', min: 1, max: 30, step: 0.2, value: t.size }), Number)),
      field('Velocidad (px/s)', B('speed', h('input', { type: 'number', min: 10, max: 400, value: t.speed }), Number)),
      fill ? null : field('Posición', B('position', h('select', null, h('option', { value: 'bottom', selected: t.position !== 'top' }, 'Abajo'), h('option', { value: 'top', selected: t.position === 'top' }, 'Arriba'))))
    ),
    h(
      'div',
      { class: 'row' },
      field('Color del texto', B('color', h('input', { type: 'color', value: t.color }))),
      field('Color de fondo', B('bg', h('input', { type: 'color', value: t.bg }))),
      field('Opacidad del fondo', h('div', { class: 'range' }, B('opacity', h('input', { type: 'range', min: 0, max: 100, value: t.opacity }), Number), h('span', { class: 'muted' }, '0 = transparente'))),
      h('div', { class: 'checks shrink' }, h('label', null, B('bold', h('input', { type: 'checkbox', checked: t.bold !== false })), 'Negrita'))
    ),
    h('div', null, h('b', null, 'Vista previa'), preview)
  );
  draw();
  return el;
}

/** Editor del reloj con fecha. */
function clockEditor(c) {
  Object.keys(CLOCK_DEFAULTS).forEach((k) => c[k] === undefined && (c[k] = CLOCK_DEFAULTS[k]));
  const preview = previewBox();
  let widget = null;
  const draw = () => {
    widget?.stop();
    preview.replaceChildren();
    widget = PCWidgets.makeClock(preview, c, () => new Date(), 'cqh');
  };
  const B = (key, input, parse) => bindObj(c, key, input, draw, parse);
  const el = h(
    'div',
    { class: 'form' },
    h(
      'div',
      { class: 'row' },
      field('Formato', B('format', h('select', null, h('option', { value: '24', selected: c.format !== '12' }, '24 horas (18:30)'), h('option', { value: '12', selected: c.format === '12' }, '12 horas (6:30 p. m.)')))),
      field('Tipo de letra', B('font', h('select', null, fontOptions(c.font)))),
      field('Tamaño (% del alto)', B('size', h('input', { type: 'number', min: 1, max: 50, step: 0.5, value: c.size }), Number)),
      field('Alineación', B('align', h('select', null, [['center', 'Centro'], ['left', 'Izquierda'], ['right', 'Derecha']].map(([v, l]) => h('option', { value: v, selected: c.align === v }, l)))))
    ),
    h(
      'div',
      { class: 'row' },
      field('Color', B('color', h('input', { type: 'color', value: c.color }))),
      field('Fondo', B('bg', h('input', { type: 'color', value: c.bg }))),
      field('Opacidad del fondo', B('opacity', h('input', { type: 'range', min: 0, max: 100, value: c.opacity }), Number)),
      h('div', { class: 'checks shrink' }, h('label', null, B('date', h('input', { type: 'checkbox', checked: c.date !== false })), 'Mostrar fecha'), h('label', null, B('seconds', h('input', { type: 'checkbox', checked: !!c.seconds })), 'Segundos'))
    ),
    h('div', null, h('b', null, 'Vista previa'), preview)
  );
  draw();
  return el;
}

// ---------------------------------------------------------------- Transiciones
const TRANSITIONS = [
  ['fade', '🌫️ Fundido'],
  ['slide', '⬅️ Deslizar desde la derecha'],
  ['slide-right', '➡️ Deslizar desde la izquierda'],
  ['slide-up', '⬆️ Deslizar desde abajo'],
  ['slide-down', '⬇️ Deslizar desde arriba'],
  ['zoom', '🔍 Zoom'],
  ['none', '✂️ Corte (sin transición)'],
];

function itemTransition(it) {
  const sel = h('select', { class: 'compact' }, h('option', { value: '' }, 'La de la lista'), TRANSITIONS.map(([v, l]) => h('option', { value: v, selected: it.transition === v }, l)));
  sel.addEventListener('change', () => (it.transition = sel.value));
  return sel;
}

/** Estado inicial (entrada) y final de cada efecto, compartido con el reproductor web. */
function transitionFrames(type) {
  switch (type) {
    case 'slide': return { in: 'translateX(100%)', out: 'translateX(-100%)' };
    case 'slide-right': return { in: 'translateX(-100%)', out: 'translateX(100%)' };
    case 'slide-up': return { in: 'translateY(100%)', out: 'translateY(-100%)' };
    case 'slide-down': return { in: 'translateY(-100%)', out: 'translateY(100%)' };
    case 'zoom': return { in: 'scale(1.18)', out: 'scale(1)', fade: true };
    case 'none': return null;
    default: return { in: 'none', out: 'none', fade: true };
  }
}

/** Tipo de transición, duración y una demostración en vivo. */
function transitionEditor(state) {
  const demo = h('div', { class: 'tdemo' });
  const panels = [h('div', { class: 'tpanel a' }, 'A'), h('div', { class: 'tpanel b' }, 'B')];
  panels.forEach((p) => demo.append(p));
  let showing = 0;
  const play = () => {
    const f = transitionFrames(state.transition);
    const inEl = panels[1 - showing];
    const outEl = panels[showing];
    const ms = state.transitionDuration;
    [inEl, outEl].forEach((el) => (el.style.transition = 'none'));
    inEl.style.zIndex = 2;
    outEl.style.zIndex = 1;
    inEl.style.transform = f ? f.in : 'none';
    inEl.style.opacity = f && f.fade ? 0 : 1;
    outEl.style.transform = 'none';
    outEl.style.opacity = 1;
    void inEl.offsetWidth;
    if (f) {
      const tr = `transform ${ms}ms ease, opacity ${ms}ms ease`;
      inEl.style.transition = tr;
      if (!f.fade) outEl.style.transition = tr;
    }
    inEl.style.transform = 'none';
    inEl.style.opacity = 1;
    if (f && !f.fade) outEl.style.transform = f.out;
    showing = 1 - showing;
  };
  const type = h('select', null, TRANSITIONS.map(([v, l]) => h('option', { value: v, selected: state.transition === v }, l)));
  const dur = h('input', { type: 'range', min: 100, max: 3000, step: 100, value: state.transitionDuration });
  const durLabel = h('b', null, (state.transitionDuration / 1000).toFixed(1) + ' s');
  type.addEventListener('change', () => {
    state.transition = type.value;
    play();
  });
  dur.addEventListener('input', () => {
    state.transitionDuration = Number(dur.value);
    durLabel.textContent = (state.transitionDuration / 1000).toFixed(1) + ' s';
  });
  dur.addEventListener('change', play);
  setTimeout(play, 300);
  return h(
    'div',
    { class: 'tedit' },
    h(
      'div',
      { class: 'form' },
      field('Efecto entre contenidos', type),
      field(h('span', null, 'Duración de la transición: ', durLabel), dur),
      h('div', { class: 'muted' }, 'Puede cambiar la transición de un contenido concreto en su fila ("Transición de entrada"). En videowalls se usa siempre corte para mantener la sincronía, y en el modo ligero los videos entran por corte.'),
      h('div', null, h('button', { type: 'button', class: 'btn', onclick: play }, '▶ Probar transición'))
    ),
    demo
  );
}

// ---------------------------------------------------------------- Programación
const DAY_FULL = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const fmtYMD = (v) => (v ? new Date(v + 'T00:00:00').toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

const REPEAT = {
  always: { icon: '🔁', label: 'Siempre (en bucle)', hint: 'Se reproduce continuamente, las 24 horas, todos los días.' },
  daily: { icon: '📅', label: 'Todos los días', hint: 'Cada día en la franja horaria indicada (opcionalmente entre dos fechas).' },
  weekly: { icon: '🗓️', label: 'Por semana', hint: 'Sólo los días de la semana marcados, en la franja horaria indicada.' },
  custom: { icon: '⏱️', label: 'Fechas y horas personalizadas', hint: 'Desde una fecha y hora exactas hasta otra (por ejemplo una campaña del viernes 18:00 al domingo 22:00).' },
};
const repeatOf = (s) => s.repeat || (s.days?.length ? 'weekly' : 'daily');
const fmtStamp = (v) => (v ? new Date(v).toLocaleString('es', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

function describeDays(s) {
  const r = repeatOf(s);
  if (r === 'always') return 'Todos los días, 24 h';
  if (r === 'custom') return 'Periodo continuo';
  if (r === 'daily') return 'Todos los días';
  return s.days?.length && s.days.length < 7 ? s.days.slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => DAYS[d]).join(', ') : 'Todos los días';
}
function describeHours(s) {
  const r = repeatOf(s);
  if (r === 'always') return 'Siempre';
  if (r === 'custom') return `${fmtStamp(s.startAt)} → ${fmtStamp(s.endAt)}`;
  return s.startTime || s.endTime ? `${s.startTime || '00:00'} – ${s.endTime || '24:00'}` : 'Todo el día';
}
function describeDates(s) {
  const r = repeatOf(s);
  if (r === 'always') return 'Siempre';
  if (r === 'custom') return 'Del ' + fmtStamp(s.startAt).split(',')[0] + ' al ' + fmtStamp(s.endAt).split(',')[0];
  if (!s.startDate && !s.endDate) return 'Sin fecha límite';
  if (s.startDate && s.endDate) return `${fmtYMD(s.startDate)} → ${fmtYMD(s.endDate)}`;
  return s.startDate ? `Desde ${fmtYMD(s.startDate)}` : `Hasta ${fmtYMD(s.endDate)}`;
}

pages.programacion = async (main) => {
  const [schedules, cat, displays, walls] = await Promise.all([api('GET', '/api/schedules'), loadCatalog(), api('GET', '/api/displays'), api('GET', '/api/walls')]);
  const targets = (s) => {
    const names = [
      ...(s.groupIds || []).map((id) => '🏢 ' + (cat.groups.find((g) => g.id === id)?.name || '?')),
      ...(s.displayIds || []).map((id) => displays.find((d) => d.id === id)?.name || '?'),
      ...(s.wallIds || []).map((id) => '🧱 ' + (walls.find((w) => w.id === id)?.name || '?')),
    ];
    return names.length ? names.join(', ') : 'Todas las pantallas';
  };
  const hasContent = cat.playlists.length || cat.layouts.length;
  const now = new Date();
  const clock = h('div', { class: 'now-clock' });
  const tick = () => {
    const d = new Date();
    clock.replaceChildren(h('b', null, PCWidgets.formatTime(d, { format: '24', seconds: true })), h('span', null, PCWidgets.formatDate(d)));
  };
  tick();
  refreshTimer = setInterval(tick, 1000);
  const sorted = schedules.slice().sort((a, b) => b.priority - a.priority);
  mount(
    main,
    pageHead('Programación', 'Qué contenido se reproduce, cuándo y en qué pantallas', clock, h('button', { class: 'btn primary', disabled: !hasContent, onclick: () => scheduleEditor(null, cat, displays, walls) }, '+ Nuevo evento')),
    !hasContent ? h('div', { class: 'card empty' }, 'Primero cree una lista de reproducción o un layout.') : null,
    h(
      'div',
      { class: 'card' },
      h('p', { class: 'muted' }, 'Cuando varios eventos coinciden gana el de mayor prioridad; si tienen la misma prioridad, sus listas se intercalan. Fuera de los eventos, cada pantalla reproduce su contenido por defecto.'),
      sorted.length
        ? h(
            'div',
            { class: 'table-wrap' },
            h(
              'table',
              { class: 'sched' },
              h('thead', null, h('tr', null, h('th', null, 'Contenido'), h('th', null, 'Evento'), h('th', null, 'Repetición'), h('th', null, 'Fecha'), h('th', null, 'Horario'), h('th', null, 'Pantallas'), h('th', null, 'Prioridad'), h('th', null, 'Estado'), h('th', null, ''))),
              h(
                'tbody',
                null,
                sorted.map((s) => {
                  const key = PCSchedule.contentKey(s);
                  return h(
                    'tr',
                    null,
                    h('td', null, h('div', { class: 'thumb-cell', title: 'Vista previa', onclick: () => contentRecord(key, cat) && previewContent(key, contentLabel(key, cat), contentRecord(key, cat)?.orientation === 'portrait') }, contentThumb(key, cat), h('span', null, contentLabel(key, cat)))),
                    h('td', null, h('b', null, s.name)),
                    h('td', null, h('span', { class: 'badge blue' }, REPEAT[repeatOf(s)].icon + ' ' + REPEAT[repeatOf(s)].label)),
                    h('td', null, h('div', null, '📅 ', describeDates(s)), h('div', { class: 'muted' }, describeDays(s))),
                    h('td', null, '🕒 ', describeHours(s)),
                    h('td', { class: 'muted' }, targets(s)),
                    h('td', null, s.priority),
                    h(
                      'td',
                      null,
                      s.enabled === false
                        ? h('span', { class: 'badge off' }, 'Desactivado')
                        : PCSchedule.isActive(s, now)
                          ? h('span', { class: 'badge ok' }, 'Activo ahora')
                          : repeatOf(s) === 'custom' && s.endAt && PCSchedule.localStamp(now) >= s.endAt
                            ? h('span', { class: 'badge off' }, 'Finalizado')
                            : h('span', { class: 'badge' }, 'En espera')
                    ),
                    h(
                      'td',
                      null,
                      h(
                        'div',
                        { class: 'actions' },
                        h('button', { class: 'btn small', onclick: () => scheduleEditor(s, cat, displays, walls) }, 'Editar'),
                        h(
                          'button',
                          {
                            class: 'btn small danger',
                            onclick: async () => {
                              if (!(await confirmBox(`¿Eliminar el evento "${s.name}"?`))) return;
                              await guard(() => api('DELETE', '/api/schedules/' + s.id));
                              route();
                            },
                          },
                          'Eliminar'
                        )
                      )
                    )
                  );
                })
              )
            )
          )
        : h('div', { class: 'empty' }, 'No hay eventos programados.')
    ),
    sorted.length ? h('div', { class: 'card' }, h('h2', null, 'Vista semanal'), weekView(sorted, cat)) : null
  );
};

/** Calendario semanal: cada evento se dibuja como un bloque en su día y franja horaria. */
function weekView(schedules, cat) {
  const monday = new Date();
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const colors = ['#2563eb', '#16a34a', '#d97706', '#db2777', '#7c3aed', '#0891b2', '#dc2626', '#65a30d'];
  const grid = h('div', { class: 'week' });
  grid.append(h('div', { class: 'wk-hours' }, h('div', { class: 'wk-head' }), ...[0, 3, 6, 9, 12, 15, 18, 21].map((hh) => h('div', { class: 'wk-hour', style: { top: `calc(28px + ${(hh / 24) * 100}% - ${(hh / 24) * 28}px)` } }, String(hh).padStart(2, '0') + ':00'))));
  const nowD = new Date();
  for (let i = 0; i < 7; i++) {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);
    const col = h('div', { class: 'wk-col' + (day.toDateString() === nowD.toDateString() ? ' today' : '') }, h('div', { class: 'wk-head' }, DAYS[day.getDay()] + ' ' + day.getDate()));
    const body = h('div', { class: 'wk-body' });
    col.append(body);
    schedules.forEach((s, idx) => {
      if (s.enabled === false) return;
      const r = repeatOf(s);
      let pieces;
      if (r === 'always') pieces = [[0, 1440]];
      else if (r === 'custom') {
        // Parte del periodo que cae en este día
        const dayStart = PCSchedule.ymd(day) + 'T00:00';
        const dayEnd = PCSchedule.ymd(day) + 'T24:00';
        if (!s.startAt || !s.endAt || s.endAt <= dayStart || s.startAt >= dayEnd) return;
        const a = s.startAt > dayStart ? PCSchedule.toMinutes(s.startAt.slice(11), 0) : 0;
        const b = s.endAt < dayEnd ? PCSchedule.toMinutes(s.endAt.slice(11), 1440) : 1440;
        pieces = [[a, b]];
      } else {
        // ¿Aplica ese día? Se prueba a las 12:00 sin franja horaria
        const probe = { ...s, startTime: '', endTime: '' };
        const noon = new Date(day);
        noon.setHours(12);
        if (!PCSchedule.isActive(probe, noon)) return;
        const start = PCSchedule.toMinutes(s.startTime, 0);
        const end = PCSchedule.toMinutes(s.endTime, 1440);
        pieces = start < end ? [[start, end]] : start === end ? [[0, 1440]] : [[start, 1440]];
      }
      const key = PCSchedule.contentKey(s);
      pieces.forEach(([a, b]) =>
        body.append(
          h(
            'div',
            { class: 'wk-ev', title: `${s.name} · ${contentLabel(key, cat)} · ${describeHours(s)}`, style: { top: (a / 1440) * 100 + '%', height: Math.max(2, ((b - a) / 1440) * 100) + '%', background: colors[idx % colors.length] } },
            h('b', null, s.name),
            h('span', null, describeHours(s))
          )
        )
      );
    });
    if (day.toDateString() === nowD.toDateString()) body.append(h('div', { class: 'wk-now', style: { top: ((nowD.getHours() * 60 + nowD.getMinutes()) / 1440) * 100 + '%' } }));
    grid.append(col);
  }
  return grid;
}

function scheduleEditor(s, cat, displays, walls) {
  const days = new Set(s?.days || []);
  const dsel = new Set(s?.displayIds || []);
  const wsel = new Set(s?.wallIds || []);
  const gsel = new Set(s?.groupIds || []);
  let repeat = s ? repeatOf(s) : 'weekly';
  const current = s ? PCSchedule.contentKey(s) : '';
  const thumb = h('div', { class: 'sched-thumb' });
  const select = h('select', { name: 'content', required: true }, contentOptions(cat, current, null));
  const updThumb = () => mount(thumb, contentThumb(select.value, cat), h('span', { class: 'muted' }, contentLabel(select.value, cat)));
  select.addEventListener('change', updThumb);

  const now = new Date();
  const stamp = (d) => PCSchedule.localStamp(d);
  const plusDays = (n) => new Date(now.getTime() + n * 86400000);
  const sections = {
    days: h('div', null, h('b', null, 'Días de la semana'), h('div', { class: 'checks' }, [1, 2, 3, 4, 5, 6, 0].map((d) => h('label', null, h('input', { type: 'checkbox', 'data-day': d, checked: days.has(d) }), DAY_FULL[d])))),
    hours: h('div', { class: 'row' }, field('🕒 Hora de inicio', h('input', { type: 'time', name: 'startTime', value: s?.startTime || '' })), field('🕒 Hora de fin', h('input', { type: 'time', name: 'endTime', value: s?.endTime || '' }), 'Vacío = todo el día. Si el fin es anterior al inicio cruza la medianoche.')),
    dates: h('div', { class: 'row' }, field('📅 Desde la fecha (opcional)', h('input', { type: 'date', name: 'startDate', value: s?.startDate || '' })), field('📅 Hasta la fecha (opcional)', h('input', { type: 'date', name: 'endDate', value: s?.endDate || '' }))),
    custom: h(
      'div',
      { class: 'row' },
      field('⏱️ Empieza', h('input', { type: 'datetime-local', name: 'startAt', value: s?.startAt || stamp(now).slice(0, 11) + '08:00' })),
      field('⏱️ Termina', h('input', { type: 'datetime-local', name: 'endAt', value: s?.endAt || stamp(plusDays(7)).slice(0, 11) + '20:00' }))
    ),
  };
  const hint = h('div', { class: 'tip' });
  const tabs = h('div', { class: 'seg' });
  const showRepeat = () => {
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.r === repeat));
    sections.days.classList.toggle('hidden', repeat !== 'weekly');
    sections.hours.classList.toggle('hidden', repeat === 'always' || repeat === 'custom');
    sections.dates.classList.toggle('hidden', repeat === 'always' || repeat === 'custom');
    sections.custom.classList.toggle('hidden', repeat !== 'custom');
    hint.textContent = REPEAT[repeat].hint;
  };
  Object.entries(REPEAT).forEach(([k, r]) =>
    tabs.append(
      h(
        'button',
        {
          type: 'button',
          'data-r': k,
          onclick: () => {
            repeat = k;
            showRepeat();
          },
        },
        r.icon + ' ' + r.label
      )
    )
  );
  const authorized = displays.filter((d) => d.authorized);
  const form = h(
    'form',
    { class: 'form' },
    h('h2', null, s ? 'Editar evento' : 'Nuevo evento'),
    h('div', { class: 'row' }, field('Nombre', h('input', { name: 'name', value: s?.name || '', placeholder: 'Ej. Menú del desayuno', required: true })), field('Contenido', select)),
    thumb,
    h('div', null, h('b', null, 'Repetición'), tabs),
    hint,
    sections.custom,
    sections.days,
    sections.hours,
    sections.dates,
    h('div', { class: 'row' }, field('Prioridad (0–100)', h('input', { type: 'number', name: 'priority', min: 0, max: 100, value: s?.priority ?? 1 }), 'Si coinciden varios eventos, gana el de mayor prioridad.'), h('div', { class: 'checks shrink' }, h('label', null, h('input', { type: 'checkbox', name: 'enabled', checked: s ? s.enabled !== false : true }), 'Activado'))),
    h('div', { class: 'tip' }, '¿Dónde se muestra? Marque sucursales, pantallas o videowalls. Si no marca nada, se muestra en todas las pantallas.'),
    cat.groups.length
      ? h('div', null, h('b', null, '🏢 Sucursales'), h('div', { class: 'checks' }, cat.groups.map((g) => h('label', null, h('input', { type: 'checkbox', 'data-group': g.id, checked: gsel.has(g.id) }), h('span', { class: 'gdot', style: { background: g.color } }), `${g.name} (${authorized.filter((d) => d.groupId === g.id).length})`))))
      : h('div', { class: 'muted' }, 'Consejo: cree ', h('a', { href: '#/sucursales', onclick: closeModal }, 'sucursales'), ' para programar por sucursal.'),
    h('div', null, h('b', null, '🖥️ Pantallas'), h('div', { class: 'checks' }, authorized.map((d) => h('label', null, h('input', { type: 'checkbox', 'data-display': d.id, checked: dsel.has(d.id) }), (d.number ? `#${d.number} ` : '') + d.name + (d.group ? ` · ${d.group}` : ''))))),
    walls.length ? h('div', null, h('b', null, '🧱 Videowalls'), h('div', { class: 'checks' }, walls.map((w) => h('label', null, h('input', { type: 'checkbox', 'data-wall': w.id, checked: wsel.has(w.id) }), w.name)))) : null,
    h('div', { class: 'modal-foot' }, h('button', { type: 'button', class: 'btn', onclick: closeModal }, 'Cancelar'), h('button', { class: 'btn primary' }, 'Guardar'))
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = formData(form);
    const body = {
      ...v,
      repeat,
      enabled: !!form.querySelector('[name=enabled]').checked,
      days: repeat === 'weekly' ? [...form.querySelectorAll('[data-day]:checked')].map((x) => Number(x.dataset.day)) : [],
      displayIds: [...form.querySelectorAll('[data-display]:checked')].map((x) => x.dataset.display),
      wallIds: [...form.querySelectorAll('[data-wall]:checked')].map((x) => x.dataset.wall),
      groupIds: [...form.querySelectorAll('[data-group]:checked')].map((x) => x.dataset.group),
    };
    if (repeat === 'always' || repeat === 'custom') Object.assign(body, { startTime: '', endTime: '', startDate: '', endDate: '' });
    if (repeat === 'weekly' && !body.days.length) return toast('Marque al menos un día de la semana', true);
    guard(async () => {
      if (s) await api('PUT', '/api/schedules/' + s.id, body);
      else await api('POST', '/api/schedules', body);
      closeModal();
      toast('Evento guardado');
      route();
    });
  });
  modal(form, { wide: true });
  updThumb();
  showRepeat();
}

// ---------------------------------------------------------------- Anuncio inmediato
pages.anuncio = async (main) => {
  const [allDisplays, groups] = await Promise.all([api('GET', '/api/displays'), api('GET', '/api/groups')]);
  const displays = allDisplays.filter((d) => d.authorized);
  const preview = h('div', { style: { borderRadius: '8px', aspectRatio: '16/9', display: 'grid', placeItems: 'center', padding: '24px', fontSize: '28px', fontWeight: 800, textAlign: 'center', whiteSpace: 'pre-wrap' } });
  const form = h(
    'form',
    { class: 'form' },
    field('Mensaje', h('textarea', { name: 'text', required: true, placeholder: 'Atención: la tienda cerrará en 15 minutos' })),
    h(
      'div',
      { class: 'row' },
      field('Duración (segundos)', h('input', { type: 'number', name: 'duration', min: 5, value: 30 })),
      field('Posición', h('select', { name: 'position' }, h('option', { value: 'full' }, 'Pantalla completa'), h('option', { value: 'top' }, 'Banda superior'), h('option', { value: 'bottom' }, 'Banda inferior'))),
      field('Fondo', h('input', { type: 'color', name: 'bg', value: '#dc2626' })),
      field('Texto', h('input', { type: 'color', name: 'color', value: '#ffffff' }))
    ),
    groups.length ? h('div', null, h('b', null, '🏢 Sucursales'), h('div', { class: 'checks' }, groups.map((g) => h('label', null, h('input', { type: 'checkbox', 'data-group': g.id }), h('span', { class: 'gdot', style: { background: g.color } }), g.name)))) : null,
    h('div', null, h('b', null, 'Pantallas '), h('span', { class: 'muted' }, '(nada marcado = todas)'), h('div', { class: 'checks' }, displays.map((d) => h('label', null, h('input', { type: 'checkbox', 'data-display': d.id }), d.name, d.online ? '' : ' (desconectada)')))),
    h('div', null, h('b', null, 'Vista previa'), preview),
    h('div', { class: 'actions' }, h('button', { class: 'btn primary' }, '📢 Enviar ahora'), h('button', { type: 'button', class: 'btn', onclick: () => sendAnnounce({ type: 'clearAnnouncement' }) }, 'Quitar anuncio actual'))
  );
  const upd = () => {
    const v = formData(form);
    Object.assign(preview.style, { background: v.bg, color: v.color });
    preview.textContent = v.text || 'Su mensaje aparecerá aquí';
  };
  const sendAnnounce = (extra) =>
    guard(async () => {
      const body = {
        ...formData(form),
        displayIds: [...form.querySelectorAll('[data-display]:checked')].map((x) => x.dataset.display),
        groupIds: [...form.querySelectorAll('[data-group]:checked')].map((x) => x.dataset.group),
        ...extra,
      };
      const r = await api('POST', '/api/announce', body);
      toast(`Enviado a ${r.delivered} de ${r.total} pantalla(s) conectada(s)`, !r.delivered);
    });
  form.addEventListener('input', upd);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    sendAnnounce({ type: 'announce' });
  });
  mount(main, pageHead('Anuncio inmediato', 'Muestra un mensaje urgente en las pantallas al instante, por encima del contenido programado'), h('div', { class: 'card' }, form));
  upd();
};

// ---------------------------------------------------------------- Estadísticas
pages.estadisticas = async (main) => {
  const displays = await api('GET', '/api/displays');
  const today = PCSchedule.ymd(new Date());
  const weekAgo = PCSchedule.ymd(new Date(Date.now() - 6 * 86400000));
  const out = h('div');
  const form = h(
    'form',
    { class: 'row card' },
    field('Desde', h('input', { type: 'date', name: 'from', value: weekAgo })),
    field('Hasta', h('input', { type: 'date', name: 'to', value: today })),
    field('Pantalla', h('select', { name: 'displayId' }, h('option', { value: '' }, 'Todas'), displays.map((d) => h('option', { value: d.id }, d.name)))),
    h('div', { class: 'shrink actions' }, h('button', { class: 'btn primary' }, 'Consultar'), h('button', { type: 'button', class: 'btn', onclick: () => (location.href = '/api/stats.csv?' + new URLSearchParams(formData(form))) }, '⬇️ CSV'))
  );
  const table = (rows, label) =>
    rows.length
      ? h('table', null, h('thead', null, h('tr', null, h('th', null, label), h('th', null, 'Reproducciones'), h('th', null, 'Tiempo en pantalla'))), h('tbody', null, rows.map((r) => h('tr', null, h('td', null, r.name), h('td', null, r.plays), h('td', null, fmtDur(r.seconds))))))
      : h('div', { class: 'empty' }, 'Sin datos en este periodo.');
  const load = async () => {
    const s = await api('GET', '/api/stats?' + new URLSearchParams(formData(form)));
    mount(out, h('div', { class: 'kpis' }, kpi(s.total, 'Reproducciones totales')), h('div', { class: 'grid cols-2' }, h('div', { class: 'card' }, h('h2', null, 'Por contenido'), table(s.byMedia, 'Contenido')), h('div', { class: 'card' }, h('h2', null, 'Por pantalla'), table(s.byDisplay, 'Pantalla'))));
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    guard(load);
  });
  mount(main, pageHead('Estadísticas', 'Prueba de reproducción: cuántas veces y cuánto tiempo se mostró cada anuncio'), form, out);
  await load();
};

// ---------------------------------------------------------------- Ajustes
pages.ajustes = async (main) => {
  const form = h(
    'form',
    { class: 'form' },
    field('Contraseña actual', h('input', { type: 'password', name: 'current', required: true, autocomplete: 'current-password' })),
    field('Nueva contraseña', h('input', { type: 'password', name: 'next', required: true, minlength: 6, autocomplete: 'new-password' })),
    h('button', { class: 'btn primary' }, 'Cambiar contraseña')
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    guard(async () => {
      await api('POST', '/api/me/password', formData(form));
      form.reset();
      toast('Contraseña actualizada');
    });
  });
  const health = await api('GET', '/api/health');
  mount(main, 
    pageHead('Ajustes'),
    h(
      'div',
      { class: 'grid cols-2' },
      h('div', { class: 'card' }, h('h2', null, 'Seguridad'), form),
      h(
        'div',
        { class: 'card' },
        h('h2', null, 'Servidor'),
        h('p', null, 'Dirección para los reproductores: ', h('code', null, location.origin)),
        h('p', null, 'Versión de contenido actual: ', h('code', null, health.version)),
        h('p', null, h('a', { class: 'btn', href: '/download/publicast-player.apk' }, '⬇️ Descargar APK'), ' ', h('a', { class: 'btn', href: '/player/', target: '_blank' }, '🖥️ Abrir reproductor web'))
      )
    )
  );
};

// ---------------------------------------------------------------- inicio
document.addEventListener('DOMContentLoaded', () => api('GET', '/api/me').then(startApp).catch(showLogin));
