export const PROVIDER_ARCHIVE_STORAGE = Symbol('PROVIDER_ARCHIVE_STORAGE');

export interface ProviderArchiveRow {
  archiveId: string;
  providerId: string;
  providerAbbr: string;
  providerName: string;
  archivePath: string;
  manifestSha256: string;
  tournamentCount: number;
  userAssocCount: number;
  archivedAt: string;
  archivedBy: string | null;
  revivedAt: string | null;
}

export interface IProviderArchiveStorage {
  insert(row: {
    providerId: string;
    providerAbbr: string;
    providerName: string;
    archivePath: string;
    manifestSha256: string;
    tournamentCount: number;
    userAssocCount: number;
    archivedBy: string | null;
  }): Promise<ProviderArchiveRow>;
  findById(archiveId: string): Promise<ProviderArchiveRow | null>;
  findByProviderId(providerId: string): Promise<ProviderArchiveRow[]>;
  /**
   * Stamp `revived_at = NOW()` after the revive-provider.mjs script
   * has restored the archive's rows. The archive directory on disk
   * stays — it's the durable record. Marking the row revived is the
   * signal that the archive is no longer the canonical state.
   */
  markRevived(archiveId: string): Promise<{ success: boolean }>;
}
