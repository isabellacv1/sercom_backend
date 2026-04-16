import { ConflictException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { RegisterDto } from './dto/register.dto';
import { UsersService } from '../users/users.service';
import { ProfilesService } from '../profiles/profiles.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly profilesService: ProfilesService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase().trim();

    const existingUser = await this.usersService.findByEmail(email);

    if (existingUser) {
      throw new ConflictException('El correo electrónico ya está registrado');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const user = await this.usersService.createAuthUser({
      email,
      passwordHash,
    });

    await this.profilesService.create(user.id, {
      fullName: dto.fullName,
      email,
    });

    return {
      message: 'Registro exitoso',
      user: {
        id: user.id,
        email: user.email,
        fullName: dto.fullName,
        status: 'pending_documents',
      },
    };
  }
}
