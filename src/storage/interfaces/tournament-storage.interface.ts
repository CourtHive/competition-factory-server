export const TOURNAMENT_STORAGE = Symbol('TOURNAMENT_STORAGE');

export interface ITournamentStorage {
  findTournamentRecord(params: {
    tournamentId: string;
  }): Promise<{ tournamentRecord?: any; error?: string }>;

  fetchTournamentRecords(params: {
    tournamentIds?: string[];
    tournamentId?: string;
  }): Promise<{ success?: boolean; tournamentRecords?: Record<string, any>; fetched?: number; notFound?: number; error?: any }>;

  saveTournamentRecord(params: { tournamentRecord: any }): Promise<{ success?: boolean; error?: string }>;

  saveTournamentRecords(params: {
    tournamentRecords?: Record<string, any>;
    tournamentRecord?: any;
  }): Promise<{ success?: boolean; error?: string }>;

  removeTournamentRecords(params: {
    tournamentIds?: string[];
    tournamentId?: string;
  }): Promise<{ success?: boolean; removed?: number; error?: string }>;

  listTournamentIds(): Promise<string[]>;
}
