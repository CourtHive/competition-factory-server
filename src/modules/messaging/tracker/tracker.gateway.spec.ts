import { Test, TestingModule } from '@nestjs/testing';
import { TrackerGateway } from './tracker.gateway';
import { ConfigService } from '@nestjs/config';
import { reduce } from 'rxjs/operators';
import { JwtService } from '@nestjs/jwt';

describe('TrackerGateway', () => {
  let gateway: TrackerGateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TrackerGateway, ConfigService, JwtService],
    }).compile();

    gateway = module.get<TrackerGateway>(TrackerGateway);
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  describe('findAll', () => {
    it('should return 3 numbers', (done) => {
      gateway
        .findAll({})
        .pipe(reduce((acc: any[], item) => [...acc, item], []))
        .subscribe((results) => {
          expect(results.length).toBe(3);
          results.forEach((result, index) => expect(result.iteration).toBe(index + 1));
          done();
        });
    });
  });

  describe('identity', () => {
    it('should return the same number has what was sent', async () => {
      await expect(gateway.identity(1)).resolves.toBe(1);
    });
  });
});
