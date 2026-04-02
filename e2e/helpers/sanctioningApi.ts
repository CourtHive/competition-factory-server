import type { APIRequestContext } from '@playwright/test';

/**
 * Direct API calls to the sanctioning endpoints.
 * Used for test setup/teardown and verification without going through the UI.
 */
export class SanctioningApiHelper {
  constructor(
    private request: APIRequestContext,
    private baseUrl: string = 'http://localhost:3000',
    private token?: string,
  ) {}

  private headers(): Record<string, string> {
    return this.token ? { Authorization: `Bearer ${this.token}` } : {};
  }

  async create(params: any) {
    const res = await this.request.post(`${this.baseUrl}/sanctioning/create`, {
      data: params,
      headers: this.headers(),
    });
    return res.json();
  }

  async detail(sanctioningId: string) {
    const res = await this.request.post(`${this.baseUrl}/sanctioning/detail`, {
      data: { sanctioningId },
      headers: this.headers(),
    });
    return res.json();
  }

  async list(providerId?: string) {
    const res = await this.request.post(`${this.baseUrl}/sanctioning/list`, {
      data: { providerId },
      headers: this.headers(),
    });
    return res.json();
  }

  async execute(sanctioningId: string, method: string, params?: any) {
    const res = await this.request.post(`${this.baseUrl}/sanctioning/execute`, {
      data: { sanctioningId, method, params },
      headers: this.headers(),
    });
    return res.json();
  }

  async remove(sanctioningId: string) {
    const res = await this.request.post(`${this.baseUrl}/sanctioning/remove`, {
      data: { sanctioningId },
      headers: this.headers(),
    });
    return res.json();
  }

  /**
   * Create a record in a specific status by running the appropriate workflow.
   * Useful for setting up test preconditions.
   */
  async createInStatus(params: any, targetStatus: string) {
    const createResult = await this.create(params);
    const sanctioningId = createResult?.sanctioningRecord?.sanctioningId;
    if (!sanctioningId) return createResult;

    const workflow: Record<string, string[]> = {
      DRAFT: [],
      SUBMITTED: ['submitApplication'],
      UNDER_REVIEW: ['submitApplication', 'reviewApplication'],
      APPROVED: ['submitApplication', 'reviewApplication', 'approveApplication'],
      ACTIVE: ['submitApplication', 'reviewApplication', 'approveApplication', 'activateFromSanctioning'],
    };

    const steps = workflow[targetStatus] ?? [];
    for (const method of steps) {
      const result = await this.execute(sanctioningId, method, {});
      if (result?.error) return { error: result.error, failedAt: method };
    }

    return { sanctioningId };
  }
}
