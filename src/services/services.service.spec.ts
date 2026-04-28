import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { ServicesService } from './services.service';
import { SupabaseService } from '../supabase/supabase.service';

describe('ServicesService', () => {
  let service: ServicesService;
  let fromMock: jest.Mock;

  beforeEach(async () => {
    fromMock = jest.fn();

    const moduleRef = await Test.createTestingModule({
      providers: [
        ServicesService,
        {
          provide: SupabaseService,
          useValue: {
            sb: {
              from: fromMock,
            },
          },
        },
      ],
    }).compile();

    service = moduleRef.get<ServicesService>(ServicesService);
  });

  it('retorna oportunidades disponibles para trabajador en su misma zona', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: 'worker-1',
                    city: 'Bogota',
                    is_active: true,
                    status: 'verified',
                    roles: ['worker'],
                    active_role: 'worker',
                  },
                  error: null,
                }),
            }),
          }),
        };
      }

      if (table === 'worker_skills') {
        return {
          select: () => ({
            eq: () => ({
              eq: () =>
                Promise.resolve({
                  data: [{ category_id: 'cat-1' }],
                  error: null,
                }),
            }),
          }),
        };
      }

      if (table === 'services') {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                neq: () => ({
                  in: () => ({
                    order: () =>
                      Promise.resolve({
                        data: [
                          {
                            id: 'service-1',
                            title: 'Instalacion de cerradura',
                            address: 'Calle 123',
                            city: 'bogota',
                            status: 'requested',
                            budget_min: 100000,
                            budget_max: 150000,
                            scheduled_at: '2026-04-29T15:00:00.000Z',
                            urgency_level: 'medium',
                            assigned_worker_id: null,
                            client_id: 'client-1',
                            created_at: '2026-04-28T12:00:00.000Z',
                            category: { name: 'Cerrajeria' },
                            service_option: { title: 'Cambio de chapa' },
                            proposals: [],
                          },
                          {
                            id: 'service-2',
                            title: 'No deberia aparecer',
                            address: 'Calle 456',
                            city: 'Medellin',
                            status: 'requested',
                            budget_min: 80000,
                            budget_max: 120000,
                            scheduled_at: null,
                            urgency_level: 'low',
                            assigned_worker_id: null,
                            client_id: 'client-2',
                            created_at: '2026-04-28T11:00:00.000Z',
                            category: { name: 'Cerrajeria' },
                            service_option: { title: 'Apertura' },
                            proposals: [],
                          },
                        ],
                        error: null,
                      }),
                  }),
                }),
              }),
            }),
          }),
        };
      }

      return {};
    });

    const response = await service.findAvailableOpportunities('worker-1');

    expect(response.total).toBe(1);
    expect(response.opportunities[0]).toMatchObject({
      service_id: 'service-1',
      type: 'Cambio de chapa',
      location: {
        city: 'bogota',
        zone: 'bogota',
      },
    });
  });

  it('excluye servicios a los que el trabajador ya aplicó', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: 'worker-1',
                    city: 'Bogota',
                    is_active: true,
                    status: 'verified',
                    roles: ['worker'],
                    active_role: 'worker',
                  },
                  error: null,
                }),
            }),
          }),
        };
      }

      if (table === 'worker_skills') {
        return {
          select: () => ({
            eq: () => ({
              eq: () =>
                Promise.resolve({
                  data: [{ category_id: 'cat-1' }],
                  error: null,
                }),
            }),
          }),
        };
      }

      if (table === 'services') {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                neq: () => ({
                  in: () => ({
                    order: () =>
                      Promise.resolve({
                        data: [
                          {
                            id: 'service-1',
                            title: 'Servicio ya postulado',
                            address: 'Calle 123',
                            city: 'Bogota',
                            status: 'requested',
                            budget_min: 100000,
                            budget_max: 150000,
                            scheduled_at: null,
                            urgency_level: 'medium',
                            assigned_worker_id: null,
                            client_id: 'client-1',
                            created_at: '2026-04-28T12:00:00.000Z',
                            category: { name: 'Cerrajeria' },
                            service_option: { title: 'Cambio de chapa' },
                            proposals: [{ technician_id: 'worker-1' }],
                          },
                        ],
                        error: null,
                      }),
                  }),
                }),
              }),
            }),
          }),
        };
      }

      return {};
    });

    const response = await service.findAvailableOpportunities('worker-1');
    expect(response.total).toBe(0);
  });

  it('rechaza acceso si el usuario no es worker activo/verificado', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: 'worker-1',
                    city: 'Bogota',
                    is_active: true,
                    status: 'verified',
                    roles: ['client'],
                    active_role: 'client',
                  },
                  error: null,
                }),
            }),
          }),
        };
      }

      return {};
    });

    await expect(
      service.findAvailableOpportunities('worker-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
