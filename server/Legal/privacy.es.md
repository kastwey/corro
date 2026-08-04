# Aviso de privacidad

_Última actualización: 3 de agosto de 2026._

Este servicio de Corro lo gestiona **{{controller}}**, con sede o residencia en {{jurisdiction}}.
Puedes contactar con {{controller}} en **{{contact}}**.

A efectos de la normativa de protección de datos, {{controller}} actúa como _responsable del
tratamiento_: es la persona u organización que decide cómo se utilizan los datos descritos a
continuación. Corro es el programa; este aviso se refiere a esta instalación concreta.

## Jugar sin cuenta

No necesitas una cuenta para jugar. Corro no pide a quienes juegan sin cuenta una dirección de
correo ni un nombre real, pero el servidor sí trata los datos necesarios para mantener una mesa y
permitir que sus jugadores vuelvan a ella.

Cuando creas una mesa o te unes a ella, el servidor guarda:

- El **nombre de jugador que elijas**, identificadores internos de la mesa y del jugador, la ficha,
  la plaza o el equipo que hayas elegido y las marcas de tiempo asociadas. No tienes que usar tu
  nombre real.
- Una credencial secreta para tu plaza y un código para volver a entrar. Sirven para demostrar que
  la plaza es tuya y no se muestran a los demás jugadores.
- La configuración de la mesa, las acciones de la partida, su estado actual y los resultados.
- Los 200 mensajes más recientes del chat de texto, si la mesa lo utiliza.
- Un paquete de juego personalizado, si el anfitrión sube uno para la mesa.

Esta información se utiliza para hacer funcionar la partida, aplicar sus reglas y recuperar la mesa
después de una desconexión. Las demás personas de la mesa pueden ver el nombre que hayas elegido,
las acciones de la partida y los mensajes del chat. El responsable y quienes estén autorizados para
administrar el servidor pueden acceder a los datos de la mesa almacenados en él; el chat de texto no
está cifrado de extremo a extremo, por lo que el servidor puede acceder a su contenido. No incluyas
en tu nombre de jugador, tus mensajes o los paquetes que subas datos que no quieras que vean esas
personas.

Como en cualquier servicio en línea, el servidor y los sistemas que lo alojan también tratan datos
técnicos de conexión, como la dirección IP, la fecha y hora de las solicitudes, las rutas solicitadas
y datos básicos del navegador o de la red. Los registros operativos pueden incluir identificadores
de mesas, jugadores o cuentas, así como nombres de jugador. Estos datos se utilizan para proteger,
mantener y diagnosticar el servicio, no con fines publicitarios ni para elaborar perfiles.

## Si inicias sesión

Iniciar sesión es opcional. Al hacerlo se crea una cuenta que guarda:

- Un identificador interno y un nombre de perfil editable, tomado inicialmente del perfil que
  proporcione el proveedor de inicio de sesión.
- La dirección de correo comunicada por el proveedor, si está disponible. Se muestra en los ajustes
  de tu cuenta para que puedas distinguir los métodos de acceso; Corro no la utiliza para identificar
  una cuenta ni para vincular cuentas entre sí.
- Por cada método de acceso vinculado, el nombre del proveedor, el identificador opaco que este te
  asigna, la dirección de correo que haya comunicado y la fecha de vinculación.
- Las fechas de creación de la cuenta y del último inicio de sesión.

Corro nunca recibe la contraseña de tu proveedor de inicio de sesión ni conserva su token de acceso.
Una cuenta se identifica únicamente por el proveedor y su identificador opaco, nunca por la
dirección de correo. Dos proveedores pueden comunicar la misma dirección para personas distintas;
por eso, usar otro proveedor puede crear al principio una cuenta independiente. Dos cuentas solo se
unen después de que demuestres expresamente que controlas ambos métodos de acceso.

Cuando ocupas una plaza con la sesión iniciada, la mesa guarda el identificador interno de tu cuenta.
Si inicias sesión después de haber jugado sin cuenta, el navegador puede asociar a esa cuenta las
plazas cuyas credenciales ya conserva. Así pueden aparecer esas mesas en otro dispositivo donde
hayas iniciado sesión.

## Tu nombre público y aparecer conectado

Una cuenta puede tener un **nombre público** — un identificador como `@kastwey` — que eliges tú. Es
opcional: no hace falta para jugar y no se pide al iniciar sesión. Se guarda junto a tu cuenta, con
la fecha en que lo cambiaste por última vez, de modo que un nombre se mantiene estable durante
treinta días seguidos.

Aparte, puedes pedir aparecer en la **lista de jugadores conectados**. Está desactivada salvo que la
actives, y mientras esté activa el servidor publica, solo a otros jugadores con la sesión iniciada:

- Tu **nombre público**. Nunca el nombre de tu cuenta, que suele venir de tu proveedor de acceso y a
  menudo es tu nombre real: esa lista no lo publica en ningún caso.
- Una indicación aproximada de qué estás haciendo: en el lobby, en una mesa o jugando. Nunca dice en
  qué mesa ni en qué partida.

Desactivarla te retira por completo de la lista: a los demás no se les indica que haya nadie oculto
ni ningún recuento te incluye. Un nombre público que dejas de usar no se entrega de inmediato a otra
persona, para que nadie pueda tomar un nombre que tus amistades conocen y hacerse pasar por ti.

## Solicitudes de amistad

Desde la lista de jugadores conectados puedes pedir amistad a alguien. Pedirla guarda un único
registro de la relación entre las dos cuentas: quién la pidió, si está pendiente, aceptada o
rechazada, y cuándo. No viaja contigo ningún otro dato.

Solo pueden pedírtela por tu nombre si tienes un nombre público Y has pedido aparecer en la lista,
de modo que ser localizable sigue siendo una decisión tuya. El servidor responde igual ante un
nombre inexistente que ante alguien que eligió no aparecer, así que esa página no sirve para
averiguar qué nombres existen.

Dos cosas sobre rechazar conviene decirlas claramente, porque son decisiones y no consecuencias de
cómo está construido:

- **El rechazo se recuerda.** El registro sobrevive, así que esa persona no puede volver a pedírtelo.
  Si se borrara sin más, un "no" significaría "esta noche no" y tu única salida real sería dejar de
  aparecer en la lista.
- **El rechazo no se comunica.** Quien lo pidió sigue viendo que lo pidió, y nunca se le dice qué
  decidiste. Tampoco puede retirar una solicitud: un botón que funcionara antes de la respuesta y
  fallara después anunciaría tu decisión al fallar.

Puedes deshacer una amistad cuando quieras, desde cualquiera de los dos lados; eso borra el
registro, y después cualquiera de los dos puede volver a pedirla. Borrar tu cuenta elimina todos
estos registros, incluidos los que están en las listas de quienes eran amigos tuyos.

## Cookies y datos guardados en el navegador

Corro utiliza estas cookies propias:

- `corro_language` guarda durante un año el idioma que hayas elegido.
- `corro.session` contiene una credencial de acceso cifrada. Su duración la fija el responsable —30
  días por defecto— y el uso activo puede renovar ese plazo.
- `corro.external` conserva temporalmente el resultado de un inicio de sesión con Google o
  Microsoft. Caduca en un máximo de cinco minutos y suele eliminarse en cuanto termina el proceso.

Las dos cookies de acceso son `HttpOnly` y solo resultan necesarias si decides utilizar una cuenta.
Corro no instala cookies publicitarias ni analíticas.

El almacenamiento local del navegador conserva:

- Una lista de las mesas a las que se ha unido este navegador, incluidos los identificadores de la
  mesa y del jugador, las credenciales de la plaza, los códigos para volver a entrar y los nombres de
  jugador elegidos. Las entradas de más de siete días se eliminan la próxima vez que se consulta la
  lista.
- Preferencias locales como el tema, los ajustes de sonido, el volumen de cada participante en el
  chat de voz, los dispositivos de audio seleccionados, la disposición de la mano, los avisos ya
  descartados y los códigos de desbloqueo de paquetes.

La aplicación envía al servidor los identificadores de las mesas guardadas para actualizar la
lista. También envía la credencial de una plaza al volver a conectarse o, después de iniciar sesión,
al asociar esa plaza con la cuenta. Las demás preferencias permanecen normalmente en el navegador.

Borrar los datos de este sitio en el navegador elimina estos registros locales y las cookies. **No**
borra una cuenta, una mesa ni el historial de chat almacenado en el servidor.

## Chat de voz

Si esta instalación ofrece chat de voz, unirse siempre es opcional. Cuando decides entrar, el
navegador envía el audio del micrófono a través del servidor de retransmisión de esta instalación
para que lo reciban las demás personas de la sala. El servidor de retransmisión también trata el
identificador que tienes como jugador en la mesa, tu nombre de jugador, la dirección IP y datos de
conexión.

El audio se cifra en cada conexión mediante WebRTC, pero no de extremo a extremo entre los
participantes: el servidor de retransmisión puede acceder a él. Corro **no** lo graba ni lo
transcribe. Al salir del chat de voz, el navegador deja de enviar audio.

## Para qué se utilizan los datos

Los datos descritos se utilizan para:

- Prestar las funciones de mesa, chat, cuenta y voz opcional que solicites.
- Autenticar una plaza o una cuenta y permitir que su titular vuelva a conectarse.
- Evitar abusos, proteger el servicio, investigar fallos y mantener su fiabilidad.
- Cumplir una obligación legal, cuando corresponda.

Cuando resulte aplicable el RGPD u otra norma equivalente, el tratamiento necesario para las
funciones de mesa, chat de texto, cuenta y voz opcional se basa en la ejecución del acuerdo por el
que el responsable te presta el servicio que solicitas. El servidor de retransmisión solo recibe
audio después de que decidas unirte, y al salir se detiene cualquier transmisión posterior. La
generación de los registros operativos necesarios y la prevención de abusos se basan en el interés
legítimo del responsable en la seguridad y el buen funcionamiento. El tratamiento exigido por ley se
basa en la obligación legal correspondiente.

El nombre de jugador y las credenciales técnicas son necesarios para ocupar una plaza. No necesitas
una cuenta, una dirección de correo ni el chat de voz para jugar. Corro no vende datos personales,
no los utiliza con fines publicitarios, no crea perfiles publicitarios ni toma decisiones
automatizadas que produzcan efectos jurídicos o de importancia similar para ti.

## Quién recibe los datos

- **Las demás personas de tu mesa** reciben los nombres, la información de la partida, el chat y el
  audio en directo que están destinados a compartirse con ellas.
- **El proveedor de inicio de sesión que elijas**, actualmente Google o Microsoft cuando estén
  disponibles, sabe que has iniciado sesión en este sitio y comunica al responsable tu identificador
  en ese proveedor, el nombre del perfil y, si está disponible, la dirección de correo. Su propio
  tratamiento se rige por la política de privacidad de ese proveedor.
- **Los proveedores técnicos del responsable** pueden tratar datos por cuenta de este. Pueden ser
  proveedores de alojamiento, base de datos, registros operativos y retransmisión de voz opcional.
  Dependen de cómo se gestione esta instalación; escribe a **{{contact}}** para conocer sus nombres,
  los países o regiones donde tratan los datos y, si procede, las garantías para transferencias
  internacionales.

Los datos también podrán comunicarse cuando lo exija la ley o cuando sea necesario para proteger el
servicio y a sus usuarios.

## Cuánto tiempo se conservan los datos

El anfitrión puede borrar una mesa y una mesa vacía puede eliminarse automáticamente. Cuando está
activada la eliminación automática por inactividad, se borran las mesas que no hayan recibido una
actualización durante el plazo elegido por el responsable, que es de 30 días de forma predeterminada.
El estado de la partida, los nombres de jugador, el chat y cualquier paquete subido se borran junto
con la mesa. Si la eliminación automática está desactivada, la mesa permanece hasta que se elimine
de forma manual o se borre el almacenamiento subyacente.

La cuenta se conserva hasta que la borres o hasta que el responsable atienda una solicitud válida de
supresión. Los registros operativos y las copias de seguridad se conservan durante los plazos
fijados por el responsable y sus proveedores; escribe a **{{contact}}** para conocer los de esta
instalación. Los proveedores de inicio de sesión conservan sus propios registros conforme a sus
políticas.

## Borrar una cuenta

Puedes borrar tu cuenta en cualquier momento desde **Tu cuenta**. Se eliminan el perfil de la
cuenta, las direcciones de correo y los vínculos con todos los métodos de inicio de sesión, y se
cierra la sesión en el navegador actual. Si más adelante vuelves a entrar con el mismo proveedor,
se creará otra cuenta.

Borrar una cuenta **no** elimina los registros compartidos de las mesas. El registro de tu plaza, el
nombre de jugador que hayas elegido, las acciones de las partidas y los mensajes del chat permanecen
para los demás jugadores hasta que se borre la mesa. La plaza puede conservar el antiguo
identificador interno de la cuenta como referencia técnica huérfana, pero ya no remite a una cuenta
ni permite recuperar la mesa a través de ella. Las credenciales locales de las mesas también
permanecen en este navegador hasta que borres los datos del sitio o caduquen en la lista local.

Los datos incluidos en copias de seguridad o registros de seguridad pueden permanecer hasta que
concluya su periodo normal de conservación, salvo que la ley obligue a guardarlos durante más
tiempo.

## Tus derechos

Según la legislación aplicable, puedes tener derecho a acceder a tus datos personales, corregirlos
o suprimirlos; limitar u oponerte a su uso; recibirlos en un formato estructurado y de uso común, y
retirar el consentimiento cuando el tratamiento se base en él. Estos derechos no son absolutos,
especialmente cuando una mesa compartida contiene también datos de otras personas. Escribe a
**{{contact}}**. El responsable puede necesitar información suficiente para localizar tus datos y
comprobar que son tuyos.

El responsable responderá dentro del plazo exigido por la legislación aplicable. Con arreglo al
RGPD, el plazo habitual es de un mes, aunque la ley permite ampliarlo cuando la solicitud es
compleja. También puedes reclamar ante una autoridad de protección de datos competente, incluida la
del lugar donde vivas o trabajes o donde consideres que se ha producido una infracción.

## Cambios en este aviso

Este aviso se actualizará cuando cambie la forma en que esta instalación trata los datos. La fecha
indicada al comienzo muestra cuándo se revisó el texto por última vez.
