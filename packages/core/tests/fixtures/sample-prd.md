# Phasekit Sample PRD

## Goal

Provide a deterministic tracked PRD fixture for ingest tests.

## Story 1: Project initialization

Acceptance criteria:
- Initialize planning state in a new repository.
- Persist generated planning files under `.planning/`.

## Story 2: Requirement ingestion

Acceptance criteria:
- Accept one or more input paths for PRD ingestion.
- Extract stable requirements from headings and acceptance criteria.
- Generate at least one actionable phase from the ingested requirements.
