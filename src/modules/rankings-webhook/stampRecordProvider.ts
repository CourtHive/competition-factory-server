// Stamp the owning provider onto a tournament record's
// unifiedTournamentId.organisation so the rankings ingest can derive the
// provider_id (the abbreviation) it scopes the bundle by. Provisioner-created
// records (e.g. BOBOCA) don't carry the organisation; without this the ingest
// writes a blank provider_id and the provider-scoped bundle drops the tournament.
// Shared by both republish paths (provider recompute + single-tournament) so
// they can't diverge.
export function stampRecordProvider(record: any, provider: any): void {
  const providerAbbr = provider?.organisationAbbreviation;
  if (!record || !providerAbbr) return;
  record.unifiedTournamentId = {
    ...record.unifiedTournamentId,
    organisation: { organisationId: providerAbbr, organisationName: provider?.organisationName ?? providerAbbr },
  };
}
