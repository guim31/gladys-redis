// -----------------------------------------------------------------------------
// An in-memory Redis behind the node-redis client API the integration uses
// (createClient, connect, sendCommand, duplicate, subscribe…): the commands
// of src/ only, with the real INFO answers and error replies of Redis 7 and
// Valkey 8 (test/fixtures/real). Keyspace notifications are sent like the
// server does when `notify` holds the flags of notify-keyspace-events.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const read = (name) => readFileSync(new URL(`../fixtures/real/${name}`, import.meta.url), 'utf8');

export const INFO = { redis7: read('info-redis7.txt'), valkey8: read('info-valkey8.txt') };
export const ERRORS = JSON.parse(read('errors.json'));
export const HOST = 'redis.test';

const replyError = (message) => Object.assign(new Error(message), { name: 'SimpleError' });

export class FakeRedis {
  constructor({ info = INFO.redis7, password = '', username = '', databases = 16 } = {}) {
    this.info = info;
    this.password = password;
    this.username = username;
    this.databases = databases;
    /** @type {Map<string, { type: string, value: unknown }>} database 0 only */
    this.data = new Map();
    this.down = false;
    this.notify = 'KA';
    this.configReadable = true;
    this.forbidden = new Set(); // keys refused by the ACL
    this.commands = [];
    this.subscribers = new Set();
    this.published = [];
  }

  set(key, value) {
    this.data.set(key, { type: 'string', value: String(value) });
  }

  hset(key, fields) {
    this.data.set(key, { type: 'hash', value: new Map(Object.entries(fields)) });
  }

  list(key, items, type = 'list') {
    this.data.set(key, { type, value: [...items] });
  }

  /** A change made by another client: the notification, like the server sends it. */
  touch(key, event) {
    if (/K/.test(this.notify)) {
      for (const subscriber of this.subscribers) {
        subscriber.deliver(`__keyspace@0__:${key}`, event);
      }
    }
  }

  createClient = (options) => new FakeClient(this, options);

  run(args) {
    this.commands.push(args);
    const [name, key, ...rest] = args;
    const entry = this.data.get(key);
    const ofType = (type) => {
      if (entry && entry.type !== type) {
        throw replyError(ERRORS.wrongtype);
      }
    };
    if (key !== undefined && this.forbidden.has(key)) {
      throw replyError(ERRORS.noperm_key);
    }
    switch (name.toUpperCase()) {
      case 'INFO':
        return this.info;
      case 'DBSIZE':
        return this.data.size;
      case 'TYPE':
        return entry?.type ?? 'none';
      case 'GET':
        ofType('string');
        return entry?.value ?? null;
      case 'HGET':
        ofType('hash');
        return entry?.value.get(rest[0]) ?? null;
      case 'LLEN':
      case 'SCARD':
      case 'ZCARD':
      case 'XLEN':
        return entry?.value.length ?? 0;
      case 'SET':
        this.data.set(key, { type: 'string', value: rest[0] });
        this.touch(key, 'set');
        if (rest[1] === 'EX') {
          this.touch(key, 'expire');
        }
        return 'OK';
      case 'HSET': {
        ofType('hash');
        const map = entry?.value ?? new Map();
        map.set(rest[0], rest[1]);
        this.data.set(key, { type: 'hash', value: map });
        this.touch(key, 'hset');
        return 1;
      }
      case 'EXPIRE':
        this.touch(key, 'expire');
        return entry ? 1 : 0;
      case 'INCRBYFLOAT':
      case 'HINCRBYFLOAT': {
        const hash = name.toUpperCase() === 'HINCRBYFLOAT';
        ofType(hash ? 'hash' : 'string');
        const by = Number(hash ? rest[1] : rest[0]);
        const current = hash ? entry?.value.get(rest[0]) : entry?.value;
        const number = Number(current ?? 0);
        if (Number.isNaN(number)) {
          throw replyError('ERR value is not a valid float');
        }
        const next = String(number + by);
        if (hash) {
          const map = entry?.value ?? new Map();
          map.set(rest[0], next);
          this.data.set(key, { type: 'hash', value: map });
        } else {
          this.data.set(key, { type: 'string', value: next });
        }
        this.touch(key, name.toLowerCase());
        return next;
      }
      case 'PUBLISH':
        this.published.push({ channel: key, message: rest[0] });
        return 2;
      case 'CONFIG':
        if (!this.configReadable) {
          throw replyError(ERRORS.noperm_command);
        }
        return { 'notify-keyspace-events': this.notify };
      default:
        throw replyError(`ERR unknown command '${name}'`);
    }
  }
}

class FakeClient {
  constructor(server, options) {
    this.server = server;
    this.options = options;
    this.isReady = false;
    this.listeners = new Map();
  }

  on() {
    return this;
  }

  async connect() {
    const { server, options } = this;
    if (server.down || options.socket.host !== HOST) {
      throw Object.assign(new Error(ERRORS.refused), { code: 'ECONNREFUSED' });
    }
    if (server.password) {
      if (!options.password) {
        throw replyError(ERRORS.noauth);
      }
      if (options.password !== server.password || (options.username ?? '') !== server.username) {
        throw replyError(ERRORS.wrongpass);
      }
    }
    if (options.database >= server.databases) {
      throw replyError(ERRORS.database);
    }
    this.isReady = true;
    return this;
  }

  async sendCommand(args) {
    if (!this.isReady || this.server.down) {
      this.isReady = false;
      throw new Error('The client is closed');
    }
    return this.server.run(args);
  }

  duplicate() {
    return new FakeClient(this.server, this.options);
  }

  async subscribe(channel, listener) {
    this.listeners.set(channel, listener);
    this.server.subscribers.add(this);
  }

  async unsubscribe(channels) {
    for (const channel of channels) {
      this.listeners.delete(channel);
    }
  }

  deliver(channel, message) {
    this.listeners.get(channel)?.(message, channel);
  }

  destroy() {
    this.isReady = false;
    this.server.subscribers.delete(this);
  }
}
