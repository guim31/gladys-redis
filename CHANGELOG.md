# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Redis and Valkey keys as Gladys sensors, added with "Add a key": a string or
  a hash field gives its value (number or text), a list, a set, a sorted set or
  a stream its length; types number, temperature, humidity, percentage, power,
  energy, text, or automatic.
- A server device: reachable, version, memory used, connected clients, keys in
  the database.
- Reads every 10 seconds to 10 minutes, and at once on a keyspace notification
  when the server sends them.
- Scene trigger "A Redis key changes" (key, Redis event).
- Scene actions "Write a Redis value" (optional expiry), "Increment a Redis
  value" and "Publish a Redis message", off by default and limited to the keys
  followed and the channels listed.
- Dashboard widget "Redis values".
- Password, ACL user, TLS and database number; texts and documentation in
  English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-redis/commits/main
