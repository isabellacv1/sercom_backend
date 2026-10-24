import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/decorators/current-user.decorator';
import { AppRoles } from '../auth/interfaces/app-roles';
import type { MulterFile } from '../common/types/multer.types';
import { CreateCredentialDto } from './dto/create-credential.dto';
import { ReviewCredentialDto } from './dto/review-credential.dto';
import { WorkerCredentialsService } from './worker-credentials.service';

@Controller('worker-credentials')
export class WorkerCredentialsController {
  constructor(private readonly credentials: WorkerCredentialsService) {}

  // GET /worker-credentials/me — los míos, con enlace al archivo
  @Auth(AppRoles.WORKER)
  @Get('me')
  listMine(@CurrentUser() user: JwtUser) {
    return this.credentials.listMine(user.sub);
  }

  // POST /worker-credentials/me — multipart: file + title, institution, fechas
  @Auth(AppRoles.WORKER)
  @Post('me')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  create(
    @CurrentUser() user: JwtUser,
    @Body() dto: CreateCredentialDto,
    @UploadedFile() file: MulterFile,
  ) {
    return this.credentials.create(user.sub, dto, file);
  }

  @Auth(AppRoles.WORKER)
  @Delete('me/:id')
  remove(
    @CurrentUser() user: JwtUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.credentials.remove(user.sub, id);
  }

  // GET /worker-credentials/workers/:workerId — vista pública (sin archivo)
  @Auth()
  @Get('workers/:workerId')
  listForWorker(@Param('workerId', ParseUUIDPipe) workerId: string) {
    return this.credentials.listForWorker(workerId);
  }

  // PATCH /worker-credentials/:id/review — admin verifica o rechaza
  @Auth(AppRoles.ADMIN)
  @Patch(':id/review')
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewCredentialDto,
  ) {
    return this.credentials.review(id, dto);
  }
}
