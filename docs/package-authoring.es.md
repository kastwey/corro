# Crea tu primer paquete de Corro

[Read in English](package-authoring.md)

Esta guía te lleva desde una idea hasta un juego `.corro` listo para subir. Da por hecho que puedes
abrir una terminal y editar archivos de texto, pero **no presupone conocimientos de C#, TypeScript
ni programación web**. Un paquete son datos: JSON, traducciones, ayuda Markdown y recursos SVG.

Si ya conoces el formato, usa directamente la [referencia completa](../CORRO_FORMAT.md).

## Qué necesitas

Para crear, comprobar y empaquetar un juego solo necesitas:

1. El [SDK de .NET 10](https://dotnet.microsoft.com/download/dotnet/10.0).
2. Una copia de este repositorio, descargada como ZIP o clonada con Git.
3. Un editor de texto. Recomendamos [Visual Studio Code](https://code.visualstudio.com/) porque cada
   proyecto generado incluye esquemas de autocompletado y validación.

No necesitas Node.js, Docker, Azure ni una base de datos para crear y empaquetar. Solo son necesarios
para algunas formas de ejecutar el servidor Corro completo en local. Puedes subir el archivo
resultante directamente a [imperio.kastwey.org](https://imperio.kastwey.org), el servidor público de
Corro, donde las actualizaciones de este repositorio se publican automáticamente.

## La versión corta

Desde la raíz del repositorio, ejecuta estos cuatro comandos:

```bash
# 1. Crea un proyecto válido para dos jugadores.
dotnet run --project tools/Corro.PackageCli -p:SkipFrontendBuild=true -- new track games/mi-primer-juego --id mi-primer-juego --name-en "My First Game" --name-es "Mi primer juego" --author "Tu nombre"

# 2. Compruébalo después de editar.
dotnet run --project tools/Corro.PackageCli -p:SkipFrontendBuild=true -- validate games/mi-primer-juego

# 3. Revisa qué ha entendido el motor.
dotnet run --project tools/Corro.PackageCli -p:SkipFrontendBuild=true -- inspect games/mi-primer-juego

# 4. Crea el archivo para subir.
dotnet run --project tools/Corro.PackageCli -p:SkipFrontendBuild=true -- pack games/mi-primer-juego --output artifacts/mi-primer-juego.corro
```

El proyecto inicial ya es válido. El resto de la guía explica qué puedes cambiar sin romperlo.

## Paso 1: elige la familia más parecida

Una **familia** es el modelo de interacción implementado por el motor. Elige aquella cuyo turno y
decisiones ya se parezcan a tu idea; los nombres y la temática no importan.

| Familia | Elígela si tu juego… | Archivo principal | Dificultad |
| --- | --- | --- | --- |
| `property` | recorre un tablero económico, compra grupos, construye y negocia | `board.json` y después `cards.json` | Avanzada |
| `race` | mueve varias fichas por un circuito, captura y entra en un pasillo final | `board.json` | Media |
| `track` | mueve una ficha por una pista con efectos que avanzan o retroceden | `board.json` | La más fácil |
| `journey` | juega cartas de distancia, ataque, remedio e inmunidad permanente | `cards.json` | Media |
| `assembly` | reúne piezas de colores mientras los rivales dañan y tú reparas | `cards.json` | Media |
| `draft` | todos eligen en secreto, revelan juntos y rotan las manos | `cards.json` | Avanzada |
| `shedding` | encaja con el descarte y gana quien vacía primero la mano | `cards.json` | Fácil |
| `exploding` | juega acciones y después roba con riesgo de eliminación y reacciones | `cards.json` | Media |
| `trivia` | recorre una rueda de seis categorías y responde preguntas | `questions.en.json` y `questions.es.json` | Media |

Para un primer experimento, `track` o `shedding` ofrecen el recorrido más corto. Usa `property` solo
si la economía, las subastas, los grupos y la construcción forman parte real de tu juego.

Si el turno principal no encaja en ninguna fila, probablemente el paquete todavía no pueda
expresarlo. Consulta [Cuándo no basta un paquete](#cuándo-no-basta-un-paquete).

## Paso 2: genera el proyecto

Sustituye la familia, carpeta, identificador, nombres y autor de este ejemplo:

```bash
dotnet run --project tools/Corro.PackageCli -p:SkipFrontendBuild=true -- new journey games/mi-viaje --id mi-viaje --name-en "My Journey" --name-es "Mi viaje" --author "Tu nombre"
```

El identificador del paquete:

- usa letras minúsculas, números, guiones o guiones bajos;
- debe permanecer estable después de compartir el juego;
- no se muestra al jugador, así que no necesita traducción.

Los nombres inglés y español sí se muestran. Conviven en `manifest.json`, y Corro elige el adecuado
para el idioma actual.

El comando se niega a sobrescribir una carpeta que no esté vacía. Es una protección deliberada para
no perder un juego existente.

## Paso 3: abre la carpeta generada

Abre la propia carpeta del paquete en VS Code: **Archivo → Abrir carpeta**. No abras solamente un
archivo JSON suelto.

Así, la carpeta `.vscode` conecta cada archivo con su esquema local. Mientras escribes, VS Code
propone campos conocidos y subraya errores obvios de tipo o escritura. Los esquemas ayudan, pero
`validate` sigue siendo la autoridad: ejecuta las reglas reales del motor y comprueba relaciones
entre archivos.

No edites `.vscode/schemas` al diseñar el juego. Esos archivos describen Corro, no tu contenido. Son
ayudas de autoría y se excluyen automáticamente del `.corro` final.

## Paso 4: entiende los archivos generados

| Ruta | Para qué sirve | ¿Empiezo aquí? |
| --- | --- | --- |
| `manifest.json` | Identidad, familia, jugadores, reglas y lista de fichas | Sí |
| `board.json` | Disposición espacial de `property`, `race`, `track` y `trivia` | Depende de la familia |
| `cards.json` | Cartas de `property` y las cinco familias de cartas | Depende de la familia |
| `cards/*.svg` | Ilustración opcional de la carta cuyo id coincida | Más adelante |
| `questions.en.json`, `questions.es.json` | Bancos reales de preguntas para `trivia` | Solo trivia |
| `i18n/en.json`, `i18n/es.json` | Nombres y textos referenciados mediante claves | Sí |
| `tokens/*.svg` | Geometría de las fichas de jugador | Más adelante |
| `CREDITS.md` | Fuentes y licencias de redistribución de arte y sonidos | Antes de compartir |
| `help.en.md`, `help.es.md` | Reglas F1 e instrucciones para lector de pantalla | Antes de compartir |
| `README.md` | Lista breve de pasos para el proyecto generado | Léelo |
| `.vscode/` | Esquemas locales y configuración del editor | No lo toques |

Las familias de cartas no tienen `board.json`, y es correcto. `race` y `track` no necesitan
`cards.json`. No crees archivos solo porque otra familia los tenga.

Cada plantilla comienza con exactamente dos jugadores para ser pequeña y comprensible. Para admitir
más, aumenta `players.max`, añade suficientes fichas o asientos distintos y amplía los mazos cuando
sea necesario. Ejecuta `validate`: indicará la capacidad exacta exigida por la familia.

## Paso 5: haz los primeros cambios seguros

Cambia una clase de contenido cada vez y valida después de cada paso.

### Identidad

Abre `manifest.json` y revisa:

- `id`: identidad técnica estable;
- `name.en` y `name.es`: nombres visibles y localizados;
- `author` y `version`;
- `players.min` y `players.max`;
- el bloque de reglas de la familia, como `trackRules` o `journeyRules`.

No renombres campos como `gameType` o `players`; cambia sus valores.

### Nombres y textos

Los archivos de contenido suelen contener referencias como:

```json
{ "id": "step25", "nameKey": "cards.step25" }
```

Las palabras reales viven en ambos archivos de idioma:

```json
{
  "cards": {
    "step25": "Avanza 25 unidades"
  }
}
```

La clave debe resolverse en al menos un idioma, y un paquete pensado para ambos debería traducirla en
los dos. Conserva estable la clave y traduce el valor. Nunca pongas un secreto, como un código de
desbloqueo, dentro de las traducciones: estas se envían a los navegadores.

### Tablero, cartas o preguntas

Usa la tabla de familias para encontrar el archivo principal. Empieza renombrando los elementos
neutrales existentes. Después cambia valores o cantidades. Solo entonces añade o elimina entradas.

La plantilla muestra las mecánicas esenciales de su familia. Cuando necesites un ejemplo realista,
compárala con el paquete más completo de la [tabla de referencias del SDK](../sdk/README.md#starter-templates-and-reference-packages).

### Dibujos opcionales para las cartas

Todas las cartas funcionan sin imagen: Corro muestra un dibujo neutro según su mecánica genérica.
Para sustituirlo, añade `cards/<id-de-carta>.svg`; por ejemplo, la carta `step25` usa
`cards/step25.svg`. No añadas un campo `svg` a `cards.json`.

Usa `viewBox="0 0 64 64"` y aplana el dibujo a geometría `<path>`. Por seguridad, el cargador
descarta colores y cualquier otro marcado SVG; el marco de la carta aporta un color legible. El
dibujo es decorativo: el nombre localizado y la ayuda de la carta siguen siendo la información
accesible. Ejecuta `validate`: un nombre de archivo mal escrito, un SVG sin trazado utilizable o un
dibujo demasiado grande se rechazan en vez de ignorarse silenciosamente.

También puedes añadir `"artColor": "#2F7185"` a esa carta en `cards.json` para colorear su marco
y silueta. Debe ser un valor `#RRGGBB` completo. Es solo una ayuda visual: el nombre y la ayuda
deben seguir expresando el color o la identidad de la carta.

## Supervivencia básica con JSON

JSON es una notación de texto estricta:

- las palabras llevan comillas dobles: `"name": "Mi juego"`;
- las propiedades se separan con comas;
- los objetos usan `{ }` y las listas `[ ]`;
- los números y `true`/`false` no llevan comillas;
- cada llave o corchete abierto necesita su cierre.

Si VS Code subraya una línea, deja el ratón encima antes de seguir. Si `validate` dice `Invalid JSON`,
incluye línea y posición. Corrige primero ese error de sintaxis; otros mensajes podrían ser una
consecuencia suya.

## Paso 6: conserva el juego accesible y bilingüe

Corro nace centrado en accesibilidad. No borres la sección de lector de pantalla de ninguna ayuda.
Reescríbela para describir tu juego real:

- dónde vive normalmente el foco de teclado;
- qué exploran las flechas;
- cómo se realiza el turno;
- qué anuncian `S`, `Shift+S` u otras teclas de estado de la familia;
- que `F6`/`Shift+F6` recorren las zonas del juego;
- que `Ctrl+Shift+R` abre el chat y enfoca el cuadro de mensaje;
- qué sucesos se anuncian automáticamente.

Evita instrucciones que dependan solo de la vista, como «pulsa el botón rojo» o «ve al icono de la
izquierda». Nombra la acción y la información. La guía generada para la familia es un punto de
partida veraz, no un texto de relleno.

Mantén equivalentes `help.en.md` y `help.es.md`. Escribe también etiquetas y anuncios compuestos como
frases fluidas, no como datos separados visualmente. Consulta la
[arquitectura de accesibilidad](accessibility.md) si añades terminología compleja.

## Paso 7: valida a menudo

Desde la raíz del repositorio, ejecuta:

```bash
dotnet run --project tools/Corro.PackageCli -p:SkipFrontendBuild=true -- validate games/mi-primer-juego
```

`VALID` significa que el mismo cargador y los mismos validadores de familia usados por el servidor
han aceptado el paquete. Un aviso del esquema puede ayudar, pero solo este comando demuestra la
conformidad con el motor.

Usa `inspect` para comprobar qué ha entendido Corro:

```bash
dotnet run --project tools/Corro.PackageCli -p:SkipFrontendBuild=true -- inspect games/mi-primer-juego
```

Muestra familia, nombres, idiomas, jugadores, número de fichas y cantidades específicas. En un
paquete oculto muestra `Hidden: yes`, pero nunca imprime el código de desbloqueo.

## Errores frecuentes en lenguaje sencillo

| El mensaje contiene… | Significa | Comprueba |
| --- | --- | --- |
| `Invalid JSON (line …)` | El JSON está mal formado | Comillas, comas y cierres cerca de esa línea |
| `resolves in no locale` | Una clave `nameKey`/`textKey` no tiene texto | Añade la misma clave en `i18n/en.json` e `i18n/es.json` |
| `token … has no icon` | Una ficha declarada no tiene un SVG utilizable | Revisa el id y `tokens/<id>.svg` |
| `card illustration …` | Un SVG opcional de carta está mal formado, es demasiado grande o no corresponde a ninguna carta | Haz coincidir `cards/<id>.svg` con un id de `cards.json` y aplánalo a trazados |
| `unknown type` o `unknown effect` | Has nombrado una mecánica no implementada por la familia | Usa una opción sugerida por el esquema o la referencia |
| `deck … is too small` | No se puede repartir a la mesa máxima | Añade copias, reduce la mano o baja `players.max` |
| `players.max … tokens/seats` | Hay más jugadores permitidos que fichas/asientos | Añade fichas/asientos o reduce `players.max` |
| `Destination folder is not empty` | `new` está protegiendo archivos existentes | Elige una carpeta nueva o vacía; nunca fuerza el borrado |
| `output archive must be outside` | El archivo acabaría incluyéndose a sí mismo | Pon el `.corro` junto a la carpeta, no dentro |

Copia el mensaje **completo** al pedir ayuda: está diseñado para identificar el campo, carta o
casilla implicados.

## Paso 8: empaqueta y sube

Cuando la validación sea correcta:

```bash
dotnet run --project tools/Corro.PackageCli -p:SkipFrontendBuild=true -- pack games/mi-primer-juego --output artifacts/mi-primer-juego.corro
```

`pack` valida primero, crea un archivo reproducible, lo extrae por la ruta segura de subida del
servidor y vuelve a validarlo antes de sustituir el destino. También imprime tamaño y SHA-256.

Abre [imperio.kastwey.org](https://imperio.kastwey.org), el servidor público de Corro, elige **Crear
partida** y usa **subir un juego (.corro)** para seleccionar el archivo. Subirlo no instala el paquete
en el catálogo público de juegos del servidor. Queda preparado para la partida que vas a crear; el
servidor puede conservar sus bytes para restaurarla.

En una instalación propia, un administrador también puede colocar el paquete descomprimido bajo
`server/Packages/`. Es una opción avanzada de despliegue; un autor normal no la necesita.

## Trabajo original y redistribución

Puedes experimentar en privado con los paquetes que permitan las leyes de tu territorio. Un paquete
propuesto para este repositorio público debe usar nombres, textos, arte y sonidos originales, de
dominio público o con una licencia adecuada. No envíes una reproducción de un juego comercial aunque
sus reglas sean conocidas. Dale título, terminología e identidad visual propios. Consulta las
[reglas de contribución](../CONTRIBUTING.md#contributing-a-game-package).

## Cuándo no basta un paquete

Un paquete configura mecánicas ya implementadas por su familia. No puede introducir un modelo de
turno, una política de información secreta o una superficie interactiva completamente nuevos.

Probablemente necesitas proponer una familia del motor si tu juego requiere, por ejemplo:

- una secuencia de turno distinta de todas las familias existentes;
- información secreta visible para un subconjunto especial de jugadores;
- un nuevo tipo de tablero o interacción con la mano;
- decisiones o reacciones imposibles de representar con las cartas existentes;
- reglas especiales de abandono, restauración o bots.

Antes de escribir código del motor, abre una incidencia describiendo las decisiones del jugador y el
flujo del turno. A menudo la solución mínima es un efecto declarativo reutilizable en una familia
existente, no una familia ni un lenguaje de scripting. Consulta el
[diseño de familias](game-families.md#package-or-new-family).

## Dónde continuar

- [Beginner guide in English](package-authoring.md)
- [Tutorial de tablero de propiedades](tutorial-city-board.md)
- [Referencia del formato](../CORRO_FORMAT.md)
- [Referencia de la CLI](../tools/Corro.PackageCli/README.md)
- [Alcance y límites de los esquemas](../sdk/Corro.PackageSdk/Schemas/README.md)
- [Paquetes de referencia por familia](../sdk/README.md#starter-templates-and-reference-packages)
- [Contribución y licencias](../CONTRIBUTING.md#contributing-a-game-package)
