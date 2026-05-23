-- Create favorites table for client-worker favorites relationship
CREATE TABLE IF NOT EXISTS favorites (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  technician_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  CONSTRAINT favorites_unique_pair UNIQUE (client_id, technician_id)
);

CREATE INDEX IF NOT EXISTS favorites_client_id_idx ON favorites(client_id);
CREATE INDEX IF NOT EXISTS favorites_technician_id_idx ON favorites(technician_id);

-- RLS: only the authenticated client can read/write their own favorites
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client can manage own favorites"
  ON favorites
  FOR ALL
  USING (auth.uid() = client_id)
  WITH CHECK (auth.uid() = client_id);
