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

  beforeEach(() => {
    registry = new ConsumerRegistryService();
    bootstrap = new ConsumerBootstrap(registry);
    delete process.env.SCORE_RELAY_URL;
    delete process.env.EXPRESSION_URL;
    delete process.env.VIDEO_BOARD_URL;
    delete process.env.SCORE_RELAY_API_KEY;
    delete process.env.EXPRESSION_API_KEY;
    delete process.env.VIDEO_BOARD_API_KEY;
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
});
