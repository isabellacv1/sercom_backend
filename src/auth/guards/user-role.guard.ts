import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppRoles } from '../interfaces/app-roles';

@Injectable()
export class UserRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const validRoles = this.reflector.getAllAndOverride<AppRoles[]>(
      'roles',
      [context.getHandler(), context.getClass()],
    );

    if (!validRoles || validRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException('Usuario no autenticado');
    }

    const { roles, active_role } = user;

    if (!Array.isArray(roles) || roles.length === 0) {
      throw new ForbiddenException('Usuario sin roles asignados');
    }

    if (!active_role || !roles.includes(active_role)) {
      throw new ForbiddenException('Rol activo inválido');
    }

    const hasAccess = validRoles.includes(active_role);

    if (!hasAccess) {
      throw new ForbiddenException(
        `No tienes permisos con el rol actual: ${active_role}`,
      );
    }

    return true;
  }
}