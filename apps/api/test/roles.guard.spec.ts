import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import type { User } from '@bokku/database';
import type { UserRole } from '@bokku/shared';

import { ROLES_KEY } from '../src/common/decorators/roles.decorator';
import { RolesGuard } from '../src/common/guards/roles.guard';

function buildContext(userRole?: UserRole): ExecutionContext {
  const req = userRole ? { user: { id: 'u1', role: userRole } as Partial<User> } : {};
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function guardWith(roles?: UserRole[]): RolesGuard {
  const reflector = {
    getAllAndOverride: vi.fn().mockReturnValue(roles),
  } as unknown as Reflector;
  return new RolesGuard(reflector);
}

describe('RolesGuard', () => {
  it('allows when the route has no role requirement', () => {
    expect(guardWith(undefined).canActivate(buildContext())).toBe(true);
  });

  it('allows when the user has one of the required roles', () => {
    expect(
      guardWith(['PLATFORM_ADMIN', 'BOKKU_ADMIN']).canActivate(buildContext('PLATFORM_ADMIN')),
    ).toBe(true);
  });

  it('denies when the user lacks the required role', () => {
    expect(() => guardWith(['PLATFORM_ADMIN']).canActivate(buildContext('CUSTOMER'))).toThrow(
      ForbiddenException,
    );
  });

  it('denies unauthenticated requests on role-protected routes', () => {
    expect(() => guardWith(['CUSTOMER']).canActivate(buildContext())).toThrow(ForbiddenException);
  });

  it('reads requirements from ROLES_KEY metadata', () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue(undefined),
    } as unknown as Reflector;
    new RolesGuard(reflector).canActivate(buildContext());
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(ROLES_KEY, expect.anything());
  });
});
