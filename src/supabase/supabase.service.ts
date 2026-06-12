import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Database } from 'src/types/supabase';

@Injectable()
export class SupabaseService {
  readonly client: SupabaseClient<Database>;
  readonly anonClient: SupabaseClient<Database>;

  constructor(private readonly configService: ConfigService) {
    const url = this.configService.get<string>('SUPABASE_URL');
    const key = this.configService.get<string>('SUPABASE_SECRET_KEY');
    const anonKey = this.configService.get<string>('SUPABASE_ANON_KEY');

    if (!url || !key) {
      throw new InternalServerErrorException(
        'Faltan SUPABASE_URL o SUPABASE_SECRET_KEY en el .env',
      );
    }

    this.client = createClient<Database>(url, key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Cliente con anon key — para signUp con envío real de email de verificación
    this.anonClient = createClient<Database>(url, anonKey ?? key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  get sb(): SupabaseClient<Database> {
    return this.client;
  }

  /** Cliente sin tipos estrictos — para tablas nuevas no incluidas en el schema generado */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get sbRaw(): SupabaseClient<any> {
    return this.client as SupabaseClient<any>;
  }
}