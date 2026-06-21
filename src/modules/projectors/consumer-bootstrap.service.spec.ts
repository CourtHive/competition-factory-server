import { Logger } from '@nestjs/common';

import { ConsumerBootstrap } from './consumer-bootstrap.service';
import {
  ConsumerRegistryService,
  HttpConsumerEndpoint,
  isCallbackConsumer,
} from './consumer-registry.service';

function asHttp(endpoint: any): HttpConsumerEndpoint {
  if (isCallbackConsumer(endpoint)) {
    throw new Error('expected HTTP consumer, got callback consumer');
  }
  return endpoint as HttpConsumerEndpoint;
}

describe('ConsumerBootstrap', () => {
  let registry: ConsumerRegistryService;
  let bootstrap: ConsumerBootstrap;
  const ORIGINAL_ENV = { ...process.env };

  // Registry/bootstrap emit consumer-registration lines at log level; these
  // specs assert on registry state, not log output, so silence the noise.
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  beforeAll(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterAll(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  beforeEach(() => {
    registry = new ConsumerRegistryService();
    bootstrap = new ConsumerBootstrap(registry);
    delete process.env.SCORE_RELAY_URL;
    delete process.env.EXPRESSION_URL;
    delete process.env.VIDEO_BOARD_URL;
    delete process.env.SCORE_RELAY_API_KEY;
    delete process.env.EXPRESSION_API_KEY;
    delete process.env.VIDEO_BOARD_API_KEY;
    delete process.env.SCORE_RELAY_INTERNAL_URL;
    delete process.env.INTERNAL_WEBHOOK_SECRET;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('registers nothing when no env vars set', () => {
    bootstrap.onModuleInit();
    expect(registry.list()).toHaveLength(0);
  });

  it('registers score-relay as both scorebug and video-board consumers', () => {
    process.env.SCORE_RELAY_URL = 'http://localhost:8384';
    bootstrap.onModuleInit();

    const all = registry.list();
    expect(all).toHaveLength(2);

    const scorebug = registry.list('scorebug');
    expect(scorebug).toHaveLength(1);
    expect(asHttp(scorebug[0]).url).toBe('http://localhost:8384/api/projection/scorebug');
    expect(asHttp(scorebug[0]).authHeader).toBeUndefined();

    const videoBoard = registry.list('video-board');
    expect(videoBoard).toHaveLength(1);
    expect(asHttp(videoBoard[0]).url).toBe('http://localhost:8384/api/projection/video-board');
  });

  it('strips trailing slash from SCORE_RELAY_URL', () => {
    process.env.SCORE_RELAY_URL = 'http://localhost:8384/';
    bootstrap.onModuleInit();
    expect(asHttp(registry.list('scorebug')[0]).url).toBe('http://localhost:8384/api/projection/scorebug');
  });

  it('attaches Bearer auth header when SCORE_RELAY_API_KEY is set', () => {
    process.env.SCORE_RELAY_URL = 'http://localhost:8384';
    process.env.SCORE_RELAY_API_KEY = 'secret';
    bootstrap.onModuleInit();
    expect(asHttp(registry.list('scorebug')[0]).authHeader).toBe('Bearer secret');
  });

  it('registers EXPRESSION_URL as a scorebug consumer', () => {
    process.env.EXPRESSION_URL = 'https://expression.example.test/scorebug';
    process.env.EXPRESSION_API_KEY = 'expr-key';
    bootstrap.onModuleInit();
    const scorebug = registry.list('scorebug');
    expect(scorebug).toHaveLength(1);
    expect(scorebug[0].id).toBe('expression-direct');
    expect(asHttp(scorebug[0]).authHeader).toBe('Bearer expr-key');
  });

  it('registers VIDEO_BOARD_URL as a video-board consumer', () => {
    process.env.VIDEO_BOARD_URL = 'http://192.168.1.43:9000/board';
    bootstrap.onModuleInit();
    const videoBoard = registry.list('video-board');
    expect(videoBoard).toHaveLength(1);
    expect(videoBoard[0].id).toBe('video-board-direct');
  });

  it('combines all three sources when all set', () => {
    process.env.SCORE_RELAY_URL = 'http://localhost:8384';
    process.env.EXPRESSION_URL = 'https://expression.example.test/scorebug';
    process.env.VIDEO_BOARD_URL = 'http://192.168.1.43:9000/board';
    bootstrap.onModuleInit();

    expect(registry.list('scorebug')).toHaveLength(2); // score-relay + expression
    expect(registry.list('video-board')).toHaveLength(2); // score-relay + video-board-direct
  });

  describe('matchup-finalized consumer (Phase 3 slice 6)', () => {
    it('does not register when neither var is set', () => {
      bootstrap.onModuleInit();
      expect(registry.list('matchup-finalized')).toHaveLength(0);
    });

    it('does not register when only SCORE_RELAY_INTERNAL_URL is set', () => {
      process.env.SCORE_RELAY_INTERNAL_URL = 'http://localhost:8384';
      bootstrap.onModuleInit();
      expect(registry.list('matchup-finalized')).toHaveLength(0);
    });

    it('does not register when only INTERNAL_WEBHOOK_SECRET is set', () => {
      process.env.INTERNAL_WEBHOOK_SECRET = 'secret';
      bootstrap.onModuleInit();
      expect(registry.list('matchup-finalized')).toHaveLength(0);
    });

    it('registers when both vars are set', () => {
      process.env.SCORE_RELAY_INTERNAL_URL = 'http://localhost:8384';
      process.env.INTERNAL_WEBHOOK_SECRET = 'shared-secret';
      bootstrap.onModuleInit();

      const consumers = registry.list('matchup-finalized');
      expect(consumers).toHaveLength(1);
      const endpoint = asHttp(consumers[0]);
      expect(endpoint.id).toBe('score-relay-matchup-finalized');
      expect(endpoint.url).toBe('http://localhost:8384/api/internal/matchup-finalized');
      expect(endpoint.extraHeaders).toEqual({ 'X-Internal-Secret': 'shared-secret' });
      expect(endpoint.singleShot).toBe(true);
      expect(endpoint.enabled).toBe(true);
    });

    it('strips trailing slash from SCORE_RELAY_INTERNAL_URL', () => {
      process.env.SCORE_RELAY_INTERNAL_URL = 'http://localhost:8384/';
      process.env.INTERNAL_WEBHOOK_SECRET = 'shared-secret';
      bootstrap.onModuleInit();

      const endpoint = asHttp(registry.list('matchup-finalized')[0]);
      expect(endpoint.url).toBe('http://localhost:8384/api/internal/matchup-finalized');
    });
  });
});
