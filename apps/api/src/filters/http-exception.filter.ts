import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    
    const status = 
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse = 
      exception instanceof HttpException
        ? exception.getResponse()
        : { message: (exception as Error).message };

    const message = typeof exceptionResponse === 'object' && exceptionResponse !== null
      ? (exceptionResponse as any).message || (exceptionResponse as any).error
      : exceptionResponse;

    const errorShape = {
      error: status === HttpStatus.INTERNAL_SERVER_ERROR ? 'Internal Server Error' : message,
      code: status,
      details: (exceptionResponse as any).message || null,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    response.status(status).json(errorShape);
  }
}
