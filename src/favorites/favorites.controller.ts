import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { FavoritesService } from './favorites.service';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser, JwtUser } from '../auth/decorators/current-user.decorator';

@Auth()
@Controller('favorites')
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Get()
  getFavorites(@CurrentUser() user: JwtUser) {
    return this.favoritesService.getFavorites(user.sub);
  }

  @Post(':technicianId')
  addFavorite(
    @CurrentUser() user: JwtUser,
    @Param('technicianId') technicianId: string,
  ) {
    return this.favoritesService.addFavorite(user.sub, technicianId);
  }

  @Delete(':technicianId')
  removeFavorite(
    @CurrentUser() user: JwtUser,
    @Param('technicianId') technicianId: string,
  ) {
    return this.favoritesService.removeFavorite(user.sub, technicianId);
  }

  @Get(':technicianId/check')
  checkFavorite(
    @CurrentUser() user: JwtUser,
    @Param('technicianId') technicianId: string,
  ) {
    return this.favoritesService
      .isFavorite(user.sub, technicianId)
      .then((isFavorite) => ({ isFavorite }));
  }
}
