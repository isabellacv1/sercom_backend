import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { PayoutAccountDto } from './dto/payout-account.dto';

const COLUMNS =
  'method, account_number, bank_name, account_type, holder_name, holder_document, updated_at';

/**
 * Datos donde SerCom le transfiere al profesional lo que gana (Nequi,
 * Daviplata o cuenta bancaria). Mientras el pago es manual, el admin los ve
 * en GET /payments/admin/payouts.
 */
@Injectable()
export class PayoutAccountService {
  constructor(private readonly supabaseService: SupabaseService) {}

  private get db() {
    return this.supabaseService.sbRaw;
  }

  async get(workerId: string) {
    const { data, error } = await this.db
      .from('worker_payout_accounts')
      .select(COLUMNS)
      .eq('worker_id', workerId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);
    return { payout_account: data ?? null };
  }

  async upsert(workerId: string, dto: PayoutAccountDto) {
    const { data: profile } = await this.db
      .from('profiles')
      .select('roles, active_role')
      .eq('id', workerId)
      .maybeSingle();
    const roles: string[] = Array.isArray(profile?.roles) ? profile.roles : [];
    if (!roles.includes('worker') && profile?.active_role !== 'worker') {
      throw new ForbiddenException(
        'Solo los profesionales registran dónde recibir pagos',
      );
    }

    const isBank = dto.method === 'bank_account';
    const { data, error } = await this.db
      .from('worker_payout_accounts')
      .upsert(
        {
          worker_id: workerId,
          method: dto.method,
          account_number: dto.account_number,
          bank_name: isBank ? dto.bank_name?.trim() : null,
          account_type: isBank ? dto.account_type : null,
          holder_name: dto.holder_name.trim(),
          holder_document: dto.holder_document ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'worker_id' },
      )
      .select(COLUMNS)
      .single();

    if (error) throw new InternalServerErrorException(error.message);
    return { message: 'Datos de pago guardados', payout_account: data };
  }

  /** Para el listado del admin: cuentas de varios profesionales. */
  async findByWorkers(workerIds: string[]) {
    if (!workerIds.length) return new Map<string, any>();
    const { data } = await this.db
      .from('worker_payout_accounts')
      .select(`worker_id, ${COLUMNS}`)
      .in('worker_id', workerIds);
    return new Map((data ?? []).map((a: any) => [a.worker_id, a]));
  }
}
