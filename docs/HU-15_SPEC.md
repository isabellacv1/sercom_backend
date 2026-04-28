# HU-15 - Propuesta de Servicio (Worker -> Client)

## 1. DTOs Exactos (Request/Response)

### CreateProposalDto (Request)
Este DTO es el contrato estricto entre el Frontend y el Backend para la creación de una propuesta. Debe asegurar que los datos cumplan con las reglas de negocio (precio, condiciones, disponibilidad).

```typescript
export class CreateProposalDto {
  @IsUUID()
  @IsNotEmpty()
  service_id: string;

  @IsNumber()
  @Min(0)
  price: number; // Monto en COP (implícito)

  @IsString()
  @IsNotEmpty()
  @MinLength(20)
  @MaxLength(500)
  message: string; // Detalles del servicio y alcance

  @IsDateString()
  available_date: string; // Fecha de disponibilidad para el servicio

  @IsString()
  @IsNotEmpty()
  available_from: string; // Inicio franja horaria (ej. "08:00")

  @IsString()
  @IsNotEmpty()
  available_to: string; // Fin franja horaria (ej. "12:00")
}
```

### ProposalResponseDto (Response)
Respuesta esperada al crear exitosamente la propuesta o al consultar las propuestas de una misión.

```typescript
export class ProposalResponseDto {
  id: string;
  serviceId: string;
  technicianId: string;
  price: number;
  message: string;
  estimatedDuration?: string;
  status: string; // 'pending', 'accepted', 'rejected'
  availableDate: string;
  availableFrom: string;
  availableTo: string;
  createdAt: Date;
  worker?: {
    id: string;
    name: string;
    rating: number;
    ratingCount: number;
    profileImageUrl: string;
  };
}
```

## 2. Políticas de Seguridad RLS de Supabase (Row Level Security)

Para garantizar la seguridad de los datos en la tabla `proposals`, se deben implementar las siguientes políticas de RLS:

1. **Insert (Worker):** Un usuario solo puede insertar una propuesta si su ID (`auth.uid()`) coincide con el `technician_id` de la propuesta.
   ```sql
   CREATE POLICY "Workers can create proposals" ON proposals
   FOR INSERT WITH CHECK (auth.uid() = technician_id);
   ```

2. **Select (Worker/Client):** 
   - Un trabajador puede ver sus propias propuestas.
   - El cliente creador de la solicitud (misión) puede ver las propuestas asociadas a su `service_id`.
   ```sql
   CREATE POLICY "Users can view relevant proposals" ON proposals
   FOR SELECT USING (
     auth.uid() = technician_id 
     OR 
     auth.uid() = (SELECT client_id FROM services WHERE id = proposals.service_id)
   );
   ```

3. **Update (Worker):** Un trabajador solo puede modificar su propuesta si el estado sigue siendo 'pending'.
   ```sql
   CREATE POLICY "Workers can update own pending proposals" ON proposals
   FOR UPDATE USING (auth.uid() = technician_id AND status = 'pending');
   ```

## 3. Lógica de Validación de Unicidad

La regla de unicidad (máximo 1 propuesta por trabajador por misión) debe implementarse en dos capas para garantizar integridad:

1. **Database Constraint (Supabase/PostgreSQL):**
   Se requiere un índice único compuesto en la tabla `proposals`. Esto previene condiciones de carrera (Race Conditions).
   ```sql
   ALTER TABLE proposals 
   ADD CONSTRAINT unique_proposal_per_worker_service 
   UNIQUE (service_id, technician_id);
   ```

2. **Application Logic (NestJS):**
   En el servicio `ProposalsService`, se debe validar antes de la inserción y capturar el error amigablemente con un `ConflictException` (actualmente ya implementado, pero reforzado con la restricción de BD).
   ```typescript
   // Check for duplicate proposals
   const existingProposalResponse = await this.supabaseService.sb
     .from('proposals')
     .select('id')
     .eq('service_id', dto.service_id)
     .eq('technician_id', technicianId)
     .maybeSingle();

   if (existingProposalResponse.data) {
     throw new ConflictException('Ya has enviado una propuesta para este servicio');
   }
   ```

## 4. Dependencias del Módulo `ProposalsModule`

- **SupabaseModule:** Para interactuar con la base de datos y validar permisos.
- **AuthModule:** Para extraer y validar el JWT (`CurrentUser`, `JwtAuthGuard`).
- **ServicesModule (Recomendado):** Delega la validación del estado de los servicios si la complejidad aumenta, o en su defecto mantener queries simples en `ProposalsService`.
