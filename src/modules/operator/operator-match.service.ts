import { commandFingerprint } from 'src/storage/postgres/commandReceipts';
import { operatorScorePrecondition, scoreRequest } from './scoreRequest';
import { FactoryHttpDelivery } from '../factory/factory-http-delivery.service';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  grantCoversMethod,
  isWithinWindow,
  isTournamentWide,
  isTargetInScope,
  isEvaluableScope,
  requiredTargetFields,
} from '../factory/helpers/grantScope';
import { MutationAuthorizationService } from '../factory/mutation-authorization.service';
import { enrichTargetFromRecord } from '../factory/helpers/resolveMutationTarget';
import { isProviderAdministrator } from '../factory/helpers/providerAdminMethods';
import { sessionProviderId } from '../factory/helpers/actingProviderScope';
import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import { GRANT_STORAGE, type IGrantStorage } from 'src/storage/interfaces';
import { loadFetchedRecords } from '../factory/helpers/loadFetchedRecords';
import asyncGlobalState from '../factory/engines/asyncGlobalState';
import { queryEngine } from '../factory/engines/queryEngine';
import { recordRevision } from 'src/storage/postgres/recordRevision';
import type { UserContext } from '../account/auth/decorators/user-context.decorator';
import type { MatchIds } from './matchRequest';

@Injectable()
export class OperatorMatchService {
  constructor(
    private readonly delivery: FactoryHttpDelivery,
    private readonly storage: TournamentStorageService,
    private readonly authorization: MutationAuthorizationService,
    @Inject(GRANT_STORAGE) private readonly grants: IGrantStorage,
  ) {}

  /** Evaluate only supplied IDs. A catalogue offer requires a live tournament-wide grant. */
  async catalogueAccess(tournamentIds: string[], user?: UserContext) {
    const provider = sessionProviderId(user);
    if (!user?.userId || !provider || user.apiKey || !user.providerIds.includes(provider))
      throw new ForbiddenException();
    const allowed: string[] = [];
    for (const tournamentId of tournamentIds) {
      if (await this.scoringAccess(user, provider, tournamentId)) allowed.push(tournamentId);
    }
    return { tournamentIds: allowed };
  }

  async read(ids: MatchIds, user?: UserContext) {
    if (!user?.userId || user.apiKey || !sessionProviderId(user)) throw new ForbiddenException();
    const result = await this.storage.fetchTournamentRecords({ tournamentId: ids.tournamentId, captureRevision: true });
    const record = result.tournamentRecords?.[ids.tournamentId];
    return this.evaluate(ids, user, record);
  }

  private async evaluate(ids: MatchIds, user: UserContext, record) {
    const audience = await this.authorize(ids, user, record);
    return this.matchDto(ids, record, audience);
  }

  private async authorize(ids: MatchIds, user: UserContext, record) {
    const provider = sessionProviderId(user);
    if (
      !provider ||
      user.apiKey ||
      !user.providerIds.includes(provider) ||
      !record ||
      record.tournamentId !== ids.tournamentId ||
      record.parentOrganisation?.organisationId !== provider
    )
      throw new ForbiddenException();
    const event = record.events?.find((e) => e.eventId === ids.eventId);
    const draw = event?.drawDefinitions?.find((d) => d.drawId === ids.drawId);
    const targetRecord = { events: [{ eventId: ids.eventId, drawDefinitions: draw ? [draw] : [] }] };
    if (!(await this.scoringAccess(user, provider, ids.tournamentId, { ids, targetRecord })))
      throw new ForbiddenException();
    if (!draw) throw new NotFoundException();
    return isProviderAdministrator(user, provider) ? 'director' : 'recorder';
  }

  private async scoringAccess(
    user: UserContext,
    provider: string,
    tournamentId: string,
    match?: { ids: MatchIds; targetRecord: { events: any[] } },
  ) {
    const rows = await this.grants.findForSubject(user.userId, tournamentId);
    const covered = rows.some(
      (grant) =>
        grant.userId === user.userId &&
        grant.providerId === provider &&
        grant.tournamentId === tournamentId &&
        isWithinWindow(grant) &&
        grantCoversMethod(grant.capability, 'setMatchUpStatus') &&
        isEvaluableScope(grant.scope) &&
        (match
          ? isTargetInScope(
              grant.scope,
              enrichTargetFromRecord(match.ids, match.targetRecord, requiredTargetFields(grant.scope)),
            )
          : isTournamentWide(grant.scope)),
    );
    if (!covered) return false;
    const denial = await this.authorization.gate({
      officialScoringProvider: provider,
      userContext: user,
      tournamentIds: [tournamentId],
      requestedMethods: ['setMatchUpStatus'],
      methods: match && [{ method: 'setMatchUpStatus', params: match.ids }],
      actor: user.userId,
    });
    return denial === null;
  }

  async score(command: ReturnType<typeof scoreRequest>, user?: UserContext) {
    if (!user?.userId || user.apiKey || !sessionProviderId(user)) throw new ForbiddenException();
    const { target, commandId, intent, revision, outcome, emptyScore } = command;
    const snapshot = await this.storage.fetchTournamentRecords({ tournamentId: target.tournamentId });
    await this.authorize(target, user, snapshot.tournamentRecords?.[target.tournamentId]);
    const methods = [{ method: 'setMatchUpStatus', params: { ...target, outcome } }];
    const assertion = async (records) => {
      const current = await this.evaluate(target, user, records[target.tournamentId]);
      if (
        current.match.resultIntent !== intent ||
        (emptyScore && !current.match.clearable) ||
        current.match.disabledMatchUpStatuses.includes(outcome.matchUpStatus) ||
        (intent === 'correct-result' && current.revision !== revision)
      )
        throw new ConflictException('Score changed');
    };
    const receipt = await this.delivery.commit({
      tournamentIds: [target.tournamentId],
      methods,
      rollbackOnError: true,
      commandId,
      commandActor: user.userId,
      userId: user.userId,
      userEmail: user.email,
      source: 'api',
      commandFingerprint: commandFingerprint({
        tournamentId: target.tournamentId,
        methods: [{ kind: 'operator-score', intent, revision }, ...methods],
        rollbackOnError: true,
      }),
      [operatorScorePrecondition]: assertion,
    });
    if (!receipt?.success || !receipt.durableReceipt) throw new ServiceUnavailableException();
    return { commandId, accepted: true };
  }

  private matchDto(ids: MatchIds, record, audience: 'recorder' | 'director') {
    const revision = recordRevision(record);
    if (!revision) throw new ServiceUnavailableException('Revision unavailable');
    return asyncGlobalState.runWithInstanceState(() => {
      // Without a copy (P67), like the mutation path: the record was parsed from its own row for this request.
      if (loadFetchedRecords({ [ids.tournamentId]: record }).error) throw new ServiceUnavailableException();
      const reply = queryEngine.matchUpActions({ ...ids, operatorAudience: audience });
      if (reply.error) throw new NotFoundException();
      if (!reply.operatorMatch) throw new ServiceUnavailableException('Operator query unavailable');
      return { ...ids, revision, match: reply.operatorMatch };
    });
  }
}
