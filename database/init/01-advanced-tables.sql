-- Create scans table (basic table that others depend on)
CREATE TABLE IF NOT EXISTS scans (
    id UUID PRIMARY KEY,
    url TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    global_risk_score INTEGER DEFAULT 0,
    error TEXT,
    metadata JSONB DEFAULT '{}'
);

-- Ensure artifact_paths column exists for compatibility with API
ALTER TABLE scans
    ADD COLUMN IF NOT EXISTS artifact_paths JSONB DEFAULT '{}';

-- Create AI analysis table
CREATE TABLE IF NOT EXISTS ai_analysis (
    scan_id UUID PRIMARY KEY,
    threat_intelligence JSONB,
    risk_assessment JSONB,
    behavioral_analysis JSONB,
    predictions JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (scan_id) REFERENCES scans(id) ON DELETE CASCADE
);

-- Create integrity reports table
CREATE TABLE IF NOT EXISTS integrity_reports (
    id SERIAL PRIMARY KEY,
    scan_id UUID NOT NULL,
    package_name VARCHAR(255) NOT NULL,
    version VARCHAR(100),
    integrity_status VARCHAR(50) NOT NULL,
    verification_method VARCHAR(100),
    confidence DECIMAL(5,2),
    details JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (scan_id) REFERENCES scans(id) ON DELETE CASCADE
);

-- Create supply chain analysis table
CREATE TABLE IF NOT EXISTS supply_chain_analysis (
    scan_id UUID PRIMARY KEY,
    risk_assessment JSONB,
    recommendations JSONB,
    supply_chain_map JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (scan_id) REFERENCES scans(id) ON DELETE CASCADE
);

-- Create quantum readiness table
CREATE TABLE IF NOT EXISTS quantum_readiness (
    scan_id UUID PRIMARY KEY,
    overall_readiness DECIMAL(5,2),
    crypto_inventory JSONB,
    threats JSONB,
    migration_plan JSONB,
    timeline JSONB,
    cost_estimate JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (scan_id) REFERENCES scans(id) ON DELETE CASCADE
);

-- Create analytics reports table
CREATE TABLE IF NOT EXISTS analytics_reports (
    id SERIAL PRIMARY KEY,
    scan_id UUID NOT NULL,
    type VARCHAR(100) NOT NULL,
    title VARCHAR(255) NOT NULL,
    generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    summary JSONB,
    sections JSONB,
    recommendations JSONB,
    charts JSONB,
    FOREIGN KEY (scan_id) REFERENCES scans(id) ON DELETE CASCADE
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_ai_analysis_scan_id ON ai_analysis(scan_id);
CREATE INDEX IF NOT EXISTS idx_integrity_reports_scan_id ON integrity_reports(scan_id);
CREATE INDEX IF NOT EXISTS idx_integrity_reports_package ON integrity_reports(package_name);
CREATE INDEX IF NOT EXISTS idx_quantum_readiness_scan_id ON quantum_readiness(scan_id);
CREATE INDEX IF NOT EXISTS idx_analytics_reports_scan_id ON analytics_reports(scan_id);
CREATE INDEX IF NOT EXISTS idx_analytics_reports_type ON analytics_reports(type);

-- Add updated_at trigger function (if not exists)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at columns
CREATE TRIGGER update_ai_analysis_updated_at 
    BEFORE UPDATE ON ai_analysis 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_supply_chain_analysis_updated_at 
    BEFORE UPDATE ON supply_chain_analysis 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_quantum_readiness_updated_at 
    BEFORE UPDATE ON quantum_readiness 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
