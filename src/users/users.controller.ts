import {
  BadRequestException,
  Controller,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UsersDocumentsService } from './users-documents.service';
import type { MulterFile } from '../common/types/multer.types';

type JwtUser = {
  sub: string;
  email?: string;
  role?: string;
};

@Controller('users')
export class UsersController {
  constructor(private readonly usersDocumentsService: UsersDocumentsService) {}

  @UseGuards(JwtAuthGuard)
  @Post('me/documents')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'identityDocument', maxCount: 1 },
      { name: 'selfiePhoto', maxCount: 1 },
    ]),
  )
  async uploadDocuments(
    @CurrentUser() user: JwtUser,
    @UploadedFiles()
    files: {
      identityDocument?: MulterFile[];
      selfiePhoto?: MulterFile[];
    },
  ) {
    const identityDocument = files.identityDocument?.[0];
    const selfiePhoto = files.selfiePhoto?.[0];

    if (!identityDocument || !selfiePhoto) {
      throw new BadRequestException(
        'Debes cargar la cédula y la foto personal',
      );
    }

    return this.usersDocumentsService.uploadUserDocuments(
      user.sub,
      identityDocument,
      selfiePhoto,
    );
  }
}
