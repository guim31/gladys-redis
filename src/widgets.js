// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `values`.
//
// The use case: a glance at what the home scripts keep in Redis (counters,
// states, queue lengths) without adding a tile per key. One row per key —
// its value, or why it has none — for every key followed, or the ones chosen
// in the widget settings (their devices); a row for the server, and a
// Refresh button, each with a setting to hide it.
//
// The values are sent as text, not bound to device features: the widget
// works before any device is added.
//
// Budget (8 components, 2 texts): one text while the server does not
// answer, one status list of ten rows at most, and a Refresh button.
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_UNITS as UNIT, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { parseKeyId } from './devices.js';
import { WIDGET_KEY } from './hub.js';
import { KEY_TYPES, keyName } from './keys.js';
import { productVersion } from './redis/info.js';
import { pick } from './texts.js';

// Action key of the button: permanent once published.
export const ACTIONS = Object.freeze({ REFRESH: 'refresh' });

export const MAX_ROWS = 10;

export const TEXT = {
  configure: {
    en: 'Enter the address of your Redis server in the configuration of the integration.',
    fr: "Saisissez l'adresse de votre serveur Redis dans la configuration de l'intégration.",
    de: 'Gib die Adresse deines Redis-Servers in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección de su servidor Redis en la configuración de la integración.',
  },
  noKey: {
    en: 'No key followed yet: use "Add a key" in the configuration of the integration.',
    fr: "Aucune clé suivie : utilisez « Ajouter une clé » dans la configuration de l'intégration.",
    de: 'Noch kein Schlüssel verfolgt: Nutze „Schlüssel hinzufügen“ in der Konfiguration der Integration.',
    es: 'Ninguna clave seguida: use «Añadir una clave» en la configuración de la integración.',
  },
  server: { en: 'Server', fr: 'Serveur', de: 'Server', es: 'Servidor' },
  noValue: { en: 'No value', fr: 'Aucune valeur', de: 'Kein Wert', es: 'Sin valor' },
  error: { en: 'Error', fr: 'Erreur', de: 'Fehler', es: 'Error' },
  more: { en: 'Others', fr: 'Autres', de: 'Weitere', es: 'Otras' },
  refresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
  refreshed: {
    en: 'Values read again.',
    fr: 'Valeurs relues.',
    de: 'Werte neu gelesen.',
    es: 'Valores leídos de nuevo.',
  },
};

const UNIT_SYMBOLS = {
  [UNIT.CELSIUS]: ' °C',
  [UNIT.PERCENT]: ' %',
  [UNIT.WATT]: ' W',
  [UNIT.KILOWATT_HOUR]: ' kWh',
};

const ICONS = {
  number: 'hash',
  temperature: 'thermometer',
  humidity: 'droplet',
  percent: 'percent',
  power: 'zap',
  energy: 'battery-charging',
  text: 'type',
};

const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const shown = (value) => value !== false && value !== 'false';

/** A value as shown: "21.5 °C", with the decimal separator of the language. */
export function formatValue(type, value, language) {
  if (typeof value !== 'number') {
    return String(value);
  }
  const text = new Intl.NumberFormat(language, { maximumFractionDigits: 2 }).format(value);
  return `${text}${UNIT_SYMBOLS[KEY_TYPES[type].unit] ?? ''}`;
}

/** The name of a key's device in Gladys (renamed by the user), else its own. */
function deviceName(hub, spec) {
  const device = (hub.gladys.devices ?? []).find(
    (entry) => parseKeyId(hub.gladys, entry.external_id) === spec.id,
  );
  return device?.name || keyName(spec);
}

/** The keys the widget shows: the chosen devices, or every key. */
export function chosenKeys(hub, settings) {
  const chosen = [settings?.keys ?? []].flat().filter((id) => typeof id === 'string' && id);
  const all = [...hub.keys.values()].sort((a, b) => keyName(a).localeCompare(keyName(b)));
  if (chosen.length === 0) {
    return all;
  }
  // A chosen device whose key was removed shows nothing, not every key.
  const ids = new Set(chosen.map((id) => parseKeyId(hub.gladys, id) ?? id));
  return all.filter((spec) => ids.has(spec.id));
}

function keyRow(hub, spec, language) {
  const label = fit(deviceName(hub, spec), 40);
  const reading = hub.readings.get(spec.id);
  if (reading?.error) {
    return {
      label,
      value: pick(TEXT.error, language),
      icon: 'alert-triangle',
      color: WIDGET_COLORS.DANGER,
    };
  }
  const value = hub.displayValue(spec);
  if (value === null) {
    return {
      label,
      value: pick(TEXT.noValue, language),
      icon: 'minus-circle',
      color: WIDGET_COLORS.NEUTRAL,
    };
  }
  return {
    label,
    value: fit(formatValue(spec.type, value, language), 40),
    icon: ICONS[spec.type],
    color: WIDGET_COLORS.INFO,
  };
}

async function get(hub, { settings, language = 'en' }) {
  if (!hub.connection) {
    return {
      ttl_seconds: 300,
      components: [{ type: 'text', variant: 'body', text: pick(TEXT.configure, language) }],
    };
  }
  const components = [];
  const errorText = hub.errorText(language);
  if (errorText) {
    components.push({ type: 'text', variant: 'body', text: fit(errorText, 200) });
  } else if (hub.keys.size === 0) {
    components.push({ type: 'text', variant: 'body', text: pick(TEXT.noKey, language) });
  }
  const rows = [];
  if (shown(settings?.show_server) && hub.info && !hub.error) {
    rows.push({
      label: pick(TEXT.server, language),
      value: fit(productVersion(hub.info), 40),
      icon: 'server',
      color: WIDGET_COLORS.SUCCESS,
    });
  }
  const keyRows = chosenKeys(hub, settings).map((spec) => keyRow(hub, spec, language));
  const room = MAX_ROWS - rows.length;
  if (keyRows.length > room) {
    rows.push(...keyRows.slice(0, room - 1), {
      label: pick(TEXT.more, language),
      value: `+${keyRows.length - room + 1}`,
      icon: 'more-horizontal',
      color: WIDGET_COLORS.NEUTRAL,
    });
  } else {
    rows.push(...keyRows);
  }
  if (rows.length > 0) {
    components.push({ type: 'status', items: rows });
  }
  if (shown(settings?.show_refresh)) {
    components.push({
      type: 'button',
      label: pick(TEXT.refresh, language),
      icon: 'refresh-cw',
      style: 'secondary',
      action: { key: ACTIONS.REFRESH },
    });
  }
  const intervalSeconds = Math.round((hub.config?.pollIntervalMs ?? 60_000) / 1000);
  return { ttl_seconds: Math.min(300, Math.max(10, intervalSeconds)), components };
}

async function action(hub, { actionKey }) {
  if (actionKey !== ACTIONS.REFRESH) {
    throw new Error(`Unknown action ${actionKey}`);
  }
  await hub.pollAll({ fresh: true });
  return { message: TEXT.refreshed };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
