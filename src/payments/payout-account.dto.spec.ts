import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PayoutAccountDto } from './dto/payout-account.dto';

const errorsFor = (body: Record<string, unknown>) =>
  validateSync(plainToInstance(PayoutAccountDto, body)).map((e) => e.property);

describe('PayoutAccountDto', () => {
  it('Nequi solo necesita celular y titular', () => {
    expect(
      errorsFor({ method: 'nequi', account_number: '3001234567', holder_name: 'Ana Pérez' }),
    ).toEqual([]);
  });

  it('cuenta bancaria exige banco y tipo de cuenta', () => {
    expect(
      errorsFor({ method: 'bank_account', account_number: '12345678901', holder_name: 'Ana' }).sort(),
    ).toEqual(['account_type', 'bank_name']);
  });

  it('rechaza números con letras o espacios', () => {
    expect(
      errorsFor({ method: 'nequi', account_number: '300 123 45', holder_name: 'Ana' }),
    ).toEqual(['account_number']);
  });
});
