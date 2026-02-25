ALTER TABLE credit_limit_violations ADD INDEX idx_clv_branch (branch_id);
ALTER TABLE detected_anomalies ADD INDEX idx_da_entity (entity_id);
