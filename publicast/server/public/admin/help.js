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
        h('p', null, 'En "Editar" también puede indicar la sucursal, la ubicación, la orientación (horizontal/vertical), el rendimiento y el contenido por defecto. "Recargar" reinicia la reproducción.'),
        h('p', null, h('b', null, 'Miniatura y vista previa: '), 'la columna "Vista" muestra una captura real de cada pantalla (la app la envía cada 5 minutos). Pulse la miniatura o "👁 Vista previa" para ver la captura, pedir una nueva con "📸 Capturar ahora" y ver a su lado una simulación en vivo del contenido.'),
        tip('Si la app no conecta: use la IP local (no "localhost"), compruebe que el Firewall de Windows permite el puerto 8080 y que ambos equipos están en la misma red.'),
      ],
    },
    {
      id: 'biblioteca',
      icon: '🖼️',
      title: 'Biblioteca de contenidos',
      body: [
        h('p', null, 'Arrastre archivos a la zona de subida o haga clic para elegirlos. Formatos: JPG, PNG, GIF animado, WebP, MP4, WebM, MKV y MOV.'),
        h(
          'p',
          null,
          h('b', null, '▶️ YouTube / Reels: '),
          'pegue el enlace de YouTube, Shorts, TikTok, Vimeo, Facebook o Instagram. Hay dos opciones: ',
          h('b', null, 'reproducción en línea'),
          ' (arranca sola, sin controles; con YouTube pasa al siguiente contenido cuando termina el video; las pantallas necesitan Internet) o ',
          h('b', null, 'descargar al servidor'),
          ' (se guarda como MP4: funciona sin Internet, va más fluido en Fire TV y es la única forma para los Reels de Instagram; requiere "winget install yt-dlp" en el servidor).'
        ),
        tip('Si YouTube o Instagram piden iniciar sesión al descargar, inicie sesión en Firefox en el equipo del servidor y arranque el servidor con "set YTDLP_COOKIES_FROM_BROWSER=firefox". En el navegador, los videos en línea empiezan en silencio (lo exige el navegador); en la app Android suenan normalmente salvo que marque "Sin sonido".'),
        h('ul', null, h('li', null, h('b', null, '📄 HTML local: '), 'suba un archivo .html, una carpeta completa (con sus imágenes, CSS y JS) o pegue una ruta como file:///C:/Users/…/pagina.html si el archivo está en el equipo del servidor. Se copia al servidor y las pantallas lo guardan para mostrarlo sin Internet.'), h('li', null, h('b', null, '🌐 Página web: '), 'muestra una URL a pantalla completa (menús digitales, tableros, redes sociales).'), h('li', null, h('b', null, '🔤 Mensaje de texto: '), 'título y texto con los colores que elija, sin necesidad de diseñar una imagen.')),
        h('p', null, 'La "duración" es el tiempo que se muestra cada imagen. En videos, 0 = se reproduce completo.'),
        tip('Resolución recomendada: 1920 × 1080 (horizontal) o 1080 × 1920 (vertical). Videos en MP4 (H.264).'),
      ],
    },
    {
      id: 'listas',
      icon: '🎞️',
      title: 'Listas de reproducción',
      body: [
        steps('Pulse "+ Nueva lista" y escriba un nombre.', 'Pulse "+ Añadir contenidos" y marque los que quiera.', 'Ordénelos arrastrando (⋮⋮) o con las flechas, y ajuste los segundos de cada uno.', 'En "✨ Transiciones" elija el efecto (fundido, deslizar en 4 direcciones, zoom o corte) y su duración; pulse "▶ Probar transición" para verlo.', 'Si quiere, cambie la transición de un contenido concreto en su fila ("Transición de entrada").', 'Guarde. Con "▶ Vista previa" verá cómo queda.'),
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
        steps(
          'Pulse "+ Nuevo evento" y elija la lista o el layout (verá su miniatura).',
          h('span', null, 'Elija la repetición: ', h('b', null, '🔁 Siempre'), ' (en bucle, 24 h), ', h('b', null, '📅 Todos los días'), ' (en una franja horaria), ', h('b', null, '🗓️ Por semana'), ' (días marcados) o ', h('b', null, '⏱️ Fechas y horas personalizadas'), ' (de un día y hora exactos a otro).'),
          'Elija dónde se muestra: sucursales, pantallas o videowalls (nada marcado = todas), y la prioridad.'
        ),
        h('p', null, 'La tabla muestra la miniatura, la fecha y el horario de cada evento; abajo, la ', h('b', null, 'vista semanal'), ' dibuja los eventos en el calendario con una línea roja en la hora actual.'),
        tip('Si dos eventos coinciden gana el de mayor prioridad. Con la misma prioridad, sus listas se intercalan. Fuera de cualquier evento, la pantalla muestra su contenido por defecto.'),
      ],
    },
    {
      id: 'sucursales',
      icon: '🏢',
      title: 'Sucursales (grupos de pantallas)',
      body: [
        h('p', null, 'Agrupe las pantallas por local, ciudad o zona. Luego puede programar contenido o enviar un anuncio inmediato a toda una sucursal de una vez.'),
        steps(['Vaya a ', link('#/sucursales', 'Sucursales'), ' → "+ Nueva sucursal", escriba el nombre y marque sus pantallas.'], 'En Programación y en Anuncio inmediato marque la sucursal en lugar de cada pantalla.', 'En Pantallas puede filtrar la lista por sucursal.'),
        tip('Si agrega una pantalla nueva a la sucursal, recibe automáticamente toda la programación de esa sucursal.'),
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
      id: 'servidor',
      icon: '📟',
      title: 'Consumo del servidor y apariencia',
      body: [
        h('p', null, 'En ', link('#/servidor', 'Servidor'), ' verá en tiempo real el uso de procesador, memoria y disco del equipo donde está instalado PubliCast, la memoria que usa el propio servidor, las pantallas conectadas y las direcciones que deben usar los dispositivos.'),
        h('p', null, 'Abajo a la izquierda puede elegir la apariencia del panel: ', h('b', null, '🖥️ Auto'), ' (según Windows), ', h('b', null, '☀️ Claro'), ' u ', h('b', null, '🌙 Oscuro'), '.'),
      ],
    },
    {
      id: 'rendimiento',
      icon: '⚡',
      title: 'Fire TV Stick y TV Box económicos: que vaya fluido',
      body: [
        h('p', null, 'La app activa sola el ', h('b', null, 'modo ligero'), ' en Fire TV y en equipos de menos de 2,5 GB de RAM (puede forzarlo en Pantallas → Editar → Rendimiento). Además:'),
        h(
          'ul',
          null,
          h('li', null, h('b', null, 'Videos en MP4 (H.264) de 1080p como máximo. '), 'Los 4K, HEVC/H.265, WebM o MKV se traban en un Fire TV Stick normal. En la Biblioteca use "⚡ Optimizar para TV" (requiere ffmpeg en el servidor).'),
          h('li', null, h('b', null, 'Un solo video a la vez. '), 'En los layouts, ponga el video en una sola zona; en las demás use imágenes. En modo ligero las otras zonas omiten los videos automáticamente.'),
          h('li', null, h('b', null, 'Imágenes JPG de 1920 × 1080 '), '(no fotos de 12 MP ni PNG enormes). Evite GIF animados.'),
          h('li', null, 'Evite las páginas web como contenido: el navegador interno consume mucha memoria.'),
          h('li', null, 'Transición "Ninguna" o "Fundido" (no "Deslizar") en las listas de pantallas modestas.')
        ),
        h('p', null, h('b', null, 'Ajustes del Fire TV: ')),
        h(
          'ol',
          null,
          h('li', null, 'Configuración → Preferencias → Contenido destacado: desactive la reproducción automática de video y audio.'),
          h('li', null, 'Configuración → Pantalla y sonido → Salvapantallas: tiempo de inicio "Nunca". Y "Suspender pantalla": nunca.'),
          h('li', null, 'Configuración → Preferencias → Configuración de privacidad: desactive "Recopilar datos de uso de apps" y "Uso de datos del dispositivo".'),
          h('li', null, 'Configuración → Aplicaciones → Administrar aplicaciones instaladas: desinstale lo que no use y "Forzar detención" de apps abiertas.'),
          h('li', null, 'Conecte el Fire TV a su propio cargador (no al USB de la TV) y, si puede, por cable de red con el adaptador Ethernet de Amazon.'),
          h('li', null, 'Reinícielo una vez al día (por ejemplo con un enchufe programable) para liberar memoria.')
        ),
        tip('Para videowalls o layouts con varios videos se recomienda Fire TV Stick 4K Max, Chromecast con Google TV o un TV Box con 4 GB de RAM.'),
      ],
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
