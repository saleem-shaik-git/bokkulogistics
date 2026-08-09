/**
 * Development seed (idempotent — safe to re-run; existing rows are skipped).
 *
 * Creates:
 *   - 4 test users (password: Password123!) — Phase 2 onwards
 *   - 1 store "Bokku" (code BOKKU, Lagos NG)               — Phase 3
 *   - 5 categories, 20 products with inventory + images    — Phase 3
 *   - store_staff links for manager@/bokku-admin@          — Phase 3
 *   - default address for customer@bokku.test              — Phase 5
 *
 * All credentials and products are obviously fictional test data.
 */
import { hash } from '@node-rs/argon2';
import postgres from 'postgres';

const SEED_PASSWORD = 'Password123!';

const SEED_USERS = [
  { email: 'admin@bokku.test', role: 'PLATFORM_ADMIN', firstName: 'Platform', lastName: 'Admin' },
  { email: 'bokku-admin@bokku.test', role: 'BOKKU_ADMIN', firstName: 'Bokku', lastName: 'Admin' },
  { email: 'manager@bokku.test', role: 'STORE_MANAGER', firstName: 'Store', lastName: 'Manager' },
  { email: 'customer@bokku.test', role: 'CUSTOMER', firstName: 'Test', lastName: 'Customer' },
] as const;

const STORE = {
  name: 'Bokku',
  code: 'BOKKU',
  description: 'Your neighborhood essentials, delivered fast.',
  address: '12 Market Street, Egbeda',
  city: 'Lagos',
  state: 'Lagos',
  latitude: '6.5926000',
  longitude: '3.2907000',
  phone: '+234 800 000 0001',
  openingTime: '08:00',
  closingTime: '22:00',
} as const;

const CATEGORIES = ['food', 'drinks', 'groceries', 'household', 'other'] as const;

interface SeedProduct {
  name: string;
  category: (typeof CATEGORIES)[number];
  price: number; // kobo
  sku: string;
  stock: number;
  threshold?: number;
  description: string;
}

// All fictional. Prices in kobo (₦1 = 100 kobo).
const PRODUCTS: SeedProduct[] = [
  {
    name: 'Indomie Chicken Flavour 70g',
    category: 'food',
    price: 35000,
    sku: 'BOK-FOD-001',
    stock: 120,
    threshold: 20,
    description: 'Instant noodles, single pack.',
  },
  {
    name: 'Titus Sardine in Vegetable Oil 125g',
    category: 'food',
    price: 95000,
    sku: 'BOK-FOD-002',
    stock: 60,
    description: 'Canned sardines, easy-open tin.',
  },
  {
    name: 'Bama Mayonnaise 226g',
    category: 'food',
    price: 165000,
    sku: 'BOK-FOD-003',
    stock: 24,
    description: 'Creamy mayonnaise jar.',
  },
  {
    name: 'Honeywell Wheat Meal 1kg',
    category: 'food',
    price: 145000,
    sku: 'BOK-FOD-004',
    stock: 15,
    description: 'Whole wheat swallow.',
  },
  {
    name: 'Coca-Cola 50cl PET',
    category: 'drinks',
    price: 50000,
    sku: 'BOK-DRK-001',
    stock: 200,
    threshold: 30,
    description: 'Chilled soft drink.',
  },
  {
    name: 'Maltina Classic 33cl Can',
    category: 'drinks',
    price: 55000,
    sku: 'BOK-DRK-002',
    stock: 96,
    description: 'Malt drink can.',
  },
  {
    name: 'Hollandia Yoghurt 1L',
    category: 'drinks',
    price: 220000,
    sku: 'BOK-DRK-003',
    stock: 18,
    description: 'Plain drinking yoghurt.',
  },
  {
    name: 'Eva Table Water 75cl',
    category: 'drinks',
    price: 20000,
    sku: 'BOK-DRK-004',
    stock: 300,
    threshold: 50,
    description: 'Bottled water.',
  },
  {
    name: 'Golden Penny Semovita 1kg',
    category: 'groceries',
    price: 185000,
    sku: 'BOK-GRC-001',
    stock: 40,
    description: 'Premium semolina.',
  },
  {
    name: 'Peak Evaporated Milk 170g',
    category: 'groceries',
    price: 85000,
    sku: 'BOK-GRC-002',
    stock: 72,
    description: 'Full cream milk tin.',
  },
  {
    name: 'Power Vegetable Oil 75cl',
    category: 'groceries',
    price: 265000,
    sku: 'BOK-GRC-003',
    stock: 33,
    description: 'Cooking oil bottle.',
  },
  {
    name: 'Royal Stallion Rice 5kg',
    category: 'groceries',
    price: 1250000,
    sku: 'BOK-GRC-004',
    stock: 12,
    threshold: 5,
    description: 'Parboiled long grain rice.',
  },
  {
    name: 'Dano Milk Sachet 400g',
    category: 'groceries',
    price: 395000,
    sku: 'BOK-GRC-005',
    stock: 0,
    threshold: 6,
    description: 'Instant filled milk powder refill.',
  },
  {
    name: 'Knorr Chicken Cubes 400g',
    category: 'groceries',
    price: 1200000,
    sku: 'BOK-GRC-006',
    stock: 25,
    description: 'Seasoning cubes value pack.',
  },
  {
    name: 'Dettol Cool Soap 70g',
    category: 'household',
    price: 45000,
    sku: 'BOK-HHD-001',
    stock: 84,
    description: 'Antibacterial bathing soap.',
  },
  {
    name: 'Hypo Bleach 1L',
    category: 'household',
    price: 130000,
    sku: 'BOK-HHD-002',
    stock: 48,
    description: 'Multipurpose bleach.',
  },
  {
    name: 'Sunlight Detergent 900g',
    category: 'household',
    price: 175000,
    sku: 'BOK-HHD-003',
    stock: 3,
    threshold: 8,
    description: 'Washing powder.',
  },
  {
    name: 'Viro-Robust Tissue 300g (3 Rolls)',
    category: 'household',
    price: 95000,
    sku: 'BOK-HHD-004',
    stock: 55,
    description: 'Soft toilet tissue.',
  },
  {
    name: 'Cabin Biscuit 400g',
    category: 'other',
    price: 60000,
    sku: 'BOK-OTH-001',
    stock: 90,
    description: 'Classic crunchy biscuit.',
  },
  {
    name: 'Ovaltine Chocolate Drink 400g',
    category: 'other',
    price: 480000,
    sku: 'BOK-OTH-002',
    stock: 20,
    description: 'Malted chocolate beverage refill.',
  },
];

const CATEGORY_NAMES: Record<string, string> = {
  food: 'Food',
  drinks: 'Drinks',
  groceries: 'Groceries',
  household: 'Household',
  other: 'Other',
};

const STAFF_EMAILS = ['manager@bokku.test', 'bokku-admin@bokku.test'];

function imageUrl(label: string): string {
  const text = encodeURIComponent(label.slice(0, 24));
  return `https://placehold.co/600x400/f0fdf4/166534?text=${text}`;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
    process.exit(1);
  }
  const sql = postgres(url, { max: 2, connect_timeout: 5 });

  // ── Users ──────────────────────────────────────────────────────
  const userTable = await sql`SELECT to_regclass('public.users') AS t`;
  if (!userTable[0]?.t) {
    console.error('Tables missing — run `pnpm db:migrate` first.');
    await sql.end();
    process.exit(1);
  }
  const passwordHash = await hash(SEED_PASSWORD, {
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
  for (const user of SEED_USERS) {
    const inserted = await sql`
      INSERT INTO users (email, password_hash, first_name, last_name, role, email_verified_at)
      VALUES (${user.email}, ${passwordHash}, ${user.firstName}, ${user.lastName}, ${user.role}, now())
      ON CONFLICT (email) DO NOTHING RETURNING id`;
    console.log(inserted.length ? `✓ user ${user.email}` : `• user ${user.email} exists`);
  }

  // ── Store ──────────────────────────────────────────────────────
  const [store] = await sql`
    INSERT INTO stores (name, code, description, address, city, state, latitude, longitude, phone, opening_time, closing_time)
    VALUES (${STORE.name}, ${STORE.code}, ${STORE.description}, ${STORE.address}, ${STORE.city},
            ${STORE.state}, ${STORE.latitude}::numeric, ${STORE.longitude}::numeric,
            ${STORE.phone}, ${STORE.openingTime}::time, ${STORE.closingTime}::time)
    ON CONFLICT (code) DO NOTHING
    RETURNING id`;
  const [{ id: storeId }] = store
    ? [store]
    : await sql`SELECT id FROM stores WHERE code = ${STORE.code}`;
  console.log(`${store ? '✓' : '•'} store Bokku (${storeId})`);

  // ── Categories ─────────────────────────────────────────────────
  const categoryIds = new Map<string, string>();
  for (const [index, slug] of CATEGORIES.entries()) {
    const name = CATEGORY_NAMES[slug]!;
    const [inserted] = await sql`
      INSERT INTO categories (store_id, name, slug, sort_order)
      VALUES (${storeId}, ${name}, ${slug}, ${index})
      ON CONFLICT (store_id, slug) DO NOTHING RETURNING id`;
    const [{ id }] = inserted
      ? [inserted]
      : await sql`SELECT id FROM categories WHERE store_id = ${storeId} AND slug = ${slug}`;
    categoryIds.set(slug, id);
  }
  console.log(`✓ categories: ${CATEGORIES.map((c) => CATEGORY_NAMES[c]).join(', ')}`);

  // ── Products + inventory + images ──────────────────────────────
  let created = 0;
  for (const product of PRODUCTS) {
    const [inserted] = await sql`
      INSERT INTO products (store_id, category_id, name, slug, description, sku, price,
                            low_stock_threshold, image_url, status)
      VALUES (${storeId}, ${categoryIds.get(product.category)!}, ${product.name},
              ${product.sku.toLowerCase()}, ${product.description}, ${product.sku},
              ${product.price}, ${product.threshold ?? 5},
              ${imageUrl(product.name)}, 'ACTIVE')
      ON CONFLICT (store_id, sku) DO NOTHING RETURNING id`;
    if (!inserted) continue;
    created++;
    await sql`
      INSERT INTO inventory (store_id, product_id, quantity_on_hand)
      VALUES (${storeId}, ${inserted.id}, ${product.stock})
      ON CONFLICT (store_id, product_id) DO NOTHING`;
    await sql`
      INSERT INTO product_images (product_id, url, alt_text, sort_order)
      VALUES (${inserted.id}, ${imageUrl(product.name)}, ${product.name}, 0)`;
  }
  console.log(`✓ products: ${created} created (${PRODUCTS.length} total in seed list)`);

  // ── Staff links ────────────────────────────────────────────────
  for (const email of STAFF_EMAILS) {
    const [user] = await sql`SELECT id FROM users WHERE email = ${email}`;
    if (!user) continue;
    const link = await sql`
      INSERT INTO store_staff (store_id, user_id) VALUES (${storeId}, ${user.id})
      ON CONFLICT (store_id, user_id) DO NOTHING RETURNING id`;
    console.log(link.length ? `✓ staff ${email}` : `• staff ${email} exists`);
  }

  // ── Customer default address (Phase 5) ─────────────────────────
  const [customer] = await sql`SELECT id FROM users WHERE email = 'customer@bokku.test'`;
  if (customer) {
    const seeded = await sql`
      INSERT INTO addresses (user_id, label, street, city, state, landmark, latitude, longitude, is_default)
      SELECT ${customer.id}, 'Home', '15 Salvation Road, Opebi', 'Lagos', 'Lagos',
             'Near Opebi roundabout', '6.6018000'::numeric, '3.3515000'::numeric, true
      WHERE NOT EXISTS (
        SELECT 1 FROM addresses WHERE user_id = ${customer.id} AND street = '15 Salvation Road, Opebi'
      )
      RETURNING id`;
    console.log(seeded.length ? '✓ customer address (Home, Opebi)' : '• customer address exists');
  }

  console.log(`\nDev credentials: password "${SEED_PASSWORD}" for all seed users.`);
  await sql.end();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
