-- AFFECTS: admin
-- 063-allowed-sanctioning-policies.sql
-- Rename the provider-config policy `allowedGoverningBodies` to `allowedSanctioningPolicies`, and each entry's
-- `governingBodyId` to `sanctioningPolicy`, in both tiers of every provider's stored config.
--
-- The list holds sanctioning RULEBOOKS ('itf', 'usta', 'generic'), the key a sanctioning record carries as
-- `sanctioningPolicy`. The governing body is the provider filing, which owns the sanctioned tournament (CA,
-- 2026-11-11). @courthive/provider-config renamed the key (provider-config #125); its validators refuse the old one,
-- so a provider still storing it could not save its config again.
--
-- No value changes: every rulebook key stays, under its new name. A list already stored under the new key is kept as
-- it is, and the old one dropped.
--
-- The premise is asserted, not assumed: afterwards no provider stores the old key in either tier. The migration runs
-- in a transaction, so a failed assertion rolls it back and the server does not start.
-- Idempotent: a second run finds nothing to rename.

DO $$
DECLARE
  tier text;
  renamed integer;
  remaining integer;
BEGIN
  FOREACH tier IN ARRAY ARRAY['providerConfigCaps', 'providerConfigSettings'] LOOP
    UPDATE providers AS p
       SET data = jsonb_set(
                    p.data #- ARRAY[tier, 'policies', 'allowedGoverningBodies'],
                    ARRAY[tier, 'policies', 'allowedSanctioningPolicies'],
                    COALESCE(
                      p.data #> ARRAY[tier, 'policies', 'allowedSanctioningPolicies'],
                      (SELECT COALESCE(
                                jsonb_agg(
                                  CASE WHEN jsonb_typeof(e) = 'object' AND e ? 'governingBodyId'
                                       THEN (e - 'governingBodyId')
                                            || jsonb_build_object('sanctioningPolicy', e->'governingBodyId')
                                       ELSE e END
                                  ORDER BY ord),
                                '[]'::jsonb)
                         FROM jsonb_array_elements(p.data #> ARRAY[tier, 'policies', 'allowedGoverningBodies'])
                              WITH ORDINALITY AS t(e, ord))
                    ),
                    true),
           updated_at = NOW()
     WHERE jsonb_typeof(p.data #> ARRAY[tier, 'policies', 'allowedGoverningBodies']) = 'array';
    GET DIAGNOSTICS renamed = ROW_COUNT;
    RAISE NOTICE '063: % provider(s) renamed in %', renamed, tier;
  END LOOP;

  SELECT count(*) INTO remaining
    FROM providers
   WHERE data #> '{providerConfigCaps,policies,allowedGoverningBodies}' IS NOT NULL
      OR data #> '{providerConfigSettings,policies,allowedGoverningBodies}' IS NOT NULL;
  IF remaining > 0 THEN
    RAISE EXCEPTION '063: % provider(s) still store allowedGoverningBodies', remaining;
  END IF;
END
$$;
