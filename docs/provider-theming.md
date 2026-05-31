# Provider Theming

CourtHive ships as a single deployable bundle that can be visually re-skinned per provider at runtime. A tournament-management organization (ITA, USTA section, a school athletic conference, a private club federation, etc.) can plant its colors, fonts, logo, and — when needed — an entire stylesheet on the same TMX client and courthive-public viewer that every other provider uses, without a separate build.

This page covers the moving parts CFS owns: the validation contract on writes, the public lookup endpoint courthive-public consumes, and the admin UI for authoring the configuration.

## The two override surfaces

Every theming knob is one of two shapes on `ProviderBranding` (canonical type owned by `@courthive/provider-config`):

```ts
interface ProviderBranding {
  // logos / app identity
  appName?: string;
  navbarLogoUrl?: string;
  navbarLogoAlt?: string;
  navbarLogoHeight?: number;
  splashLogoUrl?: string;
  accentColor?: string;

  // theming — added in May 2026
  themeTokens?: Record<string, string>;
  stylesheetUrl?: string;
}
```

### `themeTokens` — CSS custom-property overrides

A flat map keyed on CSS custom-property names. Keys must start with one of two allowed prefixes:

| Prefix   | Surface                                     |
| -------- | ------------------------------------------- |
| `--tmx-` | TMX client                                  |
| `--chc-` | courthive-public + courthive-components     |

Values are CSS color / length / font strings — whatever the property accepts (`#15365d`, `1.05rem`, `'Inter', sans-serif`, etc.).

```ts
themeTokens: {
  '--tmx-accent-blue': '#15365d',
  '--tmx-fill-accent': '#15365d',
  '--tmx-status-info': '#15365d',
  '--chc-text-link': '#15365d',
}
```

At boot and on provider switch, the client writes these properties inline on `document.documentElement` and tracks which it wrote so a subsequent provider switch removes the prior set cleanly — bundled CSS defaults reassert themselves automatically.

### `stylesheetUrl` — full-CSS escape hatch

For theming that can't be expressed by overriding existing tokens — custom fonts loaded via `@font-face`, animations, layout tweaks, decorative pseudo-elements — the provider can host a stylesheet and point at it:

```ts
stylesheetUrl: 'https://acme.example.com/courthive-theme.css'
```

The client maintains a single `<link>` element appended to `<head>` and updates the `href` in place when the provider switches. Because it sits after the bundled stylesheets in the cascade, it overrides anything the bundle declares without `!important`.

This is the more powerful path and the riskier one. Provider stylesheets that target internal class names will break the next time those class names change. Prefer `themeTokens` when the goal can be expressed as a color or size.

## Server-side surface

### Validation on writes

The canonical validator lives in `@courthive/provider-config` and runs on every caps write. `ProvisionerService.updateProviderCaps` short-circuits and returns `{ code: 'CAPS_INVALID', issues: [...] }` if any `themeTokens` keys fall outside the allowed prefix set or any value isn't a string.

```ts
// src/modules/provisioner/provisioner.service.ts
async updateProviderCaps(providerId: string, caps: Record<string, any>) {
  const provider = await this.providerStorage.getProvider(providerId);
  if (!provider) return { error: 'Provider not found', code: 'PROVIDER_NOT_FOUND' };
  const issues = validateCaps(caps);
  if (issues.length) return { error: 'caps validation failed', code: 'CAPS_INVALID', issues };
  return this.providerStorage.updateProviderCaps(providerId, caps);
}
```

Example issues raised by the validator:

- `{ code: 'unknownField', path: 'branding.themeTokens.--malicious-var' }` — prefix outside the `--tmx-` / `--chc-` allowlist.
- `{ code: 'wrongType', path: 'branding.themeTokens.--tmx-accent-blue' }` — value not a string.
- `{ code: 'wrongType', path: 'branding.stylesheetUrl' }` — value not a string.

Regression test: `src/modules/provisioner/provisioner.service.themeTokens.spec.ts` pins the validate-then-write contract so a future refactor that drops the validation call turns the spec red.

### Public branding lookup

A `@Public()` endpoint resolves the owning provider of a tournament and returns **only** the branding slice of its effective config — permissions, policies, integrations, and participant-privacy settings never appear on the response:

```http
GET /provider/by-tournament/:tournamentId/branding
```

Resolution path:

```
tournamentId
  -> tournament_provisioner.provider_id
    -> providers.providerConfigCaps.branding
```

If the tournament has no provider mapping or the provider was deleted, the response is `{ success: true, branding: undefined }` and the viewer gracefully falls back to bundled defaults. The unit test for `getPublicBrandingByTournament` in `providers.service.config.spec.ts` asserts the no-leak guarantee: even when caps include permissions or settings include `participantPrivacy`, the response only carries the branding slice.

### Effective-config delivery to TMX

TMX receives the full effective config (caps ∩ settings, including `branding.themeTokens` and `branding.stylesheetUrl`) on login and on provider switch through:

```http
GET /provider/:providerId/effective-config
```

Authenticated. Subject to provider access checks (the requester must have the provider in their `providerIds` or `provisionerProviderIds`).

## Setting branding on a provider

### Via the admin-client UI

Open the provisioner workspace, locate the provider in the providers panel, hit **Edit Caps**. The modal has:

- **Branding** section — `appName`, logo URLs, `accentColor`, and `stylesheetUrl`.
- **Theme tokens (CSS variables)** section — a key-value editor where each row is `<token>: <css-value>`. A "Preset" dropdown surfaces the 16 most commonly overridden tokens by friendly name so admins can fill the form without memorising the surface. Token names validate inline (red border + tooltip) when they fall outside the allowed prefix set; the final server-side validation still runs and `CAPS_INVALID` issues surface in place.

Files:

- `admin-client/src/components/providerConfig/openCapsEditor.ts`
- `admin-client/src/components/providerConfig/providerConfigFormHelpers.ts` (`buildThemeTokensField` + `THEME_TOKEN_PRESETS`)

### Via API

`PUT /provisioner/providers/:providerId/caps` with the full caps payload:

```jsonc
{
  "branding": {
    "appName": "ITA",
    "navbarLogoUrl": "https://wearecollegetennis.com/.../ITA-logo-header.png",
    "accentColor": "#15365d",
    "themeTokens": {
      "--tmx-accent-blue": "#15365d",
      "--tmx-fill-accent": "#15365d",
      "--chc-text-link": "#15365d"
    },
    "stylesheetUrl": "https://wearecollegetennis.com/courthive-theme.css"
  },
  "permissions": { /* … */ }
}
```

A malformed payload returns `{ code: 'CAPS_INVALID', issues: [...] }` with one `ValidationIssue` per offending field.

### Via dev script (local seeding)

`src/scripts/create-ita-provider.mjs` is the reference example — an idempotent Node script that creates or updates a provider directly via `pg` with a fully-formed branding caps block. Copy and adapt for any provider you want to seed locally. The script honours the canonical `PG_*` env vars from `.env`.

## How it reaches the running page

### TMX

The provider's effective config is delivered at login and on every provider switch. TMX's runtime config singleton calls `applyBranding(effectiveConfig.branding)`, which:

1. Sets `document.title` from `appName`.
2. Writes `accentColor` to `--tmx-accent-blue`.
3. Iterates `themeTokens` and writes each pair via `documentElement.style.setProperty()`, tracking the applied keys so a subsequent provider switch clears them cleanly.
4. Manages a single `<link>` for `stylesheetUrl` — appends, updates `href` in place, or removes it depending on the new value.
5. Updates the navbar logo (`<img>` swap if `navbarLogoUrl`, text fallback to `appName` otherwise).

### courthive-public

The public viewer is unauthenticated and unaware of which provider owns the tournament a visitor opens, so it asks at tournament load time via the public branding endpoint above. `renderTournament()` fires the fetch as fire-and-forget alongside the tournament-info call. A failed lookup never blocks page render.

## Validation guarantees

- `--tmx-` and `--chc-` are the only allowed token prefixes. The check sits in `validateBranding` inside `@courthive/provider-config` so client + server enforce identically.
- Token values must be strings. Numbers, objects, and `null` are rejected.
- `stylesheetUrl` must be a string. (URL well-formedness is not validated at the schema layer — bad URLs simply 404 at fetch time and the viewer falls back to bundled defaults.)
- The whole branding shape is caps-owned (`ProviderConfigCaps.branding`), not settings-owned. White-labeling is fundamentally a provisioner concern; a provider-admin cannot rebrand against the provisioner's intent.

## Data dependencies

For courthive-public to resolve a tournament's owning provider via the public endpoint, the tournament must have a row in `tournament_provisioner`. Tournaments created via the provisioner-scope API key flow get stamped automatically; tournaments imported through legacy paths may need backfilling.

Reference backfill artifact: `Mentat/scripts/data-fixes/2026-05-30-ita-as-provisioner.sql` (115 ITA-owned tournaments stamped against the existing ITA provisioner). Same pattern applies to any provider whose calendar tournaments predate the provisioner flow.

## Related files

| Surface | Files |
| --- | --- |
| Canonical types + validator | `@courthive/provider-config` — `src/types.ts`, `src/validators.ts` |
| Validation on writes | `src/modules/provisioner/provisioner.service.ts` (`updateProviderCaps`) |
| Public branding endpoint | `src/modules/providers/providers.controller.ts` (`getPublicBrandingByTournament`) |
| Public branding service method | `src/modules/providers/providers.service.ts` (`getPublicBrandingByTournament`) |
| Effective-config endpoint | `src/modules/providers/providers.controller.ts` (`getEffectiveConfig`) |
| Admin caps editor | `admin-client/src/components/providerConfig/openCapsEditor.ts` |
| Caps editor helpers | `admin-client/src/components/providerConfig/providerConfigFormHelpers.ts` |
| ITA seed reference | `src/scripts/create-ita-provider.mjs` |
| Validation contract test | `src/modules/provisioner/provisioner.service.themeTokens.spec.ts` |
| No-leak contract test | `src/modules/providers/providers.service.config.spec.ts` |
