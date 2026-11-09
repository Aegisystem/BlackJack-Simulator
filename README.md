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
- **Progreso**: saldo, resultado y porcentaje de acierto de cada jugador, tus errores más comunes y las últimas decisiones. El historial se guarda en el navegador.
- **Tabla de estrategia** (manos duras, suaves y parejas) que se ajusta a las reglas de la mesa y resalta la casilla de tu mano.
- **Conteo Hi-Lo** opcional (cuenta corrida y cuenta real).
- **Sonido real**: grabaciones de cartas y fichas para el reparto, la carta del crupier al voltearse, las apuestas, los pagos, la recogida de fichas y la barajada. Cada puesto suena desde su lado en estéreo. También hay un tono opcional de acierto o error y una voz del crupier opcional (usa la voz del sistema).
- **Animación de cartas**: salen del zapato, el crupier levanta y voltea su carta oculta, y al empezar cada ronda recoge las cartas de la anterior.
- **Corte aleatorio**: por defecto, en cada barajada la carta de corte cae en un punto al azar entre el 45% y el 55% del zapato, para que no sepas cuándo se va a barajar.
- **Apuestas rápidas**: las fichas se adaptan a la apuesta mínima de la mesa (con mínimo de 5.000 son 5k, 25k, 100k, 500k y 1M). También puedes escribir el monto exacto o usar «Máx» para apostar lo más posible.
- **Reglas configurables**: de 1 a 8 mazos, carta de corte (aleatoria o fija), S17 o H17, doblar después de dividir, rendición tardía, pago del blackjack (3 a 2 o 6 a 5) y apuestas mínima y máxima.
- Los saldos, las estadísticas y las reglas se guardan en el navegador (`localStorage`).

## Atajos de teclado

| Tecla | Acción |
|---|---|
| `Espacio` / `Enter` | Repartir |
| `1` a `5` | Fichas de 5, 25, 100, 500 y 1000 |
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

## Probar en tu computador

El sitio usa módulos de JavaScript, así que se debe abrir con un servidor local (no con doble clic sobre el archivo):

```bash
python3 -m http.server 8000
```

Luego abre <http://localhost:8000>.

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
sounds/           Grabaciones de cartas y fichas (MP3)
```

La estrategia de `js/strategy.js` está pensada para zapatos de 4 a 8 mazos. Con 1 o 2 mazos la estrategia exacta cambia un poco en algunas manos.
