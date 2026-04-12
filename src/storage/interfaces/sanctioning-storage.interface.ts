export const SANCTIONING_STORAGE = Symbol('SANCTIONING_STORAGE');

export interface ISanctioningStorage {
  findSanctioningRecord(params: {
    sanctioningId: string;
  }): Promise<{ sanctioningRecord?: any; error?: string }>;

  fetchSanctioningRecords(params: {
    providerId?: string;
  }): Promise<{ success?: boolean; sanctioningRecords?: any[]; error?: any }>;

  saveSanctioningRecord(params: { sanctioningRecord: any }): Promise<{ success?: boolean; error?: string }>;

  removeSanctioningRecord(params: {
    sanctioningId: string;
  }): Promise<{ success?: boolean; error?: string }>;

  listSanctioningIds(params?: {
    providerId?: string;
  }): Promise<string[]>;
}
