-- DRQ-08: durable structured writer result for checkpoint replay and claim/citation binding.
ALTER TABLE research_report_sections ADD COLUMN draft_payload_json TEXT;
