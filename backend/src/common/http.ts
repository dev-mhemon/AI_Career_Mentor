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
import type { ValidationError } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { map } from 'rxjs/operators';
export interface FieldError {
  field: string;
  code: string;
  message: string;
}
class ContractException extends HttpException {}
export function validationDetails(
  errors: ValidationError[],
  prefix = '',
): FieldError[] {
  return errors.flatMap((error) => {
    const field = prefix ? `${prefix}.${error.property}` : error.property;
    return [
      ...Object.keys(error.constraints || {}).map((constraint) => ({
        field,
        code:
          constraint === 'isTimeZone'
            ? 'INVALID_TIMEZONE'
            : constraint === 'isIn'
              ? 'INVALID_ENUM_VALUE'
              : 'VALIDATION_FAILED',
        message:
          constraint === 'isTimeZone'
            ? 'Choose a valid IANA timezone'
            : 'Field has an invalid value',
      })),
      ...validationDetails(error.children || [], field),
    ];
  });
}
export function fail(
  status: number,
  code: string,
  message: string,
  details?: FieldError[],
  retryable?: boolean,
  retryAfterSeconds?: number,
): never {
  throw new ContractException(
    {
      code,
      message,
      details: details || [],
      retryable: retryable ?? [429, 502, 503, 504].includes(status),
      retryAfterSeconds: retryAfterSeconds ?? null,
    },
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
      error instanceof ContractException &&
      typeof body === 'object' &&
      body &&
      'code' in body
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
    if (
      'retryAfterSeconds' in coded &&
      typeof coded.retryAfterSeconds === 'number'
    )
      response.setHeader('Retry-After', coded.retryAfterSeconds);
    response.status(status).json({
      success: false,
      error: {
        details: [],
        retryable: [429, 502, 503, 504].includes(status),
        retryAfterSeconds: null,
        ...coded,
        requestId: response.getHeader('X-Request-Id'),
      },
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
export function configureHttp(
  app: INestApplication,
  trustedProxies: string[] = [],
) {
  app.getHttpAdapter().getInstance().set('trust proxy', trustedProxies);
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.enableCors({
    origin: true,
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
  });
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
      exceptionFactory: (errors) => {
        const details = validationDetails(errors);
        return new ContractException(
          {
            code: details.some((d) => d.code === 'INVALID_TIMEZONE')
              ? 'INVALID_TIMEZONE'
              : 'VALIDATION_FAILED',
            message: 'Invalid request',
            details,
            retryable: false,
            retryAfterSeconds: null,
          },
          422,
        );
      },
    }),
  );
}
