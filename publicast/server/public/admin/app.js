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
const TYPE_LABEL = { image: 'Imagen', video: 'Video', web: 'Página web', text: 'Texto' };
const TYPE_ICON = { image: '🖼️', video: '🎬', web: '🌐', text: '🔤' };

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
  return h('div', { class: cls }, TYPE_ICON[m.type] || '❔', cls === 'thumb' ? h('span', { class: 'type' }, TYPE_LABEL[m.type]) : null);
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
    const d = await api('GET', '/api/dashboard');
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
        kpi(c.schedules, 'Eventos programados'),
        kpi(c.plays24h, 'Reproducciones (24 h)'),
        kpi(fmtBytes(c.storage), 'Almacenamiento')
      ),
      h('div', { class: 'card' }, h('h2', null, 'Estado de las pantallas'), displaysTable(d.displays, true)),
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
            )
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

function displaysTable(list, compact, onEdit) {
  if (!list.length) return h('div', { class: 'empty' }, 'Todavía no hay pantallas. Instale la app en un dispositivo Android para registrarlo.');
  return h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      null,
      h('thead', null, h('tr', null, h('th', null, 'Pantalla'), h('th', null, 'Estado'), h('th', null, 'Reproduciendo ahora'), h('th', null, 'Última conexión'), compact ? null : h('th', null, 'Dispositivo'), compact ? null : h('th', null, ''))),
      h(
        'tbody',
        null,
        list.map((d) =>
          h(
            'tr',
            null,
            h('td', null, h('b', null, d.name), d.location ? h('div', { class: 'muted' }, d.location) : null),
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
pages.pantallas = async (main) => {
  const render = async () => {
    const [displays, playlists] = await Promise.all([api('GET', '/api/displays'), api('GET', '/api/playlists')]);
    const pending = displays.filter((d) => !d.authorized);
    mount(main, 
      pageHead('Pantallas', 'Dispositivos Android que reproducen su contenido'),
      h(
        'div',
        { class: 'grid cols-2' },
        h(
          'div',
          { class: 'card' },
          h('h2', null, 'Autorizar una pantalla nueva'),
          h('p', { class: 'muted' }, 'Abra PubliCast Player en el dispositivo, escriba la dirección del servidor y se mostrará un código de 6 dígitos.'),
          authorizeForm(playlists, pending, render)
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
        h('h2', null, 'Todas las pantallas'),
        displaysTable(displays, false, (d) =>
          h(
            'div',
            { class: 'actions' },
            d.authorized ? h('button', { class: 'btn small', onclick: () => editDisplay(d, playlists, render) }, 'Editar') : null,
            d.authorized ? h('button', { class: 'btn small', title: 'Muestra el nombre en la pantalla', onclick: () => command(d, { type: 'identify' }) }, 'Identificar') : null,
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
          )
        )
      )
    );
  };
  await render();
  refreshTimer = setInterval(() => {
    if ($('#modal').classList.contains('hidden') && !document.activeElement?.closest('form')) render().catch(() => {});
  }, 10000);
};

function authorizeForm(playlists, pending, after) {
  const form = h(
    'form',
    { class: 'form' },
    field('Código mostrado en la pantalla', h('input', { name: 'code', class: 'code-input', inputmode: 'numeric', maxlength: 6, placeholder: '000000', required: true, autocomplete: 'off' })),
    h('div', { class: 'row' }, field('Nombre', h('input', { name: 'name', placeholder: 'Ej. Vitrina entrada' })), field('Lista por defecto', h('select', { name: 'defaultPlaylistId' }, playlistOptions(playlists)))),
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

function editDisplay(d, playlists, after) {
  const form = h(
    'form',
    { class: 'form' },
    h('h2', null, 'Editar pantalla'),
    field('Nombre', h('input', { name: 'name', value: d.name, required: true })),
    field('Ubicación', h('input', { name: 'location', value: d.location || '', placeholder: 'Ej. Sucursal centro, planta baja' })),
    field('Lista de reproducción por defecto', h('select', { name: 'defaultPlaylistId' }, playlistOptions(playlists, d.defaultPlaylistId)), 'Se reproduce cuando no hay ningún evento programado activo.'),
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
pages.biblioteca = async (main) => {
  let filter = 'all';
  const grid = h('div', { class: 'media-grid' });
  const load = async () => {
    const media = await api('GET', '/api/media');
    const list = media.filter((m) => filter === 'all' || m.type === filter).reverse();
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
    pageHead('Biblioteca', 'Imágenes, videos, páginas web y mensajes de texto', h('button', { class: 'btn', onclick: () => widgetEditor('web', null, load) }, '🌐 Página web'), h('button', { class: 'btn', onclick: () => widgetEditor('text', null, load) }, '🔤 Mensaje de texto')),
    h('div', { class: 'card' }, drop, fileInput),
    h('div', { class: 'page-head' }, filters),
    grid
  );
  await load();
};

function mediaCard(m, reload) {
  const dur = h('input', { type: 'number', min: 0, value: m.duration, style: { width: '80px' }, title: m.type === 'video' ? '0 = duración completa del video' : 'Segundos en pantalla' });
  dur.addEventListener('change', () => guard(() => api('PUT', '/api/media/' + m.id, { duration: dur.value }).then(() => toast('Duración guardada'))));
  return h(
    'div',
    { class: 'media-card' },
    thumbFor(m),
    h(
      'div',
      { class: 'meta' },
      h('div', { class: 'name', title: m.name }, m.name),
      h('div', { class: 'muted' }, [TYPE_LABEL[m.type], m.size ? fmtBytes(m.size) : m.url, m.usedIn ? `en ${m.usedIn} lista(s)` : 'sin usar'].filter(Boolean).join(' · ')),
      h('div', { class: 'row' }, h('label', { class: 'shrink' }, 'Duración (s)', dur)),
      h(
        'div',
        { class: 'actions' },
        m.type === 'image' || m.type === 'video' ? h('a', { class: 'btn small', href: m.url, target: '_blank' }, 'Ver') : null,
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
      ? field('Dirección (URL)', h('input', { name: 'url', type: 'url', value: m?.url || '', placeholder: 'https://…', required: true }), 'Se muestra a pantalla completa. Algunas webs bloquean ser mostradas dentro de otras páginas en el reproductor web; en la app Android funcionan todas.')
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
                    h('td', { class: 'muted' }, `${displays.filter((d) => d.defaultPlaylistId === p.id).length} pantalla(s) · ${schedules.filter((s) => s.playlistId === p.id).length} evento(s)`),
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
  modal(h('div', null, h('h2', null, 'Vista previa: ' + p.name), h('iframe', { class: 'preview-frame', src: '/player/?preview=' + encodeURIComponent(p.id) }), h('div', { class: 'modal-foot' }, h('button', { class: 'btn', onclick: closeModal }, 'Cerrar'))), { wide: true });
}

function playlistEditor(main, p, media, byId) {
  const state = {
    name: p?.name || '',
    transition: p?.transition || 'fade',
    fit: p?.fit || 'contain',
    background: p?.background || '#000000',
    ticker: { enabled: false, text: '', speed: 80, bg: '#b91c1c', color: '#ffffff', ...(p?.ticker || {}) },
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
          h('label', null, m.type === 'video' ? 'Segundos (0 = completo)' : 'Segundos', dur),
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
        field('Transición', bind(h('select', null, [['fade', 'Fundido'], ['slide', 'Deslizar'], ['none', 'Ninguna']].map(([v, l]) => h('option', { value: v, selected: state.transition === v }, l))), (v) => (state.transition = v))),
        field('Ajuste de imagen/video', bind(h('select', null, [['contain', 'Ajustar (sin recortar)'], ['cover', 'Rellenar (recortar)'], ['fill', 'Estirar']].map(([v, l]) => h('option', { value: v, selected: state.fit === v }, l))), (v) => (state.fit = v))),
        h('div', { class: 'shrink' }, field('Fondo', bind(h('input', { type: 'color', value: state.background }), (v) => (state.background = v))))
      )
    ),
    h('div', { class: 'card' }, h('div', { class: 'page-head' }, h('div', null, h('h2', null, 'Contenidos'), summary), h('button', { class: 'btn primary', onclick: picker }, '+ Añadir contenidos')), list),
    h(
      'div',
      { class: 'card form' },
      h('h2', null, 'Cintillo de noticias (texto en movimiento)'),
      h('div', { class: 'checks' }, h('label', null, bind(h('input', { type: 'checkbox', checked: state.ticker.enabled }), (v) => (state.ticker.enabled = v)), 'Mostrar un cintillo en la parte inferior de la pantalla')),
      field('Texto', bind(h('textarea', { placeholder: 'Bienvenidos · Horario de 9 a 21 h · Siga nuestras redes @mitienda' }, state.ticker.text), (v) => (state.ticker.text = v)), 'Separe los mensajes con " · ". Se repite continuamente.'),
      h(
        'div',
        { class: 'row' },
        field('Velocidad (px/s)', bind(h('input', { type: 'number', min: 10, max: 400, value: state.ticker.speed }), (v) => (state.ticker.speed = Number(v)))),
        field('Fondo', bind(h('input', { type: 'color', value: state.ticker.bg }), (v) => (state.ticker.bg = v))),
        field('Color del texto', bind(h('input', { type: 'color', value: state.ticker.color }), (v) => (state.ticker.color = v)))
      )
    )
  );
  renderItems();
}

// ---------------------------------------------------------------- Programación
pages.programacion = async (main) => {
  const [schedules, playlists, displays] = await Promise.all([api('GET', '/api/schedules'), api('GET', '/api/playlists'), api('GET', '/api/displays')]);
  const pName = (id) => playlists.find((p) => p.id === id)?.name || '(eliminada)';
  const dNames = (ids) => (ids?.length ? ids.map((id) => displays.find((d) => d.id === id)?.name || '?').join(', ') : 'Todas las pantallas');
  const describe = (s) => {
    const days = s.days?.length && s.days.length < 7 ? s.days.slice().sort().map((d) => DAYS[d]).join(', ') : 'Todos los días';
    const hours = s.startTime || s.endTime ? `${s.startTime || '00:00'}–${s.endTime || '24:00'}` : 'Todo el día';
    const dates = s.startDate || s.endDate ? `del ${s.startDate || '…'} al ${s.endDate || '…'}` : '';
    return [days, hours, dates].filter(Boolean).join(' · ');
  };
  mount(main, 
    pageHead('Programación', 'Qué lista se reproduce, cuándo y en qué pantallas', h('button', { class: 'btn primary', disabled: !playlists.length, onclick: () => scheduleEditor(null, playlists, displays) }, '+ Nuevo evento')),
    !playlists.length ? h('div', { class: 'card empty' }, 'Primero cree una lista de reproducción.') : null,
    h(
      'div',
      { class: 'card' },
      h('p', { class: 'muted' }, 'Cuando varios eventos coinciden gana el de mayor prioridad; si tienen la misma prioridad, sus contenidos se intercalan. Fuera de los eventos, cada pantalla reproduce su lista por defecto.'),
      schedules.length
        ? h(
            'div',
            { class: 'table-wrap' },
            h(
              'table',
              null,
              h('thead', null, h('tr', null, h('th', null, 'Evento'), h('th', null, 'Lista'), h('th', null, 'Cuándo'), h('th', null, 'Pantallas'), h('th', null, 'Prioridad'), h('th', null, 'Estado'), h('th', null, ''))),
              h(
                'tbody',
                null,
                schedules
                  .slice()
                  .sort((a, b) => b.priority - a.priority)
                  .map((s) =>
                    h(
                      'tr',
                      null,
                      h('td', null, h('b', null, s.name)),
                      h('td', null, pName(s.playlistId)),
                      h('td', null, describe(s)),
                      h('td', { class: 'muted' }, dNames(s.displayIds)),
                      h('td', null, s.priority),
                      h('td', null, s.enabled === false ? h('span', { class: 'badge off' }, 'Desactivado') : PCSchedule.isActive(s, new Date()) ? h('span', { class: 'badge ok' }, 'Activo ahora') : h('span', { class: 'badge' }, 'En espera')),
                      h(
                        'td',
                        null,
                        h(
                          'div',
                          { class: 'actions' },
                          h('button', { class: 'btn small', onclick: () => scheduleEditor(s, playlists, displays) }, 'Editar'),
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
                    )
                  )
              )
            )
          )
        : h('div', { class: 'empty' }, 'No hay eventos programados.')
    )
  );
};

function scheduleEditor(s, playlists, displays) {
  const days = new Set(s?.days || []);
  const dsel = new Set(s?.displayIds || []);
  const form = h(
    'form',
    { class: 'form' },
    h('h2', null, s ? 'Editar evento' : 'Nuevo evento'),
    h('div', { class: 'row' }, field('Nombre', h('input', { name: 'name', value: s?.name || '', placeholder: 'Ej. Menú del desayuno', required: true })), field('Lista de reproducción', h('select', { name: 'playlistId', required: true }, playlists.map((p) => h('option', { value: p.id, selected: p.id === s?.playlistId }, p.name))))),
    h('div', null, h('b', null, 'Días de la semana '), h('span', { class: 'muted' }, '(ninguno = todos)'), h('div', { class: 'checks' }, [1, 2, 3, 4, 5, 6, 0].map((d) => h('label', null, h('input', { type: 'checkbox', 'data-day': d, checked: days.has(d) }), DAYS[d])))),
    h('div', { class: 'row' }, field('Hora de inicio', h('input', { type: 'time', name: 'startTime', value: s?.startTime || '' })), field('Hora de fin', h('input', { type: 'time', name: 'endTime', value: s?.endTime || '' }), 'Vacío = todo el día. Si el fin es anterior al inicio cruza la medianoche.')),
    h('div', { class: 'row' }, field('Desde la fecha', h('input', { type: 'date', name: 'startDate', value: s?.startDate || '' })), field('Hasta la fecha', h('input', { type: 'date', name: 'endDate', value: s?.endDate || '' }))),
    h('div', { class: 'row' }, field('Prioridad (0–100)', h('input', { type: 'number', name: 'priority', min: 0, max: 100, value: s?.priority ?? 1 })), h('div', { class: 'checks shrink' }, h('label', null, h('input', { type: 'checkbox', name: 'enabled', checked: s ? s.enabled !== false : true }), 'Activado'))),
    h('div', null, h('b', null, 'Pantallas '), h('span', { class: 'muted' }, '(ninguna = todas)'), h('div', { class: 'checks' }, displays.filter((d) => d.authorized).map((d) => h('label', null, h('input', { type: 'checkbox', 'data-display': d.id, checked: dsel.has(d.id) }), d.name)))),
    h('div', { class: 'modal-foot' }, h('button', { type: 'button', class: 'btn', onclick: closeModal }, 'Cancelar'), h('button', { class: 'btn primary' }, 'Guardar'))
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = formData(form);
    const body = {
      ...v,
      enabled: !!form.querySelector('[name=enabled]').checked,
      days: [...form.querySelectorAll('[data-day]:checked')].map((x) => Number(x.dataset.day)),
      displayIds: [...form.querySelectorAll('[data-display]:checked')].map((x) => x.dataset.display),
    };
    guard(async () => {
      if (s) await api('PUT', '/api/schedules/' + s.id, body);
      else await api('POST', '/api/schedules', body);
      closeModal();
      toast('Evento guardado');
      route();
    });
  });
  modal(form);
}

// ---------------------------------------------------------------- Anuncio inmediato
pages.anuncio = async (main) => {
  const displays = (await api('GET', '/api/displays')).filter((d) => d.authorized);
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
    h('div', null, h('b', null, 'Pantallas '), h('span', { class: 'muted' }, '(ninguna = todas)'), h('div', { class: 'checks' }, displays.map((d) => h('label', null, h('input', { type: 'checkbox', 'data-display': d.id }), d.name, d.online ? '' : ' (desconectada)')))),
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
      const body = { ...formData(form), displayIds: [...form.querySelectorAll('[data-display]:checked')].map((x) => x.dataset.display), ...extra };
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
api('GET', '/api/me').then(startApp).catch(showLogin);
