// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from a
// realistic Redis (the real INFO of Redis 7 and Valkey 8): the server, and a
// key of every type in Gladys, over every Redis type (string, hash field,
// list, set), in every feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { KEY_TYPE_KEYS } from '../src/keys.js';
import { BASE_CONFIG, INFO, addKey, createWorld, homeRedis } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const KEYS = [
  { key: 'sensors:garage:temperature' },
  { key: 'alarm:state' },
  { key: 'meter:linky', field: 'power' },
  { key: 'queue:jobs' },
  { key: 'online:devices' },
  { key: 'visits' },
  { key: 'meter:linky', field: 'energy' },
];

async function discover(language) {
  const devices = [];
  for (const info of [INFO.redis7, INFO.valkey8]) {
    const world = await createWorld({
      config: { ...BASE_CONFIG, language },
      redis: homeRedis({ info }),
    });
    for (const [index, type] of KEY_TYPE_KEYS.entries()) {
      await addKey(world, { ...KEYS[index], type, name: `${type} key` });
    }
    await addKey(world, { key: 'nothing:here' }); // Automatic, absent, no name
    await world.app.stop();
    devices.push(world.fake.discoveredDevices);
  }
  return devices;
}

const scenarios = ['en', 'fr', 'de', 'es'].map((language) => ({
  label: `${language} names`,
  language,
}));

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const worlds = await discover(scenario.language);
    const devices = worlds.flat();
    assert.equal(devices.length, 2 * (KEY_TYPE_KEYS.length + 2), 'the server and every key');
    assert.ok(
      devices.every((device) => device.features.length > 0),
      'every device has features',
    );
    for (const list of worlds) {
      assert.equal(
        new Set(list.map((device) => device.external_id)).size,
        list.length,
        'unique device external ids',
      );
    }

    for (const device of devices) {
      const where = device.name;

      // should_poll: true if and only if poll_frequency is provided, in ms.
      if (device.poll_frequency === undefined) {
        assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
      } else {
        assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
        assert.ok(
          table.poll_frequencies_ms.includes(device.poll_frequency),
          `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
        );
      }

      assert.ok(device.features.length > 0, `${where}: no feature`);
      const externalIds = new Set();
      const names = new Set();
      for (const feature of device.features) {
        const at = `${where} / ${feature.name}`;
        const pair = table.pairs[`${feature.category}/${feature.type}`];
        assert.ok(pair, `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`);
        assert.ok(
          pair.label_en && pair.label_fr && pair.icon,
          `${at}: couple without label or icon`,
        );

        assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
        assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
        assert.ok(
          Number.isFinite(feature.min) && Number.isFinite(feature.max),
          `${at}: finite min/max`,
        );
        assert.ok(feature.min <= feature.max, `${at}: min > max`);
        assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
        assert.equal(
          typeof feature.has_feedback,
          'boolean',
          `${at}: has_feedback must be a boolean`,
        );
        if (feature.unit !== undefined) {
          assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
        }

        assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
        externalIds.add(feature.external_id);
        assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
        names.add(feature.name);
      }
    }
  });
}
