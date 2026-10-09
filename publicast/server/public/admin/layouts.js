/* PubliCast CMS — Layouts: pantalla dividida en zonas (video, imágenes, cintillo, reloj) */
'use strict';

const REGION_TYPES = { playlist: '🎞️ Lista de reproducción', ticker: '📰 Cintillo de noticias', clock: '🕒 Reloj y fecha' };

const LAYOUT_TEMPLATES = [
  { name: 'Pantalla completa', regions: [['playlist', 0, 0, 100, 100]] },
  { name: 'Principal + cintillo', regions: [['playlist', 0, 0, 100, 90], ['ticker', 0, 90, 100, 10]] },
  { name: 'Principal + lateral', regions: [['playlist', 0, 0, 70, 100], ['playlist', 70, 0, 30, 100]] },
  {
    name: 'Noticiero (principal, lateral, reloj y cintillo)',
    regions: [['playlist', 0, 0, 75, 88], ['clock', 75, 0, 25, 22], ['playlist', 75, 22, 25, 66], ['ticker', 0, 88, 100, 12]],
  },
  { name: 'Dos mitades', regions: [['playlist', 0, 0, 50, 100], ['playlist', 50, 0, 50, 100]] },
  { name: 'Cuadrícula 2 × 2', regions: [['playlist', 0, 0, 50, 50], ['playlist', 50, 0, 50, 50], ['playlist', 0, 50, 50, 50], ['playlist', 50, 50, 50, 50]] },
  { name: 'Banner superior + principal', regions: [['playlist', 0, 0, 100, 20], ['playlist', 0, 20, 100, 80]] },
  { name: 'Forma de L (principal, lateral y banda inferior)', regions: [['playlist', 0, 0, 75, 80], ['playlist', 75, 0, 25, 100], ['playlist', 0, 80, 75, 20]] },
];

function newRegion(type, x, y, w, hh, i, playlists) {
  const r = { id: 'r' + Math.random().toString(36).slice(2, 9), name: `Zona ${i + 1}`, type, x, y, w, h: hh, z: i };
  if (type === 'playlist') r.playlistId = playlists[0]?.id || null;
  if (type === 'ticker') r.ticker = { ...TICKER_DEFAULTS, text: 'Escriba aquí sus noticias · Ofertas · Avisos', size: 4.4 };
  if (type === 'clock') r.clock = { ...CLOCK_DEFAULTS };
  if (type === 'ticker') r.name = 'Cintillo';
  if (type === 'clock') r.name = 'Reloj';
  return r;
}

pages.layouts = async (main) => {
  const [cat, displays, schedules] = await Promise.all([loadCatalog(), api('GET', '/api/displays'), api('GET', '/api/schedules')]);
  const id = location.hash.split('/')[2];
  if (id) return layoutEditor(main, id === 'nuevo' ? null : cat.layouts.find((l) => l.id === id), cat);
  mount(
    main,
    pageHead('Layouts', 'Divida la pantalla en zonas: video principal, imágenes laterales, cintillo de noticias, reloj…', h('a', { class: 'btn primary', href: '#/layouts/nuevo' }, '+ Nuevo layout')),
    cat.layouts.length
      ? h(
          'div',
          { class: 'layout-grid' },
          cat.layouts.map((l) => {
            const key = 'l:' + l.id;
            const uses = displays.filter((d) => d.defaultContent === key).length + schedules.filter((s) => PCSchedule.contentKey(s) === key).length;
            return h(
              'div',
              { class: 'card layout-card' },
              h('a', { href: '#/layouts/' + l.id }, contentThumb(key, cat)),
              h('div', { class: 'name' }, h('b', null, l.name)),
              h('div', { class: 'muted' }, `${l.regions.length} zona(s) · ${l.orientation === 'portrait' ? 'Vertical' : 'Horizontal'} · ${uses ? `en uso (${uses})` : 'sin usar'}`),
              h(
                'div',
                { class: 'actions' },
                h('a', { class: 'btn small', href: '#/layouts/' + l.id }, 'Editar'),
                h('button', { class: 'btn small', onclick: () => previewContent(key, l.name, l.orientation === 'portrait') }, 'Vista previa'),
                h(
                  'button',
                  {
                    class: 'btn small danger',
                    onclick: async () => {
                      if (!(await confirmBox(`¿Eliminar el layout "${l.name}"? También se eliminarán sus eventos programados.`))) return;
                      await guard(() => api('DELETE', '/api/layouts/' + l.id));
                      route();
                    },
                  },
                  'Eliminar'
                )
              )
            );
          })
        )
      : h('div', { class: 'card empty' }, 'Aún no hay layouts. Cree uno a partir de una plantilla.')
  );
};

function layoutEditor(main, layout, cat) {
  const state = {
    name: layout?.name || '',
    orientation: layout?.orientation || 'landscape',
    background: layout?.background || '#000000',
    regions: layout ? JSON.parse(JSON.stringify(layout.regions)) : [],
  };
  if (!layout) LAYOUT_TEMPLATES[3].regions.forEach(([t, x, y, w, hh], i) => state.regions.push(newRegion(t, x, y, w, hh, i, cat.playlists)));
  let selected = state.regions[0]?.id || null;
  let live = [];
  let dirty = false;

  const canvas = h('div', { class: 'lcanvas' });
  const side = h('div', { class: 'lside' });
  const regionList = h('div', { class: 'rlist' });
  const props = h('div', { class: 'rprops' });

  const sel = () => state.regions.find((r) => r.id === selected);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const round = (v) => Math.round(v * 2) / 2; // pasos de 0,5 %

  function boxStyle(el, r) {
    Object.assign(el.style, { left: r.x + '%', top: r.y + '%', width: r.w + '%', height: r.h + '%', zIndex: r.z + 1 });
  }

  function drawCanvas() {
    live.forEach((w) => w.stop());
    live = [];
    canvas.className = 'lcanvas' + (state.orientation === 'portrait' ? ' portrait' : '');
    canvas.style.background = state.background;
    mount(canvas);
    state.regions
      .slice()
      .sort((a, b) => a.z - b.z)
      .forEach((r) => {
        const box = h('div', { class: 'lreg' + (r.id === selected ? ' sel' : '') });
        boxStyle(box, r);
        const body = h('div', { class: 'lreg-body' });
        if (r.type === 'playlist') body.append(playlistThumb(cat.playlists.find((p) => p.id === r.playlistId), cat, 'cfill'));
        if (r.type === 'ticker' && r.ticker?.text) live.push(PCWidgets.makeTicker(body, r.ticker, true, 'cqh'));
        if (r.type === 'clock') live.push(PCWidgets.makeClock(body, r.clock || {}, () => new Date(), 'cqh'));
        box.append(body, h('div', { class: 'lreg-label' }, r.name));
        ['nw', 'ne', 'sw', 'se'].forEach((c) => box.append(h('div', { class: 'handle-' + c, 'data-handle': c })));
        enableDrag(box, r);
        canvas.append(box);
      });
  }

  /** Arrastrar para mover; arrastrar las esquinas para cambiar el tamaño. */
  function enableDrag(box, r) {
    box.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (selected !== r.id) {
        selected = r.id;
        drawList();
        drawProps();
        canvas.querySelectorAll('.lreg').forEach((b) => b.classList.remove('sel'));
        box.classList.add('sel');
      }
      const handle = e.target.dataset.handle;
      const rect = canvas.getBoundingClientRect();
      const start = { x: r.x, y: r.y, w: r.w, h: r.h, px: e.clientX, py: e.clientY };
      box.setPointerCapture(e.pointerId);
      const onMove = (ev) => {
        const dx = ((ev.clientX - start.px) / rect.width) * 100;
        const dy = ((ev.clientY - start.py) / rect.height) * 100;
        if (!handle) {
          r.x = round(clamp(start.x + dx, 0, 100 - r.w));
          r.y = round(clamp(start.y + dy, 0, 100 - r.h));
        } else {
          let { x, y, w, h: hh } = start;
          if (handle.includes('e')) w = clamp(start.w + dx, 2, 100 - x);
          if (handle.includes('s')) hh = clamp(start.h + dy, 2, 100 - y);
          if (handle.includes('w')) {
            x = clamp(start.x + dx, 0, start.x + start.w - 2);
            w = start.w + (start.x - x);
          }
          if (handle.includes('n')) {
            y = clamp(start.y + dy, 0, start.y + start.h - 2);
            hh = start.h + (start.y - y);
          }
          Object.assign(r, { x: round(x), y: round(y), w: round(w), h: round(hh) });
        }
        boxStyle(box, r);
        syncGeometryInputs();
        dirty = true;
      };
      const onUp = () => {
        box.removeEventListener('pointermove', onMove);
        box.removeEventListener('pointerup', onUp);
        drawCanvas();
      };
      box.addEventListener('pointermove', onMove);
      box.addEventListener('pointerup', onUp);
    });
  }

  let geomInputs = {};
  function syncGeometryInputs() {
    const r = sel();
    if (!r) return;
    Object.entries(geomInputs).forEach(([k, input]) => (input.value = r[k]));
  }

  function drawList() {
    mount(
      regionList,
      state.regions
        .slice()
        .sort((a, b) => b.z - a.z)
        .map((r) =>
          h(
            'div',
            {
              class: 'ritem' + (r.id === selected ? ' sel' : ''),
              onclick: () => {
                selected = r.id;
                drawAll();
              },
            },
            h('span', null, REGION_TYPES[r.type].split(' ')[0]),
            h('b', null, r.name),
            h('span', { class: 'muted' }, `${r.w}×${r.h}%`)
          )
        )
    );
  }

  function drawProps() {
    const r = sel();
    geomInputs = {};
    if (!r) return mount(props, h('div', { class: 'empty' }, 'Seleccione una zona o añada una nueva.'));
    const changed = () => {
      dirty = true;
      drawCanvas();
      drawList();
    };
    const geo = (k, label, max) => {
      const input = h('input', { type: 'number', step: 0.5, min: 0, max, value: r[k] });
      input.addEventListener('change', () => {
        const v = Number(input.value) || 0;
        if (k === 'x') r.x = clamp(v, 0, 100 - r.w);
        if (k === 'y') r.y = clamp(v, 0, 100 - r.h);
        if (k === 'w') r.w = clamp(v, 1, 100 - r.x);
        if (k === 'h') r.h = clamp(v, 1, 100 - r.y);
        input.value = r[k];
        changed();
      });
      geomInputs[k] = input;
      return field(label, input);
    };
    const nameInput = h('input', { value: r.name });
    nameInput.addEventListener('input', () => {
      r.name = nameInput.value;
      dirty = true;
      drawList();
      canvas.querySelector('.lreg.sel .lreg-label') && (canvas.querySelector('.lreg.sel .lreg-label').textContent = r.name);
    });
    const typeSelect = h('select', null, Object.entries(REGION_TYPES).map(([v, l]) => h('option', { value: v, selected: r.type === v }, l)));
    typeSelect.addEventListener('change', () => {
      const fresh = newRegion(typeSelect.value, r.x, r.y, r.w, r.h, r.z, cat.playlists);
      delete r.playlistId;
      delete r.ticker;
      delete r.clock;
      Object.assign(r, { type: fresh.type, playlistId: fresh.playlistId, ticker: fresh.ticker, clock: fresh.clock });
      changed();
      drawProps();
    });
    let typeProps = null;
    if (r.type === 'playlist') {
      const ps = h('select', null, h('option', { value: '' }, '— Seleccione una lista —'), cat.playlists.map((p) => h('option', { value: p.id, selected: p.id === r.playlistId }, p.name)));
      ps.addEventListener('change', () => {
        r.playlistId = ps.value || null;
        changed();
      });
      typeProps = h('div', null, field('Lista que se reproduce en esta zona', ps, cat.playlists.length ? 'El cintillo propio de la lista no se muestra dentro de un layout: use una zona de cintillo.' : h('a', { href: '#/listas/nueva' }, 'Primero cree una lista de reproducción')));
    }
    if (r.type === 'ticker') {
      r.ticker = r.ticker || { ...TICKER_DEFAULTS };
      typeProps = tickerEditor(r.ticker, { fill: true });
      typeProps.addEventListener('input', changed);
      typeProps.addEventListener('change', changed);
    }
    if (r.type === 'clock') {
      r.clock = r.clock || { ...CLOCK_DEFAULTS };
      typeProps = clockEditor(r.clock);
      typeProps.addEventListener('input', changed);
      typeProps.addEventListener('change', changed);
    }
    const zMove = (dir) => {
      const order = state.regions.slice().sort((a, b) => a.z - b.z);
      const i = order.indexOf(r);
      const j = i + dir;
      if (j < 0 || j >= order.length) return;
      [order[i], order[j]] = [order[j], order[i]];
      order.forEach((x, k) => (x.z = k));
      changed();
    };
    mount(
      props,
      h('h3', null, 'Zona seleccionada'),
      h('div', { class: 'row' }, field('Nombre', nameInput), field('Tipo', typeSelect)),
      h('div', { class: 'row geo' }, geo('x', 'Izquierda %', 99), geo('y', 'Arriba %', 99), geo('w', 'Ancho %', 100), geo('h', 'Alto %', 100)),
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'btn small', onclick: () => zMove(1), title: 'Poner por encima de otras zonas' }, '⬆ Traer al frente'),
        h('button', { class: 'btn small', onclick: () => zMove(-1) }, '⬇ Enviar atrás'),
        h('button', { class: 'btn small', onclick: () => {
              Object.assign(r, { x: 0, y: 0, w: 100, h: 100 });
              syncGeometryInputs();
              changed();
            },
          }, '⛶ Pantalla completa'),
        h(
          'button',
          {
            class: 'btn small danger',
            onclick: () => {
              state.regions = state.regions.filter((x) => x !== r);
              selected = state.regions[0]?.id || null;
              dirty = true;
              drawAll();
            },
          },
          '✕ Eliminar zona'
        )
      ),
      typeProps
    );
  }

  function drawAll() {
    drawCanvas();
    drawList();
    drawProps();
  }

  const addRegion = (type) => {
    const r = newRegion(type, 10, 10, type === 'ticker' ? 80 : 40, type === 'ticker' ? 10 : 40, state.regions.length, cat.playlists);
    r.z = Math.max(-1, ...state.regions.map((x) => x.z)) + 1;
    if (type === 'ticker') Object.assign(r, { x: 0, y: 90, w: 100 });
    state.regions.push(r);
    selected = r.id;
    dirty = true;
    drawAll();
  };

  const applyTemplate = async (tpl) => {
    if (state.regions.length && !(await confirmBox(`¿Reemplazar las zonas actuales por la plantilla "${tpl.name}"?`))) return;
    state.regions = tpl.regions.map(([t, x, y, w, hh], i) => newRegion(t, x, y, w, hh, i, cat.playlists));
    selected = state.regions[0]?.id;
    dirty = true;
    drawAll();
  };

  const save = async () => {
    if (!state.name.trim()) return toast('Escriba un nombre para el layout', true), null;
    if (state.regions.some((r) => r.type === 'playlist' && !r.playlistId)) toast('Hay zonas sin lista asignada: se mostrarán vacías', true);
    return guard(async () => {
      const saved = layout ? await api('PUT', '/api/layouts/' + layout.id, state) : await api('POST', '/api/layouts', state);
      dirty = false;
      toast('Layout guardado. Las pantallas se actualizarán en unos segundos.');
      if (!layout) location.hash = '#/layouts/' + saved.id;
      return saved;
    });
  };

  const nameIn = h('input', { value: state.name, placeholder: 'Ej. Vitrina con noticias' });
  nameIn.addEventListener('input', () => ((state.name = nameIn.value), (dirty = true)));
  const orient = h('select', null, h('option', { value: 'landscape', selected: state.orientation !== 'portrait' }, 'Horizontal (16:9)'), h('option', { value: 'portrait', selected: state.orientation === 'portrait' }, 'Vertical (9:16)'));
  orient.addEventListener('change', () => ((state.orientation = orient.value), (dirty = true), drawCanvas()));
  const bg = h('input', { type: 'color', value: state.background });
  bg.addEventListener('input', () => ((state.background = bg.value), (dirty = true), drawCanvas()));
  const tplSelect = h('select', null, h('option', { value: '' }, '📐 Aplicar plantilla…'), LAYOUT_TEMPLATES.map((t, i) => h('option', { value: i }, t.name)));
  tplSelect.addEventListener('change', () => {
    if (tplSelect.value !== '') applyTemplate(LAYOUT_TEMPLATES[Number(tplSelect.value)]);
    tplSelect.value = '';
  });

  mount(
    main,
    pageHead(
      layout ? 'Editar layout' : 'Nuevo layout',
      h('a', { href: '#/layouts' }, '← Volver a los layouts'),
      h(
        'button',
        {
          class: 'btn',
          onclick: async () => {
            const saved = dirty || !layout ? await save() : layout;
            if (saved) previewContent('l:' + saved.id, state.name, state.orientation === 'portrait');
          },
        },
        '▶ Vista previa'
      ),
      h('button', { class: 'btn primary', onclick: save }, '💾 Guardar')
    ),
    h('div', { class: 'card form' }, h('div', { class: 'row' }, field('Nombre', nameIn), field('Orientación', orient), field('Plantillas', tplSelect), h('div', { class: 'shrink' }, field('Fondo', bg)))),
    h(
      'div',
      { class: 'leditor' },
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'muted', style: { marginBottom: '8px' } }, 'Arrastre las zonas para moverlas y sus esquinas para cambiar el tamaño.'),
        canvas,
        h(
          'div',
          { class: 'actions', style: { marginTop: '12px' } },
          h('button', { class: 'btn small', onclick: () => addRegion('playlist') }, '+ 🎞️ Zona de lista'),
          h('button', { class: 'btn small', onclick: () => addRegion('ticker') }, '+ 📰 Cintillo'),
          h('button', { class: 'btn small', onclick: () => addRegion('clock') }, '+ 🕒 Reloj y fecha')
        )
      ),
      h('div', { class: 'card' }, side)
    )
  );
  side.append(h('h3', { style: { marginTop: 0 } }, 'Zonas (de delante hacia atrás)'), regionList, props);
  drawAll();
}
