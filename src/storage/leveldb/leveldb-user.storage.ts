import { IUserStorage } from '../interfaces/user-storage.interface';
import netLevel from 'src/services/levelDB/netLevel';
import { Injectable } from '@nestjs/common';

import { BASE_USER } from 'src/services/levelDB/constants';
import { SUCCESS } from 'src/common/constants/app';

@Injectable()
export class LeveldbUserStorage implements IUserStorage {
  async findOne(email: string): Promise<any | null> {
    return await netLevel.get(BASE_USER, { key: email });
  }

  async create(user: { email: string; password: string; [key: string]: any }): Promise<any> {
    await netLevel.set(BASE_USER, { key: user.email, value: user });
    return user;
  }

  async update(email: string, data: any): Promise<{ success: boolean }> {
    await netLevel.set(BASE_USER, { key: email, value: data });
    return { ...SUCCESS };
  }

  async remove(email: string): Promise<{ success: boolean }> {
    await netLevel.delete(BASE_USER, { key: email });
    return { ...SUCCESS };
  }

  async findAll(): Promise<{ success: boolean; users?: any[]; message?: string }> {
    const users = await netLevel.list(BASE_USER, { all: true });
    if (!users) return { success: false, message: 'No users found' };
    return { ...SUCCESS, users: users as any[] };
  }
}
