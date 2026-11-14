# Redis

Sus claves de Redis (o Valkey) como sensores de Gladys, y la escritura desde sus
escenas: un puente sencillo entre Gladys y los scripts caseros que ya guardan
contadores, estados o colas en Redis.

Probada con Redis 7.4 y Valkey 8.1 reales (Docker), con y sin contraseña, con un
usuario ACL y con las notificaciones keyspace. Comentarios e informes de errores
son bienvenidos en [GitHub](https://github.com/guim31/gladys-redis/issues).

## Qué obtiene

- **Un dispositivo por clave añadida**: una cadena o un campo de hash da su
  valor (un número o un texto), una lista, un conjunto, un conjunto ordenado o
  un flujo da su longitud.
- **Un dispositivo para el servidor**: accesible, versión, memoria usada,
  clientes conectados, claves de la base de datos.
- **Actualizaciones inmediatas** con las notificaciones keyspace, si su servidor
  las envía; si no, las claves se leen en el intervalo elegido.
- **Acciones de escena** para escribir un valor, incrementar un número y
  publicar un mensaje, desactivadas por defecto.
- Un **disparador de escena** cuando una clave cambia (escrita, eliminada,
  caducada…).
- Un **widget del panel** con el valor de cada clave.

## Requisitos

- Redis 6 o posterior, o Valkey, accesible desde Gladys por la red (no
  `localhost`: la integración se ejecuta en su propio contenedor).
- Un usuario ACL requiere Redis 6 o posterior; con un simple `requirepass`, deje
  el usuario vacío.

## Configuración

- **Dirección**: nombre o dirección IP del servidor. También se aceptan
  `redis://host:puerto` y `rediss://host:puerto` (TLS), sin credenciales.
- **Puerto**, **Número de base de datos** (0, salvo que sus scripts usen
  `SELECT`).
- **Usuario (ACL, opcional)** y **Contraseña (opcional)**.
- **Conexión TLS**, y **Aceptar certificados autofirmados** para un certificado
  propio.
- **Intervalo de actualización**: de 10 segundos a 10 minutos; cada clave cuesta
  dos comandos por lectura (`TYPE`, y después la lectura).
- **Permitir la escritura desde las escenas**: desactivado por defecto; vea
  Escenas.
- **Canales permitidos para publicar**: los canales que «Publicar un mensaje de
  Redis» puede usar, separados por comas.
- **Idioma de los nombres y mensajes**: los nombres de las funciones del
  servidor y los mensajes de las acciones.

Use después **Probar la conexión**: lee el servidor y cada clave, e indica lo que
falla.

Un usuario ACL solo necesita leer las claves añadidas. Por ejemplo, solo
lectura:
`ACL SETUSER gladys on >contraseña ~sensors:* +@read +info +dbsize +ping +hello +select +type`,
más `+@write +publish &*` para escribir y publicar desde las escenas, y
`+subscribe &__keyspace@0__:*` para las notificaciones.

### Notificaciones keyspace

Marque **Seguir las notificaciones keyspace** para leer una clave en cuanto
cambia. La integración se suscribe al canal exacto de cada clave añadida (nunca a
un patrón) pero **nunca modifica la configuración del servidor**: el servidor
debe enviarlas. Por ejemplo, en `redis.conf`: `notify-keyspace-events KA`, o en
caliente: `CONFIG SET notify-keyspace-events KA`. **Probar la conexión** indica
si el servidor las envía. La lectura periódica se mantiene como red de
seguridad.

## Añadir claves

Gladys no tiene campo de lista en un formulario de configuración: las claves se
añaden con la acción **Añadir una clave** de la página de configuración, y la
integración las guarda.

- **Clave**: el nombre exacto, p. ej. `sensors:garage:temperature`. Sin patrón:
  la integración nunca recorre la base de datos.
- **Campo del hash (solo hash)**: para un hash, el campo que leer, p. ej.
  `power`.
- **Tipo en Gladys**: Automático (número o texto), Número, Temperatura (°C),
  Humedad (%), Porcentaje (%), Potencia (W), Energía (kWh), Texto. Automático
  elige según el valor actual: un número, o texto. Una lista, un conjunto, un
  conjunto ordenado o un flujo se lee como su longitud.
- **Nombre (opcional)**: el nombre del dispositivo; la clave por defecto.

La misma clave añadida de nuevo cambia su nombre o su tipo (un tipo nuevo es una
función nueva: use «Actualizar» en la pestaña Descubrir). **Eliminar una clave**
deja de seguir una clave; su dispositivo queda en Gladys hasta que lo elimine.
Hasta 50 claves.

## Dispositivos

Añada los dispositivos que quiera seguir desde la pestaña **Descubrir** de la
integración: el servidor, y un dispositivo por clave. Los valores se envían
cuando cambian, y de nuevo cada 6 horas si no. Mientras el servidor no responde,
los dispositivos clave aparecen como no accesibles y la función «Accesible» del
servidor pasa a 0.

## Escenas

### Disparadores

**Una clave de Redis cambia**: ha llegado una notificación keyspace de una clave
seguida. Filtros: la clave (vacío: todas) y el evento Redis (`set`, `del`,
`expired`, `incrbyfloat`, `hset`…, vacío: todos). Variables: la clave, su
nombre, el evento y el nuevo valor (vacío si no hay ninguno). Requiere las
notificaciones keyspace (vea más arriba). Para actuar según un valor (por encima
de un umbral…), use mejor el dispositivo clave en un disparador «Estado de un
dispositivo».

### Acciones

La escritura se rechaza mientras **Permitir la escritura desde las escenas** no
esté marcado, y solo alcanza las claves seguidas: la escena elige un dispositivo
clave. Una lista, un conjunto o un flujo nunca se sobrescribe.

- **Escribir un valor de Redis**: `SET` (o `HSET` para un campo de hash), con una
  expiración opcional en segundos (en un hash, la expiración afecta a toda la
  clave). El valor acepta las variables de escena.
- **Incrementar un valor de Redis**: `INCRBYFLOAT` (o `HINCRBYFLOAT`), en 1 si
  está vacío, negativo para disminuir, se acepta la coma. Da el nuevo valor.
- **Publicar un mensaje de Redis**: `PUBLISH` en un canal indicado en **Canales
  permitidos para publicar**. Da el número de suscriptores alcanzados.

## Panel

El widget **Valores de Redis** muestra el valor de cada clave seguida (o de las
elegidas en sus ajustes), una fila para el servidor y un botón **Actualizar**.
Los ajustes permiten ocultar la fila del servidor y el botón.

## Límites

- Cadenas, campos de hash, listas, conjuntos, conjuntos ordenados y flujos; los
  demás tipos (módulos como RedisJSON) no se leen.
- Ni Redis Cluster ni Sentinel: un solo servidor.
- Un texto se corta a 255 caracteres.

## Solución de problemas

- **«no responde»**: compruebe la dirección y el puerto, y que Redis escucha en
  la red (`bind`, `protected-mode`), no solo en `127.0.0.1`.
- **«acceso denegado»**: compruebe el usuario y la contraseña; deje el usuario
  vacío con un simple `requirepass`.
- **«rechazados por las ACL del usuario»**: el usuario ACL no puede leer esta
  clave o ejecutar este comando (vea Configuración).
- **Sin actualización inmediata**: el servidor no envía las notificaciones
  keyspace; **Probar la conexión** lo indica.
- Más detalles con `LOG_LEVEL=debug` en los registros de la integración. Informe
  de un problema en [GitHub](https://github.com/guim31/gladys-redis/issues).

Redis es una marca de Redis Ltd. Esta integración no está afiliada a Redis Ltd
ni al proyecto Valkey.
