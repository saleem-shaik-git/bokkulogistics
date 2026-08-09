import { Global, Inject, Injectable, Logger, Module } from '@nestjs/common';
import { auditLogs, type DatabaseConnection, type NewAuditLog } from '@bokku/database';

import { DRIZZLE_CLIENT } from '../../config/constants';

/**
 * Append-only audit trail. Writes never break the request path — failures
 * are logged and swallowed (the security action itself already succeeded).
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(DRIZZLE_CLIENT) private readonly database: DatabaseConnection) {}

  async record(entry: Omit<NewAuditLog, 'id' | 'createdAt'>): Promise<void> {
    try {
      await this.database.db.insert(auditLogs).values(entry);
    } catch (error) {
      this.logger.error(`Failed to write audit log for action ${entry.action}`, error as Error);
    }
  }
}

@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
