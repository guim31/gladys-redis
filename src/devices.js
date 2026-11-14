// -----------------------------------------------------------------------------
// Gladys devices, proposed in the Discovery tab (the user adds the ones to
// follow, nothing is created on their behalf):
//   - one device per key followed (src/keys.js), identity = the key and its
//     hash field hashed, one feature of the type chosen for the key;
//   - one device for the server: reachable, version, memory used, connected
//     clients, keys of the database.
//
// Published with should_poll: false: the integration reads Redis on its own
// timer (src/hub.js), at the interval chosen in the configuration, and when a
// keyspace notification arrives.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORY,
  DEVICE_FEATURE_TYPES as TYPE,
  DEVICE_FEATURE_UNITS as UNIT,
} from '@gladysassistant/integration-sdk';
import { KEY_TYPES, keyName } from './keys.js';
import { SERVER_TEXT } from './texts.js';

export const KEY_DEVICE = 'key';
export const SERVER_DEVICE = 'server';
// One server per integration: its id never depends on the address (a new
// address keeps the device, its history and its scenes).
export const SERVER_ID = 'main';

export const MODEL_KEY = 'Redis key';
export const MODEL_SERVER = 'Redis server';
export const PARAMS = Object.freeze({ KEY: 'KEY', FIELD: 'FIELD' });

export const keyIds = (gladys, id) => gladys.externalIds(KEY_DEVICE, id);
export const serverIds = (gladys) => gladys.externalIds(SERVER_DEVICE, SERVER_ID);

/** Feature key of a key: the type is part of it (a new type, a new feature). */
export const keyFeatureKey = (type) => `value_${type}`;

/** The key id of a device external id, null when it is not a key of ours. */
export function parseKeyId(gladys, externalId) {
  const prefix = keyIds(gladys, '').device;
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const id = externalId.slice(prefix.length);
  return /^[0-9a-f]{12}$/.test(id) ? id : null;
}

const readOnly = { read_only: true, has_feedback: false };

/** The discovery payload of a key: one feature. */
export function buildKeyDevice(gladys, spec) {
  const ids = keyIds(gladys, spec.id);
  const type = KEY_TYPES[spec.type];
  const name = keyName(spec);
  return {
    name,
    external_id: ids.device,
    model: MODEL_KEY,
    should_poll: false,
    params: [
      { name: PARAMS.KEY, value: spec.key.slice(0, 255) },
      ...(spec.field ? [{ name: PARAMS.FIELD, value: spec.field.slice(0, 255) }] : []),
    ],
    features: [
      {
        name,
        external_id: ids.feature(keyFeatureKey(spec.type)),
        category: type.category,
        type: type.type,
        ...(type.unit ? { unit: type.unit } : {}),
        ...readOnly,
        // A text has no history worth keeping (and Gladys keeps none for it).
        keep_history: spec.type !== 'text',
        min: type.min,
        max: type.max,
      },
    ],
  };
}

export const keyFeatureId = (gladys, spec) =>
  keyIds(gladys, spec.id).feature(keyFeatureKey(spec.type));

// The features of the server, in display order. `read` turns the server
// status ({ reachable, info, dbKeys }) into a state, or null when unknown.
export const SERVER_FEATURES = [
  {
    key: 'reachable',
    category: CATEGORY.INPUT,
    type: TYPE.SENSOR.BINARY,
    min: 0,
    max: 1,
    keepHistory: true,
    read: ({ reachable }) => (reachable ? 1 : 0),
  },
  {
    key: 'version',
    category: CATEGORY.TEXT,
    type: TYPE.TEXT.TEXT,
    min: 0,
    max: 0,
    keepHistory: false,
    read: ({ reachable, info }) =>
      reachable && info?.version ? { text: `${info.product} ${info.version}` } : null,
  },
  {
    key: 'memory',
    category: CATEGORY.DATA,
    type: TYPE.DATA.SIZE,
    unit: UNIT.MEGABYTE,
    min: 0,
    max: 10_000_000,
    keepHistory: true,
    read: ({ reachable, info }) =>
      reachable && Number.isFinite(info?.usedMemory)
        ? Math.round((info.usedMemory / 1024 / 1024) * 10) / 10
        : null,
  },
  {
    key: 'clients',
    category: CATEGORY.COUNTER_SENSOR,
    type: TYPE.SENSOR.INTEGER,
    min: 0,
    max: 1_000_000,
    keepHistory: true,
    read: ({ reachable, info }) =>
      reachable && Number.isFinite(info?.clients) ? info.clients : null,
  },
  {
    key: 'keys',
    category: CATEGORY.COUNTER_SENSOR,
    type: TYPE.SENSOR.INTEGER,
    min: 0,
    max: 1_000_000_000,
    keepHistory: true,
    read: ({ reachable, dbKeys }) => (reachable && Number.isFinite(dbKeys) ? dbKeys : null),
  },
];

/** The discovery payload of the server. */
export function buildServerDevice(gladys, { host, language }) {
  const ids = serverIds(gladys);
  const text = SERVER_TEXT[language] ?? SERVER_TEXT.en;
  return {
    name: text.device(host),
    external_id: ids.device,
    model: MODEL_SERVER,
    should_poll: false,
    features: SERVER_FEATURES.map((feature) => ({
      name: text[feature.key],
      external_id: ids.feature(feature.key),
      category: feature.category,
      type: feature.type,
      ...(feature.unit ? { unit: feature.unit } : {}),
      ...readOnly,
      keep_history: feature.keepHistory,
      min: feature.min,
      max: feature.max,
    })),
  };
}

/** The states of the server features (null: nothing to publish). */
export function serverValues(gladys, status) {
  const ids = serverIds(gladys);
  return SERVER_FEATURES.map((feature) => ({
    externalId: ids.feature(feature.key),
    value: feature.read(status),
  }));
}
