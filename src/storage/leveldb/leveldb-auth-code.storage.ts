import { IAuthCodeStorage } from '../interfaces/auth-code-storage.interface';
import netLevel from 'src/services/levelDB/netLevel';
import { Injectable } from '@nestjs/common';

import { BASE_ACCESS_CODES, BASE_RESET_CODES } from 'src/services/levelDB/constants';
import { SUCCESS } from 'src/common/constants/app';

@Injectable()
export class LeveldbAuthCodeStorage implements IAuthCodeStorage {
  async getResetCode(code: string): Promise<any | null> {
    return await netLevel.get(BASE_RESET_CODES, { key: code });
  }

  async setResetCode(code: string, value: any): Promise<{ success: boolean }> {
    await netLevel.set(BASE_RESET_CODES, { key: code, value });
    return { ...SUCCESS };
  }

  async deleteResetCode(code: string): Promise<{ success: boolean }> {
    await netLevel.delete(BASE_RESET_CODES, { key: code });
    return { ...SUCCESS };
  }

  async getAccessCode(code: string): Promise<any | null> {
    return await netLevel.get(BASE_ACCESS_CODES, { key: code });
  }

  async setAccessCode(code: string, email: string): Promise<{ success: boolean }> {
    await netLevel.set(BASE_ACCESS_CODES, { key: code, value: email });
    return { ...SUCCESS };
  }
}
