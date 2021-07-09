-- Local setup of timescaledb relations

CREATE TABLE relay (
  timestamp TIMESTAMPTZ NOT NULL,
  app_pub_key TEXT NOT NULL,
  blockchain TEXT NOT NULL,
  service_node TEXT,
  elapsed_time DOUBLE PRECISION NOT NULL,
  result NUMERIC,
  bytes NUMERIC NOT NULL,
  method TEXT
);

CREATE INDEX relay_app_pub_key_method_timestamp_idx ON relay(app_pub_key, method, timestamp);
CREATE INDEX relay_app_pub_key_result_timestamp_idx ON relay(app_pub_key, result, timestamp);
CREATE INDEX relay_app_pub_key_timestamp_idx ON relay(app_pub_key, timestamp DESC);
CREATE INDEX relay_service_node_timestamp_idx ON relay(service_node, timestamp DESC);
CREATE INDEX relay_timestamp_app_pub_key_idx ON relay(timestamp DESC, app_pub_key);
CREATE INDEX relay_timestamp_idx ON relay(timestamp DESC);

CREATE TABLE error (
  timestamp TIMESTAMPTZ NOT NULL,
  app_pub_key TEXT NOT NULL,
  blockchain TEXT NOT NULL,
  service_node TEXT,
  elapsed_time DOUBLE PRECISION NOT NULL,
  bytes NUMERIC NOT NULL,
  method TEXT,
  message TEXT
);

CREATE INDEX error_service_node_timestamp_idx ON error(service_node, timestamp DESC);
CREATE INDEX error_timestamp_app_pub_key_idx ON error(timestamp DESC, app_pub_key);
CREATE INDEX error_timestamp_idx ON error(timestamp DESC);