// Stub de `jose` para Jest: la librería real es ESM y los tests unitarios no
// verifican JWT (los guards se prueban con tokens reales en pruebas e2e).
module.exports = {
  createLocalJWKSet: () => () => undefined,
  jwtVerify: async () => {
    throw new Error('jwtVerify no disponible en tests unitarios');
  },
};
