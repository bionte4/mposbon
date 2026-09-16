import { Body, Controller, Get, Post } from '@nestjs/common';
import { AuthContext } from './auth-context';
import { AuthLoginService } from './auth-login.service';
import { Public } from './public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly loginService: AuthLoginService) {}

  @Public()
  @Post('login')
  login(@Body() body: { email: string; pin: string }) {
    return this.loginService.login(body);
  }

  @Get('me')
  me() {
    const user = AuthContext.require();
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      permissions: user.permissions,
      tenantId: user.tenantId,
    };
  }
}
