"""Pydantic response models — THE CONTRACT.

Frozen at H2. Person A ships every endpoint returning hardcoded fixtures
shaped by these models before writing any real logic, so Person C's
frontend is never blocked.

StepRecord has an identical shape in the DB, over the WebSocket, and in
REST responses — defined once, here.

To implement:
    Evidence, StepRecord, InvestigationSummary, InvestigationDetail,
    Escalation, HealthBreakdown, HealthResponse, RepoSummary,
    FeedbackRequest, CreateInvestigationRequest, BriefResponse
"""
