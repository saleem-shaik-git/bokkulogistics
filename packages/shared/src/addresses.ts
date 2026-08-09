/** Address contracts shared by the API and the web app. */

/** A saved delivery address. Coordinates are optional (map picking lands in Phase 9). */
export interface PublicAddress {
  id: string;
  label: string | null;
  street: string;
  city: string;
  state: string;
  landmark: string | null;
  latitude: number | null;
  longitude: number | null;
  isDefault: boolean;
  createdAt: string;
}

/** Maximum saved addresses per user. */
export const ADDRESSES_MAX_PER_USER = 10;
