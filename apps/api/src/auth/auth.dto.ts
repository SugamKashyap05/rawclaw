import { IsOptional, IsString } from 'class-validator';

export class TokenRequestDto {
  @IsOptional()
  @IsString()
  secret!: string;
}

export class BootstrapSetupDto {
  @IsString()
  user!: string;

  @IsOptional()
  @IsString()
  soul?: string;

  @IsOptional()
  @IsString()
  memory?: string;

  @IsOptional()
  @IsString()
  tools?: string;
}
