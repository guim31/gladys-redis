// -----------------------------------------------------------------------------
// Scene actions (write, increment, publish: off by default, limited to the
// keys followed and the channels listed) and the dashboard widget.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import {
  BASE_CONFIG,
  addKey,
  createDevices,
  createWorld,
  keyDevice,
  serverDevice,
} from './helpers/world.js';

async function world(t, options = {}) {
  const created = await createWorld(options);
  t.after(() => created.app.stop());
  return created;
}

const WRITE = { ...BASE_CONFIG, allow_write: true, publish_channels: 'home:events' };

test('writing is refused until allowed in the configuration', async (t) => {
  const w = await world(t);
  await addKey(w, { key: 'visits' });
  const ack = await w.fake.sceneAction('set_value', {
    device: keyDevice(w.gladys, 'visits'),
    value: '1',
  });
  assert.equal(ack.success, false);
  assert.match(ack.error, /Writing is off/);
  assert.equal(w.redis.data.get('visits').value, '41');
});

test('write, with an expiry, a string and a hash field; the device follows', async (t) => {
  const w = await world(t, { config: WRITE });
  await addKey(w, { key: 'alarm:state' });
  await addKey(w, { key: 'meter:linky', field: 'power' });
  await createDevices(w);
  const commands = w.redis.commands.length;
  let ack = await w.fake.sceneAction('set_value', {
    device: keyDevice(w.gladys, 'alarm:state'),
    value: 'disarmed',
    expire_seconds: 60,
  });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(w.redis.commands[commands], ['SET', 'alarm:state', 'disarmed', 'EX', '60']);
  assert.equal(
    w.fake.lastState(
      w.fake.discoveredDevices.find((d) => d.name === 'alarm:state').features[0].external_id,
    ),
    'disarmed',
  );

  ack = await w.fake.sceneAction('set_value', {
    device: keyDevice(w.gladys, 'meter:linky', 'power'),
    value: '900',
  });
  assert.equal(ack.success, true, ack.error);
  assert.equal(w.redis.data.get('meter:linky').value.get('power'), '900');

  ack = await w.fake.sceneAction('set_value', {
    device: keyDevice(w.gladys, 'alarm:state'),
    value: 'x',
    expire_seconds: 1.5,
  });
  assert.match(ack.error, /whole number of seconds/);
});

test('only the keys followed are written, never a list or the server', async (t) => {
  const w = await world(t, { config: WRITE });
  await addKey(w, { key: 'queue:jobs' });
  let ack = await w.fake.sceneAction('set_value', {
    device: keyDevice(w.gladys, 'queue:jobs'),
    value: 'x',
  });
  assert.match(ack.error, /only a string or a hash field/);
  ack = await w.fake.sceneAction('set_value', { device: serverDevice(w.gladys), value: 'x' });
  assert.match(ack.error, /Choose a key device/);
  ack = await w.fake.sceneAction('set_value', {
    device: keyDevice(w.gladys, 'not:followed'),
    value: 'x',
  });
  assert.match(ack.error, /Choose a key device/);
  assert.equal(w.redis.data.get('queue:jobs').type, 'list');
});

test('increment returns the new value, comma decimals accepted', async (t) => {
  const w = await world(t, { config: { ...WRITE, language: 'fr' } });
  await addKey(w, { key: 'visits' });
  await addKey(w, { key: 'meter:linky', field: 'energy' });
  let ack = await w.fake.sceneAction('increment', { device: keyDevice(w.gladys, 'visits') });
  assert.deepEqual(ack.data.outputs, { value: 42 });
  ack = await w.fake.sceneAction('increment', {
    device: keyDevice(w.gladys, 'meter:linky', 'energy'),
    by: '0,4',
  });
  assert.deepEqual(ack.data.outputs, { value: 12346 });
  ack = await w.fake.sceneAction('increment', {
    device: keyDevice(w.gladys, 'visits'),
    by: 'deux',
  });
  assert.match(ack.error, /L'incrément n'est pas un nombre/);
  w.redis.set('visits', 'text');
  ack = await w.fake.sceneAction('increment', { device: keyDevice(w.gladys, 'visits') });
  assert.equal(ack.success, false);
});

test('publish only on the channels listed', async (t) => {
  const w = await world(t, { config: WRITE });
  let ack = await w.fake.sceneAction('publish', { channel: 'home:events', message: 'door open' });
  assert.deepEqual(ack.data.outputs, { receivers: 2 });
  assert.deepEqual(w.redis.published, [{ channel: 'home:events', message: 'door open' }]);
  ack = await w.fake.sceneAction('publish', { channel: 'other', message: 'x' });
  assert.match(ack.error, /not in "Channels allowed for publishing"/);
});

test('the widget: server row, one row per key, settings to choose and hide', async (t) => {
  const w = await world(t);
  const empty = await w.fake.widgetGet('values', { settings: {}, language: 'en' });
  assert.match(empty.data.content.components[0].text, /No key followed yet/);
  await addKey(w, { key: 'sensors:garage:temperature', type: 'temperature', name: 'Garage' });
  await addKey(w, { key: 'alarm:state' });
  await addKey(w, { key: 'nothing:here' });
  await createDevices(w);
  const ack = await w.fake.widgetGet('values', { settings: {}, language: 'fr' });
  assert.equal(ack.success, true, ack.error);
  const content = ack.data.content;
  validateWidgetContent(content);
  const rows = content.components.find((component) => component.type === 'status').items;
  assert.deepEqual(
    rows.map((row) => [row.label, row.value]),
    [
      ['Serveur', 'Redis 7.4.12'],
      ['alarm:state', 'armed'],
      ['Garage', '18,25 °C'],
      ['nothing:here', 'Aucune valeur'],
    ],
  );
  assert.ok(content.components.some((component) => component.type === 'button'));

  const chosen = await w.fake.widgetGet('values', {
    settings: {
      keys: [keyDevice(w.gladys, 'alarm:state')],
      show_server: false,
      show_refresh: false,
    },
    language: 'en',
  });
  assert.deepEqual(chosen.data.content.components, [
    {
      type: 'status',
      items: [{ label: 'alarm:state', value: 'armed', icon: 'type', color: 'info' }],
    },
  ]);

  const refreshed = await w.fake.widgetAction('values', 'refresh', {});
  assert.equal(refreshed.success, true, refreshed.error);

  w.redis.down = true;
  await w.hub.pollAll();
  const down = await w.fake.widgetGet('values', { settings: {}, language: 'en' });
  assert.equal(down.data.content.components[0].text, 'Redis: does not answer');
});
