import { Body, Controller, Get, NotFoundException, Patch, UseGuards, BadRequestException } from '@nestjs/common';
import { ProfilesService } from './profiles.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Auth } from 'src/auth/decorators/auth.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { AppRoles } from 'src/auth/interfaces/app-roles';
import type { JwtUser } from 'src/auth/decorators/current-user.decorator';

@Controller('profiles')
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService, 
    private readonly usersService: ProfilesService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  findAll() {
    return this.profilesService.findAll();
  }

  @Auth()
  @Patch('me/roles')
  async updateRoles(
    @CurrentUser() user: JwtUser,
    @Body() dto: { roles: AppRoles[] },
  ) {
    return this.usersService.updateRoles(user.sub, dto.roles);
  }

  @Auth()
  @Patch('me/active-role')
  async changeActiveRole(
    @CurrentUser() user: JwtUser,
    @Body() dto: { active_role?: AppRoles | 'technician'; role?: AppRoles | 'technician' },
  ) {
    const sentRole = dto.active_role || dto.role;
    if (!sentRole) {
      throw new BadRequestException('El campo active_role o role es requerido');
    }
    const roleToSet = sentRole === 'technician' ? AppRoles.WORKER : sentRole;
    return this.usersService.changeActiveRole(user, roleToSet as AppRoles);
  }

  @Auth()
  @Get('me')
  async getMe(@CurrentUser() user: JwtUser) {
    const profile = await this.profilesService.findByUserId(user.sub);

    if (!profile) {
      throw new NotFoundException('Perfil no encontrado');
    }

    return {
      id: profile.id,
      email: profile.email,
      roles: profile.roles,
      active_role: profile.active_role,
    };
  }
}
