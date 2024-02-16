import { Injectable } from '@nestjs/common';
@Injectable()
export class AppService {
  factoryServer(): any {
    return { message: 'Factory server' };
  }
}
