// Federation-data adapter contract. The interface and helper types are
// the source-of-truth in `courthive-ingest`; CFS re-exports them here so
// the rest of this module's imports don't have to know the difference.
// The DI token (`FEDERATION_ADAPTERS`) remains local to CFS — it's a
// NestJS concept that doesn't belong in the ingest package.

export type {
  AdapterError,
  AdapterErrorCode,
  AdapterResult,
  DateRange,
  FederationDataAdapter,
  TournamentSummary,
} from 'courthive-ingest';

export { isAdapterError } from 'courthive-ingest';

/** DI token for the array of registered adapters wired in `FederationDataModule`. */
export const FEDERATION_ADAPTERS = 'FEDERATION_ADAPTERS';
