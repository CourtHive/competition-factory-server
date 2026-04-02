import { OFFICIATING_STORAGE, IOfficiatingStorage } from 'src/storage/interfaces/officiating-storage.interface';
import { canAccessOfficialRecord } from './helpers/checkOfficiatingAccess';
import { Injectable, Inject, ForbiddenException } from '@nestjs/common';
import { officiatingEngine } from 'tods-competition-factory';

@Injectable()
export class OfficiatingService {
  constructor(@Inject(OFFICIATING_STORAGE) private readonly officiatingStorage: IOfficiatingStorage) {}

  async createOfficialRecord(params: any) {
    officiatingEngine.reset();
    const result = officiatingEngine.createOfficialRecord(params);
    if (result.error) return result;

    const { officialRecord } = result as any;
    if (officialRecord) {
      // Attach providerId for storage-level scoping (not part of factory record)
      if (params.providerId) officialRecord.providerId = params.providerId;

      const saveResult = await this.officiatingStorage.saveOfficialRecord({ officialRecord });
      if (saveResult.error) return saveResult;
    }

    officiatingEngine.reset();
    return result;
  }

  async getOfficialRecord({ officialRecordId, user }: { officialRecordId: string; user?: any }) {
    const { officialRecord, error } = await this.officiatingStorage.findOfficialRecord({ officialRecordId });
    if (error || !officialRecord) return { error: error || 'Official record not found' };

    if (user && !canAccessOfficialRecord({ officialRecord, user })) {
      throw new ForbiddenException('Access denied to this official record');
    }

    return { officialRecord };
  }

  async listOfficialRecords({ providerId }: { providerId?: string }) {
    return this.officiatingStorage.fetchOfficialRecords({ providerId });
  }

  async executeOfficiatingMethod({
    officialRecordId,
    method,
    params,
    user,
  }: {
    officialRecordId: string;
    method: string;
    params?: any;
    user?: any;
  }) {
    const engine = officiatingEngine as any;

    const { officialRecord, error } = await this.officiatingStorage.findOfficialRecord({ officialRecordId });
    if (error || !officialRecord) return { error: error || 'Official record not found' };

    if (user && !canAccessOfficialRecord({ officialRecord, user })) {
      throw new ForbiddenException('Access denied to this official record');
    }

    engine.reset();
    engine.setState({ [officialRecordId]: officialRecord });
    engine.setActiveOfficialRecordId(officialRecordId);

    const engineMethod = engine[method];
    if (!engineMethod) return { error: `Method not found: ${method}` };

    const result = engineMethod(params ?? {});

    // Save back if successful mutation (not for query-only methods)
    if (result.success) {
      const updatedRecord = engine.getOfficialRecord();
      if (updatedRecord.officialRecord) {
        await this.officiatingStorage.saveOfficialRecord({
          officialRecord: updatedRecord.officialRecord,
        });
      }
    }

    engine.reset();
    return result;
  }

  async removeOfficialRecord({ officialRecordId }: { officialRecordId: string }) {
    return this.officiatingStorage.removeOfficialRecord({ officialRecordId });
  }

  async getEvaluationPolicies() {
    return { success: true, policies: [] };
  }
}
