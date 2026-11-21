import { UserCtx, type UserContext } from '../account/auth/decorators/user-context.decorator';
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { SupportService } from './support.service';

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
  @Get() list(@Query('offset') offset = '0', @UserCtx() ctx?: UserContext) {
    const value = /^\d{1,7}$/.test(offset) ? Number(offset) : 0;
    return this.service.list(value, ctx);
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
