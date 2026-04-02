export const OFFICIATING_STORAGE = Symbol('OFFICIATING_STORAGE');

export interface IOfficiatingStorage {
  findOfficialRecord(params: {
    officialRecordId: string;
  }): Promise<{ officialRecord?: any; error?: string }>;

  fetchOfficialRecords(params: {
    providerId?: string;
  }): Promise<{ success?: boolean; officialRecords?: any[]; error?: any }>;

  saveOfficialRecord(params: { officialRecord: any }): Promise<{ success?: boolean; error?: string }>;

  removeOfficialRecord(params: {
    officialRecordId: string;
  }): Promise<{ success?: boolean; error?: string }>;

  listOfficialRecordIds(params?: {
    providerId?: string;
  }): Promise<string[]>;
}
