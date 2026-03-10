import { ICalendarStorage } from '../interfaces/calendar-storage.interface';
import netLevel from 'src/services/levelDB/netLevel';
import { Injectable } from '@nestjs/common';

import { BASE_CALENDAR } from 'src/services/levelDB/constants';
import { SUCCESS } from 'src/common/constants/app';

@Injectable()
export class LeveldbCalendarStorage implements ICalendarStorage {
  async getCalendar(providerAbbr: string): Promise<any | null> {
    return await netLevel.get(BASE_CALENDAR, { key: providerAbbr });
  }

  async setCalendar(providerAbbr: string, data: any): Promise<{ success: boolean }> {
    await netLevel.set(BASE_CALENDAR, { key: providerAbbr, value: data });
    return { ...SUCCESS };
  }

  async listCalendars(): Promise<{ key: string; value: any }[]> {
    const calendars = await netLevel.list(BASE_CALENDAR, { all: true });
    return (calendars as any[]) ?? [];
  }
}
