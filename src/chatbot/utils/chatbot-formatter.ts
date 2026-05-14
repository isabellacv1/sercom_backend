export function cleanChatbotResponse(text: string): string {
  if (!text || text.trim().length === 0) {
    return 'Cuéntame más detalles sobre el servicio que necesitas.';
  }

  return (
    text
      // eliminar markdown
      .replace(/\*\*/g, '')
      .replace(/\*/g, '')
      .replace(/#/g, '')
      .replace(/`/g, '')

      // eliminar saltos excesivos
      .replace(/\n+/g, ' ')

      // limpiar espacios dobles
      .replace(/\s+/g, ' ')

      // limitar longitud
      .trim()
      .slice(0, 300)
  );
}
