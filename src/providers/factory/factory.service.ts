import { checkEngineError } from '../../common/errors/engineError';
import { executionQueue as eq } from './functions/executionQueue';
import { recordStorage } from '../../data/fileSystem';
import { askEngine } from 'tods-competition-factory';
import { Injectable } from '@nestjs/common';

@Injectable()
export class FactoryService {
  getVersion(): any {
    const version = askEngine.version();
    return { version };
  }

  removeTournamentRecords = recordStorage.removeTournamentRecords;

  async generateTournamentRecord(params) {
    return recordStorage.generateTournamentRecord(params);
  }

  async executionQueue(params) {
    const result = await eq(params);
    checkEngineError(result);
    return result;
  }
}
