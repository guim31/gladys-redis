// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// One Redis (or Valkey) server. The keys followed are not configuration
// fields (Gladys has no list field): the "Add a key" action stores them under
// /data, see src/keys.js.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Refresh intervals offered in the configuration, in seconds.
export const POLL_INTERVALS = ['10', '30', '60', '300', '600'];

export const DEFAULT_PORT = 6379;
// Redis accepts 16 databases by default (`databases` of redis.conf), more
// when configured: the server answers a SELECT out of range.
export const MAX_DATABASE = 1000;
// Channels allowed for "Publish a message", at most.
export const MAX_CHANNELS = 20;
export const MAX_CHANNEL_LENGTH = 200;

export const DEFAULT_CONFIG = {
  host: '',
  port: DEFAULT_PORT,
  database: 0,
  username: '',
  password: '',
  tls: false,
  allow_self_signed: false,
  poll_interval: '30',
  keyspace_notifications: false,
  allow_write: false,
  publish_channels: '',
  language: 'fr',
};

const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.?$/i;
const IPV6 = /^\[?([0-9a-f:.]+)\]?$/i;

/**
 * The host typed by the user: a name, an IPv4 or an IPv6 address. A
 * `redis://host:port` copied from a client is accepted too: its port wins over
 * the port field, its credentials are refused (they would end in the logs).
 * @returns {{ host: string, port: number|null, tls: boolean }|null} null when unusable
 */
export function parseHost(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  if (/^rediss?:\/\//i.test(text)) {
    let url;
    try {
      url = new URL(text);
    } catch {
      return null;
    }
    if (url.username || url.password || !url.hostname) {
      return null;
    }
    const host = url.hostname.replace(/^\[|\]$/g, '');
    return {
      host,
      port: url.port ? Number(url.port) : null,
      tls: url.protocol.toLowerCase() === 'rediss:',
    };
  }
  if (HOST.test(text)) {
    return { host: text, port: null, tls: false };
  }
  // host:port, typed in the host field.
  const withPort = text.match(/^([^:[\]]+):(\d{1,5})$/);
  if (withPort && HOST.test(withPort[1])) {
    return { host: withPort[1], port: Number(withPort[2]), tls: false };
  }
  const v6 = text.match(IPV6);
  if (v6 && v6[1].includes(':')) {
    return { host: v6[1], port: null, tls: false };
  }
  return null;
}

/** The channels allowed for "Publish a message": comma or space separated. */
export function parseChannels(raw) {
  if (typeof raw !== 'string') {
    return [];
  }
  const channels = raw
    .split(/[\s,;]+/)
    .map((channel) => channel.trim())
    .filter((channel) => channel && channel.length <= MAX_CHANNEL_LENGTH);
  return [...new Set(channels)].slice(0, MAX_CHANNELS);
}

const isTrue = (value) => value === true || value === 'true';

const integer = (value, min, max, fallback) => {
  const number = typeof value === 'string' && value.trim() ? Number(value) : value;
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
};

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  // A pasted password often carries a trailing space or new line; a Redis
  // password may contain spaces, so only the line ends are removed.
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const pick = (key, list) => {
    const value = source[key] === undefined || source[key] === null ? '' : String(source[key]);
    return list.includes(value) ? value : DEFAULT_CONFIG[key];
  };
  const typed = text('host');
  const parsed = parseHost(typed);
  return {
    host: parsed?.host ?? null,
    invalidHost: Boolean(typed) && !parsed,
    port: parsed?.port ?? integer(source.port, 1, 65535, DEFAULT_PORT),
    database: integer(source.database, 0, MAX_DATABASE, 0),
    username: text('username'),
    password: typeof source.password === 'string' ? source.password.replace(/[\r\n]+$/, '') : '',
    tls: isTrue(source.tls) || Boolean(parsed?.tls),
    allowSelfSigned: isTrue(source.allow_self_signed),
    pollIntervalMs: Number(pick('poll_interval', POLL_INTERVALS)) * 1000,
    keyspaceNotifications: isTrue(source.keyspace_notifications),
    allowWrite: isTrue(source.allow_write),
    publishChannels: parseChannels(source.publish_channels),
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}

/** The server as shown to the user: host:port/db, never the credentials. */
export const serverName = (config) => {
  const host = config.host?.includes(':') ? `[${config.host}]` : config.host;
  return `${host}:${config.port}/${config.database}`;
};
