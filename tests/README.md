# tests/

These `manual_*.py` files are the prototype's ad-hoc scripts. They execute
real Groq and GitHub calls **at import time** with hardcoded state.

They were renamed off the `test_*.py` prefix deliberately: under that name
`pytest` would collect them and fire live API calls during collection.

Do not add them to a CI run. Convert to real pytest cases if time allows —
this is below the cut line in the hackathon plan.

---

## Coverage

| File | What it locks | Needs a backend? |
|---|---|---|
| `test_chain.py` | `StepRecord` shape, the `add` reducer, the `{type, data}` stream envelope, rule zero | No |
| `test_security_scanner.py` | Layer-1 keyword matching, separators, dedup | No |
| `test_retriever.py` | Cosine recovery from L2, duplicate thresholds | No |
| `test_api_contract.py` | Every `api/CLAUDE.md` shape, plus the WebSocket envelope | Skips cleanly without one |

Run everything with `pytest tests/ -q` (~5s).

`test_api_contract.py` is the Stream A/C/D seam. Start the API and run it the
moment the real endpoints exist — it names the exact field that is wrong:

```bash
uvicorn api.main:app --port 8000
pytest tests/test_api_contract.py -v
```
