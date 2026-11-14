# Redis

Your Redis (or Valkey) keys as Gladys sensors, and writes from your scenes: a
simple bridge between Gladys and the home scripts that already keep counters,
states or queues in Redis.

Tested against real Redis 7.4 and Valkey 8.1 (Docker), with and without a
password, with an ACL user, and with keyspace notifications. Feedback and bug
reports are welcome on
[GitHub](https://github.com/guim31/gladys-redis/issues).

## What you get

- **One device per key you add**: a string or a hash field gives its value (a
  number, or a text), a list, a set, a sorted set or a stream gives its length.
- **One device for the server**: reachable, version, memory used, connected
  clients, keys in the database.
- **Instant updates** with the keyspace notifications, if your server sends
  them; otherwise the keys are read at the interval you choose.
- **Scene actions** to write a value, increment a number and publish a message,
  off by default.
- A **scene trigger** when a key changes (written, deleted, expired…).
- A **dashboard widget** with the value of every key.

## Requirements

- Redis 6 or later, or Valkey, reachable from Gladys over the network (not
  `localhost`: the integration runs in its own container).
- Redis 6 or later is needed for an ACL user; with a plain `requirepass`, leave
  the user empty.

## Configuration

- **Address**: name or IP address of the server. `redis://host:port` and
  `rediss://host:port` (TLS) are accepted too, without credentials.
- **Port**, **Database number** (0 unless your scripts use `SELECT`).
- **User (ACL, optional)** and **Password (optional)**.
- **TLS connection**, and **Accept self-signed certificates** for a certificate
  of your own.
- **Refresh interval**: from 10 seconds to 10 minutes; each key costs two
  commands per read (`TYPE`, then the read itself).
- **Allow writing from scenes**: off by default; see Scenes.
- **Channels allowed for publishing**: the channels "Publish a Redis message"
  may use, separated by commas.
- **Language of the names and messages**: the names of the server features and
  the messages of the actions.

Then use **Test the connection**: it reads the server and every key, and says
what is wrong.

An ACL user only needs to read the keys you add. For example, read only:
`ACL SETUSER gladys on >password ~sensors:* +@read +info +dbsize +ping +hello +select +type`,
plus `+@write +publish &*` to write and publish from scenes, and `+subscribe` for
the notifications.

### Keyspace notifications

Tick **Follow keyspace notifications** to read a key as soon as it changes. The
integration subscribes to the exact channel of each key added (never a pattern)
but **never changes the server configuration**: the server must send them. For
example, in `redis.conf`: `notify-keyspace-events KA`, or at runtime:
`CONFIG SET notify-keyspace-events KA`. **Test the connection** says whether the
server sends them. The periodic read stays as a safety net.

## Adding keys

Gladys has no list field in a configuration form: the keys are added with the
**Add a key** action of the configuration page, and kept by the integration.

- **Key**: the exact name, e.g. `sensors:garage:temperature`. No pattern: the
  integration never scans the database.
- **Hash field (hash only)**: for a hash, the field to read, e.g. `power`.
- **Type in Gladys**: Automatic (number or text), Number, Temperature (°C),
  Humidity (%), Percentage (%), Power (W), Energy (kWh), Text. Automatic decides
  from the current value: a number, or text. A list, a set, a sorted set or a
  stream is read as its length.
- **Name (optional)**: the name of the device; the key by default.

The same key added again changes its name or its type (a new type is a new
feature: use "Update" in the Discover tab). **Remove a key** stops following a
key; its device stays in Gladys until you delete it. Up to 50 keys.

## Devices

Add the devices to follow from the **Discover** tab of the integration: the
server, and one device per key. The values are sent when they change, and again
every 6 hours when they do not. While the server does not answer, the key
devices show as unreachable and the "Reachable" feature of the server goes to 0.

## Scenes

### Triggers

**A Redis key changes**: a keyspace notification arrived for a key you follow.
Filters: the key (empty: any) and the Redis event (`set`, `del`, `expired`,
`incrbyfloat`, `hset`…, empty: any). Variables: the key, its name, the event
and the new value (empty if there is none). Needs the keyspace notifications
(see above). To act on a value (above a threshold…), use the key device in a
"Device state" trigger instead.

### Actions

Writing is refused until you tick **Allow writing from scenes**, and only
reaches the keys you follow: the scene picks a key device. A list, a set or a
stream is never overwritten.

- **Write a Redis value**: `SET` (or `HSET` for a hash field), with an optional
  expiry in seconds (on a hash, the expiry applies to the whole key). The value
  accepts the scene variables.
- **Increment a Redis value**: `INCRBYFLOAT` (or `HINCRBYFLOAT`), by 1 when
  empty, negative to decrement, a comma is accepted. Gives the new value.
- **Publish a Redis message**: `PUBLISH` on a channel listed in **Channels
  allowed for publishing**. Gives the number of subscribers reached.

## Dashboard

The **Redis values** widget lists the value of every key you follow (or the
ones chosen in its settings), a row for the server, and a **Refresh** button.
The settings can hide the server row and the button.

## Limits

- Strings, hash fields, lists, sets, sorted sets and streams; other types
  (modules such as RedisJSON) are not read.
- No Redis Cluster nor Sentinel: one server.
- A text is cut at 255 characters.

## Troubleshooting

- **"does not answer"**: check the address and the port, and that Redis listens
  on the network (`bind`, `protected-mode`), not only on `127.0.0.1`.
- **"access refused"**: check the user and the password; leave the user empty
  with a plain `requirepass`.
- **"refused by the ACL of the user"**: the ACL user cannot read this key or run
  this command (see Configuration).
- **No instant update**: the server does not send the keyspace notifications;
  **Test the connection** says so.
- More details with `LOG_LEVEL=debug` in the logs of the integration. Report a
  problem on [GitHub](https://github.com/guim31/gladys-redis/issues).

Redis is a trademark of Redis Ltd. This integration is not affiliated with
Redis Ltd nor with the Valkey project.
