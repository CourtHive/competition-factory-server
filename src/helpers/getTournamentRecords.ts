export function getTournamentRecords(params: any) {
  return (
    params?.tournamentRecords ??
    (params?.tournamentRecord ? { [params.tournamentRecord.tournamentId]: params.tournamentRecord } : {})
  );
}
