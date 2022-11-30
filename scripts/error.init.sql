CREATE TABLE error (
  timestamp TIMESTAMPTZ NOT NULL,
  applicationpublickey TEXT NOT NULL,
  blockchain TEXT NOT NULL,
  nodepublickey TEXT,
  elapsedtime DOUBLE PRECISION NOT NULL,
  bytes NUMERIC NOT NULL,
  method TEXT,
  message TEXT,
  code TEXT
);
CREATE INDEX error_node_public_key_timestamp_idx ON error(nodepublickey, timestamp DESC);
CREATE INDEX error_timestamp_application_public_key_idx ON error(timestamp DESC, applicationpublickey);
CREATE INDEX error_timestamp_idx ON error(timestamp DESC);