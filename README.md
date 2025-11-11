# Astronomy Buddy API

A Node.js REST API that provides celestial viewing recommendations based on location, viewing equipment, and current weather conditions. Uses the Astronomy API and 7timer weather data to determine optimal viewing targets.

## Features

- **RESTful JSON API**: Easy integration with web apps, mobile apps, and other services
- **Flexible Location**: Pass latitude, longitude, and elevation as query parameters
- **Location Name Resolution**: Automatically geocodes coordinates to human-readable location names (City, State/Country)
- **Weather-Aware Planning**: Real-time atmospheric conditions (cloud cover, seeing, transparency)
- **Smart Target Analysis**: Evaluates celestial objects throughout your evening viewing window
- **Multiple Viewing Options**: Supports naked eye viewing and telescope-specific ratings (entry, intermediate, advanced telescopes)
- **Peak Viewing Times**: Identifies optimal viewing hour for each celestial target
- **Compass Directions**: Provides 16-point compass directions (N, NNE, NE, etc.) for locating targets in the sky
- **Intelligent Target Scoring**: Prioritizes targets based on magnitude, altitude, and object type
- **Flexible Parameter Handling**: Supports both standard URL parameters and JSON-encoded parameters
- **CORS Enabled**: Can be called from any frontend application
- **Health Check Endpoint**: Monitor API availability
- **Comprehensive Logging**: Detailed console logging for debugging and monitoring
- **Graceful Shutdown**: Handles SIGTERM for proper server cleanup

## Requirements

- Node.js v20.11 or higher
- Astronomy API credentials (free tier available at https://astronomyapi.com)

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
		"avgCloudCover": 2,
		"avgSeeing": 6.3,
		"avgTransparency": 7.1,
		"hasRain": false,
		"reasons": [
			"clear skies",
			"excellent atmospheric stability",
			"excellent transparency"
		]
	},
	"targets": {
		"excellent": [
			{
				"name": "Moon",
				"bestRating": "excellent",
				"reason": "High in sky, minimal atmospheric interference, very bright",
				"magnitude": -11.5,
				"constellation": "Pisces",
				"peakAltitude": 45.3,
				"peakHour": 21,
				"peakAzimuth": 180.5,
				"peakDirection": "S",
				"visibleHours": 5,
				"totalHours": 6
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
				"totalHours": 6
			}
		],
		"fair": []
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
- `quality` (string): Overall viewing quality (excellent/good/fair/poor/unsuitable)
- `score` (number): Numerical quality score (lower is better)
- `worthObserving` (boolean): Whether conditions are suitable for observing
- `avgCloudCover` (number): Cloud cover rating (1-9, 1=clear)
- `avgSeeing` (number): Atmospheric stability (1-8, 8=best)
- `avgTransparency` (number): Atmospheric transparency (1-8, 8=best)
- `hasRain` (boolean): Whether precipitation is expected
- `reasons` (array): Human-readable weather factors

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
			<p>Cloud cover: {data.weather.avgCloudCover}/9</p>
			<p>Atmospheric stability: {data.weather.avgSeeing}/8</p>

			{data.weather.worthObserving ? (
				<div>
					<h3>Excellent Targets:</h3>
					{data.targets.excellent.map(target => (
						<div key={target.name} style={{ marginBottom: '1rem' }}>
							<strong>{target.name}</strong>
							<p>Peak time: {target.peakHour}:00 - Look {target.peakDirection}</p>
							<p>Altitude: {target.peakAltitude}° | Magnitude: {target.magnitude}</p>
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
- **OpenStreetMap Nominatim** (https://nominatim.openstreetmap.org) - Reverse geocoding for location names

## Troubleshooting

**Weather data unavailable**
- The API will return an error object in the weather field but continue with target data
- Check 7timer service status at https://www.7timer.info
- Weather data is averaged across your viewing window - ensure hours are set correctly

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
[Weather] Interpreting conditions for hours 21-2
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

## License

MIT
