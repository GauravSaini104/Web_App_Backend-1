import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, Observable } from 'rxjs';

export interface ApiResponse<T> {
  success: true;
  data: T;
}

/**
 * Wraps every successful response in the same envelope
 * ({ success: true, data }) so it mirrors the error envelope produced by
 * HttpExceptionFilter. Callers can then always check `success` first.
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T>> {
    return next.handle().pipe(map((data) => ({ success: true, data })));
  }
}
