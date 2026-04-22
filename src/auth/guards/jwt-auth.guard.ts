import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { createLocalJWKSet, jwtVerify } from 'jose';

type AuthenticatedRequest = Request & {
  user?: {
    sub: string;
    email?: string;
  };
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
      throw new UnauthorizedException('Supabase no configurado');
    }

    try {
      const jwksUrl = `${supabaseUrl}/auth/v1/.well-known/jwks.json`;
      const jwks = await (await fetch(jwksUrl)).json();
      const localJwks = createLocalJWKSet(jwks);

      const { payload } = await jwtVerify(token, localJwks, {
        issuer: `${supabaseUrl}/auth/v1`,
        audience: 'authenticated',
      });

      request.user = {
        sub: payload.sub as string,
        email: payload.email as string,
      };

      return true;
    } catch {
      throw new UnauthorizedException('Token inválido');
    }
  }
}