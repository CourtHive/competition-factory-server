import { NotFoundException } from '@nestjs/common';

import { FontsController } from './fonts.controller';
import { FontsService } from './fonts.service';

function fakeRes() {
  const headers: Record<string, string> = {};
  let body: Buffer | undefined;
  return {
    headers,
    get body() {
      return body;
    },
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
    send: (b: Buffer) => {
      body = b;
    },
  };
}

describe('FontsController', () => {
  const controller = new FontsController(new FontsService());

  it('returns catalog entries with resolvable file URLs', () => {
    const { fonts } = controller.getCatalog();

    const dejavu = fonts.find((f) => f.id === 'dejavu-sans');
    expect(dejavu?.files?.normal).toBe('/fonts/files/DejaVuSans.ttf');
    expect(dejavu?.files?.bold).toBe('/fonts/files/DejaVuSans-Bold.ttf');

    const helvetica = fonts.find((f) => f.id === 'helvetica');
    expect(helvetica?.builtin).toBe(true);
    expect(helvetica?.files).toBeUndefined();
  });

  it('serves a known font binary with immutable cache + ttf content-type', () => {
    const res = fakeRes();
    controller.getFontFile('LiberationSans-Regular.ttf', res as any);
    expect(res.headers['Content-Type']).toBe('font/ttf');
    expect(res.headers['Cache-Control']).toContain('immutable');
    expect(res.body).toBeInstanceOf(Buffer);
  });

  it('rejects filenames outside the catalog (incl. traversal attempts)', () => {
    const res = fakeRes();
    expect(() => controller.getFontFile('../secret.env', res as any)).toThrow(NotFoundException);
    expect(() => controller.getFontFile('Unknown.ttf', res as any)).toThrow(NotFoundException);
  });
});
