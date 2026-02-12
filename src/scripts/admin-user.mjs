/**
 * Admin User Management Script
 *
 * List, create, and reset admin users in LevelDB or PostgreSQL.
 *
 * Prerequisites:
 *   - LevelDB: net-level-server running, DB_* vars in .env
 *   - PostgreSQL: PG_* vars in .env, schema applied
 *
 * Usage:
 *   node src/scripts/admin-user.mjs <command> [options]
 *
 * Commands:
 *   list                           List all users with their roles
 *   create --email <e> --password <p> [--provider-id <id>]
 *                                  Create a new superadmin user
 *   reset-password --email <e> --password <p>
 *                                  Reset an existing user's password
 *   set-roles --email <e> --roles superadmin,admin,client
 *                                  Set roles for an existing user
 *
 * Options:
 *   --storage <leveldb|postgres>   Storage backend (default: from STORAGE_PROVIDER env or 'leveldb')
 */

import minimist from 'minimist';
import bcrypt from 'bcryptjs';
import 'dotenv/config';

// Filter out bare '--' so that `pnpm admin:foo -- -e x` works the same as `node script.mjs foo -e x`
const rawArgs = process.argv.slice(2).filter((arg) => arg !== '--');
const args = minimist(rawArgs, {
  string: ['email', 'password', 'provider-id', 'roles', 'storage'],
  alias: { e: 'email', p: 'password', r: 'roles', s: 'storage' },
});

const command = args._[0];
const storageType = args.storage || process.env.STORAGE_PROVIDER || 'leveldb';

// ─── Helpers ────────────────────────────────────────────────────────

async function hashPassword(plain) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(plain, salt);
}

function printUser(user, email) {
  const displayEmail = email || user?.email || user?.key || '(unknown)';
  const roles = user?.roles || user?.value?.roles || [];
  const providerId = user?.providerId || user?.value?.providerId || '';
  const hasPassword = !!(user?.password || user?.value?.password);
  console.log(
    `  ${displayEmail.padEnd(35)} roles: [${roles.join(', ')}]${providerId ? `  provider: ${providerId}` : ''}${hasPassword ? '' : '  (no password!)'}`,
  );
}

function usage() {
  console.log(`
Admin User Management

Usage:
  node src/scripts/admin-user.mjs <command> [options]

Commands:
  list                                         List all users
  create  -e <email> -p <password> [--provider-id <id>]   Create superadmin
  reset-password  -e <email> -p <password>     Reset password
  set-roles  -e <email> -r <roles>             Set roles (comma-separated)

Options:
  --storage <leveldb|postgres>    Override STORAGE_PROVIDER

Examples:
  node src/scripts/admin-user.mjs list
  node src/scripts/admin-user.mjs create -e admin@courthive.com -p mysecurepassword
  node src/scripts/admin-user.mjs reset-password -e admin@courthive.com -p newpassword
  node src/scripts/admin-user.mjs set-roles -e admin@courthive.com -r superadmin,admin,client
`);
}

// ─── LevelDB Backend ───────────────────────────────────────────────

async function getLevelDbBackend() {
  const { default: netLevel } = await import('./netLevel.mjs');
  const BASE_USER = 'user';

  return {
    async listUsers() {
      try {
        return await netLevel.list(BASE_USER, { all: true });
      } catch {
        return [];
      }
    },

    async getUser(email) {
      try {
        return await netLevel.get(BASE_USER, { key: email });
      } catch {
        return null;
      }
    },

    async saveUser(email, userData) {
      await netLevel.set(BASE_USER, { key: email, value: userData });
    },

    async close() {
      try {
        await netLevel.exit();
      } catch {
        // ignore
      }
    },
  };
}

// ─── PostgreSQL Backend ─────────────────────────────────────────────

async function getPostgresBackend() {
  const pg = await import('pg');
  const { Pool } = pg.default || pg;

  const pool = new Pool({
    host: process.env.PG_HOST || 'localhost',
    port: Number(process.env.PG_PORT) || 5432,
    user: process.env.PG_USER || 'courthive',
    password: process.env.PG_PASSWORD || '',
    database: process.env.PG_DATABASE || 'courthive',
  });

  return {
    async listUsers() {
      const result = await pool.query(
        'SELECT email, password, provider_id, roles, permissions, data FROM users ORDER BY email',
      );
      return result.rows.map((row) => ({
        key: row.email,
        value: {
          email: row.email,
          password: row.password,
          providerId: row.provider_id,
          roles: row.roles || [],
          permissions: row.permissions || [],
          ...row.data,
        },
      }));
    },

    async getUser(email) {
      const result = await pool.query(
        'SELECT email, password, provider_id, roles, permissions, data FROM users WHERE email = $1',
        [email],
      );
      if (!result.rows.length) return null;
      const row = result.rows[0];
      return {
        email: row.email,
        password: row.password,
        providerId: row.provider_id,
        roles: row.roles || [],
        permissions: row.permissions || [],
        ...row.data,
      };
    },

    async saveUser(email, userData) {
      const { password, providerId, roles = [], permissions = [], ...rest } = userData;
      await pool.query(
        `INSERT INTO users (email, password, provider_id, roles, permissions, data, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (email) DO UPDATE SET
           password = EXCLUDED.password,
           provider_id = EXCLUDED.provider_id,
           roles = EXCLUDED.roles,
           permissions = EXCLUDED.permissions,
           data = EXCLUDED.data,
           updated_at = NOW()`,
        [
          email,
          password || '',
          providerId ?? null,
          JSON.stringify(roles),
          JSON.stringify(permissions),
          JSON.stringify(rest),
        ],
      );
    },

    async close() {
      await pool.end();
    },
  };
}

// ─── Commands ───────────────────────────────────────────────────────

async function listUsers(backend) {
  const users = await backend.listUsers();
  if (!users?.length) {
    console.log('\n  No users found.\n');
    return;
  }

  console.log(`\n  ${users.length} user(s) found (storage: ${storageType}):\n`);
  for (const record of users) {
    const user = record.value || record;
    printUser(user, record.key);
  }
  console.log();
}

async function createUser(backend) {
  const { email, password } = args;
  const providerId = args['provider-id'];

  if (!email || !password) {
    console.error('\n  Error: --email and --password are required\n');
    usage();
    process.exit(1);
  }

  const existing = await backend.getUser(email);
  if (existing) {
    console.error(`\n  Error: User "${email}" already exists.`);
    console.error('  Use "reset-password" to change their password or "set-roles" to change roles.\n');
    process.exit(1);
  }

  const hashedPassword = await hashPassword(password);
  const userData = {
    email,
    password: hashedPassword,
    roles: ['superadmin', 'admin', 'client'],
    permissions: [],
    ...(providerId ? { providerId } : {}),
  };

  await backend.saveUser(email, userData);
  console.log(`\n  Created superadmin user: ${email}`);
  console.log(`  Roles: [superadmin, admin, client]`);
  if (providerId) console.log(`  Provider: ${providerId}`);
  console.log();
}

async function resetPassword(backend) {
  const { email, password } = args;

  if (!email || !password) {
    console.error('\n  Error: --email and --password are required\n');
    usage();
    process.exit(1);
  }

  const existing = await backend.getUser(email);
  if (!existing) {
    console.error(`\n  Error: User "${email}" not found.\n`);
    process.exit(1);
  }

  const hashedPassword = await hashPassword(password);
  const updatedUser = { ...existing, password: hashedPassword };
  await backend.saveUser(email, updatedUser);
  console.log(`\n  Password reset for: ${email}\n`);
}

async function setRoles(backend) {
  const { email, roles: rolesStr } = args;

  if (!email || !rolesStr) {
    console.error('\n  Error: --email and --roles are required\n');
    usage();
    process.exit(1);
  }

  const existing = await backend.getUser(email);
  if (!existing) {
    console.error(`\n  Error: User "${email}" not found.\n`);
    process.exit(1);
  }

  const validRoles = ['superadmin', 'admin', 'developer', 'client', 'score', 'generate'];
  const roles = rolesStr.split(',').map((r) => r.trim().toLowerCase());
  const invalid = roles.filter((r) => !validRoles.includes(r));
  if (invalid.length) {
    console.error(`\n  Error: Invalid role(s): ${invalid.join(', ')}`);
    console.error(`  Valid roles: ${validRoles.join(', ')}\n`);
    process.exit(1);
  }

  const updatedUser = { ...existing, roles };
  await backend.saveUser(email, updatedUser);
  console.log(`\n  Roles updated for ${email}: [${roles.join(', ')}]\n`);
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  if (!command || command === 'help') {
    usage();
    process.exit(0);
  }

  let backend;
  try {
    if (storageType === 'postgres') {
      backend = await getPostgresBackend();
    } else {
      backend = await getLevelDbBackend();
    }
  } catch (err) {
    console.error(`\n  Failed to connect to ${storageType}:`, err.message);
    console.error('  Check your .env configuration and ensure the database is running.\n');
    process.exit(1);
  }

  try {
    switch (command) {
      case 'list':
        await listUsers(backend);
        break;
      case 'create':
        await createUser(backend);
        break;
      case 'reset-password':
        await resetPassword(backend);
        break;
      case 'set-roles':
        await setRoles(backend);
        break;
      default:
        console.error(`\n  Unknown command: ${command}\n`);
        usage();
        process.exit(1);
    }
  } finally {
    await backend.close();
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
