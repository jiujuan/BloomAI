-- DRQ-09: semantic citation verification provenance and configurable release-gate diagnostics.
ALTER TABLE research_citations ADD COLUMN verification_method TEXT;
ALTER TABLE research_citations ADD COLUMN semantic_checks_json TEXT;

ALTER TABLE research_quality_assessments ADD COLUMN policy_version TEXT;
ALTER TABLE research_quality_assessments ADD COLUMN gate_results_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE research_quality_assessments ADD COLUMN remedial_actions_json TEXT NOT NULL DEFAULT '[]';
