import { Injectable, Inject, ForbiddenException } from '@nestjs/common';
import { sanctioningEngine } from 'tods-competition-factory';
import { canAccessSanctioningRecord } from './helpers/checkSanctioningAccess';

import {
  SANCTIONING_STORAGE,
  ISanctioningStorage,
} from 'src/storage/interfaces/sanctioning-storage.interface';

@Injectable()
export class SanctioningService {
  constructor(
    @Inject(SANCTIONING_STORAGE) private readonly sanctioningStorage: ISanctioningStorage,
  ) {}

  async createSanctioningRecord(params: any) {
    sanctioningEngine.reset();
    const result = sanctioningEngine.createSanctioningRecord(params);
    if (result.error) return result;

    const { sanctioningRecord } = result as any;
    if (sanctioningRecord) {
      const saveResult = await this.sanctioningStorage.saveSanctioningRecord({ sanctioningRecord });
      if (saveResult.error) return saveResult;
    }

    sanctioningEngine.reset();
    return result;
  }

  async getSanctioningRecord({ sanctioningId, user }: { sanctioningId: string; user?: any }) {
    const { sanctioningRecord, error } = await this.sanctioningStorage.findSanctioningRecord({ sanctioningId });
    if (error || !sanctioningRecord) return { error: error || 'Sanctioning record not found' };

    // Access check
    if (user && !canAccessSanctioningRecord({ sanctioningRecord, user })) {
      throw new ForbiddenException('Access denied to this sanctioning record');
    }

    return { sanctioningRecord };
  }

  async listSanctioningRecords({ providerId }: { providerId?: string }) {
    return this.sanctioningStorage.fetchSanctioningRecords({ providerId });
  }

  async executeSanctioningMethod({
    sanctioningId,
    method,
    params,
    user,
  }: {
    sanctioningId: string;
    method: string;
    params?: any;
    user?: any;
  }) {
    const engine = sanctioningEngine as any;

    const { sanctioningRecord, error } = await this.sanctioningStorage.findSanctioningRecord({ sanctioningId });
    if (error || !sanctioningRecord) return { error: error || 'Sanctioning record not found' };

    // Access check
    if (user && !canAccessSanctioningRecord({ sanctioningRecord, user })) {
      throw new ForbiddenException('Access denied to this sanctioning record');
    }

    engine.reset();
    engine.setState({ [sanctioningId]: sanctioningRecord });
    engine.setActiveSanctioningId(sanctioningId);

    const engineMethod = engine[method];
    if (!engineMethod) return { error: `Method not found: ${method}` };

    const result = engineMethod(params ?? {});

    // Save back if successful mutation (not for query-only methods)
    if (result.success) {
      const updatedRecord = engine.getSanctioningRecord();
      if (updatedRecord.sanctioningRecord) {
        await this.sanctioningStorage.saveSanctioningRecord({
          sanctioningRecord: updatedRecord.sanctioningRecord,
        });
      }
    }

    engine.reset();
    return result;
  }

  async removeSanctioningRecord({ sanctioningId }: { sanctioningId: string }) {
    return this.sanctioningStorage.removeSanctioningRecord({ sanctioningId });
  }

  async getSanctioningPolicies() {
    // Policies will be available from factory once published.
    return { success: true, policies: [] };
  }

  async checkCalendarConflicts({
    sanctioningId,
    user,
  }: {
    sanctioningId: string;
    user?: any;
  }) {
    const { sanctioningRecord, error } = await this.sanctioningStorage.findSanctioningRecord({ sanctioningId });
    if (error || !sanctioningRecord) return { error: error || 'Sanctioning record not found' };

    if (user && !canAccessSanctioningRecord({ sanctioningRecord, user })) {
      throw new ForbiddenException('Access denied');
    }

    // Build calendar context from all approved/active records
    const { sanctioningRecords } = await this.sanctioningStorage.fetchSanctioningRecords({});
    const calendarEvents = (sanctioningRecords ?? [])
      .filter((r: any) => r.sanctioningId !== sanctioningId)
      .filter((r: any) => ['APPROVED', 'ACTIVE'].includes(r.status))
      .map((r: any) => ({
        sanctioningId: r.sanctioningId,
        tournamentName: r.proposal?.tournamentName,
        startDate: r.proposal?.proposedStartDate,
        endDate: r.proposal?.proposedEndDate,
        sanctioningTier: r.sanctioningLevel,
        calendarSection: r.proposal?.calendarSection,
        countryCode: r.proposal?.hostCountryCode,
      }));

    return this.executeSanctioningMethod({
      sanctioningId,
      method: 'getCalendarConflicts',
      params: {
        calendarContext: {
          existingEvents: calendarEvents,
          calendarRules: { proximityWeeks: 2, maxEventsPerWeek: 5 },
        },
      },
    });
  }
}
