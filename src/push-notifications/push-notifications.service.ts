import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { SupabaseService } from '../supabase/supabase.service';
import { RegisterTokenDto } from './dto/register-token.dto';

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

@Injectable()
export class PushNotificationsService {
  private readonly logger = new Logger(PushNotificationsService.name);
  private firebaseReady = false;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
  ) {
    this.initFirebase();
  }

  private initFirebase(): void {
    // Evitar inicializar dos veces si el módulo se recarga en tests
    if (admin.apps.length > 0) {
      this.firebaseReady = true;
      return;
    }

    const projectId = this.configService.get<string>('FIREBASE_PROJECT_ID');
    const clientEmail = this.configService.get<string>('FIREBASE_CLIENT_EMAIL');
    const rawPrivateKey = this.configService.get<string>('FIREBASE_PRIVATE_KEY');

    if (!projectId || !clientEmail || !rawPrivateKey) {
      this.logger.warn(
        'Credenciales de Firebase no configuradas ' +
          '(FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY). ' +
          'Las notificaciones push están desactivadas.',
      );
      return;
    }

    // Las variables de entorno escapan los saltos de línea como \n literal;
    // firebase-admin necesita el carácter de nueva línea real.
    const privateKey = rawPrivateKey.replace(/\\n/g, '\n');

    try {
      admin.initializeApp({
        credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
      });
      this.firebaseReady = true;
      this.logger.log('Firebase Admin SDK inicializado correctamente.');
    } catch (err) {
      this.logger.error(
        `Error al inicializar Firebase Admin SDK: ${(err as Error).message}`,
      );
    }
  }

  private get db() {
    return this.supabaseService.sbRaw;
  }

  // ─── Registro de tokens ──────────────────────────────────────────────────────

  async registerToken(userId: string, dto: RegisterTokenDto): Promise<void> {
    const { error } = await this.db.from('push_tokens').upsert(
      {
        user_id: userId,
        token: dto.token,
        platform: dto.platform,
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,token' },
    );

    if (error) {
      this.logger.error(`Error registrando push token: ${error.message}`);
      throw error;
    }
  }

  async deactivateTokensForUser(userId: string): Promise<void> {
    const { error } = await this.db
      .from('push_tokens')
      .update({ is_active: false })
      .eq('user_id', userId);

    if (error) {
      this.logger.error(`Error desactivando tokens: ${error.message}`);
    }
  }

  // ─── Envío de notificaciones ─────────────────────────────────────────────────

  async sendToUser(userId: string, payload: PushPayload): Promise<void> {
    if (!this.firebaseReady) {
      this.logger.debug(
        `Push desactivado. Notificación no enviada a usuario ${userId}: "${payload.title}"`,
      );
      return;
    }

    const { data: tokens } = await this.db
      .from('push_tokens')
      .select('token, platform')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (!tokens || tokens.length === 0) {
      this.logger.debug(
        `Usuario ${userId} no tiene tokens push registrados.`,
      );
      return;
    }

    await Promise.allSettled(
      tokens.map((row: any) => this.sendOne(row.token, payload)),
    );
  }

  private async sendOne(token: string, payload: PushPayload): Promise<void> {
    try {
      await admin.messaging().send({
        token,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: payload.data ?? {},
        android: {
          priority: 'high',
          notification: { sound: 'default' },
        },
        apns: {
          payload: { aps: { sound: 'default' } },
        },
      });
    } catch (err: any) {
      // Token inválido o vencido — desactivar para no acumular basura
      const invalidTokenCodes = [
        'messaging/registration-token-not-registered',
        'messaging/invalid-registration-token',
      ];
      if (invalidTokenCodes.includes(err?.code)) {
        this.logger.debug(
          `Token inválido (${err.code}), marcando como inactivo.`,
        );
        await this.db
          .from('push_tokens')
          .update({ is_active: false })
          .eq('token', token);
      } else {
        this.logger.error(`Error enviando FCM v1: ${err?.message ?? err}`);
      }
    }
  }
}
