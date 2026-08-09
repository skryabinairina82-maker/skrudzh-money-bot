ALTER TABLE transactions ADD COLUMN type TEXT NOT NULL DEFAULT 'expense';

INSERT OR IGNORE INTO categories (name) VALUES
  ('зарплата'),
  ('возврат долга'),
  ('алименты'),
  ('подработка'),
  ('подарки'),
  ('прочие поступления');
