/**
 * Provider lifecycle — preview / archive / delete orchestration.
 *
 * Archive flow (the destructive but recoverable one):
 *   1. Fetch provider record (need abbr + name for archive directory)
 *   2. Write archive directory to disk via ProviderArchiveService
 *   3. ProviderCleanupService.wipe() inside ONE DB transaction
 *   4. Insert provider_archives row with the manifest sha256
 *
 * If step 3 fails, the .partial directory from step 2 is left on disk
 * for inspection; the live DB is unchanged. We deliberately don't
 * auto-clean failed .partial dirs — a human inspecting them after a
 * failure is better than silently swallowing what went wrong.
 *
 * Delete flow:
 *   1. ProviderCleanupService.wipe() (same transaction)
 *   2. Done. No disk artefact, no provider_archives row, no revive.
 *
 * Both require `confirm` body field matching the provider's
 * abbreviation. Delete additionally requires `acknowledgeDataLoss:
 * true` to make the irrevocability impossible to do by accident.
 */
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { ProviderCleanupService, type CleanupCounts } from './provider-cleanup.service';
import { ProviderArchiveService } from './provider-archive.service';
import { PROVIDER_STORAGE, type IProviderStorage, PROVIDER_ARCHIVE_STORAGE, type IProviderArchiveStorage } from 'src/storage/interfaces';
import type { UserContext } from '../account/auth/decorators/user-context.decorator';

export interface PreviewArchiveResult {
  providerId: string;
  providerAbbr: string;
  providerName: string;
  counts: CleanupCounts;
}

@Injectable()
export class ProviderLifecycleService {
  private readonly logger = new Logger(ProviderLifecycleService.name);

  constructor(
    @Inject(PROVIDER_STORAGE) private readonly providerStorage: IProviderStorage,
    @Inject(PROVIDER_ARCHIVE_STORAGE) private readonly archiveStorage: IProviderArchiveStorage,
    private readonly cleanupService: ProviderCleanupService,
    private readonly archiveService: ProviderArchiveService,
  ) {}

  private async loadProvider(providerId: string): Promise<{
    providerId: string;
    providerAbbr: string;
    providerName: string;
  }> {
    const record: any = await this.providerStorage.getProvider(providerId);
    if (!record) throw new NotFoundException(`Provider ${providerId} not found`);
    const providerAbbr = record.organisationAbbreviation ?? record.providerAbbr ?? '';
    const providerName = record.organisationName ?? '';
    if (!providerAbbr) {
      throw new BadRequestException(
        `Provider ${providerId} has no organisationAbbreviation — cannot archive without one (the archive directory is keyed by abbr).`,
      );
    }
    return { providerId, providerAbbr, providerName };
  }

  private assertSuperAdmin(ctx: UserContext | undefined): void {
    if (!ctx?.isSuperAdmin) {
      throw new ForbiddenException('SUPER_ADMIN required for provider lifecycle operations');
    }
  }

  /** Read-only preview — no destructive side effects. */
  async preview(providerId: string, ctx: UserContext | undefined): Promise<PreviewArchiveResult> {
    this.assertSuperAdmin(ctx);
    const provider = await this.loadProvider(providerId);
    const counts = await this.cleanupService.getCounts(provider.providerId, provider.providerAbbr);
    return { ...provider, counts };
  }

  /** Archive + wipe. */
  async archive(
    providerId: string,
    confirm: string,
    ctx: UserContext | undefined,
  ): Promise<{ success: true; archiveId: string; archivePath: string; counts: CleanupCounts }> {
    this.assertSuperAdmin(ctx);
    const provider = await this.loadProvider(providerId);

    if (confirm !== provider.providerAbbr) {
      throw new BadRequestException(
        `confirm must equal the provider abbreviation "${provider.providerAbbr}" to authorise an archive`,
      );
    }

    // Write export FIRST so the cleanup transaction has something to
    // record. The export is the durable evidence; the cleanup is the
    // destructive step.
    const writeResult = await this.archiveService.writeArchive(provider);

    let counts: CleanupCounts;
    try {
      counts = await this.cleanupService.wipe(provider.providerId, provider.providerAbbr);
    } catch (err) {
      // Cleanup failed — the archive directory survived but live DB is
      // unchanged. Log loudly and re-throw; operator can inspect the
      // .partial-less final archive dir and decide whether to retry
      // cleanup (idempotent — second wipe just no-ops the missing rows)
      // or rm-rf the orphan archive.
      this.logger.error(
        `archive: wipe failed after archive ${writeResult.archivePath} was written: ${(err as Error).message}`,
      );
      throw err;
    }

    const archiveRow = await this.archiveStorage.insert({
      providerId: provider.providerId,
      providerAbbr: provider.providerAbbr,
      providerName: provider.providerName,
      archivePath: writeResult.archivePath,
      manifestSha256: writeResult.manifestSha256,
      tournamentCount: writeResult.tournamentCount,
      userAssocCount: writeResult.userAssocCount,
      archivedBy: ctx?.userId ?? null,
    });

    this.logger.log(
      `archived provider ${provider.providerId} (${provider.providerAbbr}) — ${writeResult.tournamentCount} tournaments, ${writeResult.userAssocCount} user assocs, ${writeResult.auditLogRows} audit rows. Archive: ${writeResult.archivePath}`,
    );

    return {
      success: true,
      archiveId: archiveRow.archiveId,
      archivePath: writeResult.archivePath,
      counts,
    };
  }

  /** Hard delete — no export, no provider_archives row. */
  async delete(
    providerId: string,
    confirm: string,
    acknowledgeDataLoss: boolean,
    ctx: UserContext | undefined,
  ): Promise<{ success: true; counts: CleanupCounts }> {
    this.assertSuperAdmin(ctx);
    const provider = await this.loadProvider(providerId);

    if (confirm !== provider.providerAbbr) {
      throw new BadRequestException(
        `confirm must equal the provider abbreviation "${provider.providerAbbr}" to authorise a delete`,
      );
    }
    if (acknowledgeDataLoss !== true) {
      throw new ConflictException(
        'acknowledgeDataLoss must be explicitly true. Delete is irrevocable — use archive if you want a recoverable record.',
      );
    }

    const counts = await this.cleanupService.wipe(provider.providerId, provider.providerAbbr);

    this.logger.log(
      `DELETED provider ${provider.providerId} (${provider.providerAbbr}) — ${counts.tournaments} tournaments destroyed. No archive.`,
    );

    return { success: true, counts };
  }
}
