# Sri Lanka Route Animation (FastAPI + Mapbox GL JS)

Run locally (macOS / Linux):

1. Create and activate a venv

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
```

2. Start the FastAPI app (from project root)

```bash
cd backend
uvicorn main:app --reload --port 8000
```

3. Open http://localhost:8000/ in your browser

Notes:
- The backend exposes `/itinerary` and `/route?from=<lat,lng>&to=<lat,lng>`.
- Frontend is served from the `frontend/` folder by FastAPI static mount.
- Mock route generation is in `backend/main.py`. Replace with Mapbox Directions API there if you have a token.
