-- 016-add-user-provisioners.sql
-- Phase 2A — provisioner-role human users.
-- Associates users with provisioners they represent, granting them
-- full provisioner privileges (create providers, manage users, impersonate
-- managed providers). M:N because a user may legitimately represent more
-- than one provisioner (e.g. a contractor working for two integrations).

CREATE TABLE IF NOT EXISTS user_provisioners (
  user_id        UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  provisioner_id UUID NOT NULL REFERENCES provisioners(provisioner_id) ON DELETE CASCADE,
  granted_by     UUID REFERENCES users(user_id),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, provisioner_id)
);

CREATE INDEX IF NOT EXISTS idx_user_provisioners_provisioner ON user_provisioners(provisioner_id);
