import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ProvisionerMiddleware } from './provisioner.middleware';
import { AdminProvisionerController } from './admin-provisioner.controller';
import { ProvisionerController } from './provisioner.controller';
import { ProvisionerService } from './provisioner.service';
import { SsoTokenService } from './sso-token.service';
import { SsoController } from './sso.controller';

@Module({
  controllers: [AdminProvisionerController, ProvisionerController, SsoController],
  providers: [ProvisionerService, SsoTokenService],
})
export class ProvisionerModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Apply ProvisionerMiddleware to all routes so impersonated
    // endpoints (executionQueue, assignments, etc.) work with prov_ tokens
    consumer.apply(ProvisionerMiddleware).forRoutes('*');
  }
}
