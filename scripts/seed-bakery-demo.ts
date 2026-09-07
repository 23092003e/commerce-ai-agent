import { Pool } from 'pg';

interface BakeryProduct {
  externalId: string;
  sku: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  price: number;
  portion: string;
  allergens: string[];
  shelfLife: string;
  variants: Array<{
    sku: string;
    title: string;
    price: number;
    quantity: number;
  }>;
}

const categories = [
  ['birthday-cakes', 'Bánh sinh nhật'],
  ['signature-cakes', 'Bánh lạnh & mousse'],
  ['artisan-breads', 'Bánh mì thủ công'],
  ['pastries', 'Bánh ngọt & pastry'],
  ['cookies-gifts', 'Cookies & quà tặng']
] as const;

const products: BakeryProduct[] = [
  {
    externalId: 'bakery-demo-001',
    sku: 'BM-CHOC-001',
    name: 'Chocolate Fudge Signature',
    slug: 'chocolate-fudge-signature',
    description:
      'Cốt chocolate ẩm mềm, kem ganache đậm vị và lớp crumble cacao. Phù hợp tiệc sinh nhật hoặc quà tặng.',
    category: 'birthday-cakes',
    price: 390000,
    portion: '4–6 người',
    allergens: ['sữa', 'trứng', 'lúa mì'],
    shelfLife: 'Bảo quản mát 2–4°C, dùng ngon trong 48 giờ.',
    variants: [
      {
        sku: 'BM-CHOC-15',
        title: 'Size 15 cm · 4–6 người',
        price: 390000,
        quantity: 8
      },
      {
        sku: 'BM-CHOC-18',
        title: 'Size 18 cm · 8–10 người',
        price: 590000,
        quantity: 5
      }
    ]
  },
  {
    externalId: 'bakery-demo-002',
    sku: 'BM-STRAW-001',
    name: 'Strawberry Chantilly',
    slug: 'strawberry-chantilly',
    description:
      'Bánh vanilla nhẹ, kem chantilly ít ngọt và dâu tây tươi theo mùa. Vị thanh, dễ dùng cho cả gia đình.',
    category: 'birthday-cakes',
    price: 420000,
    portion: '4–6 người',
    allergens: ['sữa', 'trứng', 'lúa mì'],
    shelfLife: 'Bảo quản mát 2–4°C, dùng trong ngày để dâu tươi ngon nhất.',
    variants: [
      {
        sku: 'BM-STRAW-15',
        title: 'Size 15 cm · 4–6 người',
        price: 420000,
        quantity: 6
      },
      {
        sku: 'BM-STRAW-18',
        title: 'Size 18 cm · 8–10 người',
        price: 620000,
        quantity: 4
      }
    ]
  },
  {
    externalId: 'bakery-demo-003',
    sku: 'BM-TIRA-001',
    name: 'Tiramisu Cacao',
    slug: 'tiramisu-cacao',
    description:
      'Ladyfinger thấm cà phê, kem mascarpone mượt và cacao nguyên chất. Đậm vị nhưng hậu vị cân bằng.',
    category: 'signature-cakes',
    price: 280000,
    portion: '4–5 người',
    allergens: ['sữa', 'trứng', 'lúa mì'],
    shelfLife: 'Bảo quản mát 2–4°C, dùng trong 48 giờ.',
    variants: [
      {
        sku: 'BM-TIRA-BOX',
        title: 'Hộp 4–5 người',
        price: 280000,
        quantity: 10
      },
      { sku: 'BM-TIRA-CUP', title: 'Ly cá nhân', price: 69000, quantity: 18 }
    ]
  },
  {
    externalId: 'bakery-demo-004',
    sku: 'BM-BASC-001',
    name: 'Basque Burnt Cheesecake',
    slug: 'basque-burnt-cheesecake',
    description:
      'Cheesecake cháy mặt kiểu Basque, ruột mềm tan, vị phô mai rõ nhưng không gắt.',
    category: 'signature-cakes',
    price: 320000,
    portion: '4–6 người',
    allergens: ['sữa', 'trứng'],
    shelfLife: 'Bảo quản mát 2–4°C, dùng trong 72 giờ.',
    variants: [
      {
        sku: 'BM-BASC-15',
        title: 'Size 15 cm · 4–6 người',
        price: 320000,
        quantity: 7
      },
      {
        sku: 'BM-BASC-18',
        title: 'Size 18 cm · 8–10 người',
        price: 490000,
        quantity: 3
      }
    ]
  },
  {
    externalId: 'bakery-demo-005',
    sku: 'BM-MANGO-001',
    name: 'Mango Yogurt Mousse',
    slug: 'mango-yogurt-mousse',
    description:
      'Mousse xoài chua ngọt, yogurt dịu nhẹ và đế biscuit hạnh nhân. Lựa chọn tươi mát cho tiệc trưa.',
    category: 'signature-cakes',
    price: 350000,
    portion: '4–6 người',
    allergens: ['sữa', 'trứng', 'hạnh nhân'],
    shelfLife: 'Bảo quản mát 2–4°C, dùng trong 48 giờ.',
    variants: [
      {
        sku: 'BM-MANGO-15',
        title: 'Size 15 cm · 4–6 người',
        price: 350000,
        quantity: 5
      },
      {
        sku: 'BM-MANGO-18',
        title: 'Size 18 cm · 8–10 người',
        price: 540000,
        quantity: 2
      }
    ]
  },
  {
    externalId: 'bakery-demo-006',
    sku: 'BM-CROI-001',
    name: 'Butter Croissant',
    slug: 'butter-croissant',
    description:
      'Croissant cán lớp bằng bơ, vỏ giòn thơm và ruột mềm nhiều lớp. Nướng mới mỗi sáng.',
    category: 'pastries',
    price: 42000,
    portion: '1 người',
    allergens: ['sữa', 'trứng', 'lúa mì'],
    shelfLife: 'Ngon nhất trong ngày; hâm 160°C khoảng 3 phút trước khi dùng.',
    variants: [
      { sku: 'BM-CROI-ONE', title: '1 chiếc', price: 42000, quantity: 24 },
      { sku: 'BM-CROI-BOX4', title: 'Hộp 4 chiếc', price: 160000, quantity: 8 }
    ]
  },
  {
    externalId: 'bakery-demo-007',
    sku: 'BM-ALMOND-001',
    name: 'Almond Croissant',
    slug: 'almond-croissant',
    description:
      'Croissant nhân frangipane hạnh nhân, phủ lát hạnh nhân rang thơm và đường bột nhẹ.',
    category: 'pastries',
    price: 58000,
    portion: '1 người',
    allergens: ['sữa', 'trứng', 'lúa mì', 'hạnh nhân'],
    shelfLife: 'Ngon nhất trong ngày; hâm 160°C khoảng 3 phút trước khi dùng.',
    variants: [
      { sku: 'BM-ALMOND-ONE', title: '1 chiếc', price: 58000, quantity: 16 },
      {
        sku: 'BM-ALMOND-BOX4',
        title: 'Hộp 4 chiếc',
        price: 220000,
        quantity: 6
      }
    ]
  },
  {
    externalId: 'bakery-demo-008',
    sku: 'BM-SOUR-001',
    name: 'Sourdough Country Loaf',
    slug: 'sourdough-country-loaf',
    description:
      'Bánh mì sourdough ủ tự nhiên, vỏ giòn, ruột dai ẩm và vị chua nhẹ.',
    category: 'artisan-breads',
    price: 95000,
    portion: '2–3 người',
    allergens: ['lúa mì'],
    shelfLife: 'Dùng trong 2 ngày; bảo quản túi giấy nơi thoáng mát.',
    variants: [
      { sku: 'BM-SOUR-450', title: 'Ổ 450 g', price: 95000, quantity: 10 },
      { sku: 'BM-SOUR-900', title: 'Ổ 900 g', price: 175000, quantity: 4 }
    ]
  },
  {
    externalId: 'bakery-demo-009',
    sku: 'BM-BAGU-001',
    name: 'Baguette Parisienne',
    slug: 'baguette-parisienne',
    description:
      'Baguette vỏ mỏng giòn, ruột thoáng nhẹ; hợp dùng cùng bơ, phô mai hoặc món mặn.',
    category: 'artisan-breads',
    price: 38000,
    portion: '1–2 người',
    allergens: ['lúa mì'],
    shelfLife: 'Ngon nhất trong ngày; hâm 180°C khoảng 2 phút.',
    variants: [{ sku: 'BM-BAGU-ONE', title: '1 ổ', price: 38000, quantity: 20 }]
  },
  {
    externalId: 'bakery-demo-010',
    sku: 'BM-COOKIE-001',
    name: 'Sea Salt Chocolate Chip Cookies',
    slug: 'sea-salt-chocolate-chip-cookies',
    description:
      'Cookies bơ với chocolate chip đắng nhẹ và muối biển, viền giòn, giữa mềm.',
    category: 'cookies-gifts',
    price: 120000,
    portion: '3–4 người',
    allergens: ['sữa', 'trứng', 'lúa mì'],
    shelfLife: 'Bảo quản kín nơi mát, dùng trong 7 ngày.',
    variants: [
      { sku: 'BM-COOKIE-6', title: 'Hộp 6 chiếc', price: 120000, quantity: 12 },
      { sku: 'BM-COOKIE-12', title: 'Hộp 12 chiếc', price: 220000, quantity: 7 }
    ]
  },
  {
    externalId: 'bakery-demo-011',
    sku: 'BM-GIFT-001',
    name: 'Afternoon Tea Gift Box',
    slug: 'afternoon-tea-gift-box',
    description:
      'Hộp quà gồm cookies, madeleine và financier; phù hợp tặng đối tác hoặc đồng nghiệp.',
    category: 'cookies-gifts',
    price: 360000,
    portion: '6–8 người',
    allergens: ['sữa', 'trứng', 'lúa mì', 'hạnh nhân'],
    shelfLife: 'Bảo quản kín nơi mát, dùng trong 7 ngày.',
    variants: [
      {
        sku: 'BM-GIFT-CLASSIC',
        title: 'Hộp Classic',
        price: 360000,
        quantity: 6
      },
      {
        sku: 'BM-GIFT-PREMIUM',
        title: 'Hộp Premium',
        price: 520000,
        quantity: 3
      }
    ]
  },
  {
    externalId: 'bakery-demo-012',
    sku: 'BM-VEGAN-001',
    name: 'Vegan Banana Walnut Loaf',
    slug: 'vegan-banana-walnut-loaf',
    description:
      'Banana loaf thuần chay với óc chó, mềm ẩm và ngọt vừa từ chuối chín.',
    category: 'pastries',
    price: 180000,
    portion: '4–6 người',
    allergens: ['lúa mì', 'óc chó'],
    shelfLife: 'Bảo quản kín nơi mát, dùng trong 3 ngày.',
    variants: [
      { sku: 'BM-VEGAN-MINI', title: 'Mini loaf', price: 89000, quantity: 9 },
      { sku: 'BM-VEGAN-FULL', title: 'Full loaf', price: 180000, quantity: 5 }
    ]
  }
];

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  await pool.query('BEGIN');
  await pool.query(
    "UPDATE products SET status = 'archived', updated_at = now() WHERE external_id LIKE 'demo-%'"
  );
  for (const [slug, name] of categories) {
    await pool.query(
      'INSERT INTO product_categories (slug, name) VALUES ($1, $2) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, updated_at = now()',
      [slug, name]
    );
  }
  for (const product of products) {
    const category = await pool.query<{ id: string }>(
      'SELECT id FROM product_categories WHERE slug = $1',
      [product.category]
    );
    const categoryId = category.rows[0]?.id;
    if (!categoryId) throw new Error(`Missing category: ${product.category}`);
    const saved = await pool.query<{ id: string }>(
      `INSERT INTO products (external_id, sku, name, slug, description, category_id, brand, status, base_price, currency, attributes, search_text)
       VALUES ($1,$2,$3,$4,$5,$6,'Bánh Mây Atelier','active',$7,'VND',$8,$9)
       ON CONFLICT (slug) DO UPDATE SET external_id=EXCLUDED.external_id, sku=EXCLUDED.sku, name=EXCLUDED.name, description=EXCLUDED.description, category_id=EXCLUDED.category_id, status='active', base_price=EXCLUDED.base_price, attributes=EXCLUDED.attributes, search_text=EXCLUDED.search_text, updated_at=now()
       RETURNING id`,
      [
        product.externalId,
        product.sku,
        product.name,
        product.slug,
        product.description,
        categoryId,
        product.price,
        JSON.stringify({
          portion: product.portion,
          allergens: product.allergens,
          shelfLife: product.shelfLife,
          demo: true
        }),
        `${product.name} ${product.description} ${product.category} ${product.allergens.join(' ')}`
      ]
    );
    const productId = saved.rows[0]?.id;
    if (!productId) throw new Error(`Could not save ${product.sku}`);
    for (const variant of product.variants) {
      const savedVariant = await pool.query<{ id: string }>(
        `INSERT INTO product_variants (product_id, sku, title, price, status, attributes)
         VALUES ($1,$2,$3,$4,'active',$5)
         ON CONFLICT (sku) DO UPDATE SET product_id=EXCLUDED.product_id, title=EXCLUDED.title, price=EXCLUDED.price, status='active', attributes=EXCLUDED.attributes, updated_at=now()
         RETURNING id`,
        [
          productId,
          variant.sku,
          variant.title,
          variant.price,
          JSON.stringify({ portion: product.portion })
        ]
      );
      const variantId = savedVariant.rows[0]?.id;
      if (!variantId) throw new Error(`Could not save ${variant.sku}`);
      await pool.query(
        `INSERT INTO inventory (variant_id, quantity_available, quantity_reserved)
         VALUES ($1,$2,0) ON CONFLICT (variant_id) DO UPDATE SET quantity_available=EXCLUDED.quantity_available, quantity_reserved=0, updated_at=now()`,
        [variantId, variant.quantity]
      );
    }
  }
  await pool.query('COMMIT');
  console.log(
    `Seeded ${String(products.length)} Bánh Mây Atelier demo products and archived the former apparel demo catalog.`
  );
} catch (error) {
  await pool.query('ROLLBACK');
  throw error;
} finally {
  await pool.end();
}
