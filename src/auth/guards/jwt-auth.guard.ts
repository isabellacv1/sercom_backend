import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { createClient } from '@supabase/supabase-js';
import { Database } from 'src/types/supabase';

type AuthenticatedRequest = Request & {
  user?: {
    sub: string;
    email?: string;
    roles?: string[];
    active_role?: string;
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
    const supabaseKey = process.env.SUPABASE_SECRET_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new UnauthorizedException('Supabase no configurado');
    }

    let sub: string;
    let email: string;

    try {
      const jwksUrl = `${supabaseUrl}/auth/v1/.well-known/jwks.json`;
      const jwks = await (await fetch(jwksUrl)).json();
      const localJwks = createLocalJWKSet(jwks);

      const { payload } = await jwtVerify(token, localJwks, {
        issuer: `${supabaseUrl}/auth/v1`,
        audience: 'authenticated',
      });

      sub = payload.sub as string;
      email = payload.email as string;
    } catch {
      throw new UnauthorizedException('Token inválido');
    }

    const supabase = createClient<Database>(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: profile } = await supabase
      .from('profiles')
      .select('roles, active_role')
      .eq('id', sub)
      .maybeSingle();

    request.user = {
      sub,
      email,
      roles: profile?.roles ?? [],
      active_role: profile?.active_role ?? undefined,
    };

    return true;
  }
}