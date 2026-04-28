import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ProvisionerMiddleware } from './provisioner.middleware';
import { AdminProvisionerController } from './admin-provisioner.controller';
import { ProvisionerController } from './provisioner.controller';
import { UsersProvidersController } from './users-providers.controller';
import { ProvisionerService } from './provisioner.service';
import { SsoTokenService } from './sso-token.service';
import { SsoController } from './sso.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [
    AdminProvisionerController,
    ProvisionerController,
    SsoController,
    UsersProvidersController,
  ],
  providers: [ProvisionerService, SsoTokenService],
})
export class ProvisionerModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Apply ProvisionerMiddleware to all routes so impersonated
    // endpoints (executionQueue, assignments, etc.) work with prov_ tokens
    consumer.apply(ProvisionerMiddleware).forRoutes('*');
  }
}
