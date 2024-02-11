import { ConversionController } from './conversion.controller';
import { UsersModule } from 'src/modules/users/users.module';
import { ConversionService } from './conversion.service';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthModule } from 'src/auth/auth.module';

describe('AppService', () => {
  let app: TestingModule;

  beforeAll(async () => {
    app = await Test.createTestingModule({
      imports: [AuthModule, UsersModule],
      controllers: [ConversionController],
      providers: [ConversionService],
    }).compile();
  });

  describe('version', () => {
    it('throws error when no tournament', async () => {
      const conversionController = app.get(ConversionController);
      // @ts-expect-error no tournament provided
      const result = await conversionController.convertTournament();
      expect(result.error).toBeDefined();
    });
    it('can call tournmaent converter', async () => {
      const conversionController = app.get(ConversionController);
      const result = await conversionController.convertTournament({ tournament: { tuid: 'tid' } });
      expect(result.tournamentRecord.tournamentId).toEqual('tid');
    });
  });

  afterAll(async () => {
    await app.close();
  });
});