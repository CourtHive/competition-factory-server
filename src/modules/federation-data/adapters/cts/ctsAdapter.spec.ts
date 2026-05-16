import { CtsAdapter } from './ctsAdapter';

describe('CtsAdapter', () => {
  const adapter = new CtsAdapter();

  describe('canHandle', () => {
    it('returns true for cztenis.cz turnaj+sezona URLs', () => {
      expect(adapter.canHandle('https://www.cztenis.cz/turnaj/12345/sezona/2026/')).toBe(true);
    });

    it('returns true for cesky-tenis.cz turnaj+sezona URLs', () => {
      expect(adapter.canHandle('https://cesky-tenis.cz/turnaj/12345/sezona/2026')).toBe(true);
    });

    it('is case-insensitive on path segments', () => {
      expect(adapter.canHandle('HTTPS://WWW.CZTENIS.CZ/TURNAJ/12345/SEZONA/2026/')).toBe(true);
    });

    it('returns false for non-HTTP identifiers', () => {
      expect(adapter.canHandle('CZE12345')).toBe(false);
      expect(adapter.canHandle('')).toBe(false);
      expect(adapter.canHandle('ftp://www.cztenis.cz/turnaj/12345/sezona/2026/')).toBe(false);
    });

    it('returns false for HTTP URLs without turnaj+sezona', () => {
      expect(adapter.canHandle('https://www.cztenis.cz/clanky/2026/')).toBe(false);
      expect(adapter.canHandle('https://www.cztenis.cz/turnaj/12345/')).toBe(false);
      expect(adapter.canHandle('https://www.cztenis.cz/sezona/2026/')).toBe(false);
    });

    it('returns false for non-string input', () => {
      expect(adapter.canHandle(undefined as unknown as string)).toBe(false);
      expect(adapter.canHandle(null as unknown as string)).toBe(false);
    });
  });

  describe('fetchTournament', () => {
    it('returns error when tournamentId segment missing', async () => {
      // turnaj present but no following segment before end of URL
      const result = await adapter.fetchTournament('https://www.cztenis.cz/turnaj/');
      expect(result).toEqual({ error: 'Invalid CTS identifier' });
    });

    it('returns error when sezona segment missing', async () => {
      // turnaj/<id> present but no sezona segment at all
      const result = await adapter.fetchTournament('https://www.cztenis.cz/turnaj/12345/');
      expect(result).toEqual({ error: 'Invalid CTS identifier' });
    });
  });

  describe('provider metadata', () => {
    it('exposes stable provider + organizationId', () => {
      expect(adapter.provider).toBe('CTS');
      expect(adapter.organizationId).toBe('7c10416b-9b4b-45c9-9762-efa4e2efc2cb');
    });
  });
});
