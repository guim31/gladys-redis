// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake Redis, a temporary
// /data and a manual clock, with the integration wired on top through
// registerHandlers. No poll timer runs: the tests read with
// `world.hub.pollAll()`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { keyIds, serverIds } from '../../src/devices.js';
import { keyId } from '../../src/keys.js';
import { Store } from '../../src/store.js';
import { ERRORS, FakeRedis, HOST, INFO } from './fakeRedis.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

export const BASE_CONFIG = { host: HOST, port: 6379, database: 0, language: 'en' };

/** A manual clock, shared by the hub and the tests. */
export function createClock(start = Date.parse('2026-11-14T10:00:00Z')) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/** A Redis holding the values of a small home setup. */
export function homeRedis(options) {
  const redis = new FakeRedis(options);
  redis.set('sensors:garage:temperature', '18.25');
  redis.set('alarm:state', 'armed');
  redis.set('visits', '41');
  redis.hset('meter:linky', { power: '1830', energy: '12345.6' });
  redis.list('queue:jobs', ['a', 'b', 'c']);
  redis.list('online:devices', ['x', 'y'], 'set');
  return redis;
}

export async function createWorld({
  clock = createClock(),
  config = BASE_CONFIG,
  redis = homeRedis(),
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-redis-')),
  timings = { notifyDelayMs: 0 },
  timers = false,
} = {}) {
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    createClient: redis.createClient,
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, redis, app, hub: app.hub, clock, dataDir };
}

export const keyDevice = (gladys, key, field = '') => keyIds(gladys, keyId(key, field)).device;
export const serverDevice = (gladys) => serverIds(gladys).device;

/** Add discovered devices in Gladys, as the user would (all by default). */
export async function createDevices(world, filter = () => true) {
  for (const device of world.fake.discoveredDevices.filter(filter)) {
    await world.fake.deviceCreated(device);
  }
}

/** Run a configuration action; its message in English. */
export async function runAction(world, key, fields) {
  const ack = await world.fake.action(key, fields);
  if (!ack.success) {
    throw new Error(ack.error);
  }
  return ack.data?.message?.en ?? ack.data?.message ?? ack.data;
}

export const addKey = (world, fields) => runAction(world, 'add_key', fields);

/** Let the notification timers (0 ms in tests) and their reads run. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

export { ERRORS, FakeRedis, HOST, INFO };
