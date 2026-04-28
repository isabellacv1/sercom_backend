import { Module } from '@nestjs/common';
import { ServicesController } from './services.controller';
import { ServicesService } from './services.service';
import { MissionsController } from './missions.controller';

@Module({
  controllers: [ServicesController, MissionsController],
  providers: [ServicesService],
})
export class ServicesModule {}
