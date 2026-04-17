import { IsString, IsOptional, IsUrl, IsIn } from 'class-validator';

export class ConnectMcpServerDto {
  @IsUrl({ require_tld: false })
  url!: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsIn(['sse', 'stdio', 'http'])
  @IsOptional()
  transport?: 'sse' | 'stdio' | 'http' = 'sse';
}