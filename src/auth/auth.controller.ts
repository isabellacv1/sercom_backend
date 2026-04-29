import {
  Body,
  Controller,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

type RegisterUploadedFiles = {
  cedula_document?: Express.Multer.File[];
  worker_photo?: Express.Multer.File[];
};

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
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
