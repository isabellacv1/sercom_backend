import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { createLocalJWKSet, jwtVerify, JWTPayload } from 'jose';

type AuthenticatedRequest = Request & {
  user?: JWTPayload;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('No token provided');
    }

    const token = authHeader.substring(7);

    const supabaseUrl = process.env.SUPABASE_URL;

    if (!supabaseUrl) {
      throw new UnauthorizedException(
        'Falta configuración de Supabase en el servidor',
      );
    }

    try {
      const jwksUrl = `${supabaseUrl}/auth/v1/.well-known/jwks.json`;
      console.log('JWKS URL:', jwksUrl);

      const response = await fetch(jwksUrl);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('JWKS ERROR:', response.status, errorText);
        throw new UnauthorizedException(
          'No se pudieron obtener las claves públicas',
        );
      }

      const jwks = await response.json();
      const localJwks = createLocalJWKSet(jwks);

      const { payload } = await jwtVerify(token, localJwks, {
        issuer: `${supabaseUrl}/auth/v1`,
        audience: 'authenticated',
      });

      request.user = payload;
      return true;
    } catch (error) {
      console.error('JWT ERROR:', error);

      if (error instanceof UnauthorizedException) {
        throw error;
      }

      throw new UnauthorizedException('Invalid token');
    }
  }
}
