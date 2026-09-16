-- 047-add-calendar-tournaments.sql
-- AFFECTS: end-users
-- Creates calendar_tournaments: one row per tournament, replacing the per-provider
-- JSONB blob that the tournaments list reads on every load.
--
-- Punch list P20. Plan: Mentat/planning/CALENDAR_PURE_SQL.md (rev 5) — read it before
-- changing this schema; the column classification below is a decision, not a layout.
--
-- ── WHY ──────────────────────────────────────────────────────────────────────
--
-- `calendars` is (provider_abbr PRIMARY KEY, provider JSONB, tournaments JSONB) — migration
-- 001, carried forward unexamined from the pre-Postgres LevelDB era where one blob per key
-- was the only shape a KV store offered. Two costs, and the write one is larger:
--
--   READ  — producing one page of a provider's calendar reads, detoasts and parses that
--           provider's ENTIRE array. Paging (#974) bounded the payload, never the work.
--   WRITE — `addToOrUpdateCalendar` runs on every save of a calendar-listed tournament and
--           rewrites the whole array, inside the per-tournament mutation lock. And
--           `detachFromOtherCalendars` calls `listCalendars()` — EVERY provider's entire
--           calendar into memory — on every create or provider move, to enforce an
--           invariant a primary key enforces for free.
--
-- The 2026-09-15 incident (a super-admin who stopped impersonating was served 49,000+
-- tournaments) is what exposed this; it is fixed separately in #974.
--
-- ── tournament_id AS PRIMARY KEY IS THE LOAD-BEARING DECISION ────────────────
--
-- "A tournament lives in exactly one provider's calendar" is enforced today by that
-- full-corpus `listCalendars()` sweep. Here it is the primary key: an upsert naming a new
-- provider_id IS the move. `detachFromOtherCalendars` is deleted, not optimised.
--
-- ── provider_id IS THE TENANT KEY, NOT provider_abbr ─────────────────────────
--
-- `calendars` is keyed by provider_abbr, which is MUTABLE — `modifyProvider` spreads its
-- input over the stored provider with no guard on organisationAbbreviation. Rename a
-- provider today and its calendar row orphans under the old abbr: the whole calendar
-- silently disappears and the next save creates a fresh empty one. That is a live bug,
-- not a consequence of this migration. provider_id is the immutable surrogate, so the
-- rename-orphan is structurally impossible here rather than fixed once.
--
-- provider_abbr is kept as a denormalised convenience for the abbr-addressed public route
-- (`POST /provider/calendar`), which resolves abbr -> id at the API boundary. It is
-- deliberately NOT indexed and must never be used as the tenant key.
--
-- ── WHY SOME COLUMNS AND SOME JSONB ──────────────────────────────────────────
--
-- Promote what you query; carry the rest in named JSONB columns. JSONB was never the
-- pathology — one row per PROVIDER is. A named JSONB column on a single tournament's row
-- is read with that row, written with that row, and never scanned.
--
-- Not child tables: measured (2026-09-15), NOTHING queries into the calendar's venues /
-- events / contacts collections, and TMX's list filters and sorts only on scalars already
-- promoted here. Child tables would have bought a per-page fetch, write amplification
-- inside the mutation lock, and a second un-authoritative copy of the tournament record.
-- If a query need ever appears, Postgres indexes into JSONB — promote a derived column
-- (e.g. match_up_formats TEXT[] + GIN), do not shred a collection.
--
-- Faceted search columns are ABSENT ON PURPOSE. courthive-query already owns
-- query_tournament_discovery (geo, genders[], age_codes[], category_types[], level facets,
-- fee range, entries_open/close). Duplicating them here would repeat punch-list P11. This
-- table is the strong-consistency DIRECTOR surface — "my tournaments, including the draft
-- I just saved" — and nothing more.
--
-- ── VISIBILITY IS A SCHEMA PROPERTY ──────────────────────────────────────────
--
-- The public projection is a fixed column selection, not a read-time allow-list chasing an
-- upstream shape that grows. That is what closes the 2026-08-29 class (staff contacts,
-- venue addresses and creator UUIDs reaching an unauthenticated endpoint) structurally.
-- Every column below is classified. A field added upstream lands in no column until
-- someone adds one AND answers the visibility question to do it.
--
-- Postgres also TOASTs large values out-of-line and only detoasts columns a query names,
-- so a public read that selects no PRIVATE column never touches those bytes.

-- ── ROUND-TRIP FIDELITY, WITHOUT A FAIL-OPEN ────────────────────────────────
--
-- The stored entry is sparser than the projection that builds it: `definedAttributes`
-- strips undefined, so a real entry carries only the fields that tournament actually has.
-- Measured against the built factory, a mock with one event and one venue yields exactly:
-- endDate, eventInfo, publishState, startDate, timeItemValues, tournamentContacts,
-- tournamentId, tournamentImageURL, tournamentName, venues.
--
-- So the column set cannot be derived from the type — it has to tolerate absence, and it
-- has to tolerate fields nobody here has seen yet. `remainder` catches anything not
-- explicitly mapped, which makes the round trip lossless even when the upstream projection
-- grows.
--
-- `remainder` is classified PRIVATE precisely so that catch-all is not a fail-open: a new
-- upstream field is carried and returned to authenticated callers, but reaches the public
-- projection only when someone promotes it to a PUBLIC column and answers the visibility
-- question in doing so.

CREATE TABLE IF NOT EXISTS calendar_tournaments (
  -- ── Keys ──
  tournament_id        TEXT PRIMARY KEY,
  provider_id          TEXT NOT NULL,              -- tenant key; immutable
  provider_abbr        TEXT,                       -- convenience only; NEVER the tenant key

  -- ── Queried: scope / sort / page the director list ──
  tournament_name      TEXT,                       -- PUBLIC
  search_text          TEXT NOT NULL DEFAULT '',   -- PUBLIC
  start_date           DATE,                       -- PUBLIC
  end_date             DATE,                       -- PUBLIC
  tournament_status    TEXT,                       -- PUBLIC
  published            BOOLEAN NOT NULL DEFAULT FALSE,
  event_count          INTEGER,                    -- PUBLIC. eventInfo length, counted at write.
  offline              BOOLEAN,                    -- PUBLIC. timeItemValues.TMX.offline.
  created_by_user_id   TEXT,                       -- PRIVATE. DIRECTOR ownership scoping.
  row_updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- when THIS row was written

  -- ── Carried, PUBLIC ──
  tournament_image_url TEXT,
  identity             JSONB,   -- formalName, promotionalName, tournamentLevel/Rank/Tier,
                                -- hostCountryCode, localTimeZone, activeDates, updatedAt,
                                -- parentOrganisation (the factory declares it public)
  online_resources     JSONB,
  event_info           JSONB,   -- PUBLIC, GATED AT READ on publishedEventIds — see below

  -- ── Carried, PRIVATE ──
  venues               JSONB,   -- a public `location` roll-up is deferred; see below
  registration_profile JSONB,   -- entryFees drives the card's fee chip
  tournament_contacts  JSONB,   -- per-contact isPublic is preserved inside
  tournament_address   JSONB,
  publish_state        JSONB,   -- `published` above is the queryable roll-up
  time_items           JSONB,   -- `offline` above is the queryable roll-up
  notes                TEXT,
  remainder            JSONB    -- anything not mapped above; PRIVATE by construction
);

-- ── COLUMNS DELIBERATELY NOT ADDED YET ───────────────────────────────────────
--
-- `location`, `court_svg_sport`, `individual_participant_count` and `organizer_name` appear
-- in the plan and are absent here on purpose: nothing in the stored entry can populate them
-- today (`individualParticipantCount` is only projected under `withMatchUpStats`, which the
-- calendar does not pass; `location` needs courthive-components' `formatVenueLocation`,
-- which CFS does not depend on). A column that is always NULL misrepresents what the table
-- holds. Consumers keep deriving these from the carried `venues` / `event_info` exactly as
-- they do today, so nothing regresses. Promote them in a later migration together with the
-- write-time derivation that fills them.

-- ── event_info IS NOT SAFE TO SERVE UNFILTERED ───────────────────────────────
--
-- `getTournamentCalendarEntry` calls `getTournamentInfo` WITHOUT `usePublishState`, so the
-- guard `if (!params?.usePublishState || publishedEventIds.includes(...))` short-circuits
-- true and EVERY event is carried — published or not. Verified empirically against the
-- built factory: a two-event tournament with one published yields eventInfo length 2 and
-- no per-event `published` flag.
--
-- No flag needs stamping. `publish_state.status.publishedEventIds` already rides along in
-- the same row, written in the same operation, so it cannot go stale against the events
-- beside it. `publicCalendarEntry` filters `event_info` through it at read time, failing
-- closed when the list is absent.
--
-- A second stored representation of the same fact would be the P19 class — one bad writer
-- silently flips every exclusion — which is the other reason not to stamp a flag.
--
-- NO EMBARGO CLAUSE, and that is a finding rather than an omission. Embargoes are recorded
-- at DRAW and STAGE level (`collectEventEmbargoes` -> `collectDrawEmbargoes`), plus
-- orderOfPlay / participants at tournament level; there is no event-level embargo to test,
-- and the public event fields carry counts rather than draw contents. Should one ever be
-- added, it must re-evaluate the `embargo` TIMESTAMP against now: the stored `embargoActive`
-- boolean is computed at write time and is stale the moment the embargo lapses.

-- The director list: "my tournaments", newest first.
CREATE INDEX IF NOT EXISTS calendar_tournaments_provider_start_idx
  ON calendar_tournaments (provider_id, start_date DESC);

-- The public listing: a provider's published tournaments.
CREATE INDEX IF NOT EXISTS calendar_tournaments_provider_published_idx
  ON calendar_tournaments (provider_id, published);

-- DIRECTOR scoping — "tournaments I created", across providers.
CREATE INDEX IF NOT EXISTS calendar_tournaments_created_by_idx
  ON calendar_tournaments (created_by_user_id);

-- NOTE: `calendars` is deliberately left INTACT by this migration — both its `provider`
-- and `tournaments` columns. Dropping it is 048, and only after prod has run on the new
-- path, so this migration stays reversible by pointing the storage layer back.
