# PubliCast — Señalización digital para pantallas Android

PubliCast es una solución de **cartelería / publicidad digital** (al estilo de Xibo) para enviar
contenido multimedia, información y anuncios desde un servidor central a pantallas con Android
(TV Box, Android TV, tablets, monitores con Android) y también a cualquier navegador web.

```
┌──────────────────────────┐         HTTP + WebSocket          ┌──────────────────────────┐
│   PubliCast CMS (Node)   │  ───── manifiesto, archivos ────▶ │  PubliCast Player (APK)  │
│  · Panel de administración│ ◀──── latido, estadísticas ────  │  · Caché local offline   │
│  · Biblioteca multimedia │  ───── anuncios inmediatos ─────▶ │  · Imagen/Video/Web/Texto│
│  · Listas y programación │                                    │  · Cintillo y anuncios   │
└──────────────────────────┘                                    └──────────────────────────┘
```

## Funciones

| Área | Qué hace |
|---|---|
| **Biblioteca** | Subida de imágenes (JPG, PNG, GIF animado, WebP) y videos (MP4, WebM, MKV, MOV) arrastrando archivos; páginas web (URL) y mensajes de texto con colores. |
| **Listas de reproducción** | Orden por arrastre, duración por contenido, transiciones (fundido, deslizar), ajuste de imagen (ajustar/rellenar/estirar), color de fondo y **cintillo de noticias**. Vista previa en el navegador. |
| **Cintillo de noticias** | Texto en movimiento con velocidad, **tipo de letra**, **tamaño**, negrita, **color** de texto y fondo, **transparencia** del fondo y posición (arriba/abajo), con vista previa en vivo. |
| **Layouts** | Pantalla dividida en zonas que se **arrastran y redimensionan** con el ratón: listas de reproducción, cintillo y **reloj con fecha**. Plantillas (Noticiero, Principal + lateral, 2 × 2, forma de L…), orden de capas y formato horizontal o vertical. |
| **Videowall** | Varias pantallas (hasta 8 × 8) forman una sola imagen: cada una muestra su porción y todas cambian a la vez, sincronizadas con la hora del servidor. |
| **Identificar** | Como en Windows: cada pantalla muestra en grande su número (1, 2, 3…), su nombre y su posición en el videowall. |
| **Programación** | Eventos por días, franja horaria (incluso nocturna, p. ej. 22:00–06:00), rango de fechas, prioridad y pantallas o videowalls destino. Tabla con **miniatura**, **fecha** y **horario** de cada evento, reloj en vivo y **vista semanal**. |
| **Pantallas** | Emparejamiento seguro con código de 6 dígitos, número de pantalla, estado en línea/desconectada, qué se está reproduciendo, modelo, resolución, espacio libre, orientación, comandos *Identificar* y *Recargar*. |
| **Cómo usar** | Guía paso a paso de todas las funciones dentro del propio panel. |
| **Anuncio inmediato** | Mensaje urgente al instante (pantalla completa o banda superior/inferior) en una, varias o todas las pantallas, por WebSocket. |
| **Estadísticas** | Prueba de reproducción (*proof of play*): cuántas veces y cuánto tiempo se mostró cada anuncio por pantalla. Exportación a CSV. |
| **Funcionamiento sin red** | El reproductor descarga todo a su almacenamiento (verificando MD5) y sigue reproduciendo y respetando los horarios si se cae la conexión. |

## Estructura

```
publicast/
├── server/                 # CMS: Node.js + Express (sin base de datos externa)
│   ├── src/server.js       # API REST, API de reproductores y WebSocket
│   ├── public/admin/       # Panel de administración (HTML/JS)
│   ├── public/player/      # Reproductor web (Smart TV, PC, Raspberry Pi)
│   ├── public/shared/      # Lógica de programación compartida
│   ├── apk/                # APK listo para instalar (se descarga desde el panel)
│   └── test/               # Pruebas automáticas de la API
├── android/                # App PubliCast Player (Kotlin + ExoPlayer/Media3)
└── docker-compose.yml
```

## 1. Instalar el servidor

### Opción A — Node.js (Windows, Linux, macOS, Raspberry Pi)

Requiere Node.js 18 o superior.

```bash
cd publicast/server
npm install
ADMIN_PASSWORD=MiClaveSegura npm start
```

En Windows (CMD): `set ADMIN_PASSWORD=MiClaveSegura` y luego `npm start`.
En PowerShell: `$env:ADMIN_PASSWORD="MiClaveSegura"; npm start`

### Opción B — Docker

```bash
cd publicast
docker compose up -d --build
```

Abra **http://IP-DEL-SERVIDOR:8080/admin/** e inicie sesión (usuario `admin`; la contraseña es la de
`ADMIN_PASSWORD`, o `admin` si no la definió; cámbiela en *Ajustes*).

| Variable | Por defecto | Descripción |
|---|---|---|
| `PORT` | `8080` | Puerto HTTP |
| `DATA_DIR` | `server/data` | Carpeta con la base de datos (`db.json`) y los archivos subidos |
| `ADMIN_USER` / `ADMIN_PASSWORD` | `admin` / `admin` | Usuario inicial (sólo se usan la primera vez) |
| `MAX_UPLOAD_MB` | `2048` | Tamaño máximo por archivo |
| `TRUST_PROXY` | — | Defínalo (`1`) si el servidor está detrás de nginx/Traefik |

> Para usarlo por Internet colóquelo detrás de un proxy inverso con HTTPS (nginx, Caddy, Traefik).
> La app Android admite `https://` y `wss://` automáticamente.

**Copia de seguridad:** basta con copiar la carpeta `DATA_DIR`.

## 2. Instalar la app en los dispositivos Android

1. Descargue el APK desde el panel (**Pantallas → Descargar APK**) o abra en el dispositivo
   `http://IP-DEL-SERVIDOR:8080/download/publicast-player.apk` (permita "orígenes desconocidos").
2. Abra **PubliCast Player**, escriba la dirección del servidor (p. ej. `http://192.168.1.10:8080`)
   y pulse *Conectar*.
3. La pantalla mostrará un **código de 6 dígitos**. En el panel vaya a **Pantallas**, escriba el código,
   un nombre y la lista por defecto, y pulse *Autorizar*.
4. En segundos la pantalla descarga el contenido y empieza a reproducir.

Requisitos: Android 5.0 (API 21) o superior. Funciona con pantalla táctil o con mando a distancia.

**Modo quiosco:** la app puede elegirse como *pantalla de inicio* (al pulsar Inicio, elija PubliCast
→ "Siempre"). Así arranca sola al encender el equipo y el público no puede salir de ella.
También se inicia automáticamente al arrancar el dispositivo.

**Menú oculto del reproductor:** toque 5 veces seguidas la esquina superior izquierda, o pulse
*Menú* / mantenga pulsado *OK* en el mando. Desde ahí puede cambiar de servidor, forzar la
sincronización, volver a emparejar, ver información o salir.

### Si la app no conecta

1. Al arrancar, el servidor muestra la dirección exacta a usar (`http://192.168.x.x:8080`). No use `localhost` en el Android.
2. Abra esa dirección + `/api/health` en el navegador del dispositivo: debe mostrar `{"ok":true,...}`.
3. Si no carga, abra el puerto en el Firewall de Windows (CMD como administrador):
   `netsh advfirewall firewall add rule name="PubliCast 8080" dir=in action=allow protocol=TCP localport=8080`
   y compruebe que la red Wi-Fi esté marcada como *Privada*.
4. El dispositivo y el servidor deben estar en la misma red (sin "aislamiento de clientes" en el router / Wi-Fi de invitados).

### Compilar el APK usted mismo

Con Android Studio: *File → Open* → carpeta `publicast/android` → *Build → Build APK(s)*.

Desde la terminal (requiere JDK 17+ y el Android SDK):

```bash
cd publicast/android
./gradlew assembleRelease      # APK en app/build/outputs/apk/release/
./gradlew testDebugUnitTest    # pruebas unitarias
```

El APK incluido está firmado con la clave de depuración, válida para instalarlo directamente.
Para distribuirlo en Google Play configure su propia firma en `app/build.gradle.kts`.

## 3. Uso típico

1. **Biblioteca:** suba sus anuncios (imágenes y videos) o cree mensajes de texto/páginas web.
2. **Listas de reproducción:** cree una lista, añada contenidos, ajuste duraciones y, si quiere, el cintillo.
3. **Pantallas:** asigne la lista por defecto a cada pantalla.
4. **Programación (opcional):** por ejemplo *"Menú desayuno"* de lunes a viernes de 07:00 a 11:00 con
   prioridad 5, y *"Promos fin de semana"* sábados y domingos.
5. **Anuncio inmediato:** para avisos urgentes en tiempo real.
6. **Estadísticas:** para justificar a sus anunciantes cuántas veces se emitió cada anuncio.

Cualquier cambio se envía automáticamente a las pantallas en segundos (aviso por WebSocket y,
como respaldo, latido cada 60 s).

## Videowall paso a paso

1. Coloque las pantallas y autorícelas en **Pantallas**.
2. **Videowall → + Nuevo videowall**: indique columnas y filas.
3. Pulse **🔢 Identificar pantallas**: cada televisor muestra un número grande.
4. Asigne cada pantalla a su celda (1 = arriba a la izquierda) y elija el contenido.
5. Prepare las imágenes/videos con la resolución total (p. ej. 3840 × 2160 para 2 × 2 Full HD).

La sincronización se basa en la hora del servidor; las transiciones se desactivan en el videowall
para que todas las pantallas cambien exactamente a la vez. Para videos, abra antes la Biblioteca:
el panel detecta y guarda la duración real de cada video.

## API de reproductores (para integraciones)

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/player/register` | `{ key, info }` → `{ authorized, code }` |
| `GET` | `/api/player/manifest` | Programación, listas, layouts, videowall y archivos de la pantalla (`Authorization: Bearer <key>`) |
| `POST` | `/api/player/heartbeat` | Estado actual; responde con la versión de contenido |
| `POST` | `/api/player/stats` | `{ records: [{ mediaId, playlistId, startedAt, duration }] }` |
| `WS` | `/ws?key=<key>` | Mensajes `version`, `authorized`, `announce`, `clearAnnouncement`, `identify`, `reload`, `unpaired` |

Cada pantalla genera una clave secreta aleatoria; el servidor sólo almacena su hash SHA-256.

## Pruebas

```bash
cd publicast/server && npm test               # API, emparejamiento, WebSocket, programación
cd publicast/android && ./gradlew testDebugUnitTest
```
