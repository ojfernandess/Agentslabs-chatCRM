-- Tenants that already paired Wavoip devices should keep voice enabled after wavoip_voice became opt-in.
INSERT INTO organization_feature_flags (id, organization_id, key, enabled, updated_at)
SELECT gen_random_uuid(), organization_id, 'wavoip_voice', true, NOW()
FROM (SELECT DISTINCT organization_id FROM wavoip_devices) AS legacy_orgs
ON CONFLICT (organization_id, key) DO NOTHING;
