import { Test, TestingModule } from '@nestjs/testing';
import { StorageModule } from 'src/storage/storage.module';
import { ConfigsModule } from 'src/config/config.module';
import { UsersService } from './users.service';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

describe('UsersService', () => {
  let module: TestingModule;
  let service: UsersService;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [UsersService, ConfigService, JwtService],
      imports: [ConfigsModule, StorageModule],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  afterEach(async () => {
    await module?.close();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
