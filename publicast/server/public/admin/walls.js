/* PubliCast CMS — Videowall: varias pantallas que forman una sola imagen */
'use strict';

pages.videowall = async (main) => {
  const [walls, displays, cat] = await Promise.all([api('GET', '/api/walls'), api('GET', '/api/displays'), loadCatalog()]);
  const id = location.hash.split('/')[2];
  if (id) return wallEditor(main, id === 'nuevo' ? null : walls.find((w) => w.id === id), displays, cat);
  mount(
    main,
    pageHead('Videowall', 'Una sola imagen o video repartido entre varias pantallas, reproducido de forma sincronizada', h('a', { class: 'btn primary', href: '#/videowall/nuevo' }, '+ Nuevo videowall')),
    walls.length
      ? h(
          'div',
          { class: 'layout-grid' },
          walls.map((w) =>
            h(
              'div',
              { class: 'card' },
              h('h2', null, '🧱 ' + w.name),
              wallGrid(w, displays, null),
              h('div', { class: 'muted', style: { margin: '8px 0' } }, `${w.cols} × ${w.rows} pantallas · Contenido: ${w.content ? contentLabel(w.content, cat) : 'el de la programación / cada pantalla'}`),
              h(
                'div',
                { class: 'actions' },
                h('a', { class: 'btn small', href: '#/videowall/' + w.id }, 'Configurar'),
                h('button', { class: 'btn small', onclick: () => identifyWall(w) }, '🔢 Identificar'),
                h(
                  'button',
                  {
                    class: 'btn small danger',
                    onclick: async () => {
                      if (!(await confirmBox(`¿Eliminar el videowall "${w.name}"? Las pantallas volverán a reproducir su propio contenido.`))) return;
                      await guard(() => api('DELETE', '/api/walls/' + w.id));
                      route();
                    },
                  },
                  'Eliminar'
                )
              )
            )
          )
        )
      : h(
          'div',
          { class: 'card' },
          h('div', { class: 'empty' }, 'Aún no hay videowalls.'),
          h('p', null, 'Un videowall combina varias pantallas (por ejemplo 2 × 2) para mostrar un único contenido gigante. Cada pantalla muestra automáticamente su porción y todas cambian de contenido al mismo tiempo.')
        )
  );
};

async function identifyWall(w) {
  await guard(async () => {
    const r = await api('POST', `/api/walls/${w.id}/identify`, { seconds: 20 });
    toast(`Cada pantalla muestra su número (${r.delivered} de ${r.total} conectadas)`, !r.delivered);
  });
}

/** Cuadrícula del videowall con el número de posición de cada pantalla (1, 2, 3…). */
function wallGrid(w, displays, onCell) {
  const grid = h('div', { class: 'wall-grid', style: { gridTemplateColumns: `repeat(${w.cols}, 1fr)` } });
  for (let r = 0; r < w.rows; r++)
    for (let c = 0; c < w.cols; c++) {
      const cell = w.cells.find((x) => x.row === r && x.col === c);
      const d = cell && displays.find((x) => x.id === cell.displayId);
      grid.append(
        h(
          'div',
          { class: 'wall-cell' + (d ? '' : ' empty-cell') },
          h('div', { class: 'wall-num' }, r * w.cols + c + 1),
          onCell ? onCell(r, c, cell) : h('div', { class: 'wall-name' }, d ? d.name : 'Sin asignar'),
          d && !onCell ? h('div', { class: 'muted small' }, h('span', { class: 'dot' + (d.online ? ' ok' : '') }), d.online ? 'En línea' : 'Desconectada') : null
        )
      );
    }
  return grid;
}

function wallEditor(main, wall, displays, cat) {
  const state = {
    name: wall?.name || '',
    rows: wall?.rows || 1,
    cols: wall?.cols || 2,
    content: wall?.content || '',
    cells: (wall?.cells || []).map((c) => ({ ...c })),
  };
  const authorized = displays.filter((d) => d.authorized);
  const gridBox = h('div');
  const warn = h('div', { class: 'error' });

  const draw = () => {
    state.cells = state.cells.filter((c) => c.row < state.rows && c.col < state.cols);
    const used = new Map(state.cells.map((c) => [c.displayId, c]));
    mount(
      gridBox,
      wallGrid(state, displays, (r, c, cell) => {
        const select = h(
          'select',
          null,
          h('option', { value: '' }, '— Sin pantalla —'),
          authorized.map((d) => {
            const other = used.get(d.id);
            const busy = other && !(other.row === r && other.col === c);
            const inOtherWall = d.wall && d.wall.id !== wall?.id;
            return h(
              'option',
              { value: d.id, selected: cell?.displayId === d.id },
              `${d.number ? '#' + d.number + ' ' : ''}${d.name}${busy ? ' (ya asignada)' : inOtherWall ? ` (en ${d.wall.name})` : ''}${d.online ? '' : ' · desconectada'}`
            );
          })
        );
        select.addEventListener('change', () => {
          state.cells = state.cells.filter((x) => !(x.row === r && x.col === c) && x.displayId !== select.value);
          if (select.value) state.cells.push({ row: r, col: c, displayId: select.value });
          draw();
        });
        return select;
      })
    );
    const res = h('div', { class: 'muted' }, `Resolución recomendada del contenido: ${state.cols * 1920} × ${state.rows * 1080} px (con pantallas Full HD horizontales).`);
    gridBox.append(res);
    warn.textContent = state.cells.length < state.rows * state.cols ? `Faltan ${state.rows * state.cols - state.cells.length} pantalla(s) por asignar.` : '';
  };

  const num = (key, label) => {
    const input = h('input', { type: 'number', min: 1, max: 8, value: state[key] });
    input.addEventListener('change', () => {
      state[key] = Math.max(1, Math.min(8, Number(input.value) || 1));
      input.value = state[key];
      draw();
    });
    return field(label, input);
  };
  const nameIn = h('input', { value: state.name, placeholder: 'Ej. Videowall recepción' });
  nameIn.addEventListener('input', () => (state.name = nameIn.value));
  const contentSel = h('select', null, contentOptions(cat, state.content, '— Usar la programación de cada pantalla —'));
  contentSel.addEventListener('change', () => (state.content = contentSel.value));

  const save = async () => {
    if (!state.name.trim()) return toast('Escriba un nombre para el videowall', true), null;
    return guard(async () => {
      const saved = wall ? await api('PUT', '/api/walls/' + wall.id, state) : await api('POST', '/api/walls', state);
      toast('Videowall guardado. Las pantallas se reorganizarán en unos segundos.');
      if (!wall) location.hash = '#/videowall/' + saved.id;
      return saved;
    });
  };

  mount(
    main,
    pageHead(
      wall ? 'Configurar videowall' : 'Nuevo videowall',
      h('a', { href: '#/videowall' }, '← Volver a los videowalls'),
      h(
        'button',
        {
          class: 'btn',
          title: 'Guarda y muestra el número de posición en cada pantalla',
          onclick: async () => {
            const saved = await save();
            if (saved) identifyWall(saved);
          },
        },
        '🔢 Identificar pantallas'
      ),
      h('button', { class: 'btn primary', onclick: save }, '💾 Guardar')
    ),
    h(
      'div',
      { class: 'card form' },
      h('div', { class: 'row' }, field('Nombre', nameIn), num('cols', 'Columnas (pantallas a lo ancho)'), num('rows', 'Filas (pantallas a lo alto)')),
      field('Contenido del videowall', contentSel, 'Se muestra repartido entre todas las pantallas. También puede programar el videowall desde "Programación".')
    ),
    h(
      'div',
      { class: 'card' },
      h('h2', null, 'Posición de cada pantalla'),
      h('p', { class: 'muted' }, 'Pulse "Identificar pantallas": cada televisor mostrará un número grande. Asigne aquí cada número físico a su posición (1 = arriba a la izquierda, de izquierda a derecha y de arriba abajo).'),
      gridBox,
      warn
    ),
    h(
      'div',
      { class: 'card' },
      h('h2', null, 'Consejos'),
      h(
        'ul',
        null,
        h('li', null, 'Use pantallas del mismo modelo y la misma orientación, y la misma versión de la app.'),
        h('li', null, 'Todas las pantallas cambian de contenido a la vez porque se guían por la hora del servidor. Para videos, guarde primero la duración abriendo la Biblioteca (se detecta sola).'),
        h('li', null, 'En el videowall las transiciones se desactivan para que todas las pantallas cambien exactamente al mismo tiempo.'),
        h('li', null, 'Si usa un layout en el videowall, el cintillo y el reloj también se extienden sobre todas las pantallas.')
      )
    )
  );
  draw();
}
