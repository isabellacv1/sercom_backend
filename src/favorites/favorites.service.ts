import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

const TECHNICIAN_SELECT = `
  id,
  technician_id,
  created_at,
  technician:profiles!technician_id(
    id,
    full_name,
    specialty,
    rating_avg,
    rating_count,
    profile_image_url,
    bio,
    city
  )
`;

@Injectable()
export class FavoritesService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async getFavorites(clientId: string) {
    const { data, error } = await this.supabaseService.sbRaw
      .from('favorites')
      .select(TECHNICIAN_SELECT)
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new InternalServerErrorException(
        `Error al obtener favoritos: ${error.message}`,
      );
    }

    return (data ?? []).map((row: any) => this.mapToTechnician(row));
  }

  async addFavorite(clientId: string, technicianId: string) {
    const { data: profile, error: profileError } =
      await this.supabaseService.sbRaw
        .from('profiles')
        .select('id')
        .eq('id', technicianId)
        .maybeSingle();

    if (profileError) {
      throw new InternalServerErrorException('Error al verificar el técnico');
    }
    if (!profile) {
      throw new NotFoundException('El técnico no existe');
    }

    const { data, error } = await this.supabaseService.sbRaw
      .from('favorites')
      .insert({ client_id: clientId, technician_id: technicianId })
      .select(TECHNICIAN_SELECT)
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new ConflictException('El técnico ya está en tus favoritos');
      }
      throw new InternalServerErrorException(
        `Error al agregar favorito: ${error.message}`,
      );
    }

    return this.mapToTechnician(data);
  }

  async removeFavorite(clientId: string, technicianId: string) {
    const { error } = await this.supabaseService.sbRaw
      .from('favorites')
      .delete()
      .eq('client_id', clientId)
      .eq('technician_id', technicianId);

    if (error) {
      throw new InternalServerErrorException(
        `Error al eliminar favorito: ${error.message}`,
      );
    }

    return { message: 'Favorito eliminado correctamente' };
  }

  async isFavorite(clientId: string, technicianId: string): Promise<boolean> {
    const { data, error } = await this.supabaseService.sbRaw
      .from('favorites')
      .select('id')
      .eq('client_id', clientId)
      .eq('technician_id', technicianId)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException('Error al verificar favorito');
    }

    return data !== null;
  }

  private mapToTechnician(row: any) {
    const t = row.technician ?? {};
    return {
      id: t.id ?? row.technician_id,
      name: t.full_name ?? '',
      title: t.specialty ?? '',
      rating: Number(t.rating_avg ?? 0),
      reviewsCount: Number(t.rating_count ?? 0),
      totalMissions: null,
      yearsExperience: null,
      distance: t.city ?? '',
      proposedPrice: 0,
      profileImageUrl: t.profile_image_url ?? '',
      isRecommended: false,
      tags: [],
      about: t.bio ?? '',
      portfolioUrls: [],
    };
  }
}
