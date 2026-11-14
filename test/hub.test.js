// -----------------------------------------------------------------------------
// The hub against the fake Redis: keys added and read, every Redis type, the
// server device, errors (address, password, database, ACL, server down), the
// keyspace notifications, persistence, heartbeat and quiet logs.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';
import { keyFeatureId, serverIds } from '../src/devices.js';
import { keyId } from '../src/keys.js';
import { errorKind } from '../src/redis/client.js';
import { parseInfo } from '../src/redis/info.js';
import {
  BASE_CONFIG,
  ERRORS,
  FakeRedis,
  INFO,
  addKey,
  createDevices,
  createWorld,
  keyDevice,
  runAction,
  serverDevice,
  settle,
} from './helpers/world.js';

function captureLogs(t) {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'info';
  const lines = [];
  for (const stream of ['log', 'error']) {
    t.mock.method(console, stream, (...args) => lines.push(args.join(' ')));
  }
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  return lines;
}

async function world(t, options = {}) {
  const created = await createWorld(options);
  t.after(() => created.app.stop());
  return created;
}

const featureOf = (w, key, type, field = '') =>
  keyFeatureId(w.gladys, { id: keyId(key, field), type });
const serverFeature = (w, name) => serverIds(w.gladys).feature(name);
const transportOf = (w, externalId) =>
  w.fake.transports.filter((entry) => entry.device_external_id === externalId).at(-1)?.transport;

test('the INFO of Redis 7 and Valkey 8 give the product, version, memory and clients', () => {
  assert.deepEqual(parseInfo(INFO.redis7), {
    product: 'Redis',
    version: '7.4.12',
    usedMemory: 1310752,
    clients: 1,
  });
  assert.deepEqual(parseInfo(INFO.valkey8), {
    product: 'Valkey',
    version: '8.1.11',
    usedMemory: 1228000,
    clients: 1,
  });
});

test('the real error replies are sorted into kinds', () => {
  assert.equal(errorKind(new Error(ERRORS.noauth)), 'auth');
  assert.equal(errorKind(new Error(ERRORS.wrongpass)), 'auth');
  assert.equal(errorKind(new Error(ERRORS.noperm_key)), 'permission');
  assert.equal(errorKind(new Error(ERRORS.wrongtype)), 'wrong_type');
  assert.equal(errorKind(new Error(ERRORS.database)), 'database');
  assert.equal(
    errorKind(Object.assign(new Error(ERRORS.refused), { code: 'ECONNREFUSED' })),
    'unreachable',
  );
  const timeout = new Error(ERRORS.timeout);
  timeout.name = 'ConnectionTimeoutError';
  assert.equal(errorKind(timeout), 'unreachable');
  assert.equal(
    errorKind(
      Object.assign(new Error('self-signed certificate'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }),
    ),
    'tls',
  );
});

test('the configuration: host forms, defaults, channels', () => {
  const config = normalizeConfig({
    host: ' redis://192.0.2.5:6380 ',
    database: '2',
    publish_channels: 'a, b;a c',
  });
  assert.equal(config.host, '192.0.2.5');
  assert.equal(config.port, 6380);
  assert.equal(config.database, 2);
  assert.deepEqual(config.publishChannels, ['a', 'b', 'c']);
  assert.equal(normalizeConfig({ host: 'rediss://cache.example' }).tls, true);
  assert.equal(normalizeConfig({ host: 'redis.local:6390' }).port, 6390);
  assert.equal(normalizeConfig({ host: 'redis://user:pw@host' }).invalidHost, true);
  assert.equal(normalizeConfig({ host: 'not a host' }).invalidHost, true);
  assert.equal(normalizeConfig({ host: '2001:db8::5' }).host, '2001:db8::5');
  const defaults = normalizeConfig({});
  assert.equal(defaults.host, null);
  assert.equal(defaults.pollIntervalMs, 30_000);
  assert.equal(defaults.allowWrite, false);
  assert.equal(defaults.language, 'fr');
});

test('the server device, then each Redis type read as the user added it', async (t) => {
  const w = await world(t);
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  assert.deepEqual(
    w.fake.discoveredDevices.map((device) => device.name),
    ['Redis redis.test'],
    'the server only, before any key',
  );
  assert.match(
    await addKey(w, { key: 'sensors:garage:temperature', type: 'temperature', name: 'Garage' }),
    /Key "Garage" added, type temperature, value 18.25, add its device/,
  );
  assert.match(await addKey(w, { key: 'alarm:state' }), /type text, value armed/);
  assert.match(await addKey(w, { key: 'visits' }), /type number, value 41/);
  assert.match(
    await addKey(w, { key: 'meter:linky', field: 'power', type: 'power' }),
    /value 1830/,
  );
  assert.match(await addKey(w, { key: 'queue:jobs' }), /type number, value 3/);
  assert.match(await addKey(w, { key: 'online:devices', type: 'text' }), /type text, value 2/);
  assert.match(await addKey(w, { key: 'nothing:here' }), /type number, key absent/);
  assert.match(await addKey(w, { key: 'meter:linky' }), /a hash: add it again with its field/);
  assert.equal(w.fake.discoveredDevices.length, 9);
  assert.equal(w.fake.states.length, 0, 'nothing for a device not added');

  await createDevices(w);
  assert.equal(w.fake.lastState(featureOf(w, 'sensors:garage:temperature', 'temperature')), 18.25);
  assert.equal(w.fake.lastState(featureOf(w, 'alarm:state', 'text')), 'armed');
  assert.equal(w.fake.lastState(featureOf(w, 'meter:linky', 'power', 'power')), 1830);
  assert.equal(w.fake.lastState(featureOf(w, 'queue:jobs', 'number')), 3);
  assert.equal(w.fake.lastState(featureOf(w, 'online:devices', 'text')), '2');
  assert.equal(w.fake.lastState(serverFeature(w, 'reachable')), 1);
  assert.equal(w.fake.lastState(serverFeature(w, 'version')), 'Redis 7.4.12');
  assert.equal(w.fake.lastState(serverFeature(w, 'memory')), 1.3);
  assert.equal(w.fake.lastState(serverFeature(w, 'keys')), 6);
  assert.equal(transportOf(w, keyDevice(w.gladys, 'visits')), 'local');

  // The script writes: the next read publishes the change only.
  w.redis.set('visits', '42');
  const count = w.fake.states.length;
  await w.hub.pollAll();
  assert.deepEqual(
    w.fake.states.slice(count).map((state) => [state.device_feature_external_id, state.state]),
    [[featureOf(w, 'visits', 'number'), 42]],
  );
  // A number type that holds text has no value, the last one stands.
  w.redis.set('visits', 'oops');
  await w.hub.pollAll();
  assert.equal(w.fake.lastState(featureOf(w, 'visits', 'number')), 42);
  assert.match(await runAction(w, 'test_connection'), /visits: the value is not a number/);
});

test('"Automatic" keeps the type chosen first; "Remove a key" stops following it', async (t) => {
  const w = await world(t);
  await addKey(w, { key: 'visits' });
  w.redis.set('visits', 'text now');
  assert.match(
    await addKey(w, { key: 'visits', name: 'Visitors' }),
    /Key "Visitors" updated, type number/,
  );
  assert.equal(w.hub.keys.size, 1);
  assert.match(
    await runAction(w, 'remove_key', { key: 'visits' }),
    /Key "Visitors" removed, 0 key\(s\) followed/,
  );
  assert.match(await runAction(w, 'remove_key', { key: 'visits' }), /No key "visits" is followed/);
  assert.match(await addKey(w, { key: ' ' }), /exact name of the key/);
  assert.match(await addKey(w, { key: 'x', type: 'pressure' }), /Choose a type/);
});

test('the keys survive a restart (/data), the same key is the same device', async (t) => {
  const first = await world(t);
  await addKey(first, { key: 'visits', name: 'Visitors' });
  await first.app.stop();
  const second = await world(t, { dataDir: first.dataDir });
  assert.deepEqual(
    second.fake.discoveredDevices.map((device) => [device.external_id, device.name]),
    [
      [serverDevice(second.gladys), 'Redis redis.test'],
      [keyDevice(second.gladys, 'visits'), 'Visitors'],
    ],
  );
});

test('a server down: reachable at 0, keys unreachable, one log line each way', async (t) => {
  const lines = captureLogs(t);
  const w = await world(t);
  await addKey(w, { key: 'visits' });
  await createDevices(w);
  lines.length = 0;
  await w.hub.pollAll();
  assert.deepEqual(lines, [], 'a normal read writes nothing at info');

  w.redis.down = true;
  await w.hub.pollAll();
  await w.hub.pollAll();
  assert.equal(w.fake.lastState(serverFeature(w, 'reachable')), 0);
  assert.equal(transportOf(w, keyDevice(w.gladys, 'visits')), 'unreachable');
  assert.equal(w.fake.connectionStatus.message.en, 'Redis: does not answer');
  assert.equal(w.fake.connectionStatus.message.fr, 'Redis : ne répond pas');
  assert.equal(
    lines.filter((line) => line.includes('ECONNREFUSED') || line.includes('closed')).length,
    1,
  );

  w.redis.down = false;
  await w.hub.pollAll();
  assert.equal(w.fake.lastState(serverFeature(w, 'reachable')), 1);
  assert.equal(transportOf(w, keyDevice(w.gladys, 'visits')), 'local');
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  assert.ok(lines.some((line) => line.includes('answers again')));
});

test('password, ACL user, database and address errors are told in clear', async (t) => {
  const redis = new FakeRedis({ password: 's3cret', username: 'gladys' });
  redis.set('visits', '1');
  const noPassword = await world(t, { redis });
  assert.equal(
    noPassword.fake.connectionStatus.message.en,
    'Redis: access refused: check the user and the password',
  );
  const good = await world(t, {
    redis,
    config: { ...BASE_CONFIG, username: 'gladys', password: 's3cret\n' },
  });
  assert.deepEqual(good.fake.connectionStatus, { connected: true });
  const database = await world(t, { config: { ...BASE_CONFIG, database: 40 } });
  assert.match(database.fake.connectionStatus.message.en, /database number does not exist/);
  const invalid = await world(t, { config: { host: 'http://x y' } });
  assert.match(invalid.fake.connectionStatus.message.en, /Address not understood/);
  const empty = await world(t, { config: {} });
  assert.match(await runAction(empty, 'test_connection'), /Enter the address of your Redis server/);
  assert.match(await addKey(empty, { key: 'visits' }), /Enter the address/);

  // A key the ACL refuse is the key's problem, not the server's.
  good.redis.forbidden.add('secret:key');
  await addKey(good, { key: 'visits' });
  assert.match(await addKey(good, { key: 'secret:key' }), /refused by the ACL/);
  await createDevices(good);
  await good.hub.pollAll();
  assert.deepEqual(good.fake.connectionStatus, { connected: true });
  assert.equal(good.hub.failureLog.active.has('states'), false, 'no state refused');
});

test('keyspace notifications: a change is read at once and fires "A Redis key changes"', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, keyspace_notifications: true } });
  await addKey(w, { key: 'alarm:state' });
  await addKey(w, { key: 'meter:linky', field: 'energy' });
  await createDevices(w);
  assert.match(await runAction(w, 'test_connection'), /keyspace notifications received/);

  w.redis.set('alarm:state', 'disarmed'); // written by another client
  w.redis.touch('alarm:state', 'set');
  await settle();
  assert.equal(w.fake.lastState(featureOf(w, 'alarm:state', 'text')), 'disarmed');
  assert.deepEqual(w.fake.sceneEvents.at(-1), {
    key: 'key_changed',
    data: {
      device: keyDevice(w.gladys, 'alarm:state'),
      event: 'set',
      key: 'alarm:state',
      name: 'alarm:state',
      value: 'disarmed',
    },
  });

  w.redis.data.delete('alarm:state');
  w.redis.touch('alarm:state', 'expired');
  await settle();
  assert.equal(w.fake.sceneEvents.at(-1).data.event, 'expired');
  assert.equal(w.fake.sceneEvents.at(-1).data.value, '');

  // A key not followed says nothing.
  const count = w.fake.sceneEvents.length;
  w.redis.touch('other', 'set');
  await settle();
  assert.equal(w.fake.sceneEvents.length, count);

  // Off on the server: said by "Test the connection"; ACL refusing CONFIG too.
  w.redis.notify = '';
  assert.match(await runAction(w, 'test_connection'), /keyspace notifications off on the server/);
  w.redis.configReadable = false;
  assert.match(await runAction(w, 'test_connection'), /notify-keyspace-events not readable/);
});

test('notifications are not followed when the option is off', async (t) => {
  const w = await world(t);
  await addKey(w, { key: 'alarm:state' });
  w.redis.touch('alarm:state', 'set');
  await settle();
  assert.equal(w.redis.subscribers.size, 0);
  assert.deepEqual(w.fake.sceneEvents, []);
});

test('an unchanged value is sent again after 6 hours; "Update" sends everything', async (t) => {
  const w = await world(t);
  await addKey(w, { key: 'visits' });
  await createDevices(w);
  const feature = featureOf(w, 'visits', 'number');
  const sent = () =>
    w.fake.states.filter((state) => state.device_feature_external_id === feature).length;
  const before = sent();
  await w.hub.pollAll();
  assert.equal(sent(), before);
  w.clock.advance(6 * 3600_000);
  await w.hub.pollAll();
  assert.equal(sent(), before + 1);
  await w.fake.deviceUpdated(w.fake.discoveredDevices[1]);
  assert.equal(sent(), before + 2);
});

test('the language of the configuration names the server features', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, language: 'fr' } });
  assert.deepEqual(
    w.fake.discoveredDevices[0].features.map((feature) => feature.name),
    ['Joignable', 'Version', 'Mémoire utilisée', 'Clients connectés', 'Clés de la base'],
  );
});

test('the container reads on its own timer, without any onPoll from Gladys', async (t) => {
  const w = await world(t, { timers: true, timings: { notifyDelayMs: 0, pollIntervalMs: 20 } });
  await addKey(w, { key: 'visits' });
  await createDevices(w);
  const reads = w.redis.commands.filter(([name]) => name === 'INFO').length;
  w.redis.set('visits', '50');
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.ok(w.redis.commands.filter(([name]) => name === 'INFO').length > reads);
  assert.equal(w.fake.lastState(featureOf(w, 'visits', 'number')), 50);
});

test('a key changing all the time is still read (throttle), and events are budgeted', async (t) => {
  const w = await world(t, {
    config: { ...BASE_CONFIG, keyspace_notifications: true },
    timings: { notifyDelayMs: 30 },
  });
  await addKey(w, { key: 'visits' });
  const gets = () =>
    w.redis.commands.filter(([name, key]) => name === 'GET' && key === 'visits').length;
  const before = gets();
  for (let count = 0; count < 15; count += 1) {
    w.redis.set('visits', String(count));
    w.redis.touch('visits', 'incrby');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(gets() > before, 'read while it keeps changing');
  await settle();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(w.fake.sceneEvents.length >= 2 && w.fake.sceneEvents.length <= 8);
  assert.equal(w.fake.sceneEvents.at(-1).data.value, '14');
});

test('a huge number is not a state (Infinity would break the batch)', async (t) => {
  const w = await world(t);
  w.redis.set('visits', '1e303');
  assert.match(await addKey(w, { key: 'visits', type: 'number' }), /the value is not a number/);
});

test('a closed connection never reconnects', async (t) => {
  const w = await world(t);
  const connection = w.hub.connection;
  connection.close();
  await assert.rejects(connection.command(['PING']), /closed/);
  assert.equal(connection.client, null);
});

test('the server-wide replies and the closed-client errors are not key errors', () => {
  assert.equal(
    errorKind(new Error('LOADING Redis is loading the dataset in memory')),
    'unreachable',
  );
  const disconnected = new Error('Disconnects client');
  disconnected.name = 'DisconnectsClientError';
  assert.equal(errorKind(disconnected), 'unreachable');
  assert.equal(errorKind(new Error('The client is offline')), 'unreachable');
});
