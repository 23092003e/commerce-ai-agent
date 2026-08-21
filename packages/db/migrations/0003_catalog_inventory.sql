CREATE TYPE product_status AS ENUM ('active', 'draft', 'archived');
CREATE TYPE product_variant_status AS ENUM ('active', 'inactive');
CREATE TYPE promotion_status AS ENUM ('active', 'inactive', 'scheduled', 'expired');

CREATE TABLE product_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text,
  sku text,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text NOT NULL,
  category_id uuid NOT NULL REFERENCES product_categories(id),
  brand text,
  status product_status NOT NULL DEFAULT 'active',
  base_price bigint NOT NULL CHECK (base_price >= 0),
  currency char(3) NOT NULL DEFAULT 'VND',
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  search_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX products_external_id_unique
  ON products (external_id)
  WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX products_sku_unique
  ON products (sku)
  WHERE sku IS NOT NULL;
CREATE INDEX products_search_text_idx
  ON products USING gin (to_tsvector('simple', search_text));

CREATE TABLE product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id),
  sku text NOT NULL UNIQUE,
  title text NOT NULL,
  color text,
  size text,
  price bigint NOT NULL CHECK (price >= 0),
  compare_at_price bigint CHECK (compare_at_price >= 0),
  status product_variant_status NOT NULL DEFAULT 'active',
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX product_variants_product_idx ON product_variants (product_id);
CREATE INDEX product_variants_filters_idx
  ON product_variants (color, size, price)
  WHERE status = 'active';

CREATE TABLE inventory (
  variant_id uuid PRIMARY KEY REFERENCES product_variants(id),
  quantity_available integer NOT NULL DEFAULT 0 CHECK (quantity_available >= 0),
  quantity_reserved integer NOT NULL DEFAULT 0 CHECK (quantity_reserved >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status promotion_status NOT NULL DEFAULT 'inactive',
  starts_at timestamptz,
  ends_at timestamptz,
  rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  priority integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO product_categories (slug, name)
VALUES
  ('tops', 'Áo'),
  ('bottoms', 'Quần và váy'),
  ('outerwear', 'Áo khoác'),
  ('accessories', 'Phụ kiện');

INSERT INTO products (
  external_id,
  sku,
  name,
  slug,
  description,
  category_id,
  brand,
  base_price,
  currency,
  attributes,
  search_text
)
SELECT
  seed.external_id,
  seed.sku,
  seed.name,
  seed.slug,
  seed.description,
  category.id,
  seed.brand,
  seed.base_price,
  'VND',
  '{}'::jsonb,
  seed.search_text
FROM (
  VALUES
    ('demo-001', 'DEMO-P001', 'Essential Polo', 'essential-polo', 'Áo polo demo tối giản cho trang phục hằng ngày.', 'tops', 'Demo Atelier', 449000::bigint, 'essential polo áo polo shirt tối giản black white'),
    ('demo-002', 'DEMO-P002', 'Relaxed Tee', 'relaxed-tee', 'Áo thun demo phom rộng thoải mái.', 'tops', 'Sample Street', 299000::bigint, 'relaxed tee áo thun tshirt casual black sand'),
    ('demo-003', 'DEMO-P003', 'Linen Shirt', 'linen-shirt', 'Áo sơ mi linen demo nhẹ và thoáng.', 'tops', 'Demo Atelier', 599000::bigint, 'linen shirt sơ mi công sở white blue'),
    ('demo-004', 'DEMO-P004', 'Ribbed Tank', 'ribbed-tank', 'Áo tank rib demo co giãn nhẹ.', 'tops', 'Mock and Co', 249000::bigint, 'ribbed tank áo ba lỗ white black'),
    ('demo-005', 'DEMO-P005', 'Everyday Hoodie', 'everyday-hoodie', 'Hoodie demo mềm cho ngày thường.', 'tops', 'Sample Street', 699000::bigint, 'everyday hoodie áo nỉ gray black'),
    ('demo-006', 'DEMO-P006', 'Straight Chino', 'straight-chino', 'Quần chino demo ống đứng.', 'bottoms', 'Demo Atelier', 649000::bigint, 'straight chino quần kaki beige navy'),
    ('demo-007', 'DEMO-P007', 'Wide Leg Pants', 'wide-leg-pants', 'Quần ống rộng demo thanh lịch.', 'bottoms', 'Mock and Co', 679000::bigint, 'wide leg pants quần ống rộng black cream'),
    ('demo-008', 'DEMO-P008', 'Denim Shorts', 'denim-shorts', 'Quần short denim demo năng động.', 'bottoms', 'Sample Street', 499000::bigint, 'denim shorts quần short blue black'),
    ('demo-009', 'DEMO-P009', 'Midi Skirt', 'midi-skirt', 'Chân váy midi demo dễ phối.', 'bottoms', 'Mock and Co', 559000::bigint, 'midi skirt chân váy black olive'),
    ('demo-010', 'DEMO-P010', 'Jogger Pants', 'jogger-pants', 'Quần jogger demo co giãn.', 'bottoms', 'Sample Street', 529000::bigint, 'jogger pants quần thể thao gray black'),
    ('demo-011', 'DEMO-P011', 'Lightweight Jacket', 'lightweight-jacket', 'Áo khoác nhẹ demo chống gió.', 'outerwear', 'Demo Atelier', 899000::bigint, 'lightweight jacket áo khoác nhẹ navy beige'),
    ('demo-012', 'DEMO-P012', 'Denim Jacket', 'denim-jacket', 'Áo khoác denim demo cổ điển.', 'outerwear', 'Sample Street', 999000::bigint, 'denim jacket áo khoác jean blue black'),
    ('demo-013', 'DEMO-P013', 'Utility Overshirt', 'utility-overshirt', 'Áo overshirt demo nhiều túi.', 'outerwear', 'Mock and Co', 799000::bigint, 'utility overshirt áo khoác olive sand'),
    ('demo-014', 'DEMO-P014', 'Rain Shell', 'rain-shell', 'Áo shell demo cho trời mưa nhẹ.', 'outerwear', 'Demo Atelier', 1199000::bigint, 'rain shell áo mưa jacket black teal'),
    ('demo-015', 'DEMO-P015', 'Knit Cardigan', 'knit-cardigan', 'Cardigan dệt kim demo mềm nhẹ.', 'outerwear', 'Mock and Co', 749000::bigint, 'knit cardigan áo len cream brown'),
    ('demo-016', 'DEMO-P016', 'Canvas Cap', 'canvas-cap', 'Mũ canvas demo điều chỉnh được.', 'accessories', 'Sample Street', 249000::bigint, 'canvas cap mũ black beige'),
    ('demo-017', 'DEMO-P017', 'Daily Tote', 'daily-tote', 'Túi tote demo dùng hằng ngày.', 'accessories', 'Demo Atelier', 349000::bigint, 'daily tote túi canvas natural black'),
    ('demo-018', 'DEMO-P018', 'Woven Belt', 'woven-belt', 'Thắt lưng dệt demo linh hoạt.', 'accessories', 'Mock and Co', 229000::bigint, 'woven belt thắt lưng brown black'),
    ('demo-019', 'DEMO-P019', 'Crew Socks', 'crew-socks', 'Vớ cổ trung demo mềm thoáng.', 'accessories', 'Sample Street', 129000::bigint, 'crew socks vớ white black'),
    ('demo-020', 'DEMO-P020', 'Mini Scarf', 'mini-scarf', 'Khăn mini demo tạo điểm nhấn.', 'accessories', 'Demo Atelier', 199000::bigint, 'mini scarf khăn blue red')
) AS seed(external_id, sku, name, slug, description, category_slug, brand, base_price, search_text)
JOIN product_categories AS category ON category.slug = seed.category_slug;

INSERT INTO product_variants (
  product_id,
  sku,
  title,
  color,
  size,
  price,
  compare_at_price
)
SELECT
  product.id,
  seed.sku,
  seed.title,
  seed.color,
  seed.size,
  seed.price,
  seed.compare_at_price
FROM (
  VALUES
    ('essential-polo', 'DEMO-POLO-BLK-L', 'Black / L', 'black', 'L', 449000::bigint, 499000::bigint),
    ('essential-polo', 'DEMO-POLO-WHT-M', 'White / M', 'white', 'M', 449000::bigint, 499000::bigint),
    ('relaxed-tee', 'DEMO-TEE-BLK-M', 'Black / M', 'black', 'M', 299000::bigint, NULL::bigint),
    ('relaxed-tee', 'DEMO-TEE-SND-L', 'Sand / L', 'sand', 'L', 299000::bigint, NULL::bigint),
    ('linen-shirt', 'DEMO-LIN-WHT-M', 'White / M', 'white', 'M', 599000::bigint, 649000::bigint),
    ('linen-shirt', 'DEMO-LIN-BLU-L', 'Blue / L', 'blue', 'L', 599000::bigint, 649000::bigint),
    ('ribbed-tank', 'DEMO-TANK-WHT-S', 'White / S', 'white', 'S', 249000::bigint, NULL::bigint),
    ('ribbed-tank', 'DEMO-TANK-BLK-M', 'Black / M', 'black', 'M', 249000::bigint, NULL::bigint),
    ('everyday-hoodie', 'DEMO-HOOD-GRY-M', 'Gray / M', 'gray', 'M', 699000::bigint, NULL::bigint),
    ('everyday-hoodie', 'DEMO-HOOD-BLK-L', 'Black / L', 'black', 'L', 699000::bigint, NULL::bigint),
    ('straight-chino', 'DEMO-CHI-BEI-30', 'Beige / 30', 'beige', '30', 649000::bigint, NULL::bigint),
    ('straight-chino', 'DEMO-CHI-NAV-32', 'Navy / 32', 'navy', '32', 649000::bigint, NULL::bigint),
    ('wide-leg-pants', 'DEMO-WIDE-BLK-M', 'Black / M', 'black', 'M', 679000::bigint, NULL::bigint),
    ('wide-leg-pants', 'DEMO-WIDE-CRM-L', 'Cream / L', 'cream', 'L', 679000::bigint, NULL::bigint),
    ('denim-shorts', 'DEMO-SHORT-BLU-M', 'Blue / M', 'blue', 'M', 499000::bigint, NULL::bigint),
    ('denim-shorts', 'DEMO-SHORT-BLK-L', 'Black / L', 'black', 'L', 499000::bigint, NULL::bigint),
    ('midi-skirt', 'DEMO-SKIRT-BLK-S', 'Black / S', 'black', 'S', 559000::bigint, NULL::bigint),
    ('midi-skirt', 'DEMO-SKIRT-OLV-M', 'Olive / M', 'olive', 'M', 559000::bigint, NULL::bigint),
    ('jogger-pants', 'DEMO-JOG-GRY-M', 'Gray / M', 'gray', 'M', 529000::bigint, NULL::bigint),
    ('jogger-pants', 'DEMO-JOG-BLK-L', 'Black / L', 'black', 'L', 529000::bigint, NULL::bigint),
    ('lightweight-jacket', 'DEMO-LWJ-NAV-M', 'Navy / M', 'navy', 'M', 899000::bigint, NULL::bigint),
    ('lightweight-jacket', 'DEMO-LWJ-BEI-L', 'Beige / L', 'beige', 'L', 899000::bigint, NULL::bigint),
    ('denim-jacket', 'DEMO-DNJ-BLU-M', 'Blue / M', 'blue', 'M', 999000::bigint, NULL::bigint),
    ('denim-jacket', 'DEMO-DNJ-BLK-L', 'Black / L', 'black', 'L', 999000::bigint, NULL::bigint),
    ('utility-overshirt', 'DEMO-UTL-OLV-M', 'Olive / M', 'olive', 'M', 799000::bigint, NULL::bigint),
    ('utility-overshirt', 'DEMO-UTL-SND-L', 'Sand / L', 'sand', 'L', 799000::bigint, NULL::bigint),
    ('rain-shell', 'DEMO-RAIN-BLK-L', 'Black / L', 'black', 'L', 1199000::bigint, NULL::bigint),
    ('rain-shell', 'DEMO-RAIN-TEA-M', 'Teal / M', 'teal', 'M', 1199000::bigint, NULL::bigint),
    ('knit-cardigan', 'DEMO-KNT-CRM-M', 'Cream / M', 'cream', 'M', 749000::bigint, NULL::bigint),
    ('knit-cardigan', 'DEMO-KNT-BRN-L', 'Brown / L', 'brown', 'L', 749000::bigint, NULL::bigint),
    ('canvas-cap', 'DEMO-CAP-BLK-OS', 'Black / One Size', 'black', NULL, 249000::bigint, NULL::bigint),
    ('canvas-cap', 'DEMO-CAP-BEI-OS', 'Beige / One Size', 'beige', NULL, 249000::bigint, NULL::bigint),
    ('daily-tote', 'DEMO-TOTE-NAT-OS', 'Natural / One Size', 'natural', NULL, 349000::bigint, NULL::bigint),
    ('daily-tote', 'DEMO-TOTE-BLK-OS', 'Black / One Size', 'black', NULL, 349000::bigint, NULL::bigint),
    ('woven-belt', 'DEMO-BELT-BRN-M', 'Brown / M', 'brown', 'M', 229000::bigint, NULL::bigint),
    ('woven-belt', 'DEMO-BELT-BLK-L', 'Black / L', 'black', 'L', 229000::bigint, NULL::bigint),
    ('crew-socks', 'DEMO-SOCK-WHT-M', 'White / M', 'white', 'M', 129000::bigint, NULL::bigint),
    ('crew-socks', 'DEMO-SOCK-BLK-L', 'Black / L', 'black', 'L', 129000::bigint, NULL::bigint),
    ('mini-scarf', 'DEMO-SCARF-BLU-OS', 'Blue / One Size', 'blue', NULL, 199000::bigint, NULL::bigint),
    ('mini-scarf', 'DEMO-SCARF-RED-OS', 'Red / One Size', 'red', NULL, 199000::bigint, NULL::bigint)
) AS seed(product_slug, sku, title, color, size, price, compare_at_price)
JOIN products AS product ON product.slug = seed.product_slug;

INSERT INTO inventory (variant_id, quantity_available, quantity_reserved)
SELECT
  variant.id,
  CASE
    WHEN variant.sku IN (
      'DEMO-RAIN-BLK-L',
      'DEMO-DNJ-BLK-L',
      'DEMO-SKIRT-OLV-M',
      'DEMO-CAP-BEI-OS',
      'DEMO-SOCK-BLK-L'
    ) THEN 0
    ELSE 8
  END,
  CASE
    WHEN variant.sku IN ('DEMO-POLO-BLK-L', 'DEMO-LIN-BLU-L') THEN 2
    ELSE 0
  END
FROM product_variants AS variant
WHERE variant.sku LIKE 'DEMO-%';

INSERT INTO promotions (name, status, starts_at, ends_at, rules, priority)
VALUES
  ('Demo New Customer', 'active', now() - interval '1 day', now() + interval '30 days', '{"type":"percent","value":10}'::jsonb, 100),
  ('Demo Tops Week', 'scheduled', now() + interval '7 days', now() + interval '14 days', '{"type":"category_percent","category":"tops","value":15}'::jsonb, 80),
  ('Demo Bundle Pair', 'inactive', NULL, NULL, '{"type":"bundle","quantity":2}'::jsonb, 60),
  ('Demo Free Shipping', 'active', now() - interval '1 day', now() + interval '60 days', '{"type":"shipping_threshold","minimum":1000000}'::jsonb, 40),
  ('Demo Archived Campaign', 'expired', now() - interval '60 days', now() - interval '30 days', '{"type":"percent","value":5}'::jsonb, 10);
