# Redis for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) integration for
[Redis](https://redis.io) and [Valkey](https://valkey.io): the keys you choose
become Gladys sensors, and your scenes can write values, increment counters and
publish messages. A simple bridge between Gladys and the home scripts that
already keep counters, states or queues in Redis.

## Features

- **One device per key**, added with the **Add a key** action of the
  configuration (exact names, never a pattern: the database is never scanned):
  a string or a hash field gives its value, a list, a set, a sorted set or a
  stream its length. Types: automatic, number, temperature, humidity,
  percentage, power, energy or text.
- **One device for the server**: reachable, version, memory used, connected
  clients, keys in the database.
- **Keyspace notifications** (optional): a key is read as soon as it changes,
  when the server sends them; the integration never changes the server
  configuration. Otherwise, a read every 10 seconds to 10 minutes.
- **Scene trigger**: a Redis key changes (filters: the key, the Redis event
  such as `set` or `expired`).
- **Scene actions**: write a value (`SET`/`HSET`, optional expiry), increment
  (`INCRBYFLOAT`/`HINCRBYFLOAT`), publish a message (`PUBLISH`). Off by default,
  limited to the keys followed and to the channels listed in the configuration.
- **Widget**: the value of every key, or of the chosen ones, and the server.
- Password, ACL user, TLS (self-signed certificates on request), database
  number.
- Messages and documentation in English, French, German and Spanish.

## Requirements

- Gladys Assistant 5.1.0 or later.
- Redis 6 or later, or Valkey, reachable from Gladys over the network.

## Installation

In Gladys, open **Integrations → Install from GitHub** and enter
`https://github.com/guim31/gladys-redis`. Then fill in the configuration, add
your keys with **Add a key**, and add the devices from the **Discover** tab.

The user documentation is in [docs/en.md](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)).

## Checked on real servers

The integration ran in its locked container (read-only, no capability,
256 MB) against Redis 7.4.12 and Valkey 8.1.11 in Docker: strings, hash
fields, lists, a missing key, a password, an ACL user restricted to a key
prefix, a wrong password, a database out of range, an absent host, the keyspace
notifications (`set`, `expire`, `expired`) and the three scene actions. The
real `INFO` answers and error replies are the fixtures of the tests.

## Limitations

- One server: no Redis Cluster nor Sentinel.
- Other key types (modules such as RedisJSON) are not read.
- Up to 50 keys; a text is cut at 255 characters.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
```

The tests run against an in-memory Redis behind the node-redis API and the
SDK's fake Gladys; they never touch the network.

## Credits

- [node-redis](https://github.com/redis/node-redis) (`@redis/client`, MIT), the
  Redis client.
- Redis logo of the cover: Redis Ltd, public domain on
  [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Redis_logo.svg).

## Disclaimer

Redis is a trademark of Redis Ltd. This integration is not affiliated with
Redis Ltd nor with the Valkey project.

## License

[Apache-2.0](LICENSE)
