import { RuntimeConfigController } from './runtime-config.controller';

describe('RuntimeConfigController', () => {
  const controller = new RuntimeConfigController();
  const original = process.env.TMX_URL;

  afterEach(() => {
    if (original === undefined) delete process.env.TMX_URL;
    else process.env.TMX_URL = original;
  });

  it('returns the env-configured TMX_URL when set', () => {
    process.env.TMX_URL = 'https://app.example.com/tmx/';
    expect(controller.getConfig()).toEqual({ tmxUrl: 'https://app.example.com/tmx/' });
  });

  it('falls back to /tmx/ (same-origin standard layout) when env is unset', () => {
    delete process.env.TMX_URL;
    expect(controller.getConfig()).toEqual({ tmxUrl: '/tmx/' });
  });
});
