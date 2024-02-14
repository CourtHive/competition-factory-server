import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {}

  async signIn(email: string, pass: string) {
    const user = await this.usersService.findOne(email);
    if (user?.password !== pass) {
      throw new UnauthorizedException();
    }
    const payload = { email: user.email, sub: user.userId, roles: user.roles };
    return {
      token: await this.jwtService.signAsync(payload),
    };
  }

  async invite(email: string, providerId: string) {
    // const inviteCode = createUniqueKey();
    return { email, providerId };
  }
}
