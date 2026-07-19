# Parchís clásico

El parchís de toda la vida: cada jugador lleva **4 fichas** de su color desde su casa
hasta la meta, dando la vuelta a un circuito de **68 casillas** y subiendo por su
**pasillo final de 7**. Gana quien mete antes todas sus fichas.

## Reglas

- **Salir de casa**: solo con un **5**. Si puedes sacar ficha, es obligatorio.
- **El 6 repite**: vuelves a tirar. Con las 4 fichas fuera de casa, el 6 **vale 7**.
- **Tres 6 seguidos**: la última ficha que moviste se va a casa (se libra si ya está
  en el pasillo o en la meta).
- **Comer**: si caes sobre una ficha rival sola en casilla normal, la mandas a casa y
  **cuentas 20** con la ficha que quieras. En los **seguros** no se come — con una
  excepción: al **salir de casa** te comes a quien esté en tu salida.
- **Meta**: se entra con cuenta **exacta**; al meter una ficha **cuentas 10**.
- **Barreras**: dos fichas tuyas juntas bloquean el paso a todos (también a ti). Si
  sacas un 6 y tienes barrera, estás **obligado a abrirla** cuando sea legal.
- Cada casilla admite **como máximo dos fichas**; de colores distintos, solo en seguro.
- Cuando un jugador mete todas sus fichas, la partida **sigue** por los siguientes
  puestos hasta que solo queda uno.

Tu cursor de exploración empieza en **tu casilla de salida**, y **S** siempre te
devuelve a ella.

## Explorar el tablero con el teclado

- **← / →** recorren el carril actual: el circuito (con vuelta), o tu franja
  casa → pasillo → meta.
- **↑ / ↓** cambian de zona: circuito ↔ la zona de cada color. Al volver al circuito,
  el cursor recuerda dónde estabas.
- **M / Shift+M** saltan por tus fichas, adelante y atrás, estén donde estén.
  **N / Shift+N** hacen lo mismo con todas las casillas que tengan fichas.
- **S / Shift+S** recorren tus dos hitos: tu salida y tu entrada al pasillo.
- **Inicio** va al principio del carril actual. Teclear un **número** salta a esa
  casilla del circuito.
- Cada casilla anuncia lo que contiene: seguro, salidas, entradas de pasillo, y las
  fichas o barreras presentes.
