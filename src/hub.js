// -----------------------------------------------------------------------------
// The Redis hub: reads Redis on a timer of the container, at the interval
// chosen in the configuration, and at once when a keyspace notification says
// a followed key changed; publishes the states of the added devices when they
// change; fires the "A key changes" scene event; holds the keys followed, and
// the views the widget and the scene actions read.
//
// Gladys never polls these devices (should_poll: false): the interval goes up
// to 10 minutes, beyond the fixed list of the core scheduler.
//
// One read = INFO and DBSIZE (the server device, and the health check), then
// TYPE and one read command per key. Nothing scans the database: only the
// keys added by the user are read.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { serverName } from './config.js';
import {
  buildKeyDevice,
  buildServerDevice,
  keyFeatureId,
  keyIds,
  parseKeyId,
  serverIds,
  serverValues,
} from './devices.js';
import {
  AUTO_TYPE,
  MAX_KEYS,
  autoType,
  keyLabel,
  keyName,
  keyState,
  parseKeyFields,
  readKey,
  restoreKey,
} from './keys.js';
import { FailureLog } from './logs.js';
import { ERROR_KINDS, RedisConnection, asRedisError, replyText } from './redis/client.js';
import { parseInfo, productVersion } from './redis/info.js';
import {
  CONNECTION_TEXT,
  ERROR_TEXT,
  KEY_FIELD_TEXT,
  KEY_PROBLEM_TEXT,
  REPORT_TEXT,
  TYPE_TEXT,
  inEveryLanguage,
  labelled,
  pick,
  sentence,
} from './texts.js';

const logger = createLogger({ name: 'redis-hub' });

export const WIDGET_KEY = 'values';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({ KEY_CHANGED: 'key_changed' });

export const HUB_TIMINGS = {
  // A scene action or the widget reads again when the last read is older.
  freshMs: 10_000,
  // An unchanged value is sent again this often: Gladys marks a value older
  // than 48 h as outdated.
  heartbeatMs: 6 * 3600_000,
  // A notification starts a read after this delay, and the others of the
  // same key meanwhile join it (a throttle: a counter incremented 100 times
  // a second is read once a second, never starved).
  notifyDelayMs: 1000,
};

const MAX_STATES_PER_REQUEST = 100;
// States per minute, at most (Gladys accepts 300): the budget of a read is
// its share of the minute; the values published longest ago go first.
export const MAX_STATES_PER_MINUTE = 240;
// Scene events per minute, at most ("A Redis key changes").
export const MAX_EVENTS_PER_MINUTE = 120;
const KEY_CONCURRENCY = 5;
// Key errors that are the key's own (the others are the server's).
const KEY_ERRORS = new Set([ERROR_KINDS.PERMISSION, ERROR_KINDS.WRONG_TYPE, ERROR_KINDS.OTHER]);

const signature = (config) =>
  JSON.stringify([
    config.host,
    config.port,
    config.database,
    config.username,
    config.password,
    config.tls,
    config.allowSelfSigned,
  ]);

/** A user mistake answered to a configuration action, in every language. */
export class AnswerError extends Error {
  constructor(messages) {
    super(messages.en);
    this.messages = messages;
  }
}

/** The keyspace channel of a key: `__keyspace@0__:sensors:temp`. */
export const keyspaceChannel = (database, key) => `__keyspace@${database}__:${key}`;

export class RedisHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.createClient] node-redis createClient (a fake in tests)
   * @param {boolean} [options.timers] periodic timer (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, createClient, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.createClient = createClient;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.config = null;
    this.connection = null;
    this.signature = null;
    /** @type {Map<string, object>} the keys followed, by id */
    this.keys = new Map();
    /** @type {Map<string, object>} last reading per key: readKey() or { error } */
    this.readings = new Map();
    this.info = null;
    this.dbKeys = null;
    this.error = null; // the server: RedisError
    this.readAt = 0;
    this.polling = null;
    this.generation = 0;
    /** Last value published per feature external id, and when. */
    this.published = new Map();
    this.publishedAt = new Map();
    this.transports = new Map();
    this.status = null;
    this.discovered = null;
    this.pollTimer = null;
    this.notifyTimers = new Map();
    this.stopped = false;
    // What fails again at every cycle (Gladys refusing, the reading loop):
    // one line when it starts, one when it ends.
    this.failureLog = new FailureLog(logger);
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    for (const entry of Array.isArray(saved.keys) ? saved.keys : []) {
      const spec = restoreKey(entry);
      if (spec && this.keys.size < MAX_KEYS) {
        this.keys.set(spec.id, spec);
      }
    }
    if (this.keys.size > 0) {
      logger.info(`${this.keys.size} key(s) loaded`);
    }
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.published.clear();
    this.publishedAt.clear();
    this.transports.clear();
    this.status = null;
    this.discovered = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const changed = this.signature !== signature(config);
    const languageChanged = this.config?.language !== config.language;
    this.config = config;
    if (changed) {
      this.generation += 1; // a read in progress for the old server is ignored
      this.signature = signature(config);
      this.connection?.close();
      this.connection = config.host
        ? new RedisConnection({
            config,
            createClient: this.createClient,
            onError: (message) => logger.debug(`Redis socket: ${message}`),
          })
        : null;
      this.info = null;
      this.dbKeys = null;
      this.readings.clear();
      this.error = null;
      this.readAt = 0;
      this.transports.clear();
    }
    await this.pollAll({ publish: changed || languageChanged });
    this.schedulePoll();
  }

  async stop() {
    this.stopped = true;
    this.generation += 1; // a read in progress is ignored, not reported as an outage
    clearTimeout(this.pollTimer);
    for (const pending of this.notifyTimers.values()) {
      clearTimeout(pending.timer);
    }
    this.notifyTimers.clear();
    this.connection?.close();
    await this.store.flush();
  }

  save() {
    return this.store.save({
      keys: [...this.keys.values()].map(({ key, field, type, name }) => ({
        key,
        field,
        type,
        name,
      })),
    });
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !this.connection) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollAll();
        this.failureLog.recover('poll', 'Reading Redis works again');
      } catch (err) {
        this.failureLog.fail('poll', `Poll failed: ${err.message}`, 'error');
      }
      this.schedulePoll();
    }, this.timings.pollIntervalMs ?? this.config.pollIntervalMs);
  }

  // --- Reading -------------------------------------------------------------------

  async pollAll({ publish = false, fresh = false } = {}) {
    const changed = await this.poll({ fresh });
    await this.afterChanges(changed, { publish });
  }

  /** Gladys asks for a refresh (onPoll): read now. */
  async pollDevice() {
    await this.pollAll();
  }

  /** Read again when the last read is older than `freshMs` (scene actions, widget). */
  async refreshIfStale() {
    if (this.connection && this.now() - this.readAt >= this.timings.freshMs) {
      await this.pollAll();
    }
  }

  /**
   * Read and apply what changed. Concurrent calls share the read.
   * @returns {Promise<boolean>} whether the widget shows something new
   */
  poll({ fresh = false } = {}) {
    if (!this.connection) {
      return Promise.resolve(false);
    }
    if (this.polling && (fresh || this.pollingGeneration !== this.generation)) {
      // A read started before a new key or configuration: read again once it is over.
      return this.polling.catch(() => {}).then(() => this.poll());
    }
    if (!this.polling) {
      this.pollingGeneration = this.generation;
      this.polling = this.read().finally(() => {
        this.polling = null;
      });
    }
    return this.polling;
  }

  async read() {
    const { generation, connection } = this;
    const before = this.widgetSignature();
    let info = null;
    let dbKeys = null;
    let error = null;
    const readings = new Map();
    try {
      info = parseInfo(replyText(await connection.command(['INFO'])));
      dbKeys = Number(await connection.command(['DBSIZE']));
      const specs = [...this.keys.values()];
      for (let at = 0; at < specs.length; at += KEY_CONCURRENCY) {
        const batch = specs.slice(at, at + KEY_CONCURRENCY);
        const answers = await Promise.all(batch.map((spec) => this.readOne(spec)));
        batch.forEach((spec, index) => readings.set(spec.id, answers[index]));
      }
    } catch (caught) {
      error = asRedisError(caught);
    }
    if (generation !== this.generation) {
      return false; // the configuration changed meanwhile
    }
    this.readAt = this.now();
    this.applyServer(info, dbKeys, error, readings);
    await this.publishStates();
    if (!this.error) {
      await this.followNotifications();
    }
    return before !== this.widgetSignature();
  }

  /** One key: its reading, or its own error (ACL, wrong type); a server error is thrown. */
  async readOne(spec) {
    try {
      return await readKey(this.connection, spec);
    } catch (caught) {
      const err = asRedisError(caught);
      if (!KEY_ERRORS.has(err.kind)) {
        throw err;
      }
      return { error: { kind: err.kind, detail: err.message } };
    }
  }

  applyServer(info, dbKeys, error, readings) {
    const name = serverName(this.config);
    if (error) {
      if (this.error?.kind !== error.kind) {
        logger.warn(`Redis ${name}: ${error.message}`);
      }
      this.error = error;
      return; // the last values stand
    }
    if (this.error) {
      logger.info(`Redis ${name} answers again`);
    }
    if (info.version !== this.info?.version) {
      logger.info(`${productVersion(info)} at ${name}`);
    }
    this.error = null;
    this.info = info;
    this.dbKeys = Number.isFinite(dbKeys) ? dbKeys : null;
    for (const [id, reading] of readings) {
      if (!this.keys.has(id)) {
        continue; // removed during the read
      }
      this.setReading(id, reading);
    }
  }

  setReading(id, reading) {
    const spec = this.keys.get(id);
    const before = this.problemOf(spec, 'en');
    this.readings.set(id, reading);
    const after = this.problemOf(spec, 'en');
    if (after && after !== before) {
      // A refused read is worth a warning; a key absent or empty (an expiry)
      // is the life of the key, said by "Test the connection" and the widget.
      logger[reading.error ? 'warn' : 'debug'](`Key "${keyLabel(spec)}": ${after}`);
    }
  }

  /** What the widget shows: it is refreshed when this changes. */
  widgetSignature() {
    return JSON.stringify([
      this.error?.kind,
      this.info?.version,
      [...this.keys.keys()].map((id) => [id, this.readings.get(id)]),
    ]);
  }

  // --- Keyspace notifications ------------------------------------------------------

  /**
   * Subscribe to the keyspace channel of every key followed (exact
   * channels, never a pattern), or close the subscription when the option
   * is off. The server sends nothing unless its `notify-keyspace-events`
   * says so: the integration never changes the server configuration.
   */
  async followNotifications() {
    if (!this.connection) {
      return;
    }
    const channels = this.config.keyspaceNotifications
      ? [...this.keys.values()].map((spec) => keyspaceChannel(this.config.database, spec.key))
      : [];
    try {
      await this.connection.subscribe(channels, (message, channel) =>
        this.onNotification(String(message), String(channel)),
      );
      this.failureLog.recover('subscribe', 'Keyspace notifications followed again');
    } catch (err) {
      this.failureLog.fail('subscribe', `Keyspace notifications not followed: ${err.message}`);
    }
  }

  /** A key changed (`set`, `del`, `expired`, `hset`…): read it soon. */
  onNotification(event, channel) {
    const prefix = keyspaceChannel(this.config.database, '');
    if (!channel.startsWith(prefix)) {
      return;
    }
    const key = channel.slice(prefix.length);
    const specs = [...this.keys.values()].filter((spec) => spec.key === key);
    if (specs.length === 0) {
      return;
    }
    logger.debug(`Keyspace: ${key} ${event}`);
    const pending = this.notifyTimers.get(key);
    if (pending) {
      pending.events.add(event); // joins the read already planned
      return;
    }
    if (this.stopped) {
      return;
    }
    const entry = { events: new Set([event]) };
    entry.timer = setTimeout(() => {
      this.notifyTimers.delete(key);
      this.refreshKey(key, [...entry.events]).catch((err) =>
        this.failureLog.fail('notify', `Reading after a notification failed: ${err.message}`),
      );
    }, this.timings.notifyDelayMs);
    this.notifyTimers.set(key, entry);
  }

  /**
   * Read the keys of this Redis key now and publish them; fire the scene
   * event once per kind of event the notifications said (set, del…).
   */
  async refreshKey(key, events = []) {
    const specs = [...this.keys.values()].filter((spec) => spec.key === key);
    const { generation } = this;
    const before = this.widgetSignature();
    for (const spec of specs) {
      let reading;
      try {
        reading = await this.readOne(spec);
      } catch (err) {
        logger.debug(`Key ${key} not read: ${err.message}`);
        return; // a server error: the next read says it
      }
      if (generation !== this.generation || !this.keys.has(spec.id)) {
        return;
      }
      this.setReading(spec.id, reading);
      await this.sendStates(this.valuesOfCreated([spec]));
      for (const event of events) {
        await this.fireKeyEvent(spec, event);
      }
    }
    this.failureLog.recover('notify', 'Reading after a notification works again');
    if (before !== this.widgetSignature()) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  async fireKeyEvent(spec, event) {
    // Gladys evaluates the scenes at every event: a sliding minute budget.
    const now = this.now();
    this.eventTimes = (this.eventTimes ?? []).filter((time) => now - time < 60_000);
    if (this.eventTimes.length >= MAX_EVENTS_PER_MINUTE) {
      this.failureLog.fail(
        'event-budget',
        `More than ${MAX_EVENTS_PER_MINUTE} key events a minute: some are dropped`,
      );
      return;
    }
    this.failureLog.recover('event-budget');
    this.eventTimes.push(now);
    const { state } = keyState(spec.type, this.readings.get(spec.id));
    const value = state === null ? '' : typeof state === 'object' ? state.text : String(state);
    try {
      await this.gladys.publishSceneEvent(TRIGGERS.KEY_CHANGED, {
        device: keyIds(this.gladys, spec.id).device,
        event,
        key: spec.key,
        name: keyName(spec),
        value,
      });
      this.failureLog.recover('event', 'Scene events accepted again');
    } catch (err) {
      this.failureLog.fail('event', `Scene event refused: ${err.message}`);
    }
  }

  // --- Devices -----------------------------------------------------------------

  isCreated(externalId) {
    return (this.gladys.devices ?? []).some((device) => device.external_id === externalId);
  }

  discoveredDevices() {
    const keys = [...this.keys.values()]
      .sort((a, b) => keyName(a).localeCompare(keyName(b)))
      .map((spec) => buildKeyDevice(this.gladys, spec));
    return [
      buildServerDevice(this.gladys, { host: this.config.host, language: this.config.language }),
      ...keys,
    ];
  }

  /** Publish the Discovery list when it changed (a key added…). */
  async publishDevices({ force = false } = {}) {
    if (!this.connection) {
      if (force) {
        await this.sendDiscovered([]);
      }
      return;
    }
    await this.sendDiscovered(this.discoveredDevices(), { force });
  }

  async sendDiscovered(devices, { force = false } = {}) {
    const key = JSON.stringify(devices);
    if (!force && key === this.discovered) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovered = key;
      this.failureLog.recover('discovered', 'Discovered devices accepted again');
    } catch (err) {
      this.failureLog.fail('discovered', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read again, publish the list again. */
  async rediscover() {
    await this.poll();
    await this.publishDevices({ force: true });
  }

  /** The user added a device: its states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    const externalId = device?.external_id;
    if (externalId === serverIds(this.gladys).device) {
      await this.sendStates(this.serverValues(), { force: true });
    } else {
      const spec = this.keys.get(parseKeyId(this.gladys, externalId));
      if (!spec) {
        return;
      }
      if (!this.error) {
        await this.sendStates(this.valuesOf([spec]), { force: true });
      }
    }
    await this.publishTransports();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  serverValues() {
    return serverValues(this.gladys, {
      reachable: Boolean(this.connection) && this.readAt > 0 && !this.error,
      info: this.info,
      dbKeys: this.dbKeys,
    });
  }

  valuesOf(specs) {
    return specs.map((spec) => ({
      externalId: keyFeatureId(this.gladys, spec),
      value: keyState(spec.type, this.readings.get(spec.id)).state,
    }));
  }

  valuesOfCreated(specs) {
    return this.valuesOf(
      specs.filter((spec) => this.isCreated(keyIds(this.gladys, spec.id).device)),
    );
  }

  // --- Publishing to Gladys ----------------------------------------------------------

  /** The states of the added devices that changed (or are due for a heartbeat). */
  async publishStates() {
    const values = [];
    if (this.readAt > 0 && this.isCreated(serverIds(this.gladys).device)) {
      // "Reachable" goes to 0 while the server does not answer.
      values.push(...this.serverValues());
    }
    // A server that does not answer: the last values of the keys are not
    // sent again as fresh ones (the badge says unreachable).
    if (!this.error) {
      values.push(...this.valuesOfCreated([...this.keys.values()]));
    }
    await this.sendStates(values);
  }

  async sendStates(values, { force = false } = {}) {
    const now = this.now();
    const same = (externalId, value) =>
      JSON.stringify(this.published.get(externalId)) === JSON.stringify(value);
    const known = values.filter(({ value }) => value !== null); // unknown: the last value stands
    const changed = known.filter(({ externalId, value }) => force || !same(externalId, value));
    const due = known.filter(
      ({ externalId, value }) =>
        !force &&
        same(externalId, value) &&
        now - (this.publishedAt.get(externalId) ?? 0) >= this.timings.heartbeatMs,
    );
    // One budget over the last minute for every path (timer, notifications,
    // actions, widget): Gladys accepts 300 states a minute.
    this.sentTimes = (this.sentTimes ?? []).filter((time) => now - time < 60_000);
    const budget = Math.max(0, MAX_STATES_PER_MINUTE - this.sentTimes.length);
    const age = ({ externalId }) => this.publishedAt.get(externalId) ?? 0;
    const states = [...changed.sort((a, b) => age(a) - age(b)), ...due]
      .slice(0, force ? Infinity : budget)
      .map(({ externalId, value }) => ({ externalId, value }));
    for (let at = 0; at < states.length; at += MAX_STATES_PER_REQUEST) {
      const batch = states.slice(at, at + MAX_STATES_PER_REQUEST);
      try {
        // A text feature takes `text`, a number `state`.
        await this.gladys.publishStates(
          batch.map(({ externalId, value }) =>
            typeof value === 'object'
              ? { device_feature_external_id: externalId, text: value.text }
              : { device_feature_external_id: externalId, state: value },
          ),
        );
        for (const { externalId, value } of batch) {
          this.published.set(externalId, value);
          this.publishedAt.set(externalId, now);
          this.sentTimes.push(now);
        }
        this.failureLog.recover('states', 'States accepted again');
      } catch (err) {
        this.failureLog.fail('states', `States refused: ${err.message}`);
      }
    }
  }

  async afterChanges(widgetChanged, { publish = false } = {}) {
    await this.publishDevices({ force: publish });
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /** The badge of the added devices: local, "unreachable" while the server is. */
  async publishTransports() {
    if (!this.connection || this.readAt === 0) {
      return;
    }
    const { LOCAL, UNREACHABLE } = DEVICE_TRANSPORTS;
    const transport = this.error ? UNREACHABLE : LOCAL;
    const entries = [
      serverIds(this.gladys).device,
      ...[...this.keys.keys()].map((id) => keyIds(this.gladys, id).device),
    ]
      .filter((id) => this.isCreated(id) && this.transports.get(id) !== transport)
      .map((id) => ({ external_id: id, transport }));
    for (let at = 0; at < entries.length; at += MAX_STATES_PER_REQUEST) {
      const batch = entries.slice(at, at + MAX_STATES_PER_REQUEST);
      try {
        await this.gladys.publishTransports(batch);
        for (const entry of batch) {
          this.transports.set(entry.external_id, entry.transport);
        }
        this.failureLog.recover('transports', 'Transports accepted again');
      } catch (err) {
        this.failureLog.fail('transports', `Transports refused: ${err.message}`);
      }
    }
  }

  /** The error of the server, in one language: "Redis: does not answer". */
  errorText(language) {
    if (!this.error) {
      return '';
    }
    return labelled(
      'Redis',
      pick(ERROR_TEXT[this.error.kind] ?? ERROR_TEXT.other, language),
      language,
    );
  }

  /** The status under the integration name. */
  connectionStatus() {
    if (this.config.invalidHost) {
      return { connected: false, message: CONNECTION_TEXT.invalidHost };
    }
    if (!this.config.host) {
      return { connected: false, message: CONNECTION_TEXT.noServer };
    }
    if (!this.error) {
      return { connected: true };
    }
    return { connected: false, message: inEveryLanguage((language) => this.errorText(language)) };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.status) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.status = key;
      this.failureLog.recover('connection', 'Connection status accepted again');
    } catch (err) {
      this.failureLog.fail('connection', `Connection status refused: ${err.message}`);
    }
  }

  /** Why a key shows nothing, in one language; null when it has a value. */
  problemOf(spec, language) {
    const reading = this.readings.get(spec?.id);
    if (!reading) {
      return null;
    }
    if (reading.error) {
      return pick(ERROR_TEXT[reading.error.kind] ?? ERROR_TEXT.other, language);
    }
    const { problem } = keyState(spec.type, reading);
    return problem ? pick(KEY_PROBLEM_TEXT[problem], language) : null;
  }

  /** The value of a key as text ("21.5", "on"), or null. */
  displayValue(spec) {
    const { state } = keyState(spec.type, this.readings.get(spec.id));
    return state === null ? null : typeof state === 'object' ? state.text : state;
  }

  // --- Configuration actions ---------------------------------------------------------

  /** What `notify-keyspace-events` allows, when the option is on: a REPORT_TEXT part. */
  notificationsReport(language) {
    if (!this.config.keyspaceNotifications || this.error) {
      return null;
    }
    const text = REPORT_TEXT[language];
    if (this.notifyFlags === undefined) {
      return text.notifyUnknown;
    }
    return /K/.test(this.notifyFlags) && /[A$hlszxeg]/.test(this.notifyFlags)
      ? text.notifyOn
      : text.notifyOff(this.notifyFlags);
  }

  /** `notify-keyspace-events` of the server, undefined when the ACL refuse CONFIG. */
  async readNotifyFlags() {
    this.notifyFlags = undefined;
    if (!this.config.keyspaceNotifications || this.error || !this.connection) {
      return;
    }
    try {
      const answer = await this.connection.command(['CONFIG', 'GET', 'notify-keyspace-events']);
      const value = Array.isArray(answer) ? answer[1] : answer?.['notify-keyspace-events'];
      this.notifyFlags = replyText(value) ?? '';
    } catch (err) {
      logger.debug(`notify-keyspace-events not read: ${err.message}`);
    }
  }

  /** "Test the connection": read now, one line. */
  async testConnection() {
    await this.pollAll({ publish: true, fresh: true });
    await this.readNotifyFlags();
    const status = this.connectionStatus();
    return inEveryLanguage((language) => {
      const text = REPORT_TEXT[language];
      if (!this.connection) {
        return pick(status.message, language);
      }
      if (this.error) {
        return sentence([this.errorText(language)]);
      }
      const parts = [text.ok, `${productVersion(this.info)} (${serverName(this.config)})`];
      if (this.dbKeys !== null) {
        parts.push(text.dbKeys(this.dbKeys));
      }
      parts.push(this.keys.size > 0 ? text.keys(this.keys.size) : text.noKey);
      for (const spec of this.keys.values()) {
        const problem = this.problemOf(spec, language);
        if (problem) {
          parts.push(labelled(keyLabel(spec), problem, language));
        }
      }
      parts.push(this.notificationsReport(language));
      return sentence(parts);
    });
  }

  /** "Add a key": read once (the type "Automatic" is decided then), then saved. */
  async addKey(fields) {
    const { spec, auto, error } = parseKeyFields(fields);
    if (error) {
      throw new AnswerError(KEY_FIELD_TEXT[error]);
    }
    const existing = this.keys.get(spec.id);
    const tooMany = () =>
      new AnswerError(inEveryLanguage((language) => REPORT_TEXT[language].tooMany(MAX_KEYS)));
    if (!existing && this.keys.size >= MAX_KEYS) {
      throw tooMany();
    }
    if (!this.connection) {
      throw new AnswerError(this.connectionStatus().message ?? CONNECTION_TEXT.noServer);
    }
    let reading = null;
    try {
      reading = await this.readOne(spec);
    } catch (err) {
      logger.debug(`Key ${spec.key} not checked: ${err.message}`);
    }
    if (auto) {
      // Kept when the key is added again with "Automatic": same feature.
      spec.type = existing?.type ?? (reading && !reading.error ? autoType(reading) : 'number');
    }
    if (!existing && this.keys.size >= MAX_KEYS) {
      throw tooMany(); // another "Add a key" finished during the check
    }
    this.keys.set(spec.id, spec);
    this.generation += 1; // a read in progress does not know this key
    if (reading) {
      this.readings.set(spec.id, reading);
    } else {
      this.readings.delete(spec.id);
    }
    await this.save();
    logger.info(`Key ${existing ? 'updated' : 'added'}: ${keyLabel(spec)} (${spec.type})`);
    await this.publishDevices();
    if (this.isCreated(keyIds(this.gladys, spec.id).device)) {
      await this.sendStates(this.valuesOf([spec]), { force: true });
    }
    await this.followNotifications();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
    return inEveryLanguage((language) => {
      const text = REPORT_TEXT[language];
      const parts = [
        existing ? text.updated(keyName(spec)) : text.added(keyName(spec)),
        text.typed(pick(TYPE_TEXT[spec.type], language)),
      ];
      if (!reading) {
        parts.push(text.notChecked);
      } else {
        const problem = this.problemOf(spec, language);
        const value = this.displayValue(spec);
        parts.push(problem ?? (value === null ? null : text.value(value)));
      }
      if (!this.isCreated(keyIds(this.gladys, spec.id).device)) {
        parts.push(text.discovery);
      }
      return sentence(parts);
    });
  }

  /** "Remove a key", by its key and field. */
  async removeKey(fields) {
    const { spec } = parseKeyFields({ ...fields, type: AUTO_TYPE });
    const found = spec ? this.keys.get(spec.id) : null;
    if (!found) {
      const label = spec ? keyLabel(spec) : '';
      throw new AnswerError(inEveryLanguage((language) => REPORT_TEXT[language].notFound(label)));
    }
    this.keys.delete(found.id);
    this.readings.delete(found.id);
    this.generation += 1;
    await this.save();
    logger.info(`Key removed: ${keyLabel(found)}`);
    await this.publishDevices();
    await this.followNotifications();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
    return inEveryLanguage((language) => {
      const text = REPORT_TEXT[language];
      return sentence([text.removed(keyName(found)), text.keys(this.keys.size)]);
    });
  }
}
