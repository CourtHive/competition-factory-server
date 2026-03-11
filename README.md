<p align="center">
  <a href="http://courthive.com/" target="blank"><img src="./src/common/images/red-ch-logo.png" width="220" alt="CourtHive Logo" /></a>
</p>

  <p align="center">CourtHive is an Open Source / Open Data initiative to develop components to support the emergence of a standards based ecosystem of services for competition.</p>
    <p align="center">
<a href="https://www.npmjs.com/~tods-competition-factory" target="_blank"><img src="https://img.shields.io/npm/v/tods-competition-factory" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~tods-competition-factory" target="_blank"><img src="https://img.shields.io/npm/l/tods-competition-factory" alt="Package License" /></a>
<a href="https://www.npmjs.com/~tods-competition-factory" target="_blank"><img src="https://img.shields.io/npm/dm/tods-competition-factory" alt="NPM Downloads" /></a>
</p>

## Description

The **Competition Factory Server** is a production-ready backend for managing competitions across sports disciplines, built on [NestJS 11](https://nestjs.com/) and powered by the [tods-competition-factory](https://github.com/CourtHive/tods-competition-factory) engine. It is built on open data standards — specifically CODES (Competition Open Data Exchange Standards) — providing a vendor-neutral foundation for representing tournament structures, participants, draws, scheduling, and results across any sport.

The server provides a real-time WebSocket gateway (Socket.IO) for client-server mutation synchronization, a REST API for public competition data, pluggable storage backends (LevelDB or PostgreSQL), Redis-backed caching, JWT authentication with role-based access control, and per-tournament concurrency locks to prevent lost updates from interleaved mutations.

It is designed to work with the [TMX](https://github.com/CourtHive/TMX) tournament management client as its primary frontend, but can serve any client that speaks its WebSocket protocol or REST endpoints.

### Key Features

- **Standards-based** — Built on CODES (Competition Open Data Exchange Standards) for interoperability across sports and systems
- **Real-time mutation sync** — Server-first architecture ensures data consistency; clients apply mutations locally only after server acknowledgment
- **Pluggable storage** — Switch between LevelDB (default, zero-config) and PostgreSQL (JSONB) via a single environment variable
- **Role-based access control** — JWT authentication with hierarchical roles (superadmin, admin, client) and provider-scoped permissions
- **Per-tournament locking** — Async mutex with sorted acquisition prevents deadlocks and lost updates from concurrent requests
- **Provider multi-tenancy** — Organizations (providers) manage their own competitions, users, and calendars in isolation
- **Factory engine integration** — All competition business logic runs through the shared `tods-competition-factory`, ensuring consistency between client and server
- **Redis caching** — Published competition data, event data, and schedule info are cached for fast public access

## Documentation

Full setup instructions, architecture guides, and configuration reference are available in the interactive documentation:

**[https://courthive.github.io/competition-factory-server/](https://courthive.github.io/competition-factory-server/)**

The documentation covers:

- **Getting Started** — Prerequisites, installation, and environment configuration
- **Storage** — Pluggable storage architecture, LevelDB setup, PostgreSQL migration
- **Authentication** — Admin account creation, roles and permissions, JWT structure
- **Architecture** — Server modules, mutation flow, WebSocket gateway, provider configuration

## Quick Start

```bash
pnpm install
pnpm watch        # development server with hot reload
```

See the [full documentation](https://courthive.github.io/competition-factory-server/) for Redis setup, environment configuration, storage options, and user creation.

## Testing

```bash
pnpm test          # run all tests
pnpm test:watch    # watch mode
```

## Support

- Author - [Charles Allen](https://github.com/CourtHive)
- Website - [https://CourtHive.com](https://CourtHive.com/)

## License

The Competition Factory Server is [MIT licensed](LICENSE).
