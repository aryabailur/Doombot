# tests/

These `manual_*.py` files are the prototype's ad-hoc scripts. They execute
real Groq and GitHub calls **at import time** with hardcoded state.

They were renamed off the `test_*.py` prefix deliberately: under that name
`pytest` would collect them and fire live API calls during collection.

Do not add them to a CI run. Convert to real pytest cases if time allows —
this is below the cut line in the hackathon plan.
