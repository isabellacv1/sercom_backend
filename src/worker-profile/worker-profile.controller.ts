import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AppRoles } from '../auth/interfaces/app-roles';
import { AddPortfolioItemDto } from './dto/add-portfolio-item.dto';
import { SetCoverageZonesDto, UpdateWorkerProfileDto } from './dto/update-worker-profile.dto';
import { WorkerProfileService } from './worker-profile.service';
import type { JwtUser } from '../auth/decorators/current-user.decorator';
 
@Controller('worker-profile')
export class WorkerProfileController {
  constructor(private readonly workerProfileService: WorkerProfileService) {}
 
  // GET /worker-profile/me
  // Vista completa: perfil + zonas + portafolio + skills + can_publish
@Auth(AppRoles.WORKER)
  @Get('me')
  getMyWorkerProfile(@CurrentUser() user: JwtUser) {
    return this.workerProfileService.getMyWorkerProfile(user.sub);
  }
 
  // PATCH /worker-profile/me/bio
  // Actualizar biografía técnica (máx. 1000 chars)
  @Auth(AppRoles.WORKER)
  @Patch('me/bio')
  updateBio(@CurrentUser() user: JwtUser, @Body() dto: UpdateWorkerProfileDto) {
    return this.workerProfileService.updateBio(user.sub, dto);
  }
 
  // GET /worker-profile/me/zones
  // Ver zonas de cobertura actuales
  @Auth(AppRoles.WORKER)
  @Get('me/zones')
  getCoverageZones(@CurrentUser() user: JwtUser) {
    return this.workerProfileService.getCoverageZones(user.sub);
  }
 
  // PATCH /worker-profile/me/zones
  // Reemplaza todas las zonas (operación completa)
  @Auth(AppRoles.WORKER)
  @Patch('me/zones')
  setCoverageZones(@CurrentUser() user: JwtUser, @Body() dto: SetCoverageZonesDto) {
    return this.workerProfileService.setCoverageZones(user.sub, dto);
  }
 
  // GET /worker-profile/me/portfolio
  // Ver items del portafolio
  @Auth(AppRoles.WORKER)
  @Get('me/portfolio')
  getPortfolio(@CurrentUser() user: JwtUser) {
    return this.workerProfileService.getPortfolio(user.sub);
  }
 
  // POST /worker-profile/me/portfolio
  // Agregar un item al portafolio (máx. 10)
  @Auth(AppRoles.WORKER)
  @Post('me/portfolio')
  addPortfolioItem(@CurrentUser() user: JwtUser, @Body() dto: AddPortfolioItemDto) {
    return this.workerProfileService.addPortfolioItem(user.sub, dto);
  }
 
  // DELETE /worker-profile/me/portfolio/:itemId
  // Eliminar un item del portafolio
  @Auth(AppRoles.WORKER)
  @Delete('me/portfolio/:itemId')
  removePortfolioItem(
    @CurrentUser() user: JwtUser,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    return this.workerProfileService.removePortfolioItem(user.sub, itemId);
  }
 
  // POST /worker-profile/me/publish
  // Publica el perfil (requiere: verified + zonas + categorías)
  @Auth(AppRoles.WORKER)
  @Post('me/publish')
  publishProfile(@CurrentUser() user: JwtUser) {
    return this.workerProfileService.publishProfile(user.sub);
  }
 
  // POST /worker-profile/me/unpublish
  // Despublica el perfil
  @Auth(AppRoles.WORKER)
  @Post('me/unpublish')
  unpublishProfile(@CurrentUser() user: JwtUser) {
    return this.workerProfileService.unpublishProfile(user.sub);
  }
}
 
