// -----------------------------------------------------------------------------
// The Redis connection, on top of node-redis (`@redis/client`, no dependency
// of its own): one client for the commands, and a second one for the keyspace
// notifications when they are asked for (a subscribed connection cannot run
// other commands).
//
// No automatic reconnection: the hub connects again at its next read, so a
// server that is down costs one attempt per interval, never a loop. Every
// command has a deadline: a server that stops answering mid-command does not
// hold the reads (or a scene) forever.
//
// Errors are sorted into kinds (ERROR_KINDS), the user sees one sentence per
// kind (src/texts.js). The raw message stays in the logs.
// -----------------------------------------------------------------------------

import { createClient as createRedisClient } from '@redis/client';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable',
  TLS: 'tls',
  AUTH: 'auth',
  PERMISSION: 'permission',
  DATABASE: 'database',
  WRONG_TYPE: 'wrong_type',
  OTHER: 'other',
});

export const CONNECT_TIMEOUT_MS = 5000;
export const COMMAND_TIMEOUT_MS = 5000;

export class RedisError extends Error {
  constructor(kind, message, options) {
    super(message, options);
    this.kind = kind;
  }
}

const UNREACHABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
  'EPIPE',
]);

/** The kind of a node-redis error, or of a server reply. */
export function errorKind(err) {
  const message = String(err?.message ?? '');
  const code = String(err?.code ?? '');
  if (err?.kind) {
    return err.kind;
  }
  if (/^(WRONGPASS|NOAUTH)\b|invalid password|invalid username-password/i.test(message)) {
    return ERROR_KINDS.AUTH;
  }
  if (/^NOPERM\b/.test(message)) {
    return ERROR_KINDS.PERMISSION;
  }
  if (/DB index is out of range|invalid DB index/i.test(message)) {
    return ERROR_KINDS.DATABASE;
  }
  if (/^WRONGTYPE\b/.test(message)) {
    return ERROR_KINDS.WRONG_TYPE;
  }
  if (
    /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS|ERR_SSL|SSL routines|wrong version number/i.test(
      `${code} ${message}`,
    )
  ) {
    return ERROR_KINDS.TLS;
  }
  if (
    UNREACHABLE_CODES.has(code) ||
    /timeout|socket closed|closed unexpectedly|client is closed|connection is closed/i.test(
      `${err?.name ?? ''} ${err?.constructor?.name ?? ''} ${message}`,
    )
  ) {
    return ERROR_KINDS.UNREACHABLE;
  }
  return ERROR_KINDS.OTHER;
}

export const asRedisError = (err) =>
  err instanceof RedisError
    ? err
    : new RedisError(errorKind(err), String(err?.message ?? err), { cause: err });

/** A node-redis reply as text (a Buffer, a number, a string). */
export const replyText = (reply) =>
  reply === null || reply === undefined
    ? null
    : Buffer.isBuffer(reply)
      ? reply.toString('utf8')
      : String(reply);

export class RedisConnection {
  /**
   * @param {object} options
   * @param {object} options.config normalized configuration (src/config.js)
   * @param {Function} [options.createClient] node-redis createClient, replaced in tests
   * @param {(message: string) => void} [options.onError] errors raised outside a command
   */
  constructor({ config, createClient = createRedisClient, onError = () => {} }) {
    this.config = config;
    this.createClient = createClient;
    this.onError = onError;
    this.client = null;
    this.connecting = null;
    this.subscriber = null;
    this.subscribed = new Set();
  }

  clientOptions() {
    const { host, port, database, username, password, tls, allowSelfSigned } = this.config;
    return {
      ...(username ? { username } : {}),
      ...(password ? { password } : {}),
      database,
      socket: {
        host,
        port,
        connectTimeout: CONNECT_TIMEOUT_MS,
        reconnectStrategy: false,
        ...(tls ? { tls: true, rejectUnauthorized: !allowSelfSigned, servername: host } : {}),
      },
    };
  }

  get connected() {
    return Boolean(this.client?.isReady);
  }

  /** Connect when not connected (the last connection was lost). */
  async ensureConnected() {
    if (this.connected) {
      return this.client;
    }
    this.connecting ??= this.open().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  async open() {
    this.drop();
    const client = this.createClient(this.clientOptions());
    // Without a listener, an error event would end the process.
    client.on('error', (err) => this.onError(err?.message ?? String(err)));
    try {
      await withDeadline(client.connect(), CONNECT_TIMEOUT_MS + 1000);
    } catch (err) {
      destroy(client);
      throw asRedisError(err);
    }
    this.client = client;
    return client;
  }

  /** One command, e.g. ['GET', 'key']; a Redis error reply is thrown as a RedisError. */
  async command(args) {
    const client = await this.ensureConnected();
    try {
      return await withDeadline(client.sendCommand(args.map(String)), COMMAND_TIMEOUT_MS);
    } catch (err) {
      const error = asRedisError(err);
      if (error.kind === ERROR_KINDS.UNREACHABLE) {
        this.drop(); // connect again at the next command
      }
      throw error;
    }
  }

  /**
   * Follow exactly these channels (SUBSCRIBE, never a pattern), calling
   * `listener(message, channel)`. An empty list closes the subscriber.
   */
  async subscribe(channels, listener) {
    const wanted = new Set(channels);
    if (wanted.size === 0) {
      this.dropSubscriber();
      return;
    }
    if (!this.subscriber?.isReady) {
      this.dropSubscriber();
      const client = await this.ensureConnected();
      const subscriber = client.duplicate();
      subscriber.on('error', (err) => this.onError(err?.message ?? String(err)));
      try {
        await withDeadline(subscriber.connect(), CONNECT_TIMEOUT_MS + 1000);
      } catch (err) {
        destroy(subscriber);
        throw asRedisError(err);
      }
      this.subscriber = subscriber;
    }
    const subscriber = this.subscriber;
    try {
      const removed = [...this.subscribed].filter((channel) => !wanted.has(channel));
      if (removed.length > 0) {
        await withDeadline(subscriber.unsubscribe(removed), COMMAND_TIMEOUT_MS);
      }
      for (const channel of wanted) {
        if (!this.subscribed.has(channel)) {
          await withDeadline(subscriber.subscribe(channel, listener), COMMAND_TIMEOUT_MS);
        }
      }
      this.subscribed = wanted;
    } catch (err) {
      this.dropSubscriber();
      throw asRedisError(err);
    }
  }

  get subscribing() {
    return Boolean(this.subscriber?.isReady);
  }

  dropSubscriber() {
    destroy(this.subscriber);
    this.subscriber = null;
    this.subscribed = new Set();
  }

  drop() {
    this.dropSubscriber();
    destroy(this.client);
    this.client = null;
  }

  close() {
    this.drop();
  }
}

function destroy(client) {
  if (!client) {
    return;
  }
  try {
    client.destroy();
  } catch {
    // already closed
  }
}

function withDeadline(promise, ms) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new RedisError(ERROR_KINDS.UNREACHABLE, `No answer within ${ms} ms`)),
      ms,
    );
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}
