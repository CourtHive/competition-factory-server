import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import type { UserContext } from '../auth/decorators/user-context.decorator';
import { SanctioningClient } from './sanctioning-client.service';
import {
  canReviewForProvider,
  notifyActivated,
  owningProviderOf,
  storeActivatedTournament,
} from './sanctioning-activation';

/**
 * The provider administrator's "Activate (Create Tournament)" from the AMS console: the tournament for an APPROVED
 * sanctioning record is created here, in CFS, which stores tournaments, and AMS is told the record is ACTIVE.
 *
 * Reviewer's work (CA, 2026-11-11): the governing body is the provider that owns the tournament, and its
 * PROVIDER_ADMIN reviews. Addressed by the record's own id, because a record whose registration never opened has no
 * tournamentId yet; the factory mints one, and AMS records it.
 */
@Injectable()
export class SanctioningActivationService {
  private readonly logger = new Logger(SanctioningActivationService.name);

  constructor(
    private readonly tournamentStorageService: TournamentStorageService,
    private readonly sanctioningClient: SanctioningClient,
  ) {}

  async activate(
    sanctioningId: string,
    userContext: UserContext,
  ): Promise<{ success: true; tournamentId: string; created: boolean }> {
    const sanctioningRecord = await this.sanctioningClient.getRecordById(sanctioningId);
    if (!sanctioningRecord) throw new NotFoundException(`sanctioning ${sanctioningId} not found`);

    if (!canReviewForProvider(userContext, owningProviderOf(sanctioningRecord))) {
      throw new ForbiddenException("Activation is the reviewer's: the provider administrator's");
    }

    // Already activated (by the first accepted registration, or an earlier activate): say so to AMS again, which is
    // idempotent, so a notification that was missed the first time is not lost for good.
    const existingId = sanctioningRecord.proposal?.tournamentId;
    if (existingId) {
      const existing = await this.tournamentStorageService.findTournamentRecord({ tournamentId: existingId });
      if (existing?.tournamentRecord) {
        await notifyActivated(this.sanctioningClient, sanctioningId, existingId, this.logger);
        return { success: true, tournamentId: existingId, created: false };
      }
    }

    if (sanctioningRecord.status !== 'APPROVED') {
      throw new ConflictException(
        `sanctioning ${sanctioningId} is ${sanctioningRecord.status}; only an APPROVED record activates`,
      );
    }

    const { tournamentId, created } = await storeActivatedTournament({
      sanctioningRecord,
      userId: userContext.userId,
      tournamentStorageService: this.tournamentStorageService,
      sanctioningClient: this.sanctioningClient,
      logger: this.logger,
    });
    return { success: true, tournamentId, created };
  }
}
