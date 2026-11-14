// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the configuration action reports, the feature
// names of the server device, scene action messages. Four languages, the four
// of the Gladys interface; German says "du", Spanish "usted".
// test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './redis/client.js';
import { KEY_PROBLEMS } from './keys.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noServer: {
    en: 'Enter the address of your Redis server in the configuration.',
    fr: "Saisissez l'adresse de votre serveur Redis dans la configuration.",
    de: 'Gib die Adresse deines Redis-Servers in der Konfiguration ein.',
    es: 'Introduzca la dirección de su servidor Redis en la configuración.',
  },
  invalidHost: {
    en: 'Address not understood, e.g. 192.168.1.2 or redis.local',
    fr: 'Adresse incomprise, ex. 192.168.1.2 ou redis.local',
    de: 'Adresse nicht verstanden, z. B. 192.168.1.2 oder redis.local',
    es: 'Dirección no válida, p. ej. 192.168.1.2 o redis.local',
  },
};

// One short explanation per error kind (src/redis/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'does not answer',
    fr: 'ne répond pas',
    de: 'antwortet nicht',
    es: 'no responde',
  },
  [ERROR_KINDS.TLS]: {
    en: 'TLS refused: check the TLS option, or tick "Accept self-signed certificates"',
    fr: "TLS refusé : vérifiez l'option TLS, ou cochez « Accepter les certificats auto-signés »",
    de: 'TLS abgelehnt: Prüfe die TLS-Option oder aktiviere „Selbstsignierte Zertifikate akzeptieren“',
    es: 'TLS rechazado: compruebe la opción TLS, o marque «Aceptar certificados autofirmados»',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'access refused: check the user and the password',
    fr: "accès refusé : vérifiez l'utilisateur et le mot de passe",
    de: 'Zugriff verweigert: Prüfe Benutzer und Passwort',
    es: 'acceso denegado: compruebe el usuario y la contraseña',
  },
  [ERROR_KINDS.PERMISSION]: {
    en: 'command or key refused by the ACL of the user',
    fr: "commande ou clé refusée par les ACL de l'utilisateur",
    de: 'Befehl oder Schlüssel von den ACL des Benutzers abgelehnt',
    es: 'comando o clave rechazados por las ACL del usuario',
  },
  [ERROR_KINDS.DATABASE]: {
    en: 'this database number does not exist on the server',
    fr: "ce numéro de base n'existe pas sur le serveur",
    de: 'diese Datenbanknummer gibt es auf dem Server nicht',
    es: 'este número de base de datos no existe en el servidor',
  },
  [ERROR_KINDS.WRONG_TYPE]: {
    en: 'the key holds another type of value',
    fr: 'la clé contient un autre type de valeur',
    de: 'der Schlüssel enthält einen anderen Werttyp',
    es: 'la clave contiene otro tipo de valor',
  },
  [ERROR_KINDS.OTHER]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
};

// Why a key has no value (src/keys.js KEY_PROBLEMS).
export const KEY_PROBLEM_TEXT = {
  [KEY_PROBLEMS.MISSING]: {
    en: 'key absent',
    fr: 'clé absente',
    de: 'Schlüssel fehlt',
    es: 'clave ausente',
  },
  [KEY_PROBLEMS.NEEDS_FIELD]: {
    en: 'a hash: add it again with its field',
    fr: 'un hash : ajoutez-la de nouveau avec son champ',
    de: 'ein Hash: Füge ihn erneut mit seinem Feld hinzu',
    es: 'un hash: añádala de nuevo con su campo',
  },
  [KEY_PROBLEMS.NOT_HASH]: {
    en: 'not a hash: add it again without a field',
    fr: 'pas un hash : ajoutez-la de nouveau sans champ',
    de: 'kein Hash: Füge ihn erneut ohne Feld hinzu',
    es: 'no es un hash: añádala de nuevo sin campo',
  },
  [KEY_PROBLEMS.NO_FIELD]: {
    en: 'field absent from the hash',
    fr: 'champ absent du hash',
    de: 'Feld fehlt im Hash',
    es: 'campo ausente del hash',
  },
  [KEY_PROBLEMS.NOT_NUMBER]: {
    en: 'the value is not a number',
    fr: "la valeur n'est pas un nombre",
    de: 'der Wert ist keine Zahl',
    es: 'el valor no es un número',
  },
  [KEY_PROBLEMS.EMPTY]: {
    en: 'empty value',
    fr: 'valeur vide',
    de: 'leerer Wert',
    es: 'valor vacío',
  },
  [KEY_PROBLEMS.UNSUPPORTED]: {
    en: 'type of key not supported',
    fr: 'type de clé non pris en charge',
    de: 'Schlüsseltyp nicht unterstützt',
    es: 'tipo de clave no admitido',
  },
};

// The Gladys types offered in "Add a key" (src/keys.js KEY_TYPES).
export const TYPE_TEXT = {
  number: { en: 'number', fr: 'nombre', de: 'Zahl', es: 'número' },
  temperature: { en: 'temperature', fr: 'température', de: 'Temperatur', es: 'temperatura' },
  humidity: { en: 'humidity', fr: 'humidité', de: 'Luftfeuchtigkeit', es: 'humedad' },
  percent: { en: 'percentage', fr: 'pourcentage', de: 'Prozentsatz', es: 'porcentaje' },
  power: { en: 'power', fr: 'puissance', de: 'Leistung', es: 'potencia' },
  energy: { en: 'energy', fr: 'énergie', de: 'Energie', es: 'energía' },
  text: { en: 'text', fr: 'texte', de: 'Text', es: 'texto' },
};

// The server device: its name and its features (src/devices.js).
export const SERVER_TEXT = {
  en: {
    device: (host) => `Redis ${host}`,
    reachable: 'Reachable',
    version: 'Version',
    memory: 'Memory used',
    clients: 'Connected clients',
    keys: 'Keys in the database',
  },
  fr: {
    device: (host) => `Redis ${host}`,
    reachable: 'Joignable',
    version: 'Version',
    memory: 'Mémoire utilisée',
    clients: 'Clients connectés',
    keys: 'Clés de la base',
  },
  de: {
    device: (host) => `Redis ${host}`,
    reachable: 'Erreichbar',
    version: 'Version',
    memory: 'Belegter Speicher',
    clients: 'Verbundene Clients',
    keys: 'Schlüssel in der Datenbank',
  },
  es: {
    device: (host) => `Redis ${host}`,
    reachable: 'Accesible',
    version: 'Versión',
    memory: 'Memoria usada',
    clients: 'Clientes conectados',
    keys: 'Claves de la base de datos',
  },
};

// Reports of the configuration actions ("Test the connection", "Add a key",
// "Remove a key"). Functions: the parts that carry a value.
export const REPORT_TEXT = {
  en: {
    ok: 'OK',
    dbKeys: (count) => `${count} key(s) in the database`,
    keys: (count) => `${count} key(s) followed`,
    noKey: 'no key followed yet: use "Add a key"',
    added: (name) => `Key "${name}" added`,
    updated: (name) => `Key "${name}" updated`,
    removed: (name) => `Key "${name}" removed`,
    typed: (type) => `type ${type}`,
    value: (value) => `value ${value}`,
    discovery: 'add its device from the Discover tab',
    notFound: (key) => `No key "${key}" is followed.`,
    tooMany: (max) => `${max} keys at most: remove one first.`,
    notChecked: 'saved, but not checked',
    notifyOn: 'keyspace notifications received',
    notifyOff: (value) =>
      `keyspace notifications off on the server (notify-keyspace-events "${value}"): reading every interval`,
    notifyUnknown: 'notify-keyspace-events not readable (ACL): reading every interval as well',
  },
  fr: {
    ok: 'OK',
    dbKeys: (count) => `${count} clé(s) dans la base`,
    keys: (count) => `${count} clé(s) suivie(s)`,
    noKey: 'aucune clé suivie : utilisez « Ajouter une clé »',
    added: (name) => `Clé « ${name} » ajoutée`,
    updated: (name) => `Clé « ${name} » modifiée`,
    removed: (name) => `Clé « ${name} » supprimée`,
    typed: (type) => `type ${type}`,
    value: (value) => `valeur ${value}`,
    discovery: "ajoutez son appareil depuis l'onglet Découverte",
    notFound: (key) => `Aucune clé « ${key} » n'est suivie.`,
    tooMany: (max) => `${max} clés au plus : supprimez-en une d'abord.`,
    notChecked: 'enregistrée, mais pas vérifiée',
    notifyOn: 'notifications keyspace reçues',
    notifyOff: (value) =>
      `notifications keyspace désactivées sur le serveur (notify-keyspace-events « ${value} ») : lecture à chaque intervalle`,
    notifyUnknown: 'notify-keyspace-events illisible (ACL) : lecture à chaque intervalle en plus',
  },
  de: {
    ok: 'OK',
    dbKeys: (count) => `${count} Schlüssel in der Datenbank`,
    keys: (count) => `${count} Schlüssel verfolgt`,
    noKey: 'noch kein Schlüssel verfolgt: Nutze „Schlüssel hinzufügen“',
    added: (name) => `Schlüssel „${name}“ hinzugefügt`,
    updated: (name) => `Schlüssel „${name}“ geändert`,
    removed: (name) => `Schlüssel „${name}“ entfernt`,
    typed: (type) => `Typ ${type}`,
    value: (value) => `Wert ${value}`,
    discovery: 'füge sein Gerät im Tab „Entdecken“ hinzu',
    notFound: (key) => `Der Schlüssel „${key}“ wird nicht verfolgt.`,
    tooMany: (max) => `Höchstens ${max} Schlüssel: Entferne zuerst einen.`,
    notChecked: 'gespeichert, aber nicht geprüft',
    notifyOn: 'Keyspace-Benachrichtigungen empfangen',
    notifyOff: (value) =>
      `Keyspace-Benachrichtigungen auf dem Server aus (notify-keyspace-events „${value}“): Lesen in jedem Intervall`,
    notifyUnknown: 'notify-keyspace-events nicht lesbar (ACL): zusätzlich Lesen in jedem Intervall',
  },
  es: {
    ok: 'OK',
    dbKeys: (count) => `${count} clave(s) en la base de datos`,
    keys: (count) => `${count} clave(s) seguida(s)`,
    noKey: 'ninguna clave seguida: use «Añadir una clave»',
    added: (name) => `Clave «${name}» añadida`,
    updated: (name) => `Clave «${name}» modificada`,
    removed: (name) => `Clave «${name}» eliminada`,
    typed: (type) => `tipo ${type}`,
    value: (value) => `valor ${value}`,
    discovery: 'añada su dispositivo desde la pestaña Descubrir',
    notFound: (key) => `No se sigue ninguna clave «${key}».`,
    tooMany: (max) => `${max} claves como máximo: elimine una antes.`,
    notChecked: 'guardada, pero no comprobada',
    notifyOn: 'notificaciones keyspace recibidas',
    notifyOff: (value) =>
      `notificaciones keyspace desactivadas en el servidor (notify-keyspace-events «${value}»): lectura en cada intervalo`,
    notifyUnknown: 'notify-keyspace-events no legible (ACL): lectura en cada intervalo también',
  },
};

// Why "Add a key" refuses its fields (src/keys.js parseKeyFields).
export const KEY_FIELD_TEXT = {
  key: {
    en: 'Enter the exact name of the key (512 characters at most).',
    fr: 'Saisissez le nom exact de la clé (512 caractères au plus).',
    de: 'Gib den genauen Namen des Schlüssels ein (höchstens 512 Zeichen).',
    es: 'Introduzca el nombre exacto de la clave (512 caracteres como máximo).',
  },
  field: {
    en: 'A hash field has 256 characters at most.',
    fr: 'Un champ de hash a 256 caractères au plus.',
    de: 'Ein Hash-Feld hat höchstens 256 Zeichen.',
    es: 'Un campo de hash tiene 256 caracteres como máximo.',
  },
  name: {
    en: 'A name has 60 characters at most.',
    fr: 'Un nom a 60 caractères au plus.',
    de: 'Ein Name hat höchstens 60 Zeichen.',
    es: 'Un nombre tiene 60 caracteres como máximo.',
  },
  type: {
    en: 'Choose a type in the list.',
    fr: 'Choisissez un type dans la liste.',
    de: 'Wähle einen Typ aus der Liste.',
    es: 'Elija un tipo de la lista.',
  },
};

// Scene action messages (shown in Gladys).
export const ACTION_TEXT = {
  noServer: {
    en: 'No Redis server is configured.',
    fr: "Aucun serveur Redis n'est configuré.",
    de: 'Es ist kein Redis-Server konfiguriert.',
    es: 'No hay ningún servidor Redis configurado.',
  },
  writeDisabled: {
    en: 'Writing is off: tick "Allow writing from scenes" in the configuration.',
    fr: "L'écriture est désactivée : cochez « Autoriser l'écriture depuis les scènes » dans la configuration.",
    de: 'Schreiben ist aus: Aktiviere „Schreiben aus Szenen erlauben“ in der Konfiguration.',
    es: 'La escritura está desactivada: marque «Permitir la escritura desde las escenas» en la configuración.',
  },
  unknownKey: {
    en: 'Choose a key device of the integration (a key added with "Add a key").',
    fr: "Choisissez un appareil clé de l'intégration (une clé ajoutée avec « Ajouter une clé »).",
    de: 'Wähle ein Schlüsselgerät der Integration (ein mit „Schlüssel hinzufügen“ hinzugefügter Schlüssel).',
    es: 'Elija un dispositivo clave de la integración (una clave añadida con «Añadir una clave»).',
  },
  notWritable: {
    en: 'This key holds another type of value: only a string, or a hash field added with its field, can be written.',
    fr: "Cette clé contient un autre type de valeur : seule une chaîne, ou un champ de hash ajouté avec son champ, s'écrit.",
    de: 'Dieser Schlüssel enthält einen anderen Werttyp: Nur ein String oder ein mit seinem Feld hinzugefügtes Hash-Feld ist schreibbar.',
    es: 'Esta clave contiene otro tipo de valor: solo se escribe una cadena, o un campo de hash añadido con su campo.',
  },
  badNumber: {
    en: 'The increment is not a number.',
    fr: "L'incrément n'est pas un nombre.",
    de: 'Das Inkrement ist keine Zahl.',
    es: 'El incremento no es un número.',
  },
  badExpire: {
    en: 'The expiry is a whole number of seconds, at least 1.',
    fr: "L'expiration est un nombre entier de secondes, 1 au moins.",
    de: 'Der Ablauf ist eine ganze Zahl von Sekunden, mindestens 1.',
    es: 'La expiración es un número entero de segundos, 1 como mínimo.',
  },
  tooLong: {
    en: 'The text is too long (100,000 characters at most).',
    fr: 'Le texte est trop long (100 000 caractères au plus).',
    de: 'Der Text ist zu lang (höchstens 100.000 Zeichen).',
    es: 'El texto es demasiado largo (100 000 caracteres como máximo).',
  },
  channelNotAllowed: {
    en: 'This channel is not in "Channels allowed for publishing" of the configuration.',
    fr: "Ce canal n'est pas dans « Canaux autorisés à la publication » de la configuration.",
    de: 'Dieser Kanal steht nicht in „Erlaubte Kanäle zum Veröffentlichen“ der Konfiguration.',
    es: 'Este canal no está en «Canales permitidos para publicar» de la configuración.',
  },
};

export const LANGUAGE_FALLBACK = 'en';

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;
export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];
/** The parts of a report, in one language: "a, b, c." */
export const sentence = (parts) => `${parts.filter(Boolean).join(', ')}.`;
export const inEveryLanguage = (render) =>
  Object.fromEntries(Object.keys(REPORT_TEXT).map((language) => [language, render(language)]));
