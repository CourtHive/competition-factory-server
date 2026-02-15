CREATE TABLE IF NOT EXISTS tournaments (
  tournament_id   TEXT PRIMARY KEY,
  provider_id     TEXT,
  tournament_name TEXT,
  start_date      DATE,
  end_date        DATE,
  data            JSONB NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  email       TEXT PRIMARY KEY,
  password    TEXT NOT NULL,
  provider_id TEXT,
  roles       JSONB DEFAULT '[]',
  permissions JSONB DEFAULT '[]',
  data        JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS providers (
  provider_id               TEXT PRIMARY KEY,
  organisation_abbreviation TEXT NOT NULL,
  organisation_name         TEXT,
  data                      JSONB DEFAULT '{}',
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS calendars (
  provider_abbr TEXT PRIMARY KEY,
  provider      JSONB,
  tournaments   JSONB DEFAULT '[]',
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reset_codes (
  code       TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS access_codes (
  code       TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tournaments_provider ON tournaments(provider_id);
CREATE INDEX IF NOT EXISTS idx_users_provider ON users(provider_id);
