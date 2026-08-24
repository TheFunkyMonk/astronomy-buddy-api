# Astronomy Buddy API

A Node.js REST API that provides celestial viewing recommendations based on location, viewing equipment, and current weather conditions. Uses the Astronomy API and 7timer weather data to determine optimal viewing targets.

## Features

- **RESTful JSON API**: Easy integration with web apps, mobile apps, and other services
- **Flexible Location**: Pass latitude, longitude, and elevation as query parameters
- **Location Name Resolution**: Automatically geocodes coordinates to human-readable location names (City, State/Country)
- **Weather-Aware Planning**: Real-time atmospheric conditions (cloud cover, seeing, transparency)
- **Smoke & Haze Aware**: Factors aerosol optical depth into viewing quality, so wildfire smoke can no longer be reported as "excellent transparency" — and reports air quality separately as a health advisory
- **Smart Target Analysis**: Evaluates celestial objects throughout your evening viewing window
- **Multiple Viewing Options**: Supports naked eye viewing and telescope-specific ratings (entry, intermediate, advanced telescopes)
- **Peak Viewing Times**: Identifies optimal viewing hour for each celestial target
- **Compass Directions**: Provides 16-point compass directions (N, NNE, NE, etc.) for locating targets in the sky
- **Distance Information**: Provides distances from Earth in appropriate light units (light seconds, minutes, hours, days, or years)
- **Intelligent Target Scoring**: Prioritizes targets based on magnitude, altitude, and object type
- **Flexible Parameter Handling**: Supports both standard URL parameters and JSON-encoded parameters
- **CORS Enabled**: Can be called from any frontend application
- **Health Check Endpoint**: Monitor API availability
- **Comprehensive Logging**: Detailed console logging for debugging and monitoring
- **Graceful Shutdown**: Handles SIGTERM for proper server cleanup

## Requirements

- Node.js v20.11 or higher
- Astronomy API credentials (free tier available at https://astronomyapi.com)

No credentials are needed for weather (7timer), air quality (Open-Meteo), or
geocoding (Nominatim) — all three are keyless.

## Setup

1. Install dependencies:
	```bash
	npm install dotenv
	```

2. Copy `.env.example` to `.env` and fill in your values:
	```bash
	cp .env.example .env
	```

3. Update the `.env` file with your API credentials and default settings:

### Example `.env` file:

```env
# Astronomy API Credentials (REQUIRED)
ASTRONOMY_API_APP_ID=your_app_id_here
ASTRONOMY_API_APP_SECRET=your_app_secret_here

# Default Settings (Optional - can be overridden in API requests)
VIEWING_LEVEL=naked-eye
EVENING_START_HOUR=21
EVENING_END_HOUR=2

# Server Configuration
PORT=3000
```

## Usage

### Starting the Server

Run the API server:

```bash
node astronomy-buddy-api.js
```

Or use npm:

```bash
npm start
```

The server will start on the configured port (default: 3000).

### API Endpoints

#### GET /viewing-data

Returns viewing recommendations for the current evening at the specified location.

**Required Query Parameters:**
- `latitude` (number): Latitude in decimal degrees (-90 to 90)
- `longitude` (number): Longitude in decimal degrees (-180 to 180)
- `elevation` (number): Elevation in meters above sea level

**Optional Query Parameters:**
- `viewingLevel` (string): One of `naked-eye`, `entry`, `intermediate`, `advanced` (default: from .env or `naked-eye`)
	- Also accepts descriptive formats like "Entry-level telescope (60-80mm aperture)" which will be automatically mapped
- `eveningStartHour` (number): Start of viewing window in 24-hour format, 0-23 (default: from .env or 21)
- `eveningEndHour` (number): End of viewing window in 24-hour format, 0-23 (default: from .env or 2)

**Parameter Format Support:**

The API supports both standard URL-encoded parameters and JSON-encoded parameters:

Standard format:
```bash
curl "http://localhost:3000/viewing-data?latitude=47.6062&longitude=-122.3321&elevation=50"
```

JSON-encoded format (automatically detected and parsed):
```bash
curl 'http://localhost:3000/viewing-data?{"latitude":47.6062,"longitude":-122.3321,"elevation":50}'
```

**Request Examples:**

Basic request (Seattle, WA):
```bash
curl "http://localhost:3000/viewing-data?latitude=47.6062&longitude=-122.3321&elevation=50"
```

With viewing level (New York, NY with entry telescope):
```bash
curl "http://localhost:3000/viewing-data?latitude=40.7128&longitude=-74.0060&elevation=10&viewingLevel=entry"
```

Custom viewing window (London, UK from 8pm to 1am):
```bash
curl "http://localhost:3000/viewing-data?latitude=51.5074&longitude=-0.1278&elevation=11&eveningStartHour=20&eveningEndHour=1"
```

**Response:** (200 OK)
```json
{
	"date": "2025-11-11",
	"location": {
		"name": "Seattle",
		"latitude": 47.6062,
		"longitude": -122.3321,
		"elevation": 50
	},
	"viewingLevel": "naked-eye",
	"viewingCapabilities": {
		"maxMagnitude": 6,
		"minAltitude": 20,
		"description": "Naked eye viewing"
	},
	"weather": {
		"quality": "good",
		"score": 1,
		"worthObserving": true,
		"avgCloudCover": 2.5,
		"avgSeeing": 3.0,
		"avgTransparency": 2.5,
		"cloudCoverPct": 19,
		"seeingText": "good",
		"transparencyText": "fair",
		"clearHours": 6,
		"nightHours": 6,
		"clearFraction": 1,
		"hasRain": false,
		"reasons": [
			"steady atmosphere",
			"moderate smoke haze"
		],
		"verdict": "A good night for stargazing. Smoke is taking the edge off.",
		"summary": "Clear all night.",
		"airQuality": {
			"aod": 0.34,
			"aodPeak": 0.36,
			"level": "moderate",
			"aerosolType": "smoke",
			"extinctionMagnitudes": 0.37,
			"pm25": 41.6,
			"dust": 1,
			"usAqi": 152,
			"healthCategory": "unhealthy",
			"healthAdvisory": "AQI 152 — unhealthy air; keep the session short or wear a mask.",
			"label": "Moderate smoke haze",
			"transparencyImpact": "Smoke costs 0.4 mag overhead, 1.1 low down — faint objects suffer near the horizon.",
			"dimsView": true,
			"dominatesView": false
		},
		"display": {
			"heading": "Good Conditions",
			"targetsHeading": "Best Targets Tonight",
			"severity": "caution",
			"severityRank": 2,
			"icon": "star"
		},
		"notices": [
			{
				"kind": "aerosol",
				"severity": "caution",
				"icon": "smoke",
				"text": "Smoke costs 0.4 mag overhead, 1.1 low down — faint objects suffer near the horizon."
			},
			{
				"kind": "health",
				"severity": "warning",
				"icon": "health",
				"text": "AQI 152 — unhealthy air; keep the session short or wear a mask."
			}
		]
	},
	"targets": {
		"excellent": [
			{
				"name": "Moon",
				"bestRating": "excellent",
				"reason": "High in the sky, steady air, very bright",
				"magnitude": -11.5,
				"constellation": "Pisces",
				"peakAltitude": 45.3,
				"peakHour": 21,
				"peakAzimuth": 180.5,
				"peakDirection": "S",
				"visibleHours": 5,
				"totalHours": 6,
				"distance": {
					"fromEarth": {
						"au": "0.00257",
						"km": "384400"
					}
				},
				"lightDistance": {
					"value": 1.28,
					"unit": "light-seconds",
					"string": "1.28 light seconds away"
				}
			}
		],
		"good": [
			{
				"name": "Jupiter",
				"bestRating": "good",
				"reason": "Good viewing angle, very bright",
				"magnitude": -2.1,
				"constellation": "Taurus",
				"peakAltitude": 38.2,
				"peakHour": 23,
				"peakAzimuth": 120.3,
				"peakDirection": "ESE",
				"visibleHours": 6,
				"totalHours": 6,
				"distance": {
					"fromEarth": {
						"au": "5.20",
						"km": "778000000"
					}
				},
				"lightDistance": {
					"value": 43.24,
					"unit": "light-minutes",
					"string": "43.24 light minutes away"
				}
			}
		],
	}
}
```

#### GET /health

Health check endpoint for monitoring.

**Request:**
```bash
curl http://localhost:3000/health
```

**Response:** (200 OK)
```json
{
	"status": "ok",
	"timestamp": "2025-11-11T12:34:56.789Z"
}
```

### Response Fields

**Root Level:**
- `date` (string): The observation date (YYYY-MM-DD)
- `location` (object): Observer's location details
	- `name` (string): Human-readable location name (e.g., "Seattle", "New York", "London")
	- `latitude` (number): Latitude in decimal degrees
	- `longitude` (number): Longitude in decimal degrees
	- `elevation` (number): Elevation in meters
- `viewingLevel` (string): Current viewing equipment level
- `viewingCapabilities` (object): Capabilities of the viewing equipment
- `weather` (object): Current weather conditions
- `targets` (object): Categorized celestial targets

**Weather Object:**

Quality reflects only the **upcoming night** (tonight's configured evening
window, in the location's local time) and is driven primarily by how much of
that window is genuinely clear:

- `excellent`: ~85%+ of the night clear
- `good`: ~65%+ of the night clear
- `partial`: a real clear window exists, but a meaningful part of the night is clouded (the "clear early, then cloudy" case)
- `poor`: no genuinely clear window; mostly cloudy — **or** a cloudless night ruined by heavy smoke
- `unsuitable`: overcast all night or precipitation expected

Aerosols (wildfire smoke, dust) can downgrade quality independently of cloud —
see [Air Quality & Smoke](#air-quality--smoke).

Fields:
- `quality` (string): Overall viewing quality (excellent/good/partial/poor/unsuitable)
- `score` (number): Numerical quality score (0 = best, 5 = worst)
- `worthObserving` (boolean): Whether conditions are suitable for observing (true for excellent/good/partial)
- `avgCloudCover` (number): Average cloud cover index for the night (1-9, **lower is better**, 1 = clear)
- `avgSeeing` (number): Average seeing index (1-8, **lower is better**, 1 = steadiest)
- `avgTransparency` (number): Average transparency index (1-8, **lower is better**, 1 = clearest air)
- `cloudCoverPct` (number): `avgCloudCover` expressed as an approximate percentage (0-100)
- `seeingText` (string): Human-friendly seeing rating (excellent/good/fair/poor)
- `transparencyText` (string): Human-friendly transparency rating (excellent/good/fair/poor)
- `clearHours` (number): Approximate hours of genuinely clear sky during the window
- `nightHours` (number): Approximate length of the evening viewing window, in hours
- `clearFraction` (number): Fraction of the window that is clear (0-1)
- `hasRain` (boolean): Whether precipitation is expected
- `reasons` (array): Human-readable weather factors
- `verdict` (string): Headline for the night, including any smoke caveat. One sentence, at most 90 characters — see [Copy Length Budgets](#copy-length-budgets)
- `summary` (string|null): One-liner on how much of the night is clear, at most 48 characters
- `airQuality` (object|**optional**): Aerosol and air quality reading — see below
- `display` (object): Presentation directives — heading, severity, icon. See [Presentation Directives](#presentation-directives-weatherdisplay-weathernotices)
- `notices` (array): Ordered advisories to render generically. Empty array when there is nothing to flag

> **Note on 7timer scales:** cloud cover, seeing, and transparency are all
> reported by 7timer as indices where a **lower number is better**. Earlier
> versions of this API treated seeing/transparency as "higher is better",
> which inverted those factors.

### Air Quality & Smoke

`weather.transparencyText` reports the **worse** of 7timer's water-vapour
transparency and the aerosol load, because 7timer's transparency index does not
account for wildfire smoke. Before this was added, a smoke-choked Seattle night
at AOD 0.7 was reported as `"excellent transparency"`.

**Aerosol optical depth (AOD), not AQI, is the metric that matters for
stargazing.** AOD at 550nm measures how much the whole air column dims and
scatters starlight; US AQI is a health metric and is a poor proxy for it. A real
example: Seattle on 2026-08-04 sat at **AQI 56–78 ("moderate")** while **AOD hit
0.73** — a naive `aqi > 100` threshold would have called that a great night. The
two are therefore tracked separately and used for different things:

| Signal | Drives | Where it surfaces |
| --- | --- | --- |
| AOD | What you can *see* | `quality`, `transparencyText`, `reasons`, `verdict`, target ratings |
| US AQI | Whether you should *be outside* | `airQuality.healthAdvisory` only |

**AOD levels and their effect on `quality`:**

| AOD | `level` | Effect |
| --- | --- | --- |
| < 0.08 | `pristine` | "Exceptional transparency" call-out |
| 0.08 – 0.15 | `none` | No mention (normal continental background) |
| 0.15 – 0.25 | `slight` | Mentioned in `reasons`; suppresses any "excellent transparency" claim |
| 0.25 – 0.40 | `moderate` | Downgrades `excellent` → `good` |
| 0.40 – 0.75 | `significant` | Downgrades `excellent`/`good` → `partial`; smoke leads the `verdict` |
| > 0.75 | `heavy` | Forces `quality` to `poor` and `worthObserving` to `false` |

Rain still outranks smoke: on a `unsuitable`/rainy night no aerosol copy is added.

`significant` maps to `partial` rather than `good` on purpose. The sky may be
cloudless all night, but only *part of it* is usable — high targets are fine
while anything low is washed out. Note this makes `partial` mean two different
things (a limited time window, or a limited part of the sky), so consumers should
not assume `partial` implies cloud: check `airQuality.level` before rendering
clear-window copy. The web app, iOS app, and TRMNL template all do this.

> **Calibration.** These boundaries were lowered after a field check in Seattle
> on 2026-08-04. An evening averaging **AOD 0.42** was rated `good` by the
> original thresholds, but on the ground it was clearly only partial viewing:
> stars high overhead were fine, the Moon low down was difficult, and Saturn low
> down was completely invisible. Published AOD tables describe *daytime*
> visibility, which is more forgiving than picking faint point sources out of a
> scattering night sky, so erring darker is correct. Refine as more nights are
> checked.

**Effect on targets — extinction scales with airmass.** This is the important
part, and getting it wrong is what made the first version too lenient.
Extinction is `1.086 × AOD` magnitudes *per unit airmass*, and airmass climbs
steeply toward the horizon (Kasten & Young 1989):

| Altitude | Airmass | Loss at AOD 0.42 |
| --- | --- | --- |
| 90° (zenith) | 1.00 | 0.46 mag |
| 60° | 1.15 | 0.53 mag |
| 30° | 1.99 | 0.91 mag |
| 20° | 2.90 | 1.32 mag |
| 15° | 3.81 | 1.74 mag |
| 10° | 5.59 | 2.55 mag |

So each target is rated against the extinction at *its own* altitude for that
hour, not a flat zenith figure. Two consequences:

- Faint targets get `bestRating: "too-faint"` with the reason *"Too faint through
  the haze"* and drop out of the results.
- Targets far too bright to ever be "too faint" are still demoted on the
  extinction they actually suffer: `≥ 0.8` mag knocks the rating down one step
  (*"dimmed by haze"*), `≥ 1.5` mag forces `poor` (*"badly dimmed by haze"*).
  This is what correctly demotes a low Moon or Saturn.

`viewingCapabilities.maxMagnitude` is deliberately **not** modified: it
advertises the equipment, not tonight's air (and consumers decode it as an
integer).

**Fields (all optional; the whole object is absent if the upstream is
unreachable):**
- `aod` (number): Average aerosol optical depth at 550nm across tonight's window
- `aodPeak` (number): Highest hourly AOD in the window
- `level` (string): One of `pristine`, `none`, `slight`, `moderate`, `significant`, `heavy`
- `aerosolType` (string): `smoke`, `dust`, or `haze` — used to name the right thing in copy
- `extinctionMagnitudes` (number): Magnitudes of dimming **at the zenith** (`1.086 × aod`). This is the best case — multiply by airmass for a given altitude (see the table above)
- `pm25` (number|null): Average PM2.5 in µg/m³
- `dust` (number|null): Average dust in µg/m³
- `usAqi` (number|null): **Peak** US AQI during the window (peak, not average — the worst moment is what matters for health)
- `healthCategory` (string|null): `good`, `moderate`, `sensitive`, `unhealthy`, `very-unhealthy`, `hazardous`
- `healthAdvisory` (string|null): Advice for standing outside a couple of hours; `null` below AQI 100 so it does not cry wolf
- `label` (string|null): Short label, e.g. `"Heavy smoke haze"`
- `transparencyImpact` (string|null): One short sentence on what the aerosols cost you optically, at most 90 characters
- `dimsView` (boolean): True when aerosols are dense enough to visibly dim the sky
- `dominatesView` (boolean): True when the AIR, not cloud, is what limits the night. **Prefer this over testing `level` against string literals** — retuning the tiers then needs no client release

**Degradation.** Air quality is a *soft* dependency, fetched in parallel with the
weather with a 5-second timeout. If Open-Meteo is slow, down, or returns no AOD
for the window, `weather.airQuality` is simply omitted and every other field
behaves exactly as it did before aerosols were considered. Consumers must treat
it as optional.

**Target Object:**
- `name` (string): Celestial body name
- `bestRating` (string): Best viewing rating for the night (excellent/good/fair)
- `reason` (string): Why this rating was assigned
- `magnitude` (number|null): Apparent magnitude (brightness, lower is brighter)
- `constellation` (string): Current constellation
- `peakAltitude` (number): Highest point above horizon in degrees
- `peakHour` (number): Hour when peak altitude occurs (0-23, 24-hour format)
- `peakAzimuth` (number): Compass bearing at peak (0-360 degrees)
- `peakDirection` (string): 16-point compass direction at peak (N, NNE, NE, ENE, E, ESE, SE, SSE, S, SSW, SW, WSW, W, WNW, NW, NNW)
- `visibleHours` (number): Number of hours visible above horizon during viewing window
- `totalHours` (number): Total hours in viewing window
- `distance` (object): Distance from Earth with AU and km values
- `lightDistance` (object): Distance from Earth in light units
	- `value` (number): Numeric distance value
	- `unit` (string): Unit of measurement (light-seconds, light-minutes, light-hours, light-days, light-years)
	- `string` (string): Human-readable distance (e.g., "8.32 light minutes away")

### Presentation Directives (`weather.display`, `weather.notices`)

**The point of these fields is that retuning the weather model should not require
releasing the apps.** For the iOS app in particular, a client change means pulling
the build from review and taking a new place in the queue, so anything the clients
decide for themselves is a change that costs a review cycle.

**The contract.** The API owns every piece of user-visible text and every severity
decision. Clients own exactly two lookup tables, and nothing else:

| Client owns | Entries | Changes when |
| --- | --- | --- |
| `severity` → colour | 5 | Never (closed vocabulary) |
| `icon` token → glyph/asset | ~8 | Only if a genuinely new *depiction* is needed |

`severity` is deliberately **presentation-level**: it says how alarmed to look,
not what is meteorologically wrong. That is why adding a `quality` value or
retuning an aerosol tier changes only *which* severity is emitted, never the
vocabulary itself — so no client needs rebuilding.

```json
"weather": {
  "display": {
    "heading": "Partial Conditions",
    "targetsHeading": "Best Targets High Overhead",
    "severity": "warning",
    "severityRank": 3,
    "icon": "smoke"
  },
  "notices": [
    { "kind": "aerosol", "severity": "warning", "icon": "smoke",  "text": "..." },
    { "kind": "health",  "severity": "caution", "icon": "health", "text": "..." }
  ]
}
```

**`display` fields:**
- `heading` (string): Card heading, rendered verbatim
- `targetsHeading` (string): Heading for the targets list, rendered verbatim
- `severity` (string): `positive` | `neutral` | `caution` | `warning` | `critical`
- `severityRank` (number): 0–4, ordered by increasing alarm. Lets a client place an
  unrecognised severity on the scale instead of guessing
- `icon` (string): Token naming what to *depict* — `sparkles`, `star`,
  `partly-cloudy`, `cloudy`, `rain`, `smoke`, `dust`

**`notices`** is an ordered array of advisories, each `{ kind, severity, icon, text }`.
**Clients must loop this blindly rather than reading named fields.** That is what
makes it possible to add an advisory (moon washout, wind, dew point) and have it
appear on every surface with no client work. `kind` is informational only — never
switch on it.

#### Copy Length Budgets

**Every user-visible string the API emits fits a fixed character budget, so no
client ever has to truncate.** The constraint comes from the narrowest surface:
the TRMNL e-ink dashboard has no scroll and no ellipsis, so copy that overruns
its description column is simply lost off the edge of the panel.

| Field | Budget |
| --- | --- |
| `display.heading`, `display.targetsHeading` | 32 |
| `verdict` | 90 |
| `summary` | 48 |
| `notices[].text`, `airQuality.transparencyImpact`, `airQuality.healthAdvisory` | 90 |
| `targets[].reason` | 64 |

The copy is *authored* to fit — the budgets are not applied by truncating long
prose. A `fitCopy` guardrail trims at a word boundary and logs a `[Copy]` warning
if a future phrasing change ever overruns, so an overflowing string cannot ship
silently. Seeing that warning in the logs is a bug in the copy, not a normal
event.

**One idea per field.** The fields are non-overlapping by design, so a surface
that renders all of them never stacks three sentences saying the same thing:

| Field | Says |
| --- | --- |
| `verdict` | What kind of night it is |
| `summary` | How much of the night is clear |
| `notices[].text` | The supporting detail (magnitudes lost, health advice) |
| `airQuality.label` | What the aerosol *is* ("Heavy smoke haze") |

This is why `verdict` no longer names the aerosol when a notice is already
carrying it: the earlier wording repeated *"heavy smoke haze"* in both places and
ran the TRMNL description to 190 characters, overflowing the panel.

#### Rules for consumers

1. **Never** switch on `quality` or `airQuality.level` for styling. Use
   `display.severity` and `display.icon`.
2. **Never** construct user-visible text. Use `display.heading`,
   `display.targetsHeading`, `verdict`, `summary`, and `notices[].text`. These are
   length-budgeted (above), so render them verbatim — no client-side truncation.
3. Use `airQuality.dominatesView` rather than testing `level` against
   `"significant"`/`"heavy"`.
4. Use `worthObserving` — not severity — for "should I go out?" affordances. A
   smoke-hazed `partial` night and a clouded-out `poor` night are both severity
   `warning`, but only one is worth going out for.
5. Fall back gracefully: an unrecognised `severity` must resolve to **neutral**,
   never to the most alarming colour.

#### Backward and forward compatibility

Both directions are safe, so the API and the apps can be deployed independently
and in any order:

- **Old client, new API** — the extra fields are ignored and the client keeps
  deriving its own styling from `quality`.
- **New client, old API** — `display` and `notices` are absent, and each client
  falls back to its previous local derivation.

The iOS app, web app, and TRMNL template all implement the fallback path, and the
TRMNL template has been verified to render byte-identical output against responses
with and without the directives.

### Error Responses

**Invalid Parameters** (400):
```json
{
	"error": "Invalid parameters",
	"message": "latitude, longitude, and elevation are required and must be valid numbers",
	"example": "/viewing-data?latitude=47.6062&longitude=-122.3321&elevation=50"
}
```

**Invalid Latitude** (400):
```json
{
	"error": "Invalid latitude",
	"message": "latitude must be between -90 and 90"
}
```

**Invalid Longitude** (400):
```json
{
	"error": "Invalid longitude",
	"message": "longitude must be between -180 and 180"
}
```

**Invalid Viewing Level** (400):
```json
{
	"error": "Invalid viewing level",
	"message": "viewingLevel must be one of: naked-eye, entry, intermediate, advanced"
}
```

**Invalid Evening Start Hour** (400):
```json
{
	"error": "Invalid eveningStartHour",
	"message": "eveningStartHour must be between 0 and 23"
}
```

**Invalid Evening End Hour** (400):
```json
{
	"error": "Invalid eveningEndHour",
	"message": "eveningEndHour must be between 0 and 23"
}
```

**Configuration Error** (500):
```json
{
	"error": "Configuration error",
	"message": "ASTRONOMY_API_APP_ID and ASTRONOMY_API_APP_SECRET must be set"
}
```

**Internal Server Error** (500):
```json
{
	"error": "Internal server error",
	"message": "Failed to fetch data for 21:00:00: API request failed"
}
```

**Not Found** (404):
```json
{
	"error": "Not found",
	"message": "Available endpoints: /viewing-data, /health"
}
```

## Viewing Levels

The API adjusts recommendations based on viewing capabilities:

- **naked-eye**: Magnitude ≤6, altitude ≥20°
	- Best for: Moon, planets, bright stars
- **entry**: Magnitude ≤10, altitude ≥15° (60-80mm telescope)
	- Best for: Star clusters, brighter nebulae, lunar details
- **intermediate**: Magnitude ≤12, altitude ≥10° (100-150mm telescope)
	- Best for: Galaxies, fainter nebulae, planetary details
- **advanced**: Magnitude ≤14, altitude ≥5° (200mm+ telescope)
	- Best for: Deep sky objects, distant galaxies, faint nebulae

## Target Prioritization

The API uses intelligent scoring to prioritize celestial targets:

1. **Rating Priority**: Excellent → Good → Fair
2. **Within Each Rating**:
	- Moon receives highest priority (brightness boost)
	- Major planets (Saturn, Jupiter, Mars) receive priority boosts
	- Brighter objects (lower magnitude) are prioritized
	- Higher peak altitude improves score
3. **Visibility Filtering**: Only shows targets that are:
	- Above the horizon during your viewing window
	- Bright enough for your equipment
	- At appropriate altitude for your setup

## Finding Your Coordinates

- **Latitude/Longitude**: https://www.latlong.net/
- **Elevation**: https://www.whatismyelevation.com/

**Example Locations:**
- Seattle, WA: `latitude=47.6062&longitude=-122.3321&elevation=50`
- New York, NY: `latitude=40.7128&longitude=-74.0060&elevation=10`
- London, UK: `latitude=51.5074&longitude=-0.1278&elevation=11`
- Tokyo, Japan: `latitude=35.6762&longitude=139.6503&elevation=40`
- Sydney, Australia: `latitude=-33.8688&longitude=151.2093&elevation=3`

## Integration Examples

### JavaScript/Fetch
```javascript
const params = new URLSearchParams({
	latitude: 47.6062,
	longitude: -122.3321,
	elevation: 50,
	viewingLevel: 'naked-eye'
});

fetch(`http://localhost:3000/viewing-data?${params}`)
	.then(response => response.json())
	.then(data => {
		console.log('Location:', data.location.name);
		console.log('Weather:', data.weather.quality);
		console.log('Worth observing:', data.weather.worthObserving);

		data.targets.excellent.forEach(target => {
			console.log(`${target.name}: Look ${target.peakDirection} at ${target.peakHour}:00`);
		});
	});
```

### cURL with jq
```bash
# Get all excellent targets with peak viewing times
curl -s "http://localhost:3000/viewing-data?latitude=47.6062&longitude=-122.3321&elevation=50" \
	| jq '.targets.excellent[] | "\(.name) - \(.peakHour):00 \(.peakDirection)"'

# Check if weather is suitable for viewing
curl -s "http://localhost:3000/viewing-data?latitude=47.6062&longitude=-122.3321&elevation=50" \
	| jq '.weather | "Quality: \(.quality), Cloud cover: \(.avgCloudCover)/9, Worth observing: \(.worthObserving)"'
```

### Python
```python
import requests

params = {
	'latitude': 47.6062,
	'longitude': -122.3321,
	'elevation': 50,
	'viewingLevel': 'entry'
}

response = requests.get('http://localhost:3000/viewing-data', params=params)
data = response.json()

print(f"Location: {data['location']['name']}")
print(f"Weather quality: {data['weather']['quality']}")
print(f"Cloud cover: {data['weather']['avgCloudCover']}/9")

if data['weather']['worthObserving']:
	print("\nTonight's top targets:")
	for target in data['targets']['excellent']:
		print(f"  {target['name']}")
		print(f"    Best time: {target['peakHour']}:00")
		print(f"    Direction: {target['peakDirection']}")
		print(f"    Altitude: {target['peakAltitude']}°")
		print(f"    Brightness: mag {target['magnitude']}")
```

### React Example
```javascript
import { useState, useEffect } from 'react';

function AstronomyView({ latitude, longitude, elevation }) {
	const [data, setData] = useState(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);

	useEffect(() => {
		const params = new URLSearchParams({
			latitude,
			longitude,
			elevation,
			viewingLevel: 'naked-eye'
		});

		fetch(`http://localhost:3000/viewing-data?${params}`)
			.then(res => {
				if (!res.ok) throw new Error('Failed to fetch viewing data');
				return res.json();
			})
			.then(data => {
				setData(data);
				setLoading(false);
			})
			.catch(err => {
				setError(err.message);
				setLoading(false);
			});
	}, [latitude, longitude, elevation]);

	if (loading) return <div>Loading astronomy data...</div>;
	if (error) return <div>Error: {error}</div>;

	return (
		<div>
			<h1>Viewing Conditions for {data.location.name}</h1>
			<h2>Weather: {data.weather.quality}</h2>
			<p>Cloud cover: ~{data.weather.cloudCoverPct}%</p>
			<p>Clear tonight: {data.weather.clearHours}h of {data.weather.nightHours}h</p>
			<p>Seeing: {data.weather.seeingText}</p>

			{data.weather.worthObserving ? (
				<div>
					<h3>Excellent Targets:</h3>
					{data.targets.excellent.map(target => (
						<div key={target.name} style={{ marginBottom: '1rem' }}>
							<strong>{target.name}</strong>
							<p>Peak time: {target.peakHour}:00 - Look {target.peakDirection}</p>
							<p>Altitude: {target.peakAltitude}° | Magnitude: {target.magnitude}</p>
							<p>Distance: {target.lightDistance.string}</p>
							<p>{target.reason}</p>
						</div>
					))}

					{data.targets.good.length > 0 && (
						<>
							<h3>Good Targets:</h3>
							{data.targets.good.map(target => (
								<div key={target.name}>
									{target.name} - {target.peakHour}:00 {target.peakDirection}
								</div>
							))}
						</>
					)}
				</div>
			) : (
				<p>Weather conditions not suitable for observing tonight.</p>
			)}
		</div>
	);
}
```

## Deployment

### Production Considerations

1. **Environment Variables**: Set ASTRONOMY_API_APP_ID and ASTRONOMY_API_APP_SECRET on your server
2. **Process Manager**: Use PM2 or similar to keep the API running
	```bash
	npm install -g pm2
	pm2 start astronomy-buddy-api.js --name astronomy-api
	pm2 save
	pm2 startup
	```
3. **Reverse Proxy**: Use nginx for HTTPS and rate limiting
4. **Monitoring**: Use the `/health` endpoint for uptime monitoring
5. **Rate Limiting**: Implement rate limiting to prevent abuse
6. **Caching**: Consider caching responses for the same location/time to reduce API calls
7. **Logging**: Console logs are comprehensive - consider using a log management service

### Docker Deployment

Create a `Dockerfile`:
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["node", "astronomy-buddy-api.js"]
```

Build and run:
```bash
docker build -t astronomy-buddy-api .
docker run -p 3000:3000 --env-file .env astronomy-buddy-api
```

### Example nginx Configuration

```nginx
server {
	listen 80;
	server_name api.yoursite.com;

	# Rate limiting
	limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;
	limit_req zone=api_limit burst=20 nodelay;

	location / {
		proxy_pass http://localhost:3000;
		proxy_http_version 1.1;
		proxy_set_header Upgrade $http_upgrade;
		proxy_set_header Connection 'upgrade';
		proxy_set_header Host $host;
		proxy_set_header X-Real-IP $remote_addr;
		proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
		proxy_cache_bypass $http_upgrade;
	}

	location /health {
		proxy_pass http://localhost:3000/health;
		access_log off;
	}
}
```

## APIs Used

- **Astronomy API** (https://astronomyapi.com) - Celestial body positions and data
- **7timer Astro** (https://www.7timer.info) - Astronomical weather forecasting
- **Open-Meteo Air Quality** (https://open-meteo.com/en/docs/air-quality-api) - Aerosol optical depth, PM2.5, dust, and US AQI. Keyless and CAMS-backed; free for non-commercial use up to ~10k calls/day
- **OpenStreetMap Nominatim** (https://nominatim.openstreetmap.org) - Reverse geocoding for location names

## Troubleshooting

**Weather data unavailable**
- The API will return an error object in the weather field but continue with target data
- Check 7timer service status at https://www.7timer.info
- Weather data is averaged across your viewing window - ensure hours are set correctly

**No `weather.airQuality` in the response**
- Air quality is a soft dependency — it is omitted rather than erroring
- Check the logs for `[Air Quality] Unavailable, continuing without it:`
- Open-Meteo may have been slow (5s timeout), down, or returned no aerosol optical depth for your window
- Everything else in the response is unaffected; smoke simply is not factored in for that request

**Smoke is present but not reflected in the response**
- CAMS aerosol data is a model at ~11km resolution and can lag a fast-moving plume by a few hours
- Check `weather.airQuality.aod` directly: below 0.20 the API deliberately says nothing
- Note the window matters — smoke often thins overnight, so a smoky afternoon can still average `moderate` over a 9pm–2am window

**Location name shows "Unknown Location"**
- Geocoding service may be temporarily unavailable
- Location name is optional and doesn't affect core functionality
- API will still provide all target and weather data

**No targets returned**
- Verify your viewing window configuration (eveningStartHour, eveningEndHour parameters)
- Check that your viewing level isn't too restrictive (try `naked-eye` for broader results)
- Try different times of year for different celestial visibility
- Some locations/times may genuinely have poor viewing conditions

**Invalid parameters error**
- Ensure latitude is between -90 and 90
- Ensure longitude is between -180 and 180
- Ensure elevation is a valid number (can be negative for below sea level)
- Ensure hours are between 0 and 23
- For JSON-encoded parameters, ensure proper JSON formatting

**API authentication errors**
- Verify your Astronomy API credentials are correct and active
- Check that credentials are properly set in the .env file
- Ensure no extra spaces in the credential values
- Confirm your API key hasn't exceeded rate limits

**Port already in use**
- Change the PORT in your .env file
- Stop the conflicting service: `lsof -ti:3000 | xargs kill`
- Or use a different port: `PORT=3001 node astronomy-buddy-api.js`

**CORS issues in browser**
- The API includes proper CORS headers
- If still having issues, check your nginx/proxy configuration
- Ensure you're making requests from the correct domain

## Console Logging

The API provides comprehensive logging for debugging:

```
[Server] Astronomy Buddy API running on port 3000
[Request] GET /viewing-data?latitude=47.6062&longitude=-122.3321&elevation=50 from ::1
[Request] Parsed coordinates: lat=47.6062, lon=-122.3321, elevation=50
[Geocoding] Looking up location for lat=47.6062, lon=-122.3321
[Geocoding] Location: Seattle
[Main] Starting analysis for lat=47.6062, lon=-122.3321, elevation=50, level=naked-eye
[Weather API] Fetching data for lat=47.6062, lon=-122.3321
[Air Quality] Fetching aerosol data for lat=47.6062, lon=-122.3321
[Air Quality] AOD 0.42 (moderate, smoke), US AQI 75
[Weather] Interpreting conditions for hours 21-2
[Main] Applying 0.45 mag aerosol extinction penalty to target ratings
[Astronomy API] Fetching positions for 21:00:00
[Main] Results: 3 excellent, 2 good, 1 fair targets
```

Log prefixes indicate the component:
- `[Server]` - Server startup/shutdown
- `[Request]` - HTTP request handling
- `[Geocoding]` - Location name resolution
- `[Main]` - Core analysis logic
- `[Weather API]` - Weather data fetching
- `[Weather]` - Weather interpretation
- `[Air Quality]` - Aerosol and air quality fetching/interpretation
- `[Astronomy API]` - Astronomy data fetching

## Performance Tips

- **Cache responses**: Same location and time will return similar results for a few hours
- **Batch requests**: If checking multiple locations, use Promise.all() in your client
- **Rate limiting**: The Astronomy API has rate limits on the free tier (check your plan)
- **Time zones**: API uses UTC internally but evening hours are in local time
- **Request consolidation**: Combine location requests when possible
- **Health checks**: Use `/health` for monitoring instead of full `/viewing-data` calls

## Limitations

- **Daily predictions only**: API provides data for the current date only
- **Weather forecast**: Limited to 7timer's forecast accuracy (typically 3-day window)
- **Celestial bodies**: Limited to major planets, moon, and brighter deep sky objects
- **API rate limits**: Free tier of Astronomy API has usage limits
- **No historical data**: Cannot query past dates
- **UTC-based calculations**: Evening hours are in local 24-hour format but calculations use UTC
- **Aerosol data is modelled, not measured**: CAMS runs at ~11km resolution and can lag a fast-moving smoke plume by a few hours. Cross-checking a ground station (AirNow, WAQI) would tighten this
- **Zenith extinction figure**: `extinctionMagnitudes` is quoted at the zenith; actual loss roughly doubles at 30° altitude and is not computed per-target

## License

MIT
