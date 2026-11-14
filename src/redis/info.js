// -----------------------------------------------------------------------------
// The INFO answer of Redis or Valkey ("field:value" lines, "# Section"
// headers): the few figures the server device shows.
// -----------------------------------------------------------------------------

/**
 * @param {string} text
 * @returns {{ product: string, version: string|null, usedMemory: number|null, clients: number|null }}
 */
export function parseInfo(text) {
  const fields = new Map();
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const at = line.indexOf(':');
    if (at > 0 && !line.startsWith('#')) {
      fields.set(line.slice(0, at), line.slice(at + 1).trim());
    }
  }
  const number = (name) => {
    const value = Number(fields.get(name));
    return fields.has(name) && Number.isFinite(value) ? value : null;
  };
  // Valkey answers redis_version 7.2.4 for compatibility, and its own version apart.
  const valkey = fields.get('server_name') === 'valkey' || fields.has('valkey_version');
  const product = valkey ? 'Valkey' : 'Redis';
  const version =
    (valkey ? fields.get('valkey_version') : null) ?? fields.get('redis_version') ?? null;
  return {
    product,
    version,
    usedMemory: number('used_memory'),
    clients: number('connected_clients'),
  };
}

/** "Redis 7.4.1", "Valkey 8.1.1", or the product alone. */
export const productVersion = (info) =>
  info ? `${info.product}${info.version ? ` ${info.version}` : ''}` : 'Redis';
