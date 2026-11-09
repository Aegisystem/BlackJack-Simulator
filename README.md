# Mesa 21 · Entrenador de Blackjack

Simulador de blackjack para practicar la **estrategia básica**. Es un sitio estático (HTML, CSS y JavaScript sin dependencias), listo para GitHub Pages. No se conecta a ningún servidor ni a ninguna IA: los consejos salen de las tablas de estrategia básica que vienen en el código.

## Qué incluye

- **7 puestos** en la mesa. Se juegan de derecha a izquierda (el puesto 1 es la primera base).
- **Varios jugadores**, cada uno con su propio saldo. Un jugador puede ocupar **varios puestos** al mismo tiempo.
- **Bots** que juegan con estrategia básica perfecta y apuestan solos. Si se quedan sin saldo, se recargan.
- **Dividir hasta 5 manos** por puesto, incluso dividir una mano que ya viene de dividir. Puedes elegir si se vuelven a dividir los Ases.
- **Corrección de cada decisión**: después de cada jugada te dice si coincide con la estrategia básica y por qué.
- **Pistas** opcionales que muestran la jugada correcta antes de decidir.
- **Tabla de estrategia** (manos duras, suaves y parejas) que se ajusta a las reglas de la mesa y resalta la casilla de tu mano.
- **Conteo Hi-Lo** opcional (cuenta corrida y cuenta real).
- **Reglas configurables**: número de mazos, penetración, S17 o H17, doblar después de dividir, rendición tardía, pago del blackjack (3 a 2 o 6 a 5) y apuestas mínima y máxima.
- Los saldos, las estadísticas y las reglas se guardan en el navegador (`localStorage`).

## Atajos de teclado

| Tecla | Acción |
|---|---|
| `Espacio` / `Enter` | Repartir |
| `H` | Pedir |
| `S` | Plantarse |
| `D` | Doblar |
| `P` | Dividir |
| `R` | Rendirse |
| `?` | Pista |
| `T` | Abrir o cerrar la tabla de estrategia |

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

## Estructura

```
index.html        Página y diálogos
css/styles.css    Estilos de la mesa
js/strategy.js    Estrategia básica (funciones puras)
js/app.js         Juego, bots, interfaz y guardado
```

La estrategia de `js/strategy.js` está pensada para zapatos de 4 a 8 mazos. Con 1 o 2 mazos la estrategia exacta cambia un poco en algunas manos.
