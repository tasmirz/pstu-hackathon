import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthService } from './auth.service';
import { ChangePinDto, LoginDto, RefreshTokenDto, RegisterDto, StepUpDto } from './dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshTokenDto) {
    return this.auth.refresh(dto.refresh_token);
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Body() dto: RefreshTokenDto) {
    return this.auth.logout(dto.refresh_token);
  }

  @Post('logout-all')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  logoutAll(@CurrentUser() user: { id: number }) {
    return this.auth.logoutAll(user.id);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: { id: number }) {
    return this.auth.me(user.id);
  }

  @Post('pin/change')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  changePin(@CurrentUser() user: { id: number }, @Body() dto: ChangePinDto) {
    return this.auth.changePin(user.id, dto.current_pin, dto.new_pin);
  }

  @Post('step-up')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  stepUp(@CurrentUser() user: { id: number }, @Body() dto: StepUpDto) {
    return this.auth.stepUp(user.id, dto);
  }

  @Get('ws-token')
  @UseGuards(JwtAuthGuard)
  wsToken(@CurrentUser() user: { id: number }) {
    return this.auth.wsToken(user.id);
  }
}
