import { UserCtx, type UserContext } from '../account/auth/decorators/user-context.decorator';
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { SupportService } from './support.service';

@Controller('support')
export class SupportCapabilityController {
  constructor(private readonly service: SupportService) {}
  // `provider` is the client's selected provider. It matters only for a super-admin, whose impersonation is client-side.
  @Get('capability') capability(@Query('provider') provider?: string, @UserCtx() ctx?: UserContext) {
    return this.service.capability(typeof provider === 'string' ? provider.slice(0, 200) : undefined, ctx);
  }
}

@Controller('support/reports')
export class SupportController {
  constructor(private readonly service: SupportService) {}
  @Post() submit(@Body() body: unknown, @UserCtx() ctx?: UserContext) {
    return this.service.submit(body, ctx);
  }
  @Get(':reference') receipt(@Param('reference') ref: string, @UserCtx() ctx?: UserContext) {
    return this.service.receipt(ref, ctx);
  }
}

@Controller('admin/support/reports')
export class SupportAdminController {
  constructor(private readonly service: SupportService) {}
  @Get() list(
    @Query('offset') offset = '0',
    @Query('scope') scope?: string,
    @Query('kind') kind?: string,
    @UserCtx() ctx?: UserContext,
  ) {
    const value = /^\d{1,7}$/.test(offset) ? Number(offset) : 0;
    return this.service.list(value, ctx, { scope, kind });
  }
  @Get(':reference') show(@Param('reference') ref: string, @UserCtx() ctx?: UserContext) {
    return this.service.show(ref, ctx);
  }
  @Post(':reference/resolution') resolve(
    @Param('reference') ref: string,
    @Body() body: unknown,
    @UserCtx() ctx?: UserContext,
  ) {
    return this.service.resolve(ref, body, ctx);
  }
}
