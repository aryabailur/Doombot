"""Repository endpoints.

    GET  /api/health                          -> {status: "ok"}
    GET  /api/repos                           -> list with health scores
    POST /api/repos/{owner}/{repo}/index      -> trigger RAG indexing
    GET  /api/repos/{owner}/{repo}/health     -> score + breakdown + history
    GET  /api/brief/{owner}/{repo}            -> weekly brief markdown
"""
