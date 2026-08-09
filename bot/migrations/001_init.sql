CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  amount REAL NOT NULL,
  category TEXT NOT NULL,
  note TEXT,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);

INSERT OR IGNORE INTO categories (name) VALUES
  ('продукты'),
  ('кафе и рестораны'),
  ('алкоголь'),
  ('сладости и снеки'),
  ('доставка еды'),
  ('транспорт'),
  ('дом и коммуналка'),
  ('дети'),
  ('здоровье'),
  ('одежда'),
  ('развлечения и хобби'),
  ('подписки и сервисы'),
  ('прочее');
