import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PostgresJobQueueConsumer } from './jobs/services/postgres-job-queue.consumer.js';

export const HEALTH_CONTRACT_VERSION = '1.5.1';
export const HEALTH_PROBE_TIMEOUT_MS = 2000;

export type HealthCheckStatus = 'ok' | 'error';

export type HealthResponseDTO = {
  status: 'ok' | 'unavailable';
  version: string;
  time: string;
  checks: {
    database: HealthCheckStatus;
    queue: HealthCheckStatus;
  };
};

@Injectable()
export class AppService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AppService.name);
  private readonly inFlightProbes = new Map<
    'database' | 'queue',
    Promise<boolean>
  >();

  constructor(
    private readonly dataSource: DataSource,
    @Optional()
    @Inject(PostgresJobQueueConsumer)
    private readonly jobQueueConsumer?: PostgresJobQueueConsumer,
  ) {}

  async onApplicationBootstrap() {
    if (this.dataSource.isInitialized) {
      this.logger.log('Database connected successfully');
    } else {
      this.logger.error('Database connection failed');
    }
  }

  private async runBoundedReadProbe(
    probeKey: 'database' | 'queue',
    sql: string,
    useServiceRole: boolean,
    timeoutMs = HEALTH_PROBE_TIMEOUT_MS,
  ): Promise<boolean> {
    if (!this.dataSource?.isInitialized) {
      return false;
    }

    const boundedMs = Math.max(100, Math.floor(timeoutMs));
    let timer: ReturnType<typeof setTimeout> | undefined;

    const executeProbe = async (): Promise<boolean> => {
      if (typeof this.dataSource.createQueryRunner === 'function') {
        const qr = this.dataSource.createQueryRunner();
        let txStarted = false;
        try {
          await qr.connect();
          await qr.startTransaction('READ COMMITTED');
          txStarted = true;
          await qr.query('SET LOCAL TRANSACTION READ ONLY');
          await qr.query(`SET LOCAL statement_timeout = ${boundedMs}`);
          if (useServiceRole) {
            await qr.query('SET LOCAL ROLE service_role');
          }
          await qr.query(sql);
          await qr.commitTransaction();
          txStarted = false;
          return true;
        } catch {
          if (txStarted) {
            try {
              await qr.rollbackTransaction();
            } catch {
              // Suppress rollback diagnostics to keep health probes silent and secret-free.
            }
          }
          return false;
        } finally {
          try {
            await qr.release();
          } catch {
            // Suppress release diagnostics.
          }
        }
      }

      await this.dataSource.query(sql);
      return true;
    };

    // Single-flight coalescing prevents repeated /health calls from piling up
    // pooled connections while an earlier stalled probe is still settling.
    let probePromise = this.inFlightProbes.get(probeKey);
    if (!probePromise) {
      probePromise = executeProbe()
        .catch(() => false)
        .finally(() => {
          this.inFlightProbes.delete(probeKey);
        });
      this.inFlightProbes.set(probeKey, probePromise);
    }

    const timeoutPromise = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), boundedMs);
      timer.unref?.();
    });

    try {
      return await Promise.race([probePromise, timeoutPromise]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  private async checkDatabase(): Promise<HealthCheckStatus> {
    const ok = await this.runBoundedReadProbe('database', 'SELECT 1', false);
    if (!ok) {
      this.logger.warn('Health check failed: database probe unavailable');
    }
    return ok ? 'ok' : 'error';
  }

  private isQueueConsumerReady(): boolean {
    const consumer = this.jobQueueConsumer;
    if (!consumer) {
      return false;
    }
    return typeof consumer.isReady !== 'function' || consumer.isReady();
  }

  private async checkQueue(): Promise<HealthCheckStatus> {
    if (!this.isQueueConsumerReady()) {
      this.logger.warn('Health check failed: queue consumer not ready');
      return 'error';
    }

    const ok = await this.runBoundedReadProbe(
      'queue',
      "SELECT 1 FROM public.ai_requests WHERE is_async = true AND status = 'queued' LIMIT 1",
      true,
    );
    if (!ok) {
      this.logger.warn('Health check failed: durable queue probe unavailable');
    }
    return ok ? 'ok' : 'error';
  }

  /**
   * Executes canonical C05 `EP-H01` (`GET /health`) readiness probes against PostgreSQL
   * and the durable `public.ai_requests` job queue. Never leaks secrets or provider metadata
   * and never writes `R24` user activity.
   */
  async getHealth(): Promise<HealthResponseDTO> {
    const [database, probedQueue] = await Promise.all([
      this.checkDatabase(),
      this.checkQueue(),
    ]);

    let queue: HealthCheckStatus = probedQueue;
    if (queue === 'ok' && !this.isQueueConsumerReady()) {
      this.logger.warn(
        'Health check failed: queue consumer became unready during probe',
      );
      queue = 'error';
    }

    const healthy = database === 'ok' && queue === 'ok';
    const payload: HealthResponseDTO = {
      status: healthy ? 'ok' : 'unavailable',
      version: HEALTH_CONTRACT_VERSION,
      time: new Date().toISOString(),
      checks: {
        database,
        queue,
      },
    };

    if (!healthy) {
      throw new ServiceUnavailableException(payload);
    }

    return payload;
  }
}
