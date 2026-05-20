import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Patch,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { ProfilesService } from './profiles.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Auth } from 'src/auth/decorators/auth.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { AppRoles } from 'src/auth/interfaces/app-roles';
import type { JwtUser } from 'src/auth/decorators/current-user.decorator';
import { UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

@Controller('profiles')
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  findAll() {
    return this.profilesService.findAll();
  }

  @Auth()
  @Patch('me/photo')
  @UseInterceptors(
    FileInterceptor('worker_photo', { storage: memoryStorage() }),
  )
  async updatePhoto(
    @CurrentUser() user: JwtUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No se ha proporcionado ninguna imagen');
    }

    // Aquí llamas a tu servicio para procesar el archivo en memoria (subirlo a Cloudinary, etc.)
    // Tu profilesService debería encargarse de guardar la nueva URL en la base de datos.
    return this.profilesService.updateProfilePhoto(user.sub, file);
  }

  @Auth()
  @Get('me')
  async getMe(@CurrentUser() user: JwtUser) {
    const profile = await this.profilesService.findByUserId(user.sub);

    if (!profile) {
      throw new NotFoundException('Perfil no encontrado');
    }

    return profile;
  }

  @Auth()
  @Patch('me')
  async updateMe(
    @CurrentUser() user: JwtUser,
    @Body()
    dto: {
      full_name?: string;
      fullName?: string;
      phone?: string;
      address?: string;
    },
  ) {
    return this.profilesService.updatePersonalInfo(user.sub, dto);
  }

  @Auth()
  @Patch('me/roles')
  async updateRoles(
    @CurrentUser() user: JwtUser,
    @Body() dto: { roles: AppRoles[] },
  ) {
    return this.profilesService.updateRoles(user.sub, dto.roles);
  }

  @Auth()
  @Patch('me/active-role')
  async changeActiveRole(
    @CurrentUser() user: JwtUser,
    @Body()
    dto: {
      active_role?: AppRoles | 'technician';
      role?: AppRoles | 'technician';
    },
  ) {
    const sentRole = dto.active_role || dto.role;

    if (!sentRole) {
      throw new BadRequestException('El campo active_role o role es requerido');
    }

    const roleToSet = sentRole === 'technician' ? AppRoles.WORKER : sentRole;

    return this.profilesService.changeActiveRole(user, roleToSet as AppRoles);
  }
}
