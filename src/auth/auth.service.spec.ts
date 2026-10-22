import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

/**
 * Regresiones críticas de autenticación:
 *  - El login NO debe iniciar sesión en el cliente compartido (service key):
 *    si lo hace, todas las consultas posteriores del backend corren con el JWT
 *    del último usuario logueado.
 *  - El registro no depende del envío de correo y revierte el usuario de auth
 *    si falla la creación del perfil (evita cuentas huérfanas).
 */
describe('AuthService', () => {
  const makeService = () => {
    const sharedSignIn = jest.fn();
    const sessionSignIn = jest.fn();
    const createUser = jest.fn();
    const deleteUser = jest.fn();

    const supabaseService = {
      client: {
        auth: {
          signInWithPassword: sharedSignIn,
          admin: { createUser, deleteUser },
        },
      },
      createSessionClient: jest.fn(() => ({
        auth: { signInWithPassword: sessionSignIn },
      })),
    };
    const profilesService = {
      findByUserId: jest.fn(),
      create: jest.fn(),
    };

    const service = new AuthService(
      supabaseService as never,
      profilesService as never,
    );
    return { service, supabaseService, profilesService, sharedSignIn, sessionSignIn, createUser, deleteUser };
  };

  it('login usa un cliente de sesión aislado, nunca el compartido', async () => {
    const t = makeService();
    t.sessionSignIn.mockResolvedValue({
      data: { user: { id: 'u1', email: 'a@b.co' }, session: { access_token: 'tok', refresh_token: 'ref' } },
      error: null,
    });
    t.profilesService.findByUserId.mockResolvedValue({ full_name: 'Ana', roles: ['client'] });

    const res = await t.service.login({ email: 'A@B.co', password: '12345678' });

    expect(t.supabaseService.createSessionClient).toHaveBeenCalled();
    expect(t.sharedSignIn).not.toHaveBeenCalled();
    expect(t.sessionSignIn).toHaveBeenCalledWith({ email: 'a@b.co', password: '12345678' });
    expect(res.access_token).toBe('tok');
  });

  it('login con credenciales inválidas responde 401', async () => {
    const t = makeService();
    t.sessionSignIn.mockResolvedValue({ data: { user: null }, error: { message: 'Invalid' } });
    await expect(t.service.login({ email: 'x@y.co', password: 'bad' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('registro crea el usuario confirmado sin depender del correo', async () => {
    const t = makeService();
    t.createUser.mockResolvedValue({ data: { user: { id: 'new' } }, error: null });
    t.profilesService.create.mockResolvedValue({ roles: ['client'], active_role: 'client', status: 'verified' });

    const res = await t.service.register({ fullName: 'Ana Pérez', email: 'Ana@Mail.co', password: '12345678' });

    expect(t.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'ana@mail.co', email_confirm: true }),
    );
    expect(res.user.id).toBe('new');
  });

  it('registro con correo existente responde 409', async () => {
    const t = makeService();
    t.createUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'A user with this email address has already been registered', code: 'email_exists' },
    });
    await expect(
      t.service.register({ fullName: 'Ana', email: 'a@b.co', password: '12345678' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('si falla la creación del perfil, revierte el usuario de auth', async () => {
    const t = makeService();
    t.createUser.mockResolvedValue({ data: { user: { id: 'orphan' } }, error: null });
    t.profilesService.create.mockRejectedValue(new Error('insert failed'));

    await expect(
      t.service.register({ fullName: 'Ana', email: 'a@b.co', password: '12345678' }),
    ).rejects.toThrow('insert failed');
    expect(t.deleteUser).toHaveBeenCalledWith('orphan');
  });
});
