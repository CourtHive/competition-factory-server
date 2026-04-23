import { baseApi } from './baseApi';

export async function listRemoteTournaments() {
  const response = await baseApi.get('/factory/sync/remote');
  return response?.data;
}

export async function pullTournament(tournamentId: string) {
  const response = await baseApi.post('/factory/sync/pull', { tournamentId });
  return response?.data;
}

export async function getSyncStatus() {
  const response = await baseApi.get('/factory/sync/status');
  return response?.data;
}
