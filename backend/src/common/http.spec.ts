import { validationDetails, ApiExceptionFilter } from './http.js';
import { HttpException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
describe('C05 FieldErrorDTO and unsafe errors', () => {
  it('keeps nested dot paths and field/code/message without raw values', () => {
    expect(
      validationDetails([
        {
          property: 'existing_skills',
          children: [
            {
              property: '0',
              children: [
                {
                  property: 'name',
                  constraints: { isNotEmpty: 'unsafe secret value' },
                },
              ],
            },
          ],
        },
      ]),
    ).toEqual([
      {
        field: 'existing_skills.0.name',
        code: 'VALIDATION_FAILED',
        message: 'Field has an invalid value',
      },
    ]);
  });
  it('hides raw exception data and keeps the request ID', () => {
    const response = {
      getHeader: vi.fn(() => 'request-id'),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const host = {
      switchToHttp: () => ({ getResponse: () => response }),
    } as unknown as ArgumentsHost;
    new ApiExceptionFilter().catch(
      new HttpException(
        { code: 'INTERNAL_ERROR', message: 'postgres secret password' },
        500,
      ),
      host,
    );
    expect(response.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        requestId: 'request-id',
        details: [],
        retryable: false,
        retryAfterSeconds: null,
      },
    });
  });
});
