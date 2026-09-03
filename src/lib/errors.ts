/** Erros de domínio com código estável e status HTTP. */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  unauthorized: (msg = 'Não autenticado') => new AppError('UNAUTHORIZED', msg, 401),
  forbidden: (msg = 'Sem permissão') => new AppError('FORBIDDEN', msg, 403),
  notFound: (resource = 'Recurso') => new AppError('NOT_FOUND', `${resource} não encontrado`, 404),
  conflict: (msg: string) => new AppError('CONFLICT', msg, 409),
  validation: (msg: string, details?: unknown) =>
    new AppError('VALIDATION_ERROR', msg, 422, details),
  badRequest: (msg: string) => new AppError('BAD_REQUEST', msg, 400),
  dbUnavailable: () =>
    new AppError(
      'DB_UNAVAILABLE',
      'Banco de dados não configurado. Preencha DATABASE_URL no .env.',
      503,
    ),
  notImplemented: (feature: string) =>
    new AppError('NOT_IMPLEMENTED', `${feature} ainda não implementado`, 501),
};
