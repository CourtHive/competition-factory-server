import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';

import { CachedPersonFields, IUserStorage, UserPersonLink } from '../interfaces/user-storage.interface';
import { PG_POOL } from './postgres.config';
import { SUCCESS } from 'src/common/constants/app';

@Injectable()
export class PostgresUserStorage implements IUserStorage {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async findOne(email: string): Promise<any | null> {
    const result = await this.pool.query(
      'SELECT user_id, email, password, provider_id, last_selected_provider_id, must_change_password, contact_email, email_verified_at, roles, permissions, data, standard_given_name, standard_family_name FROM users WHERE email = $1',
      [email],
    );
    if (!result.rows.length) return null;
    const row = result.rows[0];
    return {
      userId: row.user_id,
      email: row.email,
      password: row.password,
      providerId: row.provider_id,
      lastSelectedProviderId: row.last_selected_provider_id,
      mustChangePassword: row.must_change_password,
      contactEmail: row.contact_email,
      emailVerifiedAt: row.email_verified_at,
      roles: row.roles,
      permissions: row.permissions,
      ...row.data,
      // Coalesce HiveID-cached canonical names (written by setPersonLink) into
      // the legacy firstName/lastName surface so admin UI + email templates
      // see a populated name for HiveID-linked users who never had names
      // written through the JSON-blob path. Explicit `data.firstName` /
      // `data.lastName` win when present so admin edits aren't shadowed.
      firstName: row.data?.firstName ?? row.standard_given_name ?? undefined,
      lastName: row.data?.lastName ?? row.standard_family_name ?? undefined,
    };
  }

  async findByContactEmail(contactEmail: string): Promise<any | null> {
    const result = await this.pool.query(
      `SELECT user_id, email, password, provider_id, last_selected_provider_id, must_change_password, contact_email, email_verified_at, roles, permissions, data, standard_given_name, standard_family_name
         FROM users
        WHERE LOWER(contact_email) = LOWER($1)
        LIMIT 1`,
      [contactEmail],
    );
    if (!result.rows.length) return null;
    const row = result.rows[0];
    return {
      userId: row.user_id,
      email: row.email,
      password: row.password,
      providerId: row.provider_id,
      lastSelectedProviderId: row.last_selected_provider_id,
      mustChangePassword: row.must_change_password,
      contactEmail: row.contact_email,
      emailVerifiedAt: row.email_verified_at,
      roles: row.roles,
      permissions: row.permissions,
      ...row.data,
      firstName: row.data?.firstName ?? row.standard_given_name ?? undefined,
      lastName: row.data?.lastName ?? row.standard_family_name ?? undefined,
    };
  }

  async create(user: { email: string; password: string; [key: string]: any }): Promise<any> {
    const { email, password, providerId, roles = [], permissions = [], mustChangePassword, ...rest } = user;
    await this.pool.query(
      `INSERT INTO users (email, password, provider_id, roles, permissions, must_change_password, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (email) DO UPDATE SET
         password = EXCLUDED.password,
         provider_id = EXCLUDED.provider_id,
         roles = EXCLUDED.roles,
         permissions = EXCLUDED.permissions,
         must_change_password = EXCLUDED.must_change_password,
         data = EXCLUDED.data,
         updated_at = NOW()`,
      [
        email,
        password,
        providerId ?? null,
        JSON.stringify(roles),
        JSON.stringify(permissions),
        Boolean(mustChangePassword),
        JSON.stringify(rest),
      ],
    );
    return user;
  }

  async update(email: string, data: any): Promise<{ success: boolean }> {
    const { password, providerId, roles = [], permissions = [], mustChangePassword, ...rest } = data;
    await this.pool.query(
      `UPDATE users SET password = $2, provider_id = $3, roles = $4, permissions = $5, must_change_password = $6, data = $7, updated_at = NOW()
       WHERE email = $1`,
      [
        email,
        password,
        providerId ?? null,
        JSON.stringify(roles),
        JSON.stringify(permissions),
        Boolean(mustChangePassword),
        JSON.stringify(rest),
      ],
    );
    return { ...SUCCESS };
  }

  async completeFirstLogin(email: string, hashedPassword: string): Promise<{ success: boolean }> {
    await this.pool.query(
      `UPDATE users
          SET password = $2,
              must_change_password = FALSE,
              updated_at = NOW()
        WHERE email = $1`,
      [email, hashedPassword],
    );
    return { ...SUCCESS };
  }

  async setContactEmail(userId: string, contactEmail: string): Promise<{ success: boolean }> {
    // Atomic one-query write: stamps the new contact_email and (importantly)
    // CLEARS email_verified_at so an already-verified user changing their
    // contact email has to verify again. Without the clear, a malicious
    // user could swap their contact email after a stolen session and gain
    // a verified channel they don't own.
    await this.pool.query(
      `UPDATE users
          SET contact_email = $2,
              email_verified_at = NULL,
              updated_at = NOW()
        WHERE user_id = $1`,
      [userId, contactEmail],
    );
    return { ...SUCCESS };
  }

  async markEmailVerified(userId: string): Promise<{ success: boolean }> {
    await this.pool.query(
      `UPDATE users
          SET email_verified_at = NOW(),
              updated_at = NOW()
        WHERE user_id = $1`,
      [userId],
    );
    return { ...SUCCESS };
  }

  async findByUserId(userId: string): Promise<any | null> {
    const result = await this.pool.query(
      `SELECT user_id, email, password, provider_id, last_selected_provider_id, must_change_password, contact_email, email_verified_at, roles, permissions, data
         FROM users
        WHERE user_id = $1
        LIMIT 1`,
      [userId],
    );
    if (!result.rows.length) return null;
    const row = result.rows[0];
    return {
      userId: row.user_id,
      email: row.email,
      password: row.password,
      providerId: row.provider_id,
      lastSelectedProviderId: row.last_selected_provider_id,
      mustChangePassword: row.must_change_password,
      contactEmail: row.contact_email,
      emailVerifiedAt: row.email_verified_at,
      roles: row.roles,
      permissions: row.permissions,
      ...row.data,
    };
  }

  async getContactEmailCoverage(): Promise<{
    total: number;
    missing: number;
    equalsLogin: number;
    verified: number;
    unverified: number;
  }> {
    // Single round-trip aggregate. equalsLogin uses LOWER(...) comparison
    // because login emails are stored case-insensitive-equivalent (the
    // findOne/findByContactEmail paths already normalize that way).
    const result = await this.pool.query<{
      total: string;
      missing: string;
      equals_login: string;
      verified: string;
      unverified: string;
    }>(
      `SELECT
         COUNT(*)::text AS total,
         COUNT(*) FILTER (WHERE contact_email IS NULL OR contact_email = '')::text AS missing,
         COUNT(*) FILTER (WHERE contact_email IS NOT NULL AND LOWER(contact_email) = LOWER(email))::text AS equals_login,
         COUNT(*) FILTER (WHERE contact_email IS NOT NULL AND contact_email <> '' AND email_verified_at IS NOT NULL)::text AS verified,
         COUNT(*) FILTER (WHERE contact_email IS NOT NULL AND contact_email <> '' AND email_verified_at IS NULL)::text AS unverified
         FROM users`,
    );
    const row = result.rows[0];
    return {
      total: Number(row?.total ?? 0),
      missing: Number(row?.missing ?? 0),
      equalsLogin: Number(row?.equals_login ?? 0),
      verified: Number(row?.verified ?? 0),
      unverified: Number(row?.unverified ?? 0),
    };
  }

  async setPasswordByUserId(userId: string, hashedPassword: string): Promise<{ success: boolean }> {
    // Single-query atomic password write. Also clears must_change_password
    // — a successful self-initiated password reset is a stronger signal
    // than the assigned-password state, so no need to force another change.
    await this.pool.query(
      `UPDATE users
          SET password = $2,
              must_change_password = FALSE,
              updated_at = NOW()
        WHERE user_id = $1`,
      [userId, hashedPassword],
    );
    return { ...SUCCESS };
  }

  async remove(email: string): Promise<{ success: boolean }> {
    await this.pool.query('DELETE FROM users WHERE email = $1', [email]);
    return { ...SUCCESS };
  }

  async findAll(): Promise<{ success: boolean; users?: any[]; message?: string }> {
    // LEFT JOIN user_providers so the admin UI can render multi-provider
    // associations without a follow-up round trip. `provider_ids` is in
    // addition to the legacy single `provider_id` column — both are kept
    // for now (Phase 5 of the multi-provider plan retires the legacy
    // column once all read paths have migrated).
    const result = await this.pool.query(`
      SELECT
        u.user_id,
        u.email,
        u.provider_id,
        u.roles,
        u.permissions,
        u.data,
        u.last_access,
        u.standard_given_name,
        u.standard_family_name,
        COALESCE(
          ARRAY_AGG(up.provider_id ORDER BY up.created_at) FILTER (WHERE up.provider_id IS NOT NULL),
          ARRAY[]::TEXT[]
        ) AS provider_ids
      FROM users u
      LEFT JOIN user_providers up ON up.user_id = u.user_id
      GROUP BY u.user_id, u.email, u.provider_id, u.roles, u.permissions, u.data, u.last_access, u.standard_given_name, u.standard_family_name
    `);
    if (!result.rows.length) return { success: false, message: 'No users found' };
    // Spread `data` first so canonical column-derived fields win on conflict.
    // Identical bug to provider storage: a stale `data.lastAccess` migrated
    // from the LevelDB-era record body would otherwise shadow the column.
    const users = result.rows.map((row) => ({
      key: row.email,
      value: {
        ...row.data,
        userId: row.user_id,
        email: row.email,
        providerId: row.provider_id,
        providerIds: row.provider_ids,
        roles: row.roles,
        permissions: row.permissions,
        lastAccess: row.last_access,
        // Same coalesce as findOne — see comment there.
        firstName: row.data?.firstName ?? row.standard_given_name ?? undefined,
        lastName: row.data?.lastName ?? row.standard_family_name ?? undefined,
      },
    }));
    return { ...SUCCESS, users };
  }

  async updateLastAccess(email: string): Promise<void> {
    await this.pool.query('UPDATE users SET last_access = NOW() WHERE email = $1', [email]);
  }

  async updateLastSelectedProviderId(
    email: string,
    providerId: string | null,
  ): Promise<{ success: boolean }> {
    await this.pool.query(
      'UPDATE users SET last_selected_provider_id = $2 WHERE email = $1',
      [email, providerId],
    );
    return { ...SUCCESS };
  }

  async setPersonLink(
    userId: string,
    args: { personId: string; personRevision: number; cached: CachedPersonFields },
  ): Promise<{ success: boolean }> {
    // Atomic one-query write: stamps person_id + person_revision + the five
    // cached canonical fields together. The logical FK to
    // courthive-persons.persons.person_id is validated at the caller
    // (PersonsClient.resolve must have returned this personId); Postgres
    // cannot enforce it because persons lives in a separate database per
    // the Option-A decision 2026-05-30.
    await this.pool.query(
      `UPDATE users
          SET person_id = $2,
              person_revision = $3,
              standard_family_name = $4,
              standard_given_name = $5,
              birth_date = $6,
              sex = $7,
              nationality_code = $8,
              updated_at = NOW()
        WHERE user_id = $1`,
      [
        userId,
        args.personId,
        args.personRevision,
        args.cached.standardFamilyName ?? null,
        args.cached.standardGivenName ?? null,
        args.cached.birthDate ?? null,
        args.cached.sex ?? null,
        args.cached.nationalityCode ?? null,
      ],
    );
    return { ...SUCCESS };
  }

  async getPersonLink(userId: string): Promise<UserPersonLink | null> {
    const result = await this.pool.query(
      `SELECT user_id, person_id, person_revision,
              standard_family_name, standard_given_name,
              birth_date, sex, nationality_code,
              consent_preferences
         FROM users
        WHERE user_id = $1
        LIMIT 1`,
      [userId],
    );
    if (!result.rows.length) return null;
    const row = result.rows[0];
    return {
      userId: row.user_id,
      personId: row.person_id,
      personRevision: row.person_revision,
      cached: {
        standardFamilyName: row.standard_family_name,
        standardGivenName: row.standard_given_name,
        birthDate: row.birth_date ? new Date(row.birth_date).toISOString().slice(0, 10) : null,
        sex: row.sex,
        nationalityCode: row.nationality_code,
      },
      consentPreferences: (row.consent_preferences as Record<string, unknown> | null) ?? {},
    };
  }

  async rewritePersonId(args: {
    fromPersonId: string;
    toPersonId: string;
    personRevision: number;
    cached: CachedPersonFields;
  }): Promise<{ rewrittenCount: number }> {
    // Called on every personMerged SSE event from courthive-persons.
    // Tolerant of zero hits (the merged human may not have a local user
    // row). Single UPDATE — fast even at higher merge volumes.
    const result = await this.pool.query(
      `UPDATE users
          SET person_id = $1,
              person_revision = $2,
              standard_family_name = $3,
              standard_given_name = $4,
              birth_date = $5,
              sex = $6,
              nationality_code = $7,
              updated_at = NOW()
        WHERE person_id = $8`,
      [
        args.toPersonId,
        args.personRevision,
        args.cached.standardFamilyName ?? null,
        args.cached.standardGivenName ?? null,
        args.cached.birthDate ?? null,
        args.cached.sex ?? null,
        args.cached.nationalityCode ?? null,
        args.fromPersonId,
      ],
    );
    return { rewrittenCount: result.rowCount ?? 0 };
  }
}
