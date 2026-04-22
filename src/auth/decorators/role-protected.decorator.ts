import { SetMetadata } from '@nestjs/common';
import { AppRoles } from '../interfaces/app-roles';

export const RoleProtected = (...args: AppRoles[]) => {
  return SetMetadata('roles', args);
};