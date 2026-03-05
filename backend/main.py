from fastapi import FastAPI, Query
from fastapi.responses import JSONResponse, HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Tuple
from pathlib import Path
import math
import os
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

app = FastAPI(title="Sri Lanka Route Animation Mock API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR.parent / "frontend"
STATIC_DIR = BASE_DIR / "static"

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# Serve frontend static assets (JS/CSS) at /assets so index.html can reference them
app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIR)), name="frontend_assets")


@app.get("/", response_class=HTMLResponse)
def index():
    index_path = FRONTEND_DIR / "index.html"
    html = index_path.read_text(encoding="utf-8")
    html = html.replace("{{GOOGLE_MAPS_API_KEY}}", os.environ.get("GOOGLE_MAPS_API_KEY", ""))
    html = html.replace("{{GOOGLE_MAPS_MAP_ID}}", os.environ.get("GOOGLE_MAPS_MAP_ID", ""))
    return HTMLResponse(html)


def haversine_km(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    lat1, lon1 = a
    lat2, lon2 = b
    R = 6371.0088
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    lat1r = math.radians(lat1)
    lat2r = math.radians(lat2)
    a_ = math.sin(dlat / 2) ** 2 + math.cos(lat1r) * math.cos(lat2r) * math.sin(dlon / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a_), math.sqrt(1 - a_))
    return R * c


@app.get("/itinerary")
def get_itinerary():
    # Mock itinerary for Sri Lanka (6-7 stops)
    # stops = [
    #     {"id": "colombo", "name": "Colombo", "day": 1, "lat": 6.9271, "lng": 79.8612, "photoUrl": "/static/stops/colombo.svg"},
    #     {"id": "kandy", "name": "Kandy", "day": 1, "lat": 7.2906, "lng": 80.6337, "photoUrl": "/static/stops/kandy.svg"},
    #     {"id": "sigiriya", "name": "Sigiriya", "day": 2, "lat": 7.9567, "lng": 80.7608, "photoUrl": "/static/stops/sigiriya.svg"},
    #     {"id": "nuwara_eliya", "name": "Nuwara Eliya", "day": 3, "lat": 6.9497, "lng": 80.7893, "photoUrl": "/static/stops/nuwara_eliya.svg"},
    #     {"id": "ella", "name": "Ella", "day": 3, "lat": 6.8393, "lng": 81.0534, "photoUrl": "/static/stops/ella.svg"},
    #     {"id": "yala", "name": "Yala", "day": 4, "lat": 6.3615, "lng": 81.4361, "photoUrl": "/static/stops/yala.svg"},
    #     {"id": "mirissa", "name": "Mirissa", "day": 5, "lat": 5.9482, "lng": 80.4700, "photoUrl": "/static/stops/mirissa.svg"},
    #     # {"id": "jaffna", "name": "Jaffna", "day": 6, "lat": 9.6615, "lng": 80.1836, "photoUrl": "/static/stops/jaffna.svg"},
    # ]
    stops = [
        {
            "id": "bia",
            "name": "Bandaranaike International Airport (BIA)",
            "day": 1,
            "lat": 7.1274,
            "lng": 79.8837,
            "photoUrl": "https://storage.googleapis.com/manike-ai-media/experience-images/tenants/tenant-670177c55486/images/f24c733d-7cfe-4a6f-bdb8-22943cb574b2.jpg",
        },
        {
            "id": "fortress_koggala",
            "name": "The Fortress Resort & Spa, Koggala",
            "day": 1,
            "lat": 5.9686,
            "lng": 80.3475,
            "photoUrl": "https://storage.googleapis.com/manike-ai-media/experience-images/tenants/tenant-670177c55486/images/2f5a9b46-dd8a-4579-9213-ecbf0095f8d2.jpg",
        },
        {
            "id": "unawatuna_beach",
            "name": "Unawatuna Beach",
            "day": 1,
            "lat": 6.0076,
            "lng": 80.2520,
            "photoUrl": "https://storage.googleapis.com/manike-ai-media/experience-images/tenants/tenant-670177c55486/images/8d7daaae-4fb7-4051-aa41-4e0dc62769e1.jpg",
        },
        {
            "id": "galle_fort",
            "name": "Galle Fort",
            "day": 2,
            "lat": 6.0319,
            "lng": 80.2210,
            "photoUrl": "https://storage.googleapis.com/manike-ai-media/experience-images/tenants/tenant-670177c55486/images/c4df9fac-37ee-4392-a4b3-65a292895efd.jpg",
        },
    ]
    return JSONResponse({
        "title": "Sri Lanka Trip",
        # default vehicle icon: replace with /static/car_top.png (add your attached top-down car image there)
        "vehicleIconUrl": "/static/car_top.png",
        "stops": stops,
    })


@app.get("/route")
def get_route(from_: str = Query(..., alias="from"), to: str = Query(...)):
    # from and to are expected as "lat,lng"
    try:
        lat1_s, lon1_s = from_.split(",")
        lat2_s, lon2_s = to.split(",")
        lat1, lon1 = float(lat1_s), float(lon1_s)
        lat2, lon2 = float(lat2_s), float(lon2_s)
    except Exception:
        return JSONResponse({"error": "bad from/to format, expected lat,lng"}, status_code=400)

    # Compute straight-line distance
    distance_km = haversine_km((lat1, lon1), (lat2, lon2))

    # Create densified curved route (N points). Slight sinusoidal offset to create a natural curve
    N = 200
    coords = []
    for i in range(N + 1):
        t = i / N
        lat = lat1 + (lat2 - lat1) * t
        lon = lon1 + (lon2 - lon1) * t
        # add small perpendicular offset for curvature
        offset = math.sin(math.pi * t) * 0.02 * (distance_km / 200.0)
        # compute a perpendicular direction (rotate vector by 90deg)
        dlat = lat2 - lat1
        dlon = lon2 - lon1
        # normalize
        L = math.hypot(dlat, dlon) + 1e-9
        pdlat = -dlon / L
        pdlon = dlat / L
        lat += pdlat * offset
        lon += pdlon * offset
        coords.append([lon, lat])

    return JSONResponse({
        "geometry": {"type": "LineString", "coordinates": coords},
        "distanceKm": round(distance_km, 3),
    })


@app.get("/ping")
def ping():
    return {"status": "ok"}


# Note: To replace the mock route with Google Maps Directions (or other routing service):
# - Call the external routing API in /route and return geometry.coordinates and distanceKm.
# - Keep the same response structure so frontend can switch without changes.
