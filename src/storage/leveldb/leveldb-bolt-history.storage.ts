import {
  BoltHistoryDocument,
  IBoltHistoryStorage,
  VERSION_CONFLICT,
} from '../interfaces/bolt-history.interface';
import netLevel from 'src/services/levelDB/netLevel';
import { Injectable } from '@nestjs/common';

import { BASE_BOLT_HISTORY } from 'src/services/levelDB/constants';
import { SUCCESS } from 'src/common/constants/app';

@Injectable()
export class LeveldbBoltHistoryStorage implements IBoltHistoryStorage {
  async findBoltHistory({ tieMatchUpId }: { tieMatchUpId: string }) {
    if (!tieMatchUpId) return { error: 'tieMatchUpId required' };
    const document = (await netLevel.get(BASE_BOLT_HISTORY, { key: tieMatchUpId })) as
      | BoltHistoryDocument
      | undefined
      | null;
    if (!document) return { error: 'Bolt history not found' };
    return { document };
  }

  async saveBoltHistory({ document }: { document: BoltHistoryDocument }) {
    if (!document?.tieMatchUpId) return { error: 'document.tieMatchUpId required' };

    const existing = (await netLevel.get(BASE_BOLT_HISTORY, {
      key: document.tieMatchUpId,
    })) as BoltHistoryDocument | undefined | null;

    const currentVersion = existing?.version ?? 0;
    if (currentVersion > document.version) return { error: VERSION_CONFLICT };

    const now = new Date().toISOString();
    const newVersion = currentVersion + 1;
    const persisted: BoltHistoryDocument = {
      ...document,
      createdAt: existing?.createdAt ?? document.createdAt ?? now,
      updatedAt: now,
      version: newVersion,
    };

    await netLevel.set(BASE_BOLT_HISTORY, { key: document.tieMatchUpId, value: persisted });
    return { ...SUCCESS, version: newVersion };
  }

  async listBoltHistoryForTournament({ tournamentId }: { tournamentId: string }) {
    if (!tournamentId) return { error: 'tournamentId required' };
    const all = (await netLevel.list(BASE_BOLT_HISTORY, { all: true })) as
      | { key: string; value: BoltHistoryDocument }[]
      | undefined;
    const documents = (all ?? [])
      .map((entry) => entry.value)
      .filter((doc): doc is BoltHistoryDocument => doc?.tournamentId === tournamentId);
    return { documents };
  }

  async removeBoltHistory({ tieMatchUpId }: { tieMatchUpId: string }) {
    if (!tieMatchUpId) return { error: 'tieMatchUpId required' };
    await netLevel.delete(BASE_BOLT_HISTORY, { key: tieMatchUpId });
    return { ...SUCCESS };
  }
}
