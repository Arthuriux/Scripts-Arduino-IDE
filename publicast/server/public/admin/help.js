/* PubliCast CMS — guía "Cómo usar" */
'use strict';

pages.ayuda = async (main) => {
  const origin = location.origin;
  const link = (hash, text) => h('a', { href: hash }, text);
  const steps = (...items) => h('ol', null, items.map((i) => h('li', null, i)));
  const tip = (...c) => h('div', { class: 'tip' }, '💡 ', c);
  const sections = [
    {
      id: 'inicio',
      icon: '🚀',
      title: 'Puesta en marcha en 5 minutos',
      body: [
        steps(
          ['Suba sus imágenes y videos en ', link('#/biblioteca', 'Biblioteca'), '.'],
          ['Cree una ', link('#/listas', 'lista de reproducción'), ' y añada esos contenidos.'],
          ['Instale la app en el Android (', h('a', { href: '/download/publicast-player.apk' }, 'descargar APK'), ') y escriba la dirección ', h('code', null, origin), '.'],
          ['En ', link('#/pantallas', 'Pantallas'), ' escriba el código de 6 dígitos que aparece en el televisor y elija la lista por defecto.'],
          'Listo: la pantalla descarga el contenido y empieza a reproducir. Cualquier cambio llega en segundos.'
        ),
      ],
    },
    {
      id: 'pantallas',
      icon: '🖥️',
      title: 'Pantallas: conectar, nombrar e identificar',
      body: [
        steps(
          'Abra PubliCast Player en el dispositivo, escriba la dirección del servidor (la que muestra la ventana del servidor al arrancar, por ejemplo http://192.168.1.10:8080) y pulse Conectar.',
          ['Aparece un código de 6 dígitos. En ', link('#/pantallas', 'Pantallas → Autorizar una pantalla nueva'), ' escríbalo junto con un nombre.'],
          'Cada pantalla recibe un número (#1, #2, #3…). Puede cambiarlo en "Editar".'
        ),
        h('p', null, h('b', null, 'Identificar: '), 'igual que en la configuración de pantallas de Windows, el botón "Identificar" (o "🔢 Identificar todas") muestra en cada televisor su número en grande durante 15 segundos. Así sabe cuál es cuál.'),
        h('p', null, 'En "Editar" también puede indicar la ubicación, la orientación (horizontal/vertical) y el contenido por defecto. "Recargar" reinicia la reproducción.'),
        tip('Si la app no conecta: use la IP local (no "localhost"), compruebe que el Firewall de Windows permite el puerto 8080 y que ambos equipos están en la misma red.'),
      ],
    },
    {
      id: 'biblioteca',
      icon: '🖼️',
      title: 'Biblioteca de contenidos',
      body: [
        h('p', null, 'Arrastre archivos a la zona de subida o haga clic para elegirlos. Formatos: JPG, PNG, GIF animado, WebP, MP4, WebM, MKV y MOV.'),
        h('ul', null, h('li', null, h('b', null, '🌐 Página web: '), 'muestra una URL a pantalla completa (menús digitales, tableros, redes sociales).'), h('li', null, h('b', null, '🔤 Mensaje de texto: '), 'título y texto con los colores que elija, sin necesidad de diseñar una imagen.')),
        h('p', null, 'La "duración" es el tiempo que se muestra cada imagen. En videos, 0 = se reproduce completo.'),
        tip('Resolución recomendada: 1920 × 1080 (horizontal) o 1080 × 1920 (vertical). Videos en MP4 (H.264).'),
      ],
    },
    {
      id: 'listas',
      icon: '🎞️',
      title: 'Listas de reproducción',
      body: [
        steps('Pulse "+ Nueva lista" y escriba un nombre.', 'Pulse "+ Añadir contenidos" y marque los que quiera.', 'Ordénelos arrastrando (⋮⋮) o con las flechas, y ajuste los segundos de cada uno.', 'Elija la transición (fundido, deslizar) y cómo se ajustan las imágenes.', 'Guarde. Con "▶ Vista previa" verá cómo queda.'),
      ],
    },
    {
      id: 'cintillo',
      icon: '📰',
      title: 'Cintillo de noticias',
      body: [
        h('p', null, 'Es el texto que se desplaza continuamente (como en los noticieros). Puede añadirlo de dos formas:'),
        h('ul', null, h('li', null, 'En una ', link('#/listas', 'lista de reproducción'), ': sección "Cintillo de noticias", arriba o abajo de la pantalla.'), h('li', null, 'En un ', link('#/layouts', 'layout'), ': como una zona más, con la posición y el tamaño que quiera.')),
        h('p', null, 'Opciones: texto, velocidad, ', h('b', null, 'tipo de letra'), ', ', h('b', null, 'tamaño'), ' (en % del alto de la pantalla), negrita, ', h('b', null, 'color'), ' del texto y del fondo, y ', h('b', null, 'transparencia'), ' del fondo (0 = totalmente transparente). La vista previa se actualiza al instante.'),
        tip('Separe los mensajes con " · " para que se lean mejor.'),
      ],
    },
    {
      id: 'layouts',
      icon: '🧩',
      title: 'Layouts: dividir la pantalla en zonas',
      body: [
        h('p', null, 'Un layout reparte la pantalla en zonas que se reproducen a la vez: por ejemplo un video grande, imágenes laterales, el reloj con la fecha y el cintillo abajo.'),
        steps(
          ['Vaya a ', link('#/layouts', 'Layouts'), ' → "+ Nuevo layout" y elija una plantilla (Noticiero, Principal + lateral, Cuadrícula 2 × 2…).'],
          'Arrastre cada zona para moverla y sus esquinas para cambiar su tamaño. También puede escribir las medidas exactas en %.',
          'Seleccione una zona y elija qué muestra: una lista de reproducción, un cintillo o el reloj y fecha.',
          'Use "Traer al frente / Enviar atrás" si quiere superponer zonas (por ejemplo, un logo sobre el video).',
          'Guarde y asígnelo a una pantalla, a un videowall o a un evento de la programación, igual que una lista.'
        ),
      ],
    },
    {
      id: 'programacion',
      icon: '🗓️',
      title: 'Programación por horarios',
      body: [
        h('p', null, 'Sirve para que cada contenido salga sólo cuando corresponde (desayunos por la mañana, promociones el fin de semana, campañas con fecha de inicio y fin).'),
        steps('Pulse "+ Nuevo evento" y elija la lista o el layout (verá su miniatura).', 'Marque los días, la hora de inicio y de fin, y opcionalmente el rango de fechas.', 'Elija las pantallas o videowalls (ninguna = todas) y la prioridad.'),
        h('p', null, 'La tabla muestra la miniatura, la fecha y el horario de cada evento; abajo, la ', h('b', null, 'vista semanal'), ' dibuja los eventos en el calendario con una línea roja en la hora actual.'),
        tip('Si dos eventos coinciden gana el de mayor prioridad. Con la misma prioridad, sus listas se intercalan. Fuera de cualquier evento, la pantalla muestra su contenido por defecto.'),
      ],
    },
    {
      id: 'videowall',
      icon: '🧱',
      title: 'Videowall',
      body: [
        h('p', null, 'Combina varias pantallas (por ejemplo 2 × 2 o 3 × 1) para mostrar una sola imagen o video gigante. Cada pantalla muestra automáticamente su porción.'),
        steps(
          'Coloque físicamente las pantallas y autorícelas en "Pantallas".',
          ['En ', link('#/videowall', 'Videowall'), ' → "+ Nuevo videowall" indique columnas y filas.'],
          'Pulse "🔢 Identificar pantallas": cada televisor muestra un número grande (como Windows).',
          'En la cuadrícula asigne cada pantalla a su posición: 1 es arriba a la izquierda, se cuenta de izquierda a derecha y de arriba abajo.',
          'Elija el contenido del videowall y guarde.'
        ),
        tip('Prepare los contenidos con la resolución total del videowall (por ejemplo 3840 × 2160 para 2 × 2 pantallas Full HD). Todas las pantallas cambian a la vez guiándose por la hora del servidor.'),
      ],
    },
    {
      id: 'anuncio',
      icon: '📢',
      title: 'Anuncio inmediato',
      body: [h('p', null, 'En ', link('#/anuncio', 'Anuncio inmediato'), ' escriba un mensaje urgente y pulse "Enviar ahora": aparece al instante sobre el contenido (pantalla completa o banda superior/inferior) durante los segundos que indique.')],
    },
    {
      id: 'estadisticas',
      icon: '📈',
      title: 'Estadísticas (prueba de reproducción)',
      body: [h('p', null, 'En ', link('#/estadisticas', 'Estadísticas'), ' verá cuántas veces y cuánto tiempo se mostró cada contenido en cada pantalla. Descargue el CSV para entregarlo a sus anunciantes.')],
    },
    {
      id: 'reproductor',
      icon: '📱',
      title: 'Menú oculto del reproductor Android',
      body: [
        h('p', null, 'Toque 5 veces seguidas la esquina superior izquierda de la pantalla, o pulse "Menú" / mantenga pulsado "OK" en el mando. Desde ahí puede cambiar de servidor, forzar la sincronización, volver a emparejar, ver información o salir.'),
        tip('Para modo quiosco, elija PubliCast como "pantalla de inicio" del Android: arrancará sola al encender y el público no podrá salir.'),
      ],
    },
  ];
  mount(
    main,
    pageHead('Cómo usar PubliCast', 'Guía rápida de todas las funciones'),
    h('div', { class: 'card help-toc' }, sections.map((s) => h('a', { href: '#/ayuda', onclick: (e) => (e.preventDefault(), document.getElementById('h-' + s.id)?.scrollIntoView({ behavior: 'smooth' })) }, s.icon + ' ' + s.title))),
    sections.map((s) => h('div', { class: 'card help', id: 'h-' + s.id }, h('h2', null, s.icon + ' ' + s.title), s.body))
  );
};
