import { z } from 'zod';

/**
 * Address form schema (web). Coordinates are intentionally absent — map
 * picking/geocoding arrives with MapsService (Phase 9); the API accepts
 * them optionally from clients that have GPS.
 */
export const addressSchema = z.object({
  label: z.string().trim().max(60, 'Keep the label under 60 characters').optional(),
  street: z
    .string()
    .trim()
    .min(3, 'Street address is required')
    .max(200, 'Street address is too long'),
  city: z.string().trim().min(2, 'City is required').max(100),
  state: z.string().trim().min(2, 'State is required').max(100),
  landmark: z.string().trim().max(200, 'Keep the landmark under 200 characters').optional(),
  isDefault: z.boolean().optional(),
});

export type AddressInput = z.infer<typeof addressSchema>;
