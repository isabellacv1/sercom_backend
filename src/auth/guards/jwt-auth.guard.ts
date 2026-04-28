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
      console.log('Fetching JWKS from:', jwksUrl);
      const jwksResponse = await fetch(jwksUrl);
      if (!jwksResponse.ok) {
        console.error('Failed to fetch JWKS:', jwksResponse.statusText);
      }
      const jwks = await jwksResponse.json();
      const localJwks = createLocalJWKSet(jwks);

      // Decoding for debug
      const { decodeJwt } = await import('jose');
      const decoded = decodeJwt(token);
      console.log('JWT Decoded Payload:', decoded);

      const { payload } = await jwtVerify(token, localJwks);

      request.user = {
        sub: payload.sub as string,
        email: payload.email as string,
      };

      return true;
    } catch (err) {
      console.error('JWT Verification Error:', err);
      throw new UnauthorizedException(`Token inválido: ${err.message}`);
    }
  }
}
