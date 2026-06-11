import {
  Body,
  Controller,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import type { MulterFile } from '../common/types/multer.types';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import * as currentUserDecorator from './decorators/current-user.decorator';

type RegisterUploadedFiles = {
  cedula_document?: MulterFile[];
  worker_photo?: MulterFile[];
};

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('social-login')
  socialLogin(@Body('supabase_token') token: string) {
    return this.authService.socialLogin(token);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-email')
  changeEmail(
    @currentUserDecorator.CurrentUser() user: currentUserDecorator.JwtUser,
    @Body('new_email') newEmail: string,
  ) {
    return this.authService.changeEmail(user.sub, newEmail);
  }

  @Post('register')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'cedula_document', maxCount: 1 },
        { name: 'worker_photo', maxCount: 1 },
      ],
      {
        storage: memoryStorage(),
      },
    ),
  )
  register(
    @Body() dto: RegisterDto,
    @UploadedFiles() files: RegisterUploadedFiles,
  ) {
    return this.authService.register(dto, {
      cedulaDocument: files?.cedula_document?.[0] ?? null,
      workerPhoto: files?.worker_photo?.[0] ?? null,
    });
  }
}
