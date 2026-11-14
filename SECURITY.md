# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Secrets**: the Redis password is a `secret` field of the Gladys
  configuration. The integration reads it from Gladys at startup, keeps it in
  memory, sends it only to the Redis server of the configuration, and never
  writes it to `/data` nor to the logs. An address with credentials inside
  (`redis://user:pass@…`) is refused, so that none ends up in a log line. An
  ACL user limited to the keys followed is recommended.
- **Stored in `/data`**: `redis-state.json`, the keys added by the user (key
  name, hash field, type, display name). No secret, no value.
- **Writes**: none unless the user ticks "Allow writing from scenes"; then only
  `SET`, `HSET`, `EXPIRE`, `INCRBYFLOAT` and `HINCRBYFLOAT` on the keys
  followed, and `PUBLISH` on the channels listed in the configuration. The
  integration never scans the database and never changes the server
  configuration.
- **Network**: one connection (two with the keyspace notifications) to the
  address of the configuration only, TLS on request.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and the Redis or Valkey server the integration talks to.
