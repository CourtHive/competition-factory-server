import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { ConfigsModule } from 'src/config/config.module';
import { ConfigService } from '@nestjs/config';

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersService, ConfigService],
      imports: [ConfigsModule],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
