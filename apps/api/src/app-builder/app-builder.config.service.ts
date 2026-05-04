import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type AppBuilderConfig = {
  templateConfidenceThreshold: number;
  editClassifierConfidenceThreshold: number;
  autoValidationDebounceMs: number;
  autoValidationMaxWaitMs: number;
  foregroundStartWindowMs: number;
  backgroundQueueTimeoutMs: number;
  aiJobLimit: number;
  validationJobLimit: number;
  maxQueuedJobs: number;
  recoveryFreezeTtlMs: number;
  recoveryFreezeHeartbeatMs: number;
  janitorIntervalMs: number;
  staleTempUploadMs: number;
  snapshotKeepLatest: number;
  snapshotPruneUnreferencedDays: number;
  uploadWorkspaceLimitBytes: number;
  chunkedUploadLimitBytes: number;
  uploadReservationTtlMs: number;
  suggestionSimilarityThreshold: number;
  smokeRestoreMaxAttempts: number;
  suggestionVectorClearMaxAttempts: number;
  devMetricsToken: string | null;
};

@Injectable()
export class AppBuilderConfigService implements OnModuleInit {
  private readonly logger = new Logger(AppBuilderConfigService.name);
  private config!: AppBuilderConfig;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    this.config = this.loadConfig();
  }

  get values(): AppBuilderConfig {
    if (!this.config) {
      this.config = this.loadConfig();
    }
    return this.config;
  }

  get templateConfidenceThreshold(): number {
    return this.values.templateConfidenceThreshold;
  }

  get editClassifierConfidenceThreshold(): number {
    return this.values.editClassifierConfidenceThreshold;
  }

  private loadConfig(): AppBuilderConfig {
    return {
      templateConfidenceThreshold: this.threshold('APP_BUILDER_TEMPLATE_CONFIDENCE_THRESHOLD', 0.72),
      editClassifierConfidenceThreshold: this.threshold('APP_BUILDER_EDIT_CLASSIFIER_CONFIDENCE_THRESHOLD', 0.65),
      autoValidationDebounceMs: this.integer('APP_BUILDER_AUTO_VALIDATION_DEBOUNCE_MS', 750, 0, 60_000),
      autoValidationMaxWaitMs: this.integer('APP_BUILDER_AUTO_VALIDATION_MAX_WAIT_MS', 3_000, 0, 120_000),
      foregroundStartWindowMs: this.integer('APP_BUILDER_FOREGROUND_START_WINDOW_MS', 10_000, 100, 120_000),
      backgroundQueueTimeoutMs: this.integer('APP_BUILDER_BACKGROUND_QUEUE_TIMEOUT_MS', 600_000, 1_000, 86_400_000),
      aiJobLimit: this.integer('APP_BUILDER_AI_JOB_LIMIT', 2, 1, 100),
      validationJobLimit: this.integer('APP_BUILDER_VALIDATION_JOB_LIMIT', 4, 1, 100),
      maxQueuedJobs: this.integer('APP_BUILDER_MAX_QUEUED_JOBS', 20, 1, 500),
      recoveryFreezeTtlMs: this.integer('APP_BUILDER_RECOVERY_FREEZE_TTL_MS', 120_000, 10_000, 3_600_000),
      recoveryFreezeHeartbeatMs: this.integer('APP_BUILDER_RECOVERY_FREEZE_HEARTBEAT_MS', 30_000, 1_000, 600_000),
      janitorIntervalMs: this.integer('APP_BUILDER_JANITOR_INTERVAL_MS', 60_000, 5_000, 3_600_000),
      staleTempUploadMs: this.integer('APP_BUILDER_STALE_TEMP_UPLOAD_MS', 1_800_000, 60_000, 86_400_000),
      snapshotKeepLatest: this.integer('APP_BUILDER_SNAPSHOT_KEEP_LATEST', 20, 1, 500),
      snapshotPruneUnreferencedDays: this.integer('APP_BUILDER_SNAPSHOT_PRUNE_UNREFERENCED_DAYS', 14, 1, 365),
      uploadWorkspaceLimitBytes: this.integer('APP_BUILDER_UPLOAD_WORKSPACE_LIMIT_BYTES', 100 * 1024 * 1024, 1024, 10 * 1024 * 1024 * 1024),
      chunkedUploadLimitBytes: this.integer('APP_BUILDER_CHUNKED_UPLOAD_LIMIT_BYTES', 10 * 1024 * 1024, 1024, 1024 * 1024 * 1024),
      uploadReservationTtlMs: this.integer('APP_BUILDER_UPLOAD_RESERVATION_TTL_MS', 900_000, 60_000, 86_400_000),
      suggestionSimilarityThreshold: this.threshold('APP_BUILDER_SUGGESTION_SIMILARITY_THRESHOLD', 0.88),
      smokeRestoreMaxAttempts: this.integer('APP_BUILDER_SMOKE_RESTORE_MAX_ATTEMPTS', 5, 1, 20),
      suggestionVectorClearMaxAttempts: this.integer('APP_BUILDER_SUGGESTION_VECTOR_CLEAR_MAX_ATTEMPTS', 12, 1, 100),
      devMetricsToken: this.devMetricsToken(),
    };
  }

  private devMetricsToken(): string | null {
    const raw = this.configService.get<string | undefined>('APP_BUILDER_DEV_METRICS_TOKEN');
    if (!raw) return null;
    if (this.isProduction()) {
      this.logger.warn('APP_BUILDER_DEV_METRICS_TOKEN is ignored in production.');
      return null;
    }
    if (raw.length < 24) {
      if (this.isProduction()) return null;
      throw new Error('APP_BUILDER_DEV_METRICS_TOKEN must be at least 24 characters when configured.');
    }
    return raw;
  }

  private threshold(key: string, fallback: number): number {
    const value = this.number(key, fallback);
    if (value >= 0.5 && value <= 0.95) {
      return value;
    }
    if (this.isProduction()) {
      const clamped = Math.min(0.95, Math.max(0.5, value));
      this.logger.warn(`${key}=${value} is outside 0.5..0.95; clamped to ${clamped}.`);
      return clamped;
    }
    throw new Error(`${key} must be between 0.5 and 0.95.`);
  }

  private integer(key: string, fallback: number, min: number, max: number): number {
    const value = Math.round(this.number(key, fallback));
    if (value >= min && value <= max) {
      return value;
    }
    if (this.isProduction()) {
      const clamped = Math.min(max, Math.max(min, value));
      this.logger.warn(`${key}=${value} is outside ${min}..${max}; clamped to ${clamped}.`);
      return clamped;
    }
    throw new Error(`${key} must be between ${min} and ${max}.`);
  }

  private number(key: string, fallback: number): number {
    const raw = this.configService.get<string | number | undefined>(key);
    if (raw === undefined || raw === null || raw === '') {
      return fallback;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      if (this.isProduction()) {
        this.logger.warn(`${key}=${raw} is not numeric; using ${fallback}.`);
        return fallback;
      }
      throw new Error(`${key} must be numeric.`);
    }
    return parsed;
  }

  private isProduction(): boolean {
    return (this.configService.get<string>('NODE_ENV') || '').toLowerCase() === 'production';
  }
}
