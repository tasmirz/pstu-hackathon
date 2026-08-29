import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Response } from 'express';
import { AppError } from '@pstu/shared';

/** Every response error is `{ error, message, details? }` — API.md's wire contract. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof AppError) {
      res.status(exception.httpStatus).json(exception.toJSON());
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message = typeof body === 'string' ? body : ((body as any)?.message ?? exception.message);
      res.status(status).json({
        error: 'VALIDATION_ERROR',
        message: Array.isArray(message) ? message.join('; ') : message,
      });
      return;
    }

    this.logger.error(exception instanceof Error ? exception.stack : exception);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Something went wrong' });
  }
}
