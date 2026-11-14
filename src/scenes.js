// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+): write a value
// (SET, with an optional expiry), increment a number, publish a message
// (PUBLISH).
//
// Writing is off until the user ticks "Allow writing from scenes", and only
// reaches the keys followed (the scene picks a key device: no free key name)
// and the channels listed in the configuration. A list, a set or a stream is
// never overwritten: only a string or a hash field is written.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { parseKeyId } from './devices.js';
import { LENGTH_COMMANDS, keyLabel, parseNumber } from './keys.js';
import { ERROR_KINDS, asRedisError, replyText } from './redis/client.js';
import { ACTION_TEXT, ERROR_TEXT, labelled, pick } from './texts.js';

const logger = createLogger({ name: 'redis-scenes' });

export const MAX_VALUE_LENGTH = 100_000;
export const MAX_EXPIRE_SECONDS = 10 * 365 * 86400;

const fail = (text, language) => {
  throw new Error(pick(text, language));
};

/** The checks every write shares: a server, writing allowed. */
function writable(hub) {
  const language = hub.config?.language;
  if (!hub.connection) {
    fail(hub.config?.host ? hub.connectionStatus().message : ACTION_TEXT.noServer, language);
  }
  if (!hub.config.allowWrite) {
    fail(ACTION_TEXT.writeDisabled, language);
  }
  return language;
}

/** The key followed behind the device chosen in the scene. */
function chosenKey(hub, fields, language) {
  const spec = hub.keys.get(parseKeyId(hub.gladys, fields.device));
  if (!spec) {
    fail(ACTION_TEXT.unknownKey, language);
  }
  if (LENGTH_COMMANDS[hub.readings.get(spec.id)?.redisType]) {
    fail(ACTION_TEXT.notWritable, language);
  }
  return spec;
}

/** Run the commands; a Redis error in the language of the configuration. */
async function run(hub, commands, language) {
  const answers = [];
  try {
    for (const command of commands) {
      answers.push(await hub.connection.command(command));
    }
  } catch (caught) {
    const err = asRedisError(caught);
    const text = pick(ERROR_TEXT[err.kind] ?? ERROR_TEXT[ERROR_KINDS.OTHER], language);
    throw new Error(labelled('Redis', text, language), { cause: caught });
  }
  return answers;
}

/** The expiry field: null when empty or 0, a whole number of seconds otherwise. */
function expiry(value, language) {
  if (value === undefined || value === null || value === '' || value === 0) {
    return null;
  }
  const seconds = typeof value === 'number' ? value : parseNumber(String(value));
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_EXPIRE_SECONDS) {
    fail(ACTION_TEXT.badExpire, language);
  }
  return seconds;
}

/** Read the key again and publish it (the notification, if any, fires the trigger). */
async function reread(hub, spec) {
  await hub.refreshKey(spec.key).catch((err) => logger.debug(`Key not read again: ${err.message}`));
}

export const SCENE_ACTIONS = {
  async set_value(hub, { fields = {} }) {
    const language = writable(hub);
    const spec = chosenKey(hub, fields, language);
    const value = fields.value === undefined || fields.value === null ? '' : String(fields.value);
    if (value.length > MAX_VALUE_LENGTH) {
      fail(ACTION_TEXT.tooLong, language);
    }
    const seconds = expiry(fields.expire_seconds, language);
    const commands = spec.field
      ? [['HSET', spec.key, spec.field, value], ...(seconds ? [['EXPIRE', spec.key, seconds]] : [])]
      : [['SET', spec.key, value, ...(seconds ? ['EX', seconds] : [])]];
    await run(hub, commands, language);
    logger.info(`Scene: ${keyLabel(spec)} written${seconds ? `, expires in ${seconds} s` : ''}`);
    await reread(hub, spec);
  },

  async increment(hub, { fields = {} }) {
    const language = writable(hub);
    const spec = chosenKey(hub, fields, language);
    const raw = fields.by;
    const by =
      raw === undefined || raw === null || raw === ''
        ? 1
        : typeof raw === 'number'
          ? raw
          : parseNumber(String(raw).replace(',', '.'));
    if (by === null || !Number.isFinite(by)) {
      fail(ACTION_TEXT.badNumber, language);
    }
    const command = spec.field
      ? ['HINCRBYFLOAT', spec.key, spec.field, by]
      : ['INCRBYFLOAT', spec.key, by];
    const [answer] = await run(hub, [command], language);
    logger.info(`Scene: ${keyLabel(spec)} incremented by ${by}`);
    await reread(hub, spec);
    return { value: parseNumber(replyText(answer)) ?? 0 };
  },

  async publish(hub, { fields = {} }) {
    const language = writable(hub);
    const channel = typeof fields.channel === 'string' ? fields.channel.trim() : '';
    if (!hub.config.publishChannels.includes(channel)) {
      fail(ACTION_TEXT.channelNotAllowed, language);
    }
    const message =
      fields.message === undefined || fields.message === null ? '' : String(fields.message);
    if (message.length > MAX_VALUE_LENGTH) {
      fail(ACTION_TEXT.tooLong, language);
    }
    const [answer] = await run(hub, [['PUBLISH', channel, message]], language);
    logger.info(`Scene: message published on ${channel}`);
    return { receivers: Number(answer) || 0 };
  },
};
