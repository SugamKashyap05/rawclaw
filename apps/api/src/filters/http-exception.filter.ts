import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';

interface ExceptionResponse {
  message?: string | string[];
  error?: string;
  [key: string]: unknown;
}

interface ErrorResponse {
  error: string;
  code: number;
  details: string | string[] | null;
  timestamp: string;
  path: string;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse: ExceptionResponse =
      exception instanceof HttpException
        ? exception.getResponse() as ExceptionResponse
        : { message: exception instanceof Error ? exception.message : 'Unknown error' };

    const message = typeof exceptionResponse === 'object' && exceptionResponse !== null
      ? exceptionResponse.message || exceptionResponse.error
      : String(exceptionResponse);

    const errorShape: ErrorResponse = {
      error: status === HttpStatus.INTERNAL_SERVER_ERROR 
        ? 'Internal Server Error' 
        : (Array.isArray(message) ? message[0] : message) || 'Error',
      code: status,
      details: exceptionResponse.message || null,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    response.status(status).json(errorShape);
  }
}