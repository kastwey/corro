# Carrera Galáctica

Bienvenido a la **Carrera Galáctica**, una carrera espacial por escuadrones sobre la
mecánica clásica de los juegos de recorrido. Cada jugador comanda un escuadrón de
**4 naves** que deben despegar, dar la vuelta completa al circuito de **68 sectores**
y aterrizar todas en su **hangar de meta**. El primer escuadrón que lo consiga gana.

## Ayuda durante la partida

- **F1** abre esta guía de Carrera Galáctica.
- **Ctrl+F1** abre la lista completa de atajos disponibles en esta partida.
- **Ctrl+Shift+F1** muestra las reglas activas, incluidos el dado, las barreras, los bonus y el juego por equipos.

## Objetivo

Llevar tus 4 naves desde tu **base** hasta la **meta**: salir al circuito, completar
la vuelta, entrar en tu **corredor final** (7 sectores privados) y aterrizar con la
cuenta exacta.

## El turno

Se tira **un dado**. Según el resultado:

- **5** — si tienes naves en la base, **una despega obligatoriamente** a tu sector de
  salida. Si un rival ocupa tu salida, su nave es derribada y vuelve a su base (la
  única excepción a los sectores seguros).
- **6** — mueves y **vuelves a tirar**. Si no te queda ninguna nave en la base, el 6
  **vale 7**. Ojo: al **tercer 6 seguido**, tu última nave movida vuelve a la base
  (salvo que ya esté en tu corredor final) y pierdes el turno.
- **Cualquier otro valor** — avanzas una nave ese número exacto de sectores. Si varias
  naves pueden moverse, eliges cuál; si solo una puede, se mueve sola; si ninguna
  puede, pasas.

## Derribos y bonificaciones

- Caer en el sector de una **nave rival solitaria** (fuera de un sector seguro) la
  **derriba**: vuelve a su base y tú cuentas un **bonus de 20 sectores** con la nave
  que prefieras.
- Llevar una nave a la **meta** te da un **bonus de 10 sectores**.
- Los bonus pueden encadenarse (un derribo durante un bonus da otro bonus). Si ningún
  movimiento del bonus es legal, se pierde.

## Sectores seguros y escudos

- En los **sectores seguros** (marcados con ◆, incluidas todas las salidas) no hay
  derribos: naves de distintos escuadrones pueden compartirlos.
- Dos naves del **mismo escuadrón** en un sector forman un **escudo (barrera)**:
  ningún escuadrón puede atravesarlo — ni siquiera el tuyo. Si sacas un **6** y tienes
  un escudo, estás **obligado a abrirlo** cuando sea posible.
- Un sector nunca aloja más de **dos naves**.

## El corredor final

Al completar la vuelta, tus naves giran hacia tu corredor privado. Para aterrizar en
la meta necesitas la **cuenta exacta**; si te pasas, ese movimiento no es válido.

## Cómo se numera la pista

La pista es **una sola**, con casillas numeradas del **1 al 68** (tras la 68 vuelve la 1).
Los números **no** se repiten por jugador: la casilla 22 es la misma para todos. Lo que
cambia por escuadrón es **dónde se sube** y **dónde se desvía**:

| Escuadrón | Despega en | Se desvía a su corredor en |
|---|---|---|
| Rojo | 5 | 68 |
| Azul | 22 | 17 |
| Amarillo | 39 | 34 |
| Verde | 56 | 51 |

Cada nave recorre 63 casillas de pista (de su salida a su desvío) y las 4 casillas que
quedan "a su espalda" no las pisa nunca — para los demás escuadrones son casillas
normales. El desvío solo funciona para su dueño: si pasas por el desvío de un rival,
sigues de largo. Tu cursor de exploración empieza en **tu casilla de salida**, y
**S** recorre las salidas y entradas de corredor de todos los escuadrones en juego.

## Explorar el tablero con el teclado

- **← / →** recorren el carril actual: el circuito (con vuelta), o tu franja
  base → corredor → meta.
- **↑ / ↓** cambian de zona: circuito ↔ la zona de cada escuadrón. Al volver al
  circuito, el cursor recuerda dónde estabas.
- **M / Shift+M** saltan por tus naves, adelante y atrás, estén donde estén. **N /
  Shift+N** hacen lo mismo con todas las casillas que tengan naves, de quien sean.
- **S / Shift+S** recorren, hacia delante y hacia atrás, las salidas y entradas de
  corredor de todos los escuadrones en juego.
- **Inicio** va al principio del carril actual: la casilla 1 en el circuito, o la base
  de la zona que estés explorando.
- Cada sector anuncia lo que contiene: seguro, salidas, entradas de corredor, y las
  naves o escudos presentes.

## Cómo jugar con lector de pantalla

### Explorar y jugar

- **Escape** devuelve el foco al tablero. Usa las flechas, **M**, **N**, **S** e **Inicio** como se explica en la sección anterior; cada movimiento del cursor anuncia el sector completo.
- **Espacio** tira el dado. Si hay varias naves que pueden moverse, se abre un diálogo no modal con una opción por nave; **Enter** activa la opción enfocada.
- Desde ese diálogo, **Escape** vuelve al tablero sin cancelar la elección, para que puedas explorar los destinos resaltados. **Ctrl+D** devuelve el foco al diálogo pendiente.

### Consultar la partida

- **C** anuncia tu escuadrón y **T** indica de quién es el turno. **Ctrl+P** lleva a la lista de jugadores.
- Tiradas, movimientos, derribos, bonus, barreras y cambios de turno se anuncian automáticamente y en el orden en que ocurren.

### Moverte entre zonas y usar el chat

- **F6** recorre tablero, acciones, jugadores y conexión; los diálogos no modales y el chat se incorporan cuando están abiertos. **Shift+F6** recorre las zonas en sentido contrario.
- **Ctrl+Shift+R** abre el chat y lleva el foco al cuadro de mensaje. **Ctrl+Shift+H** abre o cierra el chat.
- Esta guía, los atajos y las reglas activas son documentos de lectura. Recorre sus encabezados y listas con tu lector y ciérralos con **Escape** para volver al juego.
