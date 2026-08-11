/** Catalogue contracts shared between API and web. */

export interface PublicStore {
  id: string;
  name: string;
  code: string;
  description: string | null;
  address: string;
  city: string;
  state: string;
  latitude: string | null;
  longitude: string | null;
  phone: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  openingTime: string | null;
  closingTime: string | null;
}

export interface PublicCategory {
  id: string;
  storeId: string;
  name: string;
  slug: string;
  description: string | null;
  sortOrder: number;
}

export interface PublicProductImage {
  id: string;
  url: string;
  altText: string | null;
  sortOrder: number;
}

export type ProductStatus = 'ACTIVE' | 'INACTIVE' | 'OUT_OF_STOCK' | 'DRAFT';

export interface PublicProductListItem {
  id: string;
  storeId: string;
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  name: string;
  slug: string;
  description: string | null;
  /** Integer minor units (kobo). Divide by 100 for naira. */
  price: number;
  imageUrl: string | null;
  status: ProductStatus;
  /** Sellable units right now (on hand − reserved). */
  stockQuantity: number;
  /** status ACTIVE and stockQuantity > 0. */
  available: boolean;
}

export interface PublicProductDetail extends PublicProductListItem {
  sku: string;
  lowStockThreshold: number;
  images: PublicProductImage[];
  createdAt: string;
}
