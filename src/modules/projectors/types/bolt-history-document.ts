// Re-export of the canonical BoltHistoryDocument type from the storage interface.
// Centralised here so projector code does not need to reach across the storage
// module boundary; if the canonical type ever moves, only this re-export changes.
export {
  BOLT_HISTORY_STORAGE,
  VERSION_CONFLICT,
  type IBoltHistoryStorage,
  type BoltHistoryDocument,
  type TieMatchUpSide,
} from 'src/storage/interfaces/bolt-history.interface';
