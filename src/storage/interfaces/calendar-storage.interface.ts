export const CALENDAR_STORAGE = Symbol('CALENDAR_STORAGE');

export interface ICalendarStorage {
  getCalendar(providerAbbr: string): Promise<any | null>;
  setCalendar(providerAbbr: string, data: any): Promise<{ success: boolean }>;
  listCalendars(): Promise<{ key: string; value: any }[]>;
}
