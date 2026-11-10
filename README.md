# Mesa 21 · Entrenador de Blackjack

Simulador de blackjack para practicar la **estrategia básica**. Es un sitio estático (HTML, CSS y JavaScript sin dependencias), listo para GitHub Pages. No se conecta a ningún servidor ni a ninguna IA: los consejos salen de las tablas de estrategia básica que vienen en el código.

## Qué incluye

- **7 puestos** en la mesa. Se juegan de derecha a izquierda (el puesto 1 es la primera base).
- **Varios jugadores**, cada uno con su propio saldo. Un jugador puede ocupar **varios puestos** al mismo tiempo.
- **Bots** que juegan con estrategia básica perfecta y apuestan solos. Si se quedan sin saldo, se recargan.
- **Dividir hasta 5 manos** por puesto, incluso dividir una mano que ya viene de dividir. Puedes elegir si se vuelven a dividir los Ases.
- **Corrección de cada decisión**: después de cada jugada te dice si coincide con la estrategia básica y por qué.
- **Pistas** opcionales que muestran la jugada correcta antes de decidir.
- **Seguro**: cuando el crupier muestra un As te ofrece seguro (paga 2 a 1), y te corrige si lo tomas.
- **Práctica rápida**: manos sueltas para memorizar la tabla sin apostar, con aciertos y racha.
- **Repaso de errores**: en la práctica rápida, «Mis errores» repite las manos exactas que fallaste (en la mesa o en la práctica) hasta que aciertes cada una 3 veces seguidas. Las más falladas salen más seguido. También se abre desde Progreso y desde el entrenador.
- **Modo examen**: un zapato completo sin pistas, tabla ni correcciones. Al salir la carta de corte ves tu nota, el resultado en dinero y los errores, con un botón para repasarlos. Se inicia desde Progreso.
- **Progreso**: saldo, resultado y porcentaje de acierto de cada jugador, una gráfica del resultado acumulado por ronda, tus errores más comunes y las últimas decisiones. El historial se guarda en el navegador.
- **Tabla de estrategia** (manos duras, suaves y parejas) que se ajusta a las reglas de la mesa y resalta la casilla de tu mano.
- **Conteo Hi-Lo** opcional (cuenta corrida y cuenta real).
- **Sonido real**: grabaciones de cartas y fichas para el reparto, la carta del crupier al voltearse, las apuestas, los pagos, la recogida de fichas y la barajada. Cada puesto suena desde su lado en estéreo. También hay un tono opcional de acierto o error y una voz del crupier opcional (usa la voz del sistema).
- **Animación de cartas**: salen del zapato, el crupier levanta y voltea su carta oculta, y al empezar cada ronda recoge las cartas de la anterior.
- **Barajada a la vista**: con cada zapato nuevo (también al empezar la sesión) el crupier saca las cartas, hace tres riffles con las cartas cayendo intercaladas, empareja el mazo, mete la carta de corte amarilla a la altura del corte y lo carga en el zapato, con el sonido de la barajada sincronizado. En velocidad rápida hace un solo riffle. En una sala en línea todos la ven.
- **Corte aleatorio**: por defecto, en cada barajada la carta de corte cae en un punto al azar entre el 45% y el 55% del zapato, para que no sepas cuándo se va a barajar.
- **Ficha marcada**: tocas una ficha para marcarla y cada toque en tu círculo pone una de ese valor, como en las mesas en vivo. Las teclas `1` a `5` marcan la ficha y la apuestan.
- **Apuestas rápidas**: las fichas se adaptan a la apuesta mínima de la mesa (con mínimo de 5.000 son 5k, 25k, 100k, 500k y 1M). También puedes escribir el monto exacto o usar «Máx» para apostar lo más posible.
- **Perfiles de mesa**: «Pragmatic Play en vivo» (8 mazos, el crupier se planta en 17, una sola división, sin pedir con Ases divididos, sin rendición y el crupier solo revisa su carta con un As) y «Clásica de EE. UU.». La tabla y las correcciones se ajustan: por ejemplo, sin revisión con figura se pide con 11 o con 8-8 contra 10.
- **Tiempo para decidir** opcional (10 a 30 segundos), como en vivo. Si se acaba, se pide con 11 o menos y se planta con 12 o más.
- **Apuestas laterales** opcionales (Pares Perfectos y 21+3) con los pagos de las mesas de Pragmatic Play. Se resuelven al repartir y el entrenador muestra cuánto gana la casa con ellas, calculado exacto según el número de mazos (por ejemplo 4,1 % y 3,7 % con 8 mazos).
- **Reglas configurables**: de 1 a 8 mazos, carta de corte (aleatoria o fija), S17 o H17, doblar después de dividir, rendición tardía, pago del blackjack (3 a 2 o 6 a 5), si el crupier revisa su carta con figura y apuestas mínima y máxima.
- **Mesa en línea**: jueguen en la misma mesa desde varios dispositivos, sin crear cuentas. Quien crea la sala comparte un enlace o un código de 4 letras o números. Su navegador reparte las cartas con sus reglas y sus bots, y cada quien juega sus puestos desde su teléfono o computador. Se reparte cuando todos los que apostaron pulsan «Repartir» (quien creó la sala puede repartir sin esperar). Si se cae la conexión de un invitado, su pantalla se vuelve a conectar sola y sigue en sus puestos. Las correcciones y el repaso de errores se guardan en el dispositivo de cada uno. Los pasos están en [Jugar en línea](#jugar-en-línea).
- **Se instala como app** en el celular o el computador y funciona sin internet (service worker). En iPhone: Compartir → «Agregar a inicio».
- Los saldos, las estadísticas y las reglas se guardan en el navegador (`localStorage`).

## Atajos de teclado

| Tecla | Acción |
|---|---|
| `Espacio` / `Enter` | Repartir |
| `1` a `5` | Marcar una ficha y apostarla |
| `⌫` | Quitar la apuesta |
| `H` | Pedir |
| `S` | Plantarse |
| `D` | Doblar |
| `P` | Dividir |
| `R` | Rendirse |
| `I` / `N` | Tomar seguro / Sin seguro |
| `?` | Pista |
| `T` | Abrir o cerrar la tabla de estrategia |
| `M` | Silenciar o activar el sonido |

## Jugar en línea

Cada jugador usa su propio teléfono o computador, sin crear cuentas.

1. Una persona toca **En línea** (barra de arriba) y luego **Crear sala**. Su navegador reparte las cartas, y la sala recibe un código de 4 letras o números.
2. Esa persona comparte el código, o el enlace con **Copiar enlace** (en el teléfono también sale **Compartir**).
3. Los demás abren el enlace, o tocan **En línea** y escriben el código. Luego escriben su nombre y tocan **Unirme**. Cada uno queda sentado en un puesto libre y con **Sentarse** puede ocupar más puestos.
4. Cada quien apuesta en sus puestos y pulsa **Repartir**. La ronda empieza cuando todos los que apostaron lo pulsan. Si quien creó la sala pulsa **Repartir** y falta alguien, su botón cambia a **Repartir ya** para no esperar.
5. En su turno, cada jugador decide sus manos y el seguro desde su pantalla. Los botones solo se encienden en los turnos propios.

Las reglas, los bots y los saldos de la sala los maneja quien la creó, y su pestaña debe quedar abierta mientras juegan. Cada invitado entra con el saldo de su primer jugador que no es bot. Lo que gane o pierda en la sala no cambia los saldos guardados en su dispositivo. Para terminar, quien creó la sala toca **Cerrar la sala** entre rondas.

**Si se cae la conexión.** La pantalla del invitado intenta volver sola tres veces: enseguida, a los 2 segundos y a los 5 segundos. Al volver a la pestaña (por ejemplo, después de bloquear el teléfono) revisa que la sala conteste y, si no contesta en 4 segundos, se reconecta. Si no lo logra, ofrece **Volver a entrar**: con el mismo nombre se recuperan el saldo y los puestos que sigan libres. Cuando la sala nota que alguien se desconectó, sigue sin esperarlo: en su turno pide con 11 o menos, se planta con 12 o más y no toma seguro.

## Probar en tu computador

El sitio usa módulos de JavaScript, así que se debe abrir con un servidor local (no con doble clic sobre el archivo):

```bash
python3 -m http.server 8000
```

Luego abre <http://localhost:8000>.

Para probar la mesa en línea en un solo computador, abre dos pestañas con `?localnet` en la dirección (por ejemplo <http://localhost:8000/?localnet>). En ese modo las pestañas se comunican entre sí dentro del navegador, sin internet.

## Cómo funciona la mesa en línea

Los navegadores se encuentran con el servicio público y gratuito de [PeerJS](https://peerjs.com). Después, las apuestas, las cartas y las jugadas viajan directo entre los dispositivos (WebRTC). El navegador de quien crea la sala reparte: debe quedarse con la pestaña abierta mientras juegan. La carta oculta del crupier no se envía a los demás hasta que se voltea.

La conexión directa funciona en la mayoría de las redes de casa y en la misma Wi‑Fi. Algunas redes la bloquean (ciertos datos móviles o redes de empresa). En ese caso hace falta un servidor TURN que retransmita los datos, y este proyecto no trae ninguno.

En macOS con el firewall activado, un navegador sin permiso para recibir conexiones entrantes puede no lograr la conexión directa: la sala se crea, pero los demás no logran entrar. El permiso se da en Ajustes del Sistema → Red → Firewall → Opciones.

## Pruebas

La estrategia se compara casilla por casilla con las tablas publicadas de Wizard of Odds (4 a 8 mazos con S17 y H17, sin doblar tras dividir, sin rendición y la variante europea sin carta oculta). Requiere Node 18 o más reciente:

```bash
npm test
```

## Publicar en GitHub Pages

1. Sube el contenido de esta carpeta a la rama `main` del repositorio.
2. En GitHub ve a **Settings → Pages**.
3. En **Source** elige **Deploy from a branch**, rama `main`, carpeta `/ (root)`.
4. Espera un minuto. El sitio queda en `https://<usuario>.github.io/<repositorio>/`.

## Créditos

Los sonidos de cartas y fichas son del paquete [«Casino Audio»](https://kenney.nl/assets/casino-audio) de Kenney, con licencia CC0 (dominio público). Detalles en `sounds/CREDITOS.txt`.

## Estructura

```
index.html        Página y diálogos
css/styles.css    Estilos de la mesa
js/strategy.js    Estrategia básica (funciones puras)
js/app.js         Juego, bots, interfaz y guardado
js/sound.js       Sonidos y voz del crupier
js/online.js      Conexión de la mesa en línea (PeerJS, prueba local y reconexión)
tests/            Pruebas de la estrategia (node --test)
sounds/           Grabaciones de cartas y fichas (MP3)
icons/            Iconos de la app
manifest.webmanifest, sw.js   App instalable y modo sin internet
```

La estrategia de `js/strategy.js` está pensada para zapatos de 4 a 8 mazos. Con 1 o 2 mazos la estrategia exacta cambia un poco en algunas manos.
