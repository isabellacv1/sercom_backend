/**
 * Catálogo canónico de categorías y servicios válidos del chatbot.
 * Debe estar siempre sincronizado con los datos en service_categories y service_options de la BD.
 *
 * Categorías activas: Plomería, Electricidad, Aseo
 * (Cerrajería existe en BD pero no se expone en el chatbot por decisión de producto)
 */
export const SERVICE_CATALOG: Record<string, string[]> = {
  'Plomería': [
    'Destape de tuberías',
    'Instalación de grifería',
    'Reparación de fugas',
    'Reparación de sanitario',
  ],
  'Electricidad': [
    'Domótica básica',
    'Instalación de luminarias',
    'Instalación de tomacorrientes',
    'Reparación de tablero',
  ],
  'Aseo': [
    'Limpieza hogar',
    'Limpieza profunda',
    'Limpieza post obra',
  ],
};

export const VALID_CATEGORIES = Object.keys(SERVICE_CATALOG);

export function getServicesForCategory(category: string): string[] {
  return SERVICE_CATALOG[category] ?? [];
}
