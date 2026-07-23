import { isFactoryUuid, resolvePersonLink } from './personRule';

describe('personRule', () => {
  describe('isFactoryUuid', () => {
    it('detects a bare RFC-4122 v4 UUID', () => {
      expect(isFactoryUuid('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(true);
      expect(isFactoryUuid('A1B2C3D4-4F89-41D3-9A0C-0305E82C3301')).toBe(true); // case-insensitive
    });

    it('detects the prefixed UUID form (tools.UUID(pre) strips dashes)', () => {
      expect(isFactoryUuid('P_3f2504e04f8941d39a0c0305e82c3301')).toBe(true);
    });

    it('rejects real provider/federation person ids and junk', () => {
      expect(isFactoryUuid('1023456')).toBe(false); // UTR-style numeric id
      expect(isFactoryUuid('USTA-99887')).toBe(false);
      expect(isFactoryUuid('')).toBe(false);
      expect(isFactoryUuid(undefined)).toBe(false);
      expect(isFactoryUuid(null)).toBe(false);
      // v1 UUID (version nibble 1, not 4) is not a factory UUID pattern
      expect(isFactoryUuid('3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBe(false);
    });
  });

  describe('resolvePersonLink', () => {
    const PARTICIPANT = 'a1b2c3d4-4f89-41d3-9a0c-0305e82c3301';

    it('skips when personId === participantId (synthetic/local)', () => {
      expect(resolvePersonLink(PARTICIPANT, PARTICIPANT)).toEqual({ personId: null, linkSource: 'unresolved' });
    });

    it('skips when personId is itself a factory UUID (generated, not a real person)', () => {
      const otherUuid = '99999999-4f89-41d3-9a0c-0305e82c3301';
      expect(resolvePersonLink(PARTICIPANT, otherUuid)).toEqual({ personId: null, linkSource: 'unresolved' });
    });

    it('populates when personId is a non-UUID provider id (a real canonical person)', () => {
      expect(resolvePersonLink(PARTICIPANT, '1023456')).toEqual({ personId: '1023456', linkSource: 'providerId' });
    });

    it('skips when personId is missing', () => {
      expect(resolvePersonLink(PARTICIPANT, undefined)).toEqual({ personId: null, linkSource: 'unresolved' });
    });
  });
});
