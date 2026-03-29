import { baseApi } from './baseApi';

export async function getSanctioningRecords() {
  return await baseApi.post('/sanctioning/list', {});
}

export async function getSanctioningRecord({ sanctioningId }: { sanctioningId: string }) {
  return await baseApi.post('/sanctioning/detail', { sanctioningId });
}

export async function createSanctioningRecord(params: any) {
  return await baseApi.post('/sanctioning/create', params);
}

export async function executeSanctioningMethod({
  sanctioningId,
  method,
  params,
}: {
  sanctioningId: string;
  method: string;
  params?: any;
}) {
  return await baseApi.post('/sanctioning/execute', { sanctioningId, method, params });
}

export async function getSanctioningPolicies() {
  return await baseApi.post('/sanctioning/policies', {});
}

export async function checkCalendarConflicts({
  sanctioningId,
}: {
  sanctioningId: string;
}) {
  return await baseApi.post('/sanctioning/calendar-check', { sanctioningId });
}
