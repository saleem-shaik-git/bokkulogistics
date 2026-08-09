import { pgEnum } from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', [
  'CUSTOMER',
  'STORE_MANAGER',
  'BOKKU_ADMIN',
  'PLATFORM_ADMIN',
]);

export const userStatusEnum = pgEnum('user_status', ['ACTIVE', 'INACTIVE', 'SUSPENDED']);
