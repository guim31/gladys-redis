// -----------------------------------------------------------------------------
// The Redis keys followed as Gladys devices, added and removed with the
// configuration actions "Add a key" and "Remove a key" (Gladys has no list
// field in a configuration form), stored under /data (src/store.js).
//
// A key = its exact name (never a pattern: nothing scans the database), an
// optional hash field, a Gladys type (category, type, unit, display bounds of
// its feature) and an optional display name. The identity is the key and the
// field, hashed: the same key added again is the same device.
//
// What is read depends on the Redis type found at each read: a string or a
// hash field gives its value, a list, a set, a sorted set or a stream gives
// its length.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import {
  DEVICE_FEATURE_CATEGORIES as CATEGORY,
  DEVICE_FEATURE_TYPES as TYPE,
  DEVICE_FEATURE_UNITS as UNIT,
} from '@gladysassistant/integration-sdk';
import { replyText } from './redis/client.js';

// Keys at most: Gladys accepts 300 states per minute, and every key is two
// commands per read.
export const MAX_KEYS = 50;
export const MAX_KEY_LENGTH = 512;
export const MAX_FIELD_LENGTH = 256;
export const MAX_NAME_LENGTH = 60;
// A text state longer than this is cut (the tile shows a line).
export const MAX_TEXT_LENGTH = 255;

const BIG = 1e12;

// The types offered in "Add a key": keys stored under /data and in the
// feature external ids, permanent once published. Bounds are display bounds.
export const KEY_TYPES = Object.freeze({
  number: { category: CATEGORY.UNKNOWN, type: TYPE.UNKNOWN.UNKNOWN, min: -BIG, max: BIG },
  temperature: {
    category: CATEGORY.TEMPERATURE_SENSOR,
    type: TYPE.SENSOR.DECIMAL,
    unit: UNIT.CELSIUS,
    min: -100,
    max: 200,
  },
  humidity: {
    category: CATEGORY.HUMIDITY_SENSOR,
    type: TYPE.SENSOR.DECIMAL,
    unit: UNIT.PERCENT,
    min: 0,
    max: 100,
  },
  percent: {
    category: CATEGORY.LEVEL_SENSOR,
    type: TYPE.LEVEL_SENSOR.LIQUID_LEVEL_PERCENT,
    unit: UNIT.PERCENT,
    min: 0,
    max: 100,
  },
  power: {
    category: CATEGORY.ENERGY_SENSOR,
    type: TYPE.ENERGY_SENSOR.POWER,
    unit: UNIT.WATT,
    // Signed: a solar inverter exports.
    min: -1e6,
    max: 1e6,
  },
  energy: {
    category: CATEGORY.ENERGY_SENSOR,
    type: TYPE.ENERGY_SENSOR.ENERGY,
    unit: UNIT.KILOWATT_HOUR,
    min: 0,
    max: BIG,
  },
  // NOT NULL in the core, even for a text (422 on "Add to Gladys").
  text: { category: CATEGORY.TEXT, type: TYPE.TEXT.TEXT, min: 0, max: 0 },
});

export const KEY_TYPE_KEYS = Object.keys(KEY_TYPES);
// "Automatic": a number when the value is one (or a length), text otherwise.
export const AUTO_TYPE = 'auto';

// Redis types read as a length.
export const LENGTH_COMMANDS = Object.freeze({
  list: 'LLEN',
  set: 'SCARD',
  zset: 'ZCARD',
  stream: 'XLEN',
});

// Why a key has no value: keys of KEY_PROBLEM_TEXT (src/texts.js).
export const KEY_PROBLEMS = Object.freeze({
  MISSING: 'missing',
  NEEDS_FIELD: 'needs_field',
  NOT_HASH: 'not_hash',
  NO_FIELD: 'no_field',
  NOT_NUMBER: 'not_number',
  EMPTY: 'empty',
  UNSUPPORTED: 'unsupported',
});

/** The id of a key: the key and its hash field, hashed. */
export const keyId = (key, field = '') =>
  createHash('sha256').update(`${key}\n${field}`).digest('hex').slice(0, 12);

/** "key" or "key → field": how a key is named when the user gave no name. */
export const keyLabel = ({ key, field }) => (field ? `${key} → ${field}` : key);

export const isNumberType = (type) => type !== 'text';

/**
 * The fields of "Add a key", checked.
 * @returns {{ spec?: object, auto?: boolean, error?: string }} error: a KEY_FIELD_TEXT key
 */
export function parseKeyFields(fields = {}) {
  const raw = (name) => (typeof fields[name] === 'string' ? fields[name] : '');
  // A key may hold spaces: only the line ends of a paste are removed.
  const key = raw('key').replace(/^[\r\n]+|[\r\n]+$/g, '');
  const field = raw('field').replace(/^[\r\n]+|[\r\n]+$/g, '');
  const name = raw('name').trim().replace(/\s+/g, ' ');
  const typed = raw('type') || AUTO_TYPE;
  if (!key.trim() || key.length > MAX_KEY_LENGTH) {
    return { error: 'key' };
  }
  if (field.length > MAX_FIELD_LENGTH) {
    return { error: 'field' };
  }
  if (name.length > MAX_NAME_LENGTH) {
    return { error: 'name' };
  }
  if (typed !== AUTO_TYPE && !KEY_TYPES[typed]) {
    return { error: 'type' };
  }
  return {
    spec: { id: keyId(key, field), key, field, type: typed, name },
    auto: typed === AUTO_TYPE,
  };
}

/** A key read back from /data, or null when the entry is not usable. */
export function restoreKey(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const { key, field = '', type, name = '' } = entry;
  if (typeof key !== 'string' || !key || typeof field !== 'string' || !KEY_TYPES[type]) {
    return null;
  }
  return { id: keyId(key, field), key, field, type, name: typeof name === 'string' ? name : '' };
}

/** The display name of a key. */
export const keyName = (spec) => spec.name || keyLabel(spec).slice(0, MAX_NAME_LENGTH);

/**
 * Read one key: its Redis type, then its value (a string, a hash field) or
 * its length (a list, a set, a sorted set, a stream). Two commands.
 * @param {{ command: (args: string[]) => Promise<unknown> }} connection
 * @returns {Promise<{ redisType: string, raw: string|null, length: number|null, problem: string|null }>}
 */
export async function readKey(connection, { key, field }) {
  const redisType = replyText(await connection.command(['TYPE', key])) ?? 'none';
  const result = (values) => ({ redisType, raw: null, length: null, problem: null, ...values });
  if (redisType === 'none') {
    return result({ problem: KEY_PROBLEMS.MISSING });
  }
  if (redisType === 'hash') {
    if (!field) {
      return result({ problem: KEY_PROBLEMS.NEEDS_FIELD });
    }
    const raw = replyText(await connection.command(['HGET', key, field]));
    return result(raw === null ? { problem: KEY_PROBLEMS.NO_FIELD } : { raw });
  }
  if (field) {
    return result({ problem: KEY_PROBLEMS.NOT_HASH });
  }
  if (redisType === 'string') {
    return result({ raw: replyText(await connection.command(['GET', key])) });
  }
  if (LENGTH_COMMANDS[redisType]) {
    const length = Number(await connection.command([LENGTH_COMMANDS[redisType], key]));
    return result({ length: Number.isFinite(length) ? length : null });
  }
  return result({ problem: KEY_PROBLEMS.UNSUPPORTED });
}

/** A Redis string as a number, or null ("21.5", " 3 ", "-1e3"; not "", "abc", "0x10"). */
export function parseNumber(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(text)) {
    return null;
  }
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

/** The type "Automatic" gives a reading: a number when it is one, text otherwise. */
export function autoType(reading) {
  if (reading.length !== null || reading.problem) {
    return 'number';
  }
  return parseNumber(reading.raw) === null ? 'text' : 'number';
}

const round = (value) => Math.round(value * 1e6) / 1e6;

/**
 * The state of a key's feature, and why there is none.
 * @returns {{ state: number|{ text: string }|null, problem: string|null }}
 */
export function keyState(type, reading) {
  // No reading yet, a reading refused (ACL, wrong type), or a key without value.
  if (!reading || reading.error || reading.problem) {
    return { state: null, problem: reading?.problem ?? null };
  }
  if (type === 'text') {
    const text = reading.length !== null ? String(reading.length) : (reading.raw ?? '');
    return text.trim()
      ? { state: { text: text.slice(0, MAX_TEXT_LENGTH) }, problem: null }
      : { state: null, problem: KEY_PROBLEMS.EMPTY };
  }
  const number = reading.length !== null ? reading.length : parseNumber(reading.raw);
  if (number === null) {
    return {
      state: null,
      problem: reading.raw?.trim() ? KEY_PROBLEMS.NOT_NUMBER : KEY_PROBLEMS.EMPTY,
    };
  }
  return { state: round(number), problem: null };
}
