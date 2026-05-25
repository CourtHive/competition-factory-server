import { FontsService } from './fonts.service';
import { FONT_ASSET_FILES } from './fonts.catalog';

describe('FontsService', () => {
  const service = new FontsService();

  it('exposes a catalog including the built-in and Central-European fonts', () => {
    const ids = service.getCatalog().map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(['helvetica', 'dejavu-sans', 'liberation-sans']));
  });

  it('loads every catalog asset into memory', () => {
    expect(FONT_ASSET_FILES.size).toBeGreaterThan(0);
    for (const file of FONT_ASSET_FILES) {
      const buffer = service.getFontBuffer(file);
      expect(buffer).toBeInstanceOf(Buffer);
      expect((buffer as Buffer).length).toBeGreaterThan(1000);
    }
  });

  it('returns undefined for files outside the catalog', () => {
    expect(service.getFontBuffer('nope.ttf')).toBeUndefined();
  });
});
