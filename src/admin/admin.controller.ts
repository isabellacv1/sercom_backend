import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorator';
import { AppRoles } from '../auth/interfaces/app-roles';
import { AdminService } from './admin.service';
import { CreateBannerDto, CreateCouponDto, UpdateActiveDto } from './dto/coupon.dto';

/** Panel de administración: solo usuarios con rol activo "admin". */
@Auth(AppRoles.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('overview')
  overview() {
    return this.admin.overview();
  }

  @Get('metrics')
  metrics() {
    return this.admin.metrics();
  }

  @Get('credentials')
  credentials(@Query('status') status?: string) {
    return this.admin.credentials(status ?? 'pending');
  }

  @Get('coupons')
  coupons() {
    return this.admin.coupons();
  }

  @Post('coupons')
  createCoupon(@Body() dto: CreateCouponDto) {
    return this.admin.createCoupon(dto);
  }

  @Patch('coupons/:id')
  setCouponActive(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateActiveDto) {
    return this.admin.setCouponActive(id, dto.active);
  }

  @Get('banners')
  banners() {
    return this.admin.banners();
  }

  @Post('banners')
  createBanner(@Body() dto: CreateBannerDto) {
    return this.admin.createBanner(dto);
  }

  @Patch('banners/:id')
  setBannerActive(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateActiveDto) {
    return this.admin.setBannerActive(id, dto.active);
  }
}
