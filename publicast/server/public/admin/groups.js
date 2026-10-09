/* PubliCast CMS — Sucursales: agrupar pantallas por local o zona */
'use strict';

pages.sucursales = async (main) => {
  const [groups, displays, schedules] = await Promise.all([api('GET', '/api/groups'), api('GET', '/api/displays'), api('GET', '/api/schedules')]);
  const authorized = displays.filter((d) => d.authorized);
  const unassigned = authorized.filter((d) => !d.groupId);
  mount(
    main,
    pageHead('Sucursales', 'Agrupe sus pantallas por local, ciudad o zona para programar y enviar anuncios a todo el grupo', h('button', { class: 'btn primary', onclick: () => groupEditor(null, authorized) }, '+ Nueva sucursal')),
    groups.length
      ? h(
          'div',
          { class: 'group-grid' },
          groups.map((g) => {
            const list = authorized.filter((d) => d.groupId === g.id);
            const online = list.filter((d) => d.online).length;
            const evs = schedules.filter((s) => s.groupIds?.includes(g.id)).length;
            return h(
              'div',
              { class: 'card group-card', style: { '--gc': g.color } },
              h('h2', null, '🏢 ' + g.name),
              g.address ? h('div', { class: 'muted' }, '📍 ' + g.address) : null,
              h('div', { class: 'muted' }, `${list.length} pantalla(s) · ${online} en línea · ${evs} evento(s) programado(s)`),
              h(
                'div',
                { class: 'dlist' },
                list.length
                  ? list.map((d) => h('div', null, h('span', { class: 'dot' + (d.online ? ' ok' : '') }), d.number ? h('span', { class: 'dnum' }, d.number) : null, d.name))
                  : h('div', { class: 'muted' }, 'Sin pantallas asignadas')
              ),
              h(
                'div',
                { class: 'actions' },
                h('button', { class: 'btn small', onclick: () => groupEditor(g, authorized) }, 'Editar y asignar pantallas'),
                h(
                  'button',
                  {
                    class: 'btn small',
                    onclick: () =>
                      guard(async () => {
                        let n = 0;
                        for (const d of list) n += (await api('POST', `/api/displays/${d.id}/command`, { type: 'identify' })).delivered ? 1 : 0;
                        toast(`Identificando ${n} pantalla(s) de ${g.name}`, !n);
                      }),
                  },
                  '🔢 Identificar'
                ),
                h('a', { class: 'btn small', href: '#/programacion' }, '🗓️ Programar'),
                h(
                  'button',
                  {
                    class: 'btn small danger',
                    onclick: async () => {
                      if (!(await confirmBox(`¿Eliminar la sucursal "${g.name}"? Sus pantallas quedarán sin sucursal.`))) return;
                      await guard(() => api('DELETE', '/api/groups/' + g.id));
                      route();
                    },
                  },
                  'Eliminar'
                )
              )
            );
          })
        )
      : h('div', { class: 'card empty' }, 'Aún no hay sucursales. Cree una (por ejemplo "Sucursal Centro") y asígnele sus pantallas.'),
    unassigned.length && groups.length ? h('div', { class: 'card' }, h('h2', null, 'Pantallas sin sucursal'), h('div', { class: 'checks' }, unassigned.map((d) => h('span', null, '🖥️ ' + d.name)))) : null
  );
};

function groupEditor(g, displays) {
  const sel = new Set(displays.filter((d) => g && d.groupId === g.id).map((d) => d.id));
  const form = h(
    'form',
    { class: 'form' },
    h('h2', null, g ? 'Editar sucursal' : 'Nueva sucursal'),
    h('div', { class: 'row' }, field('Nombre', h('input', { name: 'name', value: g?.name || '', placeholder: 'Ej. Sucursal Centro', required: true })), h('div', { class: 'shrink' }, field('Color', h('input', { type: 'color', name: 'color', value: g?.color || '#2563eb' })))),
    field('Dirección (opcional)', h('input', { name: 'address', value: g?.address || '', placeholder: 'Av. Principal 123, Ciudad' })),
    h(
      'div',
      null,
      h('b', null, 'Pantallas de esta sucursal'),
      displays.length
        ? h('div', { class: 'checks' }, displays.map((d) => h('label', null, h('input', { type: 'checkbox', 'data-display': d.id, checked: sel.has(d.id) }), (d.number ? `#${d.number} ` : '') + d.name + (d.group && (!g || d.groupId !== g.id) ? ` (ahora en ${d.group})` : ''))))
        : h('div', { class: 'muted' }, 'Todavía no hay pantallas autorizadas.')
    ),
    h('div', { class: 'modal-foot' }, h('button', { type: 'button', class: 'btn', onclick: closeModal }, 'Cancelar'), h('button', { class: 'btn primary' }, 'Guardar'))
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    guard(async () => {
      const saved = g ? await api('PUT', '/api/groups/' + g.id, formData(form)) : await api('POST', '/api/groups', formData(form));
      await api('POST', `/api/groups/${saved.id}/displays`, { displayIds: [...form.querySelectorAll('[data-display]:checked')].map((x) => x.dataset.display) });
      closeModal();
      toast('Sucursal guardada');
      route();
    });
  });
  modal(form);
}
