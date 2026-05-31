// Unit tests for PersonsClient — the CFS-side HTTP + SSE wrapper for
// courthive-persons.
//
// All network access is mocked via jest.spyOn(globalThis, 'fetch').
// Tests cover:
//   - resolve POSTs the right shape to /persons/resolve
//   - getById GETs the right URL and handles 404
//   - handleMerge fetches survivor + calls userStorage.rewritePersonId
//   - getStatus reflects baseUrl + initial state
//
// Stream-loop reconnection logic is intentionally NOT exercised here
// (it's a side-effecting background loop). The runStreamLoop method is
// exposed for future integration testing if needed.

import { IUserStorage } from '../../../storage/interfaces/user-storage.interface';
import { HiveIDGateway } from '../../messaging/hiveid/hiveid.gateway';
import { PersonsClient } from './persons-client.service';

function makeGateway(): jest.Mocked<HiveIDGateway> {
  return {
    broadcastPersonUpdate: jest.fn(),
  } as any;
}

function makeStorage(): jest.Mocked<IUserStorage> {
  return {
    findOne: jest.fn(),
    findByContactEmail: jest.fn(),
    findByUserId: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    findAll: jest.fn(),
    updateLastAccess: jest.fn(),
    updateLastSelectedProviderId: jest.fn(),
    completeFirstLogin: jest.fn(),
    setContactEmail: jest.fn(),
    markEmailVerified: jest.fn(),
    setPasswordByUserId: jest.fn(),
    getContactEmailCoverage: jest.fn(),
    setPersonLink: jest.fn(),
    getPersonLink: jest.fn(),
    rewritePersonId: jest.fn().mockResolvedValue({ rewrittenCount: 1 }),
  } as any;
}

function mockFetchResponse(body: any, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as any;
}

describe('PersonsClient', () => {
  let storage: jest.Mocked<IUserStorage>;
  let gateway: jest.Mocked<HiveIDGateway>;
  let client: PersonsClient;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env.PERSONS_BASE_URL = 'http://test-persons:3100';
    storage = makeStorage();
    gateway = makeGateway();
    client = new PersonsClient(storage, gateway);
    fetchSpy = jest.spyOn(globalThis, 'fetch') as any;
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('resolve', () => {
    it('POSTs the fragment to /persons/resolve and returns the parsed result', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({ status: 'resolved', personId: 'p-1', personRevision: 3 }),
      );
      const result = await client.resolve({
        standardFamilyName: 'Allen',
        standardGivenName: 'Charles',
        personOtherIds: [{ provider: 'cfs-users', externalId: 'u-1' }],
      });
      expect(result).toEqual({ status: 'resolved', personId: 'p-1', personRevision: 3 });
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe('http://test-persons:3100/persons/resolve');
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(init.body)).toEqual({
        standardFamilyName: 'Allen',
        standardGivenName: 'Charles',
        personOtherIds: [{ provider: 'cfs-users', externalId: 'u-1' }],
      });
    });

    it('throws on non-OK response', async () => {
      fetchSpy.mockResolvedValueOnce(mockFetchResponse({}, false, 500));
      await expect(client.resolve({})).rejects.toThrow('persons resolve failed: HTTP 500');
    });
  });

  describe('getById', () => {
    it('GETs /persons/:id and returns the body', async () => {
      const body = {
        person: {
          personId: 'p-2',
          standardFamilyName: 'Roe',
          standardGivenName: 'John',
          birthDate: '1999-05-04',
          sex: 'M',
          nationalityCode: 'USA',
          tennisId: null,
          mergedInto: null,
          personRevision: 1,
        },
        aliases: [],
      };
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(body));
      const result = await client.getById('p-2');
      expect(result).toEqual(body);
      expect(fetchSpy.mock.calls[0][0]).toBe('http://test-persons:3100/persons/p-2');
    });

    it('returns null on 404', async () => {
      fetchSpy.mockResolvedValueOnce(mockFetchResponse({}, false, 404));
      const result = await client.getById('missing');
      expect(result).toBeNull();
    });

    it('throws on other non-OK responses', async () => {
      fetchSpy.mockResolvedValueOnce(mockFetchResponse({}, false, 500));
      await expect(client.getById('boom')).rejects.toThrow('persons getById failed: HTTP 500');
    });

    it('URL-encodes the personId', async () => {
      fetchSpy.mockResolvedValueOnce(mockFetchResponse({}, false, 404));
      await client.getById('with/slash');
      expect(fetchSpy.mock.calls[0][0]).toBe('http://test-persons:3100/persons/with%2Fslash');
    });
  });

  describe('handleMerge', () => {
    it('fetches survivor and rewrites users.person_id from deprecated -> survivor', async () => {
      const survivor = {
        person: {
          personId: 'survivor-1',
          standardFamilyName: 'Allen',
          standardGivenName: 'Charles',
          birthDate: '1975-01-01',
          sex: 'M',
          nationalityCode: 'USA',
          tennisId: null,
          mergedInto: null,
          personRevision: 4,
        },
        aliases: [],
      };
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(survivor));
      await client.handleMerge({ survivorId: 'survivor-1', deprecatedId: 'old-1' });
      expect(storage.rewritePersonId).toHaveBeenCalledWith({
        fromPersonId: 'old-1',
        toPersonId: 'survivor-1',
        personRevision: 4,
        cached: {
          standardFamilyName: 'Allen',
          standardGivenName: 'Charles',
          birthDate: '1975-01-01',
          sex: 'M',
          nationalityCode: 'USA',
        },
      });
    });

    it('skips rewrite when survivor returns 404', async () => {
      fetchSpy.mockResolvedValueOnce(mockFetchResponse({}, false, 404));
      await client.handleMerge({ survivorId: 'gone', deprecatedId: 'old-1' });
      expect(storage.rewritePersonId).not.toHaveBeenCalled();
      // No broadcast either — the survivor isn't valid so there's
      // nothing to notify clients about.
      expect(gateway.broadcastPersonUpdate).not.toHaveBeenCalled();
    });

    // Phase 4.0 — fan out a personMerged event to BOTH the survivor's
    // and the deprecated id's room so open /me sessions can refresh.
    it('broadcasts personUpdate to both survivor and deprecated rooms on successful merge', async () => {
      const survivor = {
        person: {
          personId: 'survivor-1',
          standardFamilyName: 'Allen',
          standardGivenName: 'Charles',
          birthDate: '1975-01-01',
          sex: 'M',
          nationalityCode: 'USA',
          tennisId: null,
          mergedInto: null,
          personRevision: 4,
        },
        aliases: [],
      };
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(survivor));
      await client.handleMerge({ survivorId: 'survivor-1', deprecatedId: 'old-1' });

      expect(gateway.broadcastPersonUpdate).toHaveBeenCalledTimes(2);
      expect(gateway.broadcastPersonUpdate).toHaveBeenCalledWith(
        'survivor-1',
        expect.objectContaining({
          kind: 'merged',
          prevPersonId: 'old-1',
          survivorPersonId: 'survivor-1',
          occurredAt: expect.any(String),
        }),
      );
      expect(gateway.broadcastPersonUpdate).toHaveBeenCalledWith(
        'old-1',
        expect.objectContaining({
          kind: 'merged',
          prevPersonId: 'old-1',
          survivorPersonId: 'survivor-1',
        }),
      );
    });

    it('does not fail the merge if the broadcast throws', async () => {
      gateway.broadcastPersonUpdate.mockImplementation(() => {
        throw new Error('gateway down');
      });
      const survivor = {
        person: {
          personId: 'survivor-1',
          standardFamilyName: 'X',
          standardGivenName: 'Y',
          birthDate: null,
          sex: null,
          nationalityCode: null,
          tennisId: null,
          mergedInto: null,
          personRevision: 1,
        },
        aliases: [],
      };
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(survivor));
      await expect(
        client.handleMerge({ survivorId: 'survivor-1', deprecatedId: 'old-1' }),
      ).resolves.toBeUndefined();
      expect(storage.rewritePersonId).toHaveBeenCalled();
    });
  });

  describe('getStatus', () => {
    it('reports baseUrl, not-yet-connected on construction', () => {
      const status = client.getStatus();
      expect(status.baseUrl).toBe('http://test-persons:3100');
      expect(status.connected).toBe(false);
      expect(status.lastEventAt).toBeNull();
      expect(status.consecutiveErrors).toBe(0);
    });
  });

  describe('baseUrl fallback', () => {
    it('uses default http://localhost:3100 when PERSONS_BASE_URL is unset', () => {
      delete process.env.PERSONS_BASE_URL;
      const c = new PersonsClient(storage, makeGateway());
      expect(c.getStatus().baseUrl).toBe('http://localhost:3100');
    });
  });

  describe('opt-out / disabled', () => {
    afterEach(() => {
      delete process.env.PERSONS_DISABLED;
    });

    it('skips the stream loop when PERSONS_DISABLED=true', () => {
      process.env.PERSONS_DISABLED = 'true';
      const c = new PersonsClient(storage, makeGateway());
      const spy = jest.spyOn(c, 'runStreamLoop');
      c.onApplicationBootstrap();
      expect(spy).not.toHaveBeenCalled();
    });

    it('skips the stream loop when PERSONS_BASE_URL=disabled (case-insensitive)', () => {
      process.env.PERSONS_BASE_URL = 'DISABLED';
      const c = new PersonsClient(storage, makeGateway());
      const spy = jest.spyOn(c, 'runStreamLoop');
      c.onApplicationBootstrap();
      expect(spy).not.toHaveBeenCalled();
    });

    it('runs the stream loop normally when neither opt-out is set', () => {
      process.env.PERSONS_BASE_URL = 'http://test-persons:3100';
      const c = new PersonsClient(storage, makeGateway());
      const spy = jest.spyOn(c, 'runStreamLoop').mockResolvedValue(undefined);
      c.onApplicationBootstrap();
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe('reconnect backoff + log throttling', () => {
    it('logs first + milestone failures at warn, suppresses the noisy middle', async () => {
      process.env.PERSONS_BASE_URL = 'http://test-persons:3100';
      const c = new PersonsClient(storage, makeGateway()) as any;
      const warn = jest.spyOn(c.logger, 'warn').mockImplementation(() => undefined);
      const debug = jest.spyOn(c.logger, 'debug').mockImplementation(() => undefined);

      // Drive 12 failures by calling the private logger helper directly —
      // exercises the milestone gate without spinning up the actual loop.
      for (let i = 1; i <= 12; i++) {
        c.consecutiveErrors = i;
        c.logFailure(new Error('fetch failed'));
      }
      // First failure + the 10th milestone → 2 warn lines, the other 10
      // routed to debug.
      expect(warn).toHaveBeenCalledTimes(2);
      expect(debug.mock.calls.length).toBeGreaterThanOrEqual(10);
    });

    it('computeBackoffMs grows exponentially and caps at 60s', () => {
      const c = new PersonsClient(storage, makeGateway()) as any;
      c.consecutiveErrors = 0;
      expect(c.computeBackoffMs()).toBe(5000);
      c.consecutiveErrors = 1;
      expect(c.computeBackoffMs()).toBe(5000);
      c.consecutiveErrors = 2;
      expect(c.computeBackoffMs()).toBe(10000);
      c.consecutiveErrors = 3;
      expect(c.computeBackoffMs()).toBe(20000);
      c.consecutiveErrors = 4;
      expect(c.computeBackoffMs()).toBe(40000);
      c.consecutiveErrors = 5;
      expect(c.computeBackoffMs()).toBe(60000); // capped
      c.consecutiveErrors = 9999;
      expect(c.computeBackoffMs()).toBe(60000);
    });
  });
});
