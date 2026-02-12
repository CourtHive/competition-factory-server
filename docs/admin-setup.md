# Admin Account Setup & Recovery

## Quick Reference

```bash
# List all users
pnpm admin:list

# Create a new superadmin
pnpm admin:create -e admin@example.com -p yourpassword

# Reset a forgotten password
pnpm admin:reset-password -e admin@example.com -p newpassword
```

## Prerequisites

The LevelDB server must be running:

```bash
pnpm hive-db
```

If you're using PostgreSQL, add `--storage postgres` (or set `STORAGE_PROVIDER=postgres` in `.env`).

---

## First-Time Setup

### 1. Start the database

```bash
pnpm hive-db
```

### 2. Create your admin account

```bash
node src/scripts/admin-user.mjs create \
  --email admin@yourorg.com \
  --password your-secure-password
```

This creates a user with roles `[superadmin, admin, client]` — full access to all server features.

### 3. (Optional) Associate with a provider

If you've already created a provider (organization), pass its ID:

```bash
node src/scripts/admin-user.mjs create \
  --email admin@yourorg.com \
  --password your-secure-password \
  --provider-id your-provider-uuid
```

### 4. Start the server and log in

```bash
pnpm watch
```

Log in via the API or client using the email and password you just created.

---

## Development Mode

When `APP_MODE=development` in `.env`, a hardcoded test user is available without needing any database entry:

| Email             | Password | Roles                                       |
| ----------------- | -------- | ------------------------------------------- |
| `axel@castle.com` | `castle` | superadmin, admin, developer, client, score |

This user only works in development mode and is checked before the database lookup, so it cannot be overridden.

---

## Password Recovery

If you've forgotten a user's password:

```bash
# 1. Verify the user exists
node src/scripts/admin-user.mjs list

# 2. Reset their password
node src/scripts/admin-user.mjs reset-password \
  --email admin@yourorg.com \
  --password new-secure-password
```

Passwords are stored as bcrypt hashes (10 salt rounds). The sign-in flow accepts both plain-text comparison and bcrypt verification, but the script always stores bcrypt-hashed passwords.

---

## Managing Roles

Available roles:

| Role         | Purpose                                         |
| ------------ | ----------------------------------------------- |
| `superadmin` | Full access — manage users, providers, all data |
| `admin`      | Provider-level administration                   |
| `client`     | Tournament management (mutations, fetch, save)  |
| `developer`  | Development features                            |
| `score`      | Score entry (setMatchUpStatus)                  |
| `generate`   | Generate tournament records                     |

To change a user's roles:

```bash
node src/scripts/admin-user.mjs set-roles \
  --email user@example.com \
  --roles superadmin,admin,client
```

---

## Full CLI Reference

```text
node src/scripts/admin-user.mjs <command> [options]

Commands:
  list                                    List all users with roles
  create   -e <email> -p <password>       Create a superadmin user
           [--provider-id <id>]
  reset-password  -e <email> -p <password>  Reset password
  set-roles  -e <email> -r <roles>        Set roles (comma-separated)

Options:
  --storage <leveldb|postgres>     Override STORAGE_PROVIDER
  -e, --email                      User email address
  -p, --password                   Password (plain text, will be hashed)
  -r, --roles                      Comma-separated role list
  --provider-id                    Provider/organization ID
```

### Examples

```bash
# List users in PostgreSQL
node src/scripts/admin-user.mjs list --storage postgres

# Create admin with specific roles
node src/scripts/admin-user.mjs create -e ops@courthive.com -p secret123

# Reset password
node src/scripts/admin-user.mjs reset-password -e ops@courthive.com -p newsecret

# Demote to client-only
node src/scripts/admin-user.mjs set-roles -e ops@courthive.com -r client,score
```

---

## Troubleshooting

**"Failed to connect to leveldb"**

- Make sure `pnpm hive-db` is running in another terminal
- Check `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS` in `.env`

**"Failed to connect to postgres"**

- Check `PG_HOST`, `PG_PORT`, `PG_USER`, `PG_PASSWORD`, `PG_DATABASE` in `.env`
- Make sure the PostgreSQL server is running and the database exists

**"User already exists" when creating**

- Use `reset-password` to change the password instead
- Use `set-roles` to change their roles

**Can't log in after creating a user**

- Run `list` to verify the user exists and has the correct roles
- Make sure you're hitting the right server (check `APP_PORT` in `.env`)
- In development mode, the test user `axel@castle.com` / `castle` always works
