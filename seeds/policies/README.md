# Policy seeds

Seed JSON for the `policies` table — loaded by `PolicySeedLoader` on every CFS boot. Idempotent: each seed is upserted only if `(provider_id, policy_type, name, version)` is not already present and not soft-deleted.

## File layout

```
seeds/policies/
├── _global/               # rows with provider_id IS NULL — templates + shared demos
│   └── <name>-<version>.json
└── <providerId>/          # provider-scoped rows
    └── <name>-<version>.json
```

The directory under `seeds/policies/` does NOT determine `providerId` — each JSON file carries its own `providerId` field. Directories are organisational only; the loader walks all subdirectories.

## File shape

```json
{
  "providerId": null,
  "policyType": "rankingPoints",
  "name": "BASIC",
  "version": "1.0.0",
  "visibility": "TEMPLATE_REF",
  "definition": { "awardProfiles": [ ... ] },
  "metadata": { "source": "tods-competition-factory fixtures" }
}
```

Field constraints (validated at load):

| Field | Rule |
|---|---|
| `providerId` | `null` for global rows; otherwise a `providers.provider_id` row that already exists. FK violations log a warning and skip; the seed is reattempted on next boot. |
| `policyType` | Free-form string; `rankingPoints` is currently the only validated type. |
| `name` | `^[A-Z][A-Z0-9_]{1,63}$` — uppercase identifier, e.g. `USTA_JUNIOR_2026`. |
| `version` | Short semver or date-style — `1.0`, `1.0.0`, `2026.01`, `2026.01.05`, optional `-beta.1` suffix. |
| `visibility` | `PROVIDER_PRIVATE` (default for provider-owned), `SHARED_DEMO` (catalog), `TEMPLATE_REF` (canonical worked example). |
| `definition` | The inner policy object — for `rankingPoints` this is the `{ awardProfiles: [...], ... }` value (NOT wrapped in a `rankingPoints` key). |
| `metadata` | Optional. Free-form JSON for editor / catalog UIs. |

## Generating seeds from factory fixtures

```bash
node scripts/generate-policy-seeds.mjs            # write to _global/
node scripts/generate-policy-seeds.mjs --dry-run  # list what would write
node scripts/generate-policy-seeds.mjs --force    # overwrite existing
```

The script dumps every `POLICY_RANKING_POINTS_*` from `tods-competition-factory` into `_global/<lowercase-name>-<version>.json` with `providerId: null`, `visibility: TEMPLATE_REF`. Review each file, set the correct `providerId` and `visibility` per the deployment plan (see `Mentat/planning/POLICY_DELIVERY.md` open questions), then move into the appropriate subdirectory and commit.

## Lifecycle

| Action | Effect |
|---|---|
| New seed file committed | Loaded on next boot; upserted with a fresh UUID. |
| Existing seed edited | NOT re-applied — the existing row already has the same `(policyType, name, version)` tuple. To replay an edit, bump the `version`. |
| Seed removed from disk | Existing row stays in the DB (soft-delete via the API if you need to take it offline). |
| `providers` row missing for a `PROVIDER_PRIVATE` seed | Warned + skipped. Provision the provider, restart, seed loader retries automatically. |

## Note on coexistence with `provider_catalog_items`

The `policies` table is the **published delivery registry**: immutable per version, with visibility tiering. The pre-existing `provider_catalog_items` table (migration 021) is the **authoring workspace** that TMX's `/policies` page edits in place. A future "Publish version" UX action will copy from the catalog into the `policies` table with a fresh version stamp. The two stay decoupled — editing a catalog item does NOT change any already-delivered policy.
