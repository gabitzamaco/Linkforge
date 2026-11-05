CREATE TABLE IF NOT EXISTS link_click_daily (
  code TEXT NOT NULL REFERENCES links(code) ON DELETE CASCADE,
  day DATE NOT NULL,
  clicks INTEGER NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  PRIMARY KEY (code, day)
);
