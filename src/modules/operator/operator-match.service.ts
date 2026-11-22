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
    const rows = await this.grants.findForSubject(user.userId, ids.tournamentId);
    const allowed = rows.some(
      (grant) =>
        grant.providerId === provider &&
        grant.userId === user.userId &&
        grant.tournamentId === ids.tournamentId &&
        isWithinWindow(grant) &&
        grantCoversMethod(grant.capability, 'setMatchUpStatus') &&
        isEvaluableScope(grant.scope) &&
        isTargetInScope(grant.scope, enrichTargetFromRecord(ids, targetRecord, requiredTargetFields(grant.scope))),
    );
    if (!allowed) throw new ForbiddenException();
    if (!draw) throw new NotFoundException();
    const denial = await this.authorization.gate({
      userContext: user,
      tournamentIds: [ids.tournamentId],
      requestedMethods: ['setMatchUpStatus'],
      methods: [{ method: 'setMatchUpStatus', params: ids }],
      actor: user.userId,
    });
    if (denial) throw new ForbiddenException();

    return isProviderAdministrator(user, provider) ? 'director' : 'recorder';
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
      queryEngine.setState({ [ids.tournamentId]: record });
      const reply = queryEngine.matchUpActions({ ...ids, operatorAudience: audience });
      if (reply.error) throw new NotFoundException();
      if (!reply.operatorMatch) throw new ServiceUnavailableException('Operator query unavailable');
      return { ...ids, revision, match: reply.operatorMatch };
    });
  }
}
