import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  ValidationPipe,
} from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { map } from 'rxjs/operators';
export function fail(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): never {
  throw new HttpException(
    { code, message, ...(details ? { details } : {}) },
    status,
  );
}
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const status = error instanceof HttpException ? error.getStatus() : 500;
    const body = error instanceof HttpException ? error.getResponse() : null;
    const coded =
      typeof body === 'object' && body && 'code' in body
        ? body
        : {
            code:
              (
                {
                  400: 'INVALID_FORMAT',
                  401: 'INVALID_TOKEN',
                  403: 'PERMISSION_DENIED',
                  404: 'RESOURCE_NOT_FOUND',
                  422: 'VALIDATION_FAILED',
                  429: 'RATE_LIMITED',
                  500: 'INTERNAL_ERROR',
                  503: 'SERVICE_UNAVAILABLE',
                } as Record<number, string>
              )[status] || 'INTERNAL_ERROR',
            message:
              status === 500 ? 'Internal server error' : 'Request rejected',
          };
    response.status(status).json({
      success: false,
      error: { ...coded, requestId: response.getHeader('X-Request-Id') },
    });
  }
}
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    return next
      .handle()
      .pipe(
        map((data) =>
          context.switchToHttp().getRequest<Request>().path === '/health'
            ? data
            : { success: true, data },
        ),
      );
  }
}
export function configureHttp(app: INestApplication) {
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.enableCors({ origin: true, exposedHeaders: ['X-Request-Id'] });
  app.use((_req: Request, res: Response, next: () => void) => {
    res.setHeader('X-Request-Id', randomUUID());
    next();
  });
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new EnvelopeInterceptor());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) =>
        new HttpException(
          {
            code: 'VALIDATION_FAILED',
            message: 'Invalid request',
            details: errors.map((e) => ({
              field: e.property,
              constraints: e.constraints,
            })),
          },
          422,
        ),
    }),
  );
}
