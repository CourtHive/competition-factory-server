import { Controller, Get, INestApplication, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { mocksEngine, tournamentEngineAsync } from 'tods-competition-factory';
import request from 'supertest';

import { InstanceStateMiddleware } from './instanceState.middleware';
import { validateL2 } from '../helpers/validateTournamentRecord';
import asyncGlobalState from './asyncGlobalState';
// side effect: registers asyncGlobalState as the factory's process-global state provider
import './getMutationEngine';

// A handler that touches the engine ACROSS awaits — the real risk. If the request is not
// wrapped, AsyncLocalStorage has no store when setState/allDrawMatchUps/validateL2 read state,
// so getInstanceState() mints an implicit (unreleased, warned) per-context state.
@Controller('probe')
class ProbeController {
  @Get('touch')
  async touch(): Promise<{ ok: boolean }> {
    const { tournamentRecord } = mocksEngine.generateTournamentRecord({
      drawProfiles: [{ drawSize: 4 }],
      completeAllMatchUps: true,
    });
    await tournamentEngineAsync.setState(tournamentRecord);
    await tournamentEngineAsync.allDrawMatchUps({
      drawId: tournamentRecord.events[0].drawDefinitions[0].drawId,
      inContext: true,
    });
    validateL2(tournamentRecord);
    return { ok: true };
  }
}

@Module({ controllers: [ProbeController] })
class WrappedModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(InstanceStateMiddleware).forRoutes('*');
  }
}

@Module({ controllers: [ProbeController] })
class UnwrappedModule {}

async function boot(mod: unknown): Promise<INestApplication> {
  const moduleRef: TestingModule = await Test.createTestingModule({ imports: [mod as any] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

describe('InstanceStateMiddleware — real Nest HTTP pipeline', () => {
  it('WRAPPED: a handler touching the engine across awaits creates NO implicit state', async () => {
    const app = await boot(WrappedModule);
    try {
      const before = asyncGlobalState.implicitContextCreations();
      // several requests — the store must hold across every handler + its awaits, every time
      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer()).get('/probe/touch').expect(200);
      }
      expect(asyncGlobalState.implicitContextCreations() - before).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('FALSIFY — UNWRAPPED: the identical handler DOES create implicit state (detector is live)', async () => {
    const app = await boot(UnwrappedModule);
    try {
      const before = asyncGlobalState.implicitContextCreations();
      await request(app.getHttpServer()).get('/probe/touch').expect(200);
      // proves the WRAPPED expectation above is a real guarantee, not a vacuous zero
      expect(asyncGlobalState.implicitContextCreations() - before).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });
});
