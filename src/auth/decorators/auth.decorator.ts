import { applyDecorators, UseGuards } from '@nestjs/common';
import { RoleProtected } from './role-protected.decorator';
import { UserRoleGuard } from '../guards/user-role.guard';
import { AppRoles } from '../interfaces/app-roles';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';

export const Auth = (...roles: AppRoles[]) => {
  return applyDecorators(
    RoleProtected(...roles),
    UseGuards(JwtAuthGuard, UserRoleGuard),
  );
};