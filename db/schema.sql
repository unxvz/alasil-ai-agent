CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DROP TABLE IF EXISTS products CASCADE;

CREATE TABLE products (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sku               TEXT UNIQUE NOT NULL,
  handle            TEXT UNIQUE NOT NULL,
  title             TEXT NOT NULL,
  category          TEXT NOT NULL,
  family            TEXT,
  model             TEXT,
  variant           TEXT,
  chip              TEXT,
  storage_gb        INTEGER,
  ram_gb            INTEGER,
  screen_inch       NUMERIC(4,1),
  color             TEXT,
  region            TEXT,
  sim               TEXT,
  keyboard_layout   TEXT,
  connectivity      TEXT,
  price_aed         NUMERIC(10,2) NOT NULL,
  compare_at_aed    NUMERIC(10,2),
  in_stock          BOOLEAN NOT NULL DEFAULT TRUE,
  tags              TEXT[] NOT NULL DEFAULT '{}',
  features          JSONB NOT NULL DEFAULT '{}'::jsonb,
  url               TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_products_category        ON products (category);
CREATE INDEX idx_products_family          ON products (family);
CREATE INDEX idx_products_model           ON products (model);
CREATE INDEX idx_products_variant         ON products (variant);
CREATE INDEX idx_products_chip            ON products (chip);
CREATE INDEX idx_products_storage_gb      ON products (storage_gb);
CREATE INDEX idx_products_color           ON products (color);
CREATE INDEX idx_products_region          ON products (region);
CREATE INDEX idx_products_keyboard_layout ON products (keyboard_layout);
CREATE INDEX idx_products_price_aed       ON products (price_aed);
CREATE INDEX idx_products_tags            ON products USING GIN (tags);
CREATE INDEX idx_products_features        ON products USING GIN (features);

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_products_updated_at ON products;
CREATE TRIGGER trg_products_updated_at
BEFORE UPDATE ON products
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
