# Team provider display defaults

The provider record stores optional `teamColors` using the CODES TEAM palette/default-display contract.
Team/provider administrators edit defaults once in the management console's provider dashboard.

- `GET /provider/team-displays?q=...&offset=...` supplies authenticated users a bounded directory of
  providers with display defaults. Each page returns at most 50 IDs/names, plus optional `nextOffset`.
  It never loads all provider records or their palettes. Search is parameterized and `%`, `_`, `\` match literally; invalid paging is 400.
- `GET /provider/:providerId/team-display` supplies authenticated users a public-safe TEAM participant:
  stable participantId equal to providerId, name, TEAM/COMPETITOR markers, and validated optional teamColors.
  No provider configuration, keys, contacts or permissions are returned.
- `PUT /provider/:providerId/team-display` requires SUPER_ADMIN or PROVIDER_ADMIN of that exact provider.
  Body `{ teamColors }` replaces defaults after CODES validation. `{ teamColors: {} }` clears them.
  Null/missing/malformed input is 400; wrong provider scope is 403; missing provider is 404.

A surgical JSONB update changes only teamColors and updated_at. Unrelated provider settings survive
concurrent updates. Invalid defaults are rejected before SQL writes. Invalid stored branding is visible
as a 500 and an ERROR log line rather than silently omitted. Existing provider detail responses also carry teamColors.
The scoped PUT is the only write path: generic `POST /provider/add` and `/provider/modify` refuse any payload
naming `teamColors` (400), because `/provider/modify` is not scoped to the provider's own administrator.

TMX fetches selected provider TEAM details before submitting its normal participant mutation batch.
Imports carry the full palette/defaults. Refresh modifies only imported teamColors; local names/rosters
and tournament DISPLAY overrides are preserved. A provider failure produces no import mutation batch.
The tournament's imported snapshot remains usable offline and never writes back to the provider.

Factory hydration attaches applicable tournament presentation settings to matchUps. This adds no timer,
stream or high-frequency fan-out to the mutation server. Relay consumers resolve presentation locally.
