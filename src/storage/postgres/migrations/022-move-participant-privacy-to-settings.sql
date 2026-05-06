-- 022-move-participant-privacy-to-settings.sql
-- Migrate participantPrivacy from providerConfigCaps to
-- providerConfigSettings. Privacy is provider-owned (governs the
-- provider's relationship with its own participants); the provisioner
-- has no standing to dictate it. The cap-tier MVP shipped briefly
-- before this correction — this migration moves any stray data and
-- locks the new schema.
--
-- In production no provider has participantPrivacy set yet (the cap
-- tier was introduced earlier today), so this is paperwork — but we
-- run it unconditionally to avoid drift between code (which now
-- reads settings) and any ad-hoc SQL writes that might have landed
-- against caps.
--
-- Idempotent: when caps doesn't have participantPrivacy, the WHERE
-- clause skips the row entirely. Re-running is a no-op.

UPDATE providers
SET    data = (
         jsonb_set(
           data,
           '{providerConfigSettings,participantPrivacy}',
           COALESCE(
             data #> '{providerConfigSettings,participantPrivacy}',
             data #> '{providerConfigCaps,participantPrivacy}',
             '{}'::jsonb
           ),
           true
         )
       ) #- '{providerConfigCaps,participantPrivacy}',
       updated_at = NOW()
WHERE  data #> '{providerConfigCaps,participantPrivacy}' IS NOT NULL;
