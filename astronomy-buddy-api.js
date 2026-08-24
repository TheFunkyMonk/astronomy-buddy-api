const https = require('https');
const http = require('http');
const url = require('url');
require('dotenv').config();

// Configuration from environment variables
const config = {
	appId: process.env.ASTRONOMY_API_APP_ID,
	appSecret: process.env.ASTRONOMY_API_APP_SECRET,
	viewingLevel: process.env.VIEWING_LEVEL || 'naked-eye',
	eveningStartHour: parseInt(process.env.EVENING_START_HOUR || '21'),
	eveningEndHour: parseInt(process.env.EVENING_END_HOUR || '2'),
	port: parseInt(process.env.PORT || '3000')
};

// Viewing capabilities based on level
const viewingCapabilities = {
	'naked-eye': {
		maxMagnitude: 6,
		minAltitude: 20,
		description: 'Naked eye viewing'
	},
	entry: {
		maxMagnitude: 10,
		minAltitude: 15,
		description: 'Entry-level telescope (60-80mm aperture)'
	},
	intermediate: {
		maxMagnitude: 12,
		minAltitude: 10,
		description: 'Intermediate telescope (100-150mm aperture)'
	},
	advanced: {
		maxMagnitude: 14,
		minAltitude: 5,
		description: 'Advanced telescope (200mm+ aperture)'
	}
};

// Convert 24-hour time to 12-hour format with AM/PM
function formatTime12Hour(hour) {
	const period = hour >= 12 ? 'PM' : 'AM';
	const hour12 = hour === 0 ? 12 : (hour > 12 ? hour - 12 : hour);
	return `${hour12}:00 ${period}`;
}

// Reverse geocode coordinates to get location name
async function getLocationName(latitude, longitude) {
	const apiUrl = `https://nominatim.openstreetmap.org/reverse?` +
		`lat=${latitude}&lon=${longitude}&format=json&addressdetails=1`;

	console.log(`[Geocoding] Looking up location for lat=${latitude}, lon=${longitude}`);

	try {
		const parsedUrl = url.parse(apiUrl);

		return new Promise((resolve, reject) => {
			https.get({
				hostname: parsedUrl.hostname,
				path: parsedUrl.path,
				method: 'GET',
				headers: {
					'User-Agent': 'AstronomyBuddy/1.0'
				}
			}, (res) => {
				let data = '';

				res.on('data', (chunk) => {
					data += chunk;
				});

				res.on('end', () => {
					if (res.statusCode === 200) {
						const result = JSON.parse(data);
						const address = result.address || {};

						// Most specific place name available
						const place = address.city
							|| address.town
							|| address.village
							|| address.hamlet
							|| address.county
							|| '';

						// Friendly region: US/CA state abbreviation when we can get it
						// (Nominatim exposes it as e.g. "US-WA" in ISO3166-2-lvl4),
						// otherwise fall back to the country, then the full state name.
						const countryCode = (address.country_code || '').toLowerCase();
						const isoSubdivision = address['ISO3166-2-lvl4'] || '';
						let region = '';

						if ((countryCode === 'us' || countryCode === 'ca') && isoSubdivision.includes('-')) {
							region = isoSubdivision.split('-')[1];
						} else if (address.country) {
							region = address.country;
						} else if (address.state) {
							region = address.state;
						}

						// Build a "City, WA" / "Paris, France" style label
						let locationName;
						if (place && region) {
							locationName = `${place}, ${region}`;
						} else {
							locationName = place || region || 'Unknown Location';
						}

						console.log(`[Geocoding] Location: ${locationName}`);
						resolve(locationName);
					} else {
						console.error(`[Geocoding] Request failed with status ${res.statusCode}`);
						resolve('Unknown Location');
					}
				});
			}).on('error', (err) => {
				console.error('[Geocoding] Request error:', err.message);
				resolve('Unknown Location');
			});
		});
	} catch (error) {
		console.error('[Geocoding] Exception:', error.message);
		return 'Unknown Location';
	}
}

// Add this helper function after the getDirection function
function convertToLightDistance(distanceKm) {
	const LIGHT_SPEED_KM_S = 299792.458; // km per second

	const lightSeconds = distanceKm / LIGHT_SPEED_KM_S;

	// Less than 60 seconds
	if (lightSeconds < 60) {
		return {
			value: parseFloat(lightSeconds.toFixed(2)),
			unit: 'light-seconds',
			string: `${lightSeconds.toFixed(2)} light seconds away`
		};
	}

	const lightMinutes = lightSeconds / 60;
	// Less than 60 minutes
	if (lightMinutes < 60) {
		return {
			value: parseFloat(lightMinutes.toFixed(2)),
			unit: 'light-minutes',
			string: `${lightMinutes.toFixed(2)} light minutes away`
		};
	}

	const lightHours = lightMinutes / 60;
	// Less than 24 hours
	if (lightHours < 24) {
		return {
			value: parseFloat(lightHours.toFixed(2)),
			unit: 'light-hours',
			string: `${lightHours.toFixed(2)} light hours away`
		};
	}

	const lightDays = lightHours / 24;
	// Less than 365 days
	if (lightDays < 365) {
		return {
			value: parseFloat(lightDays.toFixed(2)),
			unit: 'light-days',
			string: `${lightDays.toFixed(2)} light days away`
		};
	}

	const lightYears = lightDays / 365.25;
	return {
		value: parseFloat(lightYears.toFixed(2)),
		unit: 'light-years',
		string: `${lightYears.toFixed(2)} light years away`
	};
}

// 7timer index scales (IMPORTANT: for all three, a LOWER value is better):
//   cloudcover   1-9  (1 = 0-6% cloud cover, 9 = 94-100%)
//   seeing       1-8  (1 = <0.5" seeing, 8 = >2.5")
//   transparency 1-8  (1 = clearest air, 8 = most dimming)
// A point only counts as genuinely observable when cloud cover is at or below
// this index (~19% cloud). The old logic used < 6 (~56%), which labelled
// heavily-clouded nights as "clear".
const CLEAR_CLOUD_INDEX = 2;
const HOURS_PER_POINT = 3; // 7timer astro forecasts in 3-hour steps

// Approximate a location's UTC offset from its longitude. This is not DST- or
// political-boundary-aware, but it is accurate enough to bucket 3-hourly
// forecast points into the correct local evening (which is all we need).
function approxUtcOffset(longitude) {
	const offset = Math.round(Number(longitude) / 15);
	return Math.max(-12, Math.min(14, isNaN(offset) ? 0 : offset));
}

// Convert an averaged cloud-cover index (1-9) to an approximate percentage.
function cloudIndexToPct(index) {
	return Math.max(0, Math.min(100, Math.round(((index - 1) / 8) * 100)));
}

// Convert a seeing/transparency index (1-8, lower = better) to a plain word.
function qualityWord(index) {
	if (index <= 2) return 'excellent';
	if (index <= 4) return 'good';
	if (index <= 6) return 'fair';
	return 'poor';
}

function isEveningHour(hour, startHour, endHour) {
	if (endHour > startHour) {
		return hour >= startHour && hour <= endHour;
	}
	return hour >= startHour || hour <= endHour;
}

// ---------------------------------------------------------------------------
// Copy length budgets
// ---------------------------------------------------------------------------
// Every user-visible string is authored to fit a fixed character budget, because
// the narrowest surface -- the TRMNL e-ink dashboard -- has no scroll and no
// ellipsis: copy that overruns is simply lost off the edge of the panel. The
// budgets below were sized against that panel's description column (roughly 28
// characters per line) and are deliberately tight enough to be scannable at a
// glance on every surface.
//
// The rule is one idea per field: `verdict` says what kind of night it is,
// `summary` says how much of it is clear, and `notices` carry the detail. None
// of them restates another, so the surfaces never stack three sentences that
// say the same thing.
const COPY_LIMITS = {
	heading: 32,
	verdict: 90,
	summary: 48,
	notice: 90,
	// Per-target reasons are the one field built by appending clauses (angle,
	// brightness, haze), so this is budgeted for the worst legitimate
	// combination of all three rather than for a single phrase.
	reason: 64
};

// Guardrail, not a formatter. The authored copy already fits, so this should
// never fire in production -- it exists so that a future phrasing change cannot
// silently ship an overflowing string, and it logs loudly when it does.
function fitCopy(text, limit, field) {
	if (typeof text !== 'string' || text.length <= limit) return text;

	console.warn(`[Copy] ${field} ran to ${text.length} chars (budget ${limit}), trimming: ${text}`);
	const clipped = text.slice(0, limit - 1);
	const lastSpace = clipped.lastIndexOf(' ');
	const body = lastSpace > limit / 2 ? clipped.slice(0, lastSpace) : clipped;
	return `${body.replace(/[\s,;:.\u2014-]+$/, '')}\u2026`;
}

// ---------------------------------------------------------------------------
// Air quality / aerosols
// ---------------------------------------------------------------------------
// 7timer's transparency index is driven by water vapour aloft and does NOT see
// wildfire smoke, so a smoke-choked night could still be reported as
// "excellent transparency". Aerosol optical depth (AOD at 550nm) is the metric
// that actually matters for stargazing: it measures how much the whole air
// column dims and scatters starlight.
//
// Note that US AQI is a *health* metric and is a poor proxy for this: a night
// can sit at AQI 60 ("moderate") while AOD is 0.7 and half the visible stars
// are gone. The two are tracked separately and used for different things.
//
// CALIBRATION: these boundaries were lowered after a field check on 2026-08-04
// in Seattle. An evening averaging AOD 0.42 was rated "good" by the original
// thresholds, but on the ground it was clearly only partial viewing -- high
// stars fine, the Moon low and difficult, Saturn low and completely invisible.
// 0.42 therefore needs to land in `significant`, not `moderate`. Textbook AOD
// tables describe daytime visibility, which is more forgiving than picking faint
// point sources out of a scattering sky at night, so erring darker is right.
// Refine further as more nights get checked.
const AOD_LEVELS = [
	{ max: 0.08, level: 'pristine' },
	{ max: 0.15, level: 'none' },
	{ max: 0.25, level: 'slight' },
	{ max: 0.40, level: 'moderate' },
	{ max: 0.75, level: 'significant' },
	{ max: Infinity, level: 'heavy' }
];

// Levels at which aerosols visibly dim the sky. Below this, saying anything
// about the air would just be noise.
const DIMMING_LEVELS = new Set(['slight', 'moderate', 'significant', 'heavy']);

// Levels at which the AIR, not cloud, is the limiting factor for the night --
// the point where copy should talk about altitude rather than timing. Surfaced
// as `airQuality.dominatesView` so clients never hardcode these level names.
const DOMINATING_LEVELS = new Set(['significant', 'heavy']);

const AIR_QUALITY_TIMEOUT_MS = 5000;

function aodLevel(aod) {
	return AOD_LEVELS.find(entry => aod < entry.max).level;
}

// Extinction at the zenith for a given optical depth:
//   dm = 2.5 * log10(e^tau) = 1.086 * tau   (per unit airmass)
// This is the headline number quoted to users, but it is the BEST case: it only
// holds straight overhead. See airmass() for why low targets fare much worse.
function aodToMagnitudes(aod) {
	return 1.086 * aod;
}

// Relative airmass at a given altitude -- how many zenith-equivalents of
// atmosphere the line of sight passes through. 1.0 overhead, ~2 at 30 degrees,
// ~3.8 at 15, and it climbs steeply from there.
//
// This is the whole reason smoke feels worse than a zenith figure suggests. On a
// night with 0.45 mag of extinction overhead, a target at 15 degrees loses about
// 1.7 mag -- which is the difference between "dimmed" and "gone". Observed
// 2026-08-04: Saturn low in the sky was completely invisible while stars high
// overhead were fine, on a night the API had called "good".
//
// Kasten & Young (1989), accurate all the way to the horizon (unlike sec z,
// which diverges).
function airmass(altitudeDegrees) {
	const altitude = Math.max(0, Math.min(90, altitudeDegrees));
	const zenithAngle = 90 - altitude;
	const radians = zenithAngle * Math.PI / 180;
	return 1 / (Math.cos(radians) + 0.50572 * Math.pow(96.07995 - zenithAngle, -1.6364));
}

// Aerosol extinction actually suffered by a target at a given altitude.
function extinctionAtAltitude(zenithMagnitudes, altitudeDegrees) {
	return zenithMagnitudes * airmass(altitudeDegrees);
}

// Distinguish smoke from blown dust so the copy can name the right thing.
function aerosolType(pm25, dust) {
	if (dust !== null && dust >= 20 && (pm25 === null || dust > pm25)) return 'dust';
	if (pm25 !== null && pm25 >= 12) return 'smoke';
	return 'haze';
}

// Short label, e.g. "Heavy smoke haze". Null when there is nothing to report.
function aerosolLabel(level, type) {
	const phrase = type === 'haze' ? 'haze' : `${type} haze`;
	switch (level) {
		case 'pristine': return 'Exceptionally clear air';
		case 'none': return null;
		case 'slight': return `Slight ${phrase}`;
		case 'moderate': return `Moderate ${phrase}`;
		case 'significant': return `Heavy ${phrase}`;
		case 'heavy': return `Very heavy ${type === 'haze' ? 'haze' : type}`;
		default: return null;
	}
}

// Sentence-leading noun for the aerosol at hand -- "Smoke", "Dust" or "Haze".
// Short copy leans on this instead of the full label, because the label is
// already surfaced separately as `airQuality.label` and as the notice icon.
function aerosolNoun(type) {
	if (type === 'dust') return 'Dust';
	if (type === 'smoke') return 'Smoke';
	return 'Haze';
}

// One sentence on what the aerosol load does to the view. Quotes BOTH the zenith
// figure and the figure low in the sky: the zenith number alone badly understates
// what an observer experiences, because most disappointing targets are the low
// ones. LOW_ALTITUDE_REFERENCE is the altitude the "low in the sky" figure is
// quoted at -- around where a target starts clearing typical obstructions.
const LOW_ALTITUDE_REFERENCE = 20;

function buildTransparencyImpact(level, type, magnitudes) {
	const noun = aerosolNoun(type);
	const dimming = magnitudes.toFixed(1);
	const lowDimming = extinctionAtAltitude(magnitudes, LOW_ALTITUDE_REFERENCE).toFixed(1);

	let text;
	switch (level) {
		case 'pristine':
			text = 'Exceptionally clear air — faint objects should show well.';
			break;
		case 'slight':
			text = `A little ${noun.toLowerCase()} — about ${dimming} mag overhead, barely noticeable.`;
			break;
		case 'moderate':
			text = `${noun} costs ${dimming} mag overhead, ${lowDimming} low down — faint objects suffer near the horizon.`;
			break;
		case 'significant':
			text = `${noun} costs ${dimming} mag overhead, ${lowDimming} at ${LOW_ALTITUDE_REFERENCE}° — high targets fine, low ones washed out.`;
			break;
		case 'heavy':
			text = `${noun} costs ${dimming} mag overhead, ${lowDimming} low down — only the brightest show.`;
			break;
		default:
			return null;
	}
	return fitCopy(text, COPY_LIMITS.notice, 'transparencyImpact');
}

// Standard US AQI breakpoints.
function usAqiCategory(aqi) {
	if (aqi <= 50) return 'good';
	if (aqi <= 100) return 'moderate';
	if (aqi <= 150) return 'sensitive';
	if (aqi <= 200) return 'unhealthy';
	if (aqi <= 300) return 'very-unhealthy';
	return 'hazardous';
}

// Health advice framed for the actual activity: standing outside for a couple
// of hours. Deliberately silent below AQI 100 so it does not cry wolf.
function buildHealthAdvisory(category, aqi) {
	let text;
	switch (category) {
		case 'sensitive':
			text = `AQI ${aqi} — unhealthy for sensitive groups; go easy if smoke bothers you.`;
			break;
		case 'unhealthy':
			text = `AQI ${aqi} — unhealthy air; keep the session short or wear a mask.`;
			break;
		case 'very-unhealthy':
			text = `AQI ${aqi} — very unhealthy air; better to sit this one out.`;
			break;
		case 'hazardous':
			text = `AQI ${aqi} — hazardous air; stay inside tonight.`;
			break;
		default:
			// Includes 'good' and 'moderate': silent below AQI 100.
			return null;
	}
	return fitCopy(text, COPY_LIMITS.notice, 'healthAdvisory');
}

// Minimal JSON GET with a timeout. Kept separate from getWeatherConditions so
// that its retry behaviour is untouched.
function fetchJson(urlString, timeoutMs) {
	return new Promise((resolve, reject) => {
		const parsedUrl = url.parse(urlString);

		const req = https.get({
			hostname: parsedUrl.hostname,
			path: parsedUrl.path,
			method: 'GET'
		}, (res) => {
			let data = '';
			res.on('data', (chunk) => {
				data += chunk;
			});
			res.on('end', () => {
				if (res.statusCode !== 200) {
					reject(new Error(`Request failed with status ${res.statusCode}`));
					return;
				}
				try {
					resolve(JSON.parse(data));
				} catch (parseError) {
					reject(new Error('Response was not valid JSON'));
				}
			});
		});

		req.on('error', reject);
		req.setTimeout(timeoutMs, () => {
			req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
		});
	});
}

// Open-Meteo's air quality API: no key, no registration, CAMS-backed, global.
// This is a SOFT dependency -- a smoke reading is a bonus, never a reason to
// fail the whole response. Callers treat null as "no aerosol information".
async function getAirQuality(latitude, longitude) {
	const apiUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?` +
		`latitude=${latitude}&longitude=${longitude}` +
		`&hourly=pm2_5,us_aqi,aerosol_optical_depth,dust` +
		`&timezone=auto&forecast_days=2`;

	try {
		console.log(`[Air Quality] Fetching aerosol data for lat=${latitude}, lon=${longitude}`);
		const data = await fetchJson(apiUrl, AIR_QUALITY_TIMEOUT_MS);
		console.log('[Air Quality] Successfully retrieved aerosol data');
		return data;
	} catch (error) {
		console.error('[Air Quality] Unavailable, continuing without it:', error.message);
		return null;
	}
}

// Open-Meteo returns a contiguous hourly series in local time (timezone=auto),
// so tonight's window is just a run of indices starting at the first entry
// whose hour matches eveningStartHour.
function selectEveningIndices(times, startHour, endHour) {
	const hourAt = i => parseInt(String(times[i]).slice(11, 13), 10);

	let startIndex = -1;
	for (let i = 0; i < times.length; i++) {
		if (hourAt(i) === startHour) {
			startIndex = i;
			break;
		}
	}
	if (startIndex === -1) return [];

	const crossesMidnight = endHour <= startHour;
	const span = crossesMidnight
		? (24 - startHour) + endHour + 1
		: (endHour - startHour) + 1;

	const indices = [];
	for (let i = startIndex; i < Math.min(times.length, startIndex + span); i++) {
		indices.push(i);
	}
	return indices;
}

// Reduce the hourly aerosol series down to tonight's viewing window.
function interpretAirQuality(data, eveningStartHour, eveningEndHour) {
	if (!data || !data.hourly || !Array.isArray(data.hourly.time)) {
		return null;
	}

	const hourly = data.hourly;
	const indices = selectEveningIndices(hourly.time, eveningStartHour, eveningEndHour);
	if (indices.length === 0) {
		console.log('[Air Quality] No hours matched tonight\'s window');
		return null;
	}

	const pick = series => indices
		.map(i => Array.isArray(series) ? series[i] : undefined)
		.filter(v => typeof v === 'number' && !isNaN(v));

	const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
	const peak = arr => arr.length ? Math.max(...arr) : null;

	const aodValues = pick(hourly.aerosol_optical_depth);
	if (aodValues.length === 0) {
		// Without AOD there is nothing here worth reporting.
		console.log('[Air Quality] No aerosol optical depth values for tonight');
		return null;
	}

	const aod = avg(aodValues);
	const aodPeak = peak(aodValues);
	const pm25 = avg(pick(hourly.pm2_5));
	const dust = avg(pick(hourly.dust));
	const usAqi = peak(pick(hourly.us_aqi));

	const level = aodLevel(aod);
	const type = aerosolType(pm25, dust);
	const extinctionMagnitudes = aodToMagnitudes(aod);
	const healthCategory = usAqi !== null ? usAqiCategory(usAqi) : null;

	const round = (value, places) => value === null
		? null
		: parseFloat(value.toFixed(places));

	console.log(`[Air Quality] AOD ${aod.toFixed(2)} (${level}, ${type}), US AQI ${usAqi ?? 'n/a'}`);

	return {
		aod: round(aod, 2),
		aodPeak: round(aodPeak, 2),
		level,
		aerosolType: type,
		extinctionMagnitudes: round(extinctionMagnitudes, 2),
		pm25: round(pm25, 1),
		dust: round(dust, 1),
		usAqi: usAqi === null ? null : Math.round(usAqi),
		healthCategory,
		healthAdvisory: healthCategory ? buildHealthAdvisory(healthCategory, Math.round(usAqi)) : null,
		label: aerosolLabel(level, type),
		transparencyImpact: buildTransparencyImpact(level, type, extinctionMagnitudes),
		dimsView: DIMMING_LEVELS.has(level),
		// True when aerosols, not cloud, are what limit the night. Clients should
		// branch on THIS rather than testing `level` against string literals, so
		// that retuning the tiers never requires a client release.
		dominatesView: DOMINATING_LEVELS.has(level)
	};
}

// Weather condition interpretation from 7timer. `air` is the optional output of
// interpretAirQuality; when absent, behaviour is exactly as it was before
// aerosols were considered.
function interpretWeatherConditions(data, eveningStartHour, eveningEndHour, longitude, viewingLevel, air = null) {
	console.log(`[Weather] Interpreting conditions for local hours ${eveningStartHour}-${eveningEndHour}`);

	if (!data || !Array.isArray(data.dataseries) || data.dataseries.length === 0) {
		console.log('[Weather] No forecast data available');
		return null;
	}

	// `init` is the UTC datetime (YYYYMMDDHH) the model was run; each point's
	// `timepoint` is the number of hours AFTER init. A point's true local hour
	// therefore depends on both the init hour and the location's UTC offset --
	// it is NOT `timepoint % 24` (that was the core bug: with init at 12:00 UTC,
	// filtering for "21:00" actually selected the 09:00 UTC forecast).
	const initHourUtc = parseInt(String(data.init).slice(8, 10), 10) || 0;
	const utcOffset = approxUtcOffset(longitude);
	const crossesMidnight = eveningEndHour <= eveningStartHour;

	// Tag every point with its local hour and the "night" it belongs to, then
	// keep only the earliest night present -- i.e. tonight. The old code averaged
	// the same clock-hour across all 3 forecast days, smearing tonight together
	// with future nights.
	const eveningPoints = data.dataseries
		.map(point => {
			const absLocalHour = initHourUtc + point.timepoint + utcOffset;
			const localHour = ((absLocalHour % 24) + 24) % 24;
			const dayIndex = Math.floor(absLocalHour / 24);
			// Early-morning hours belong to the PREVIOUS evening's night.
			const nightKey = (crossesMidnight && localHour <= eveningEndHour) ? dayIndex - 1 : dayIndex;
			return { point, localHour, nightKey };
		})
		.filter(p => isEveningHour(p.localHour, eveningStartHour, eveningEndHour));

	if (eveningPoints.length === 0) {
		console.log('[Weather] No evening data available');
		return null;
	}

	const tonightKey = Math.min(...eveningPoints.map(p => p.nightKey));
	const eveningData = eveningPoints
		.filter(p => p.nightKey === tonightKey)
		.sort((a, b) => a.point.timepoint - b.point.timepoint)
		.map(p => ({ ...p.point, localHour: p.localHour }));

	console.log(`[Weather] Using ${eveningData.length} point(s) for tonight (utcOffset ${utcOffset})`);

	// Averages across tonight only.
	const avgCloudCover = eveningData.reduce((sum, d) => sum + d.cloudcover, 0) / eveningData.length;
	const avgSeeing = eveningData.reduce((sum, d) => sum + d.seeing, 0) / eveningData.length;
	const avgTransparency = eveningData.reduce((sum, d) => sum + d.transparency, 0) / eveningData.length;
	const hasRain = eveningData.some(d => d.prec_type === 'rain' || d.prec_type === 'snow');

	const nightHours = eveningData.length * HOURS_PER_POINT;

	// How much of the night is genuinely clear -- the primary driver of quality.
	const clearPoints = eveningData.filter(d => d.cloudcover <= CLEAR_CLOUD_INDEX && d.prec_type === 'none').length;
	const clearHours = clearPoints * HOURS_PER_POINT;
	const clearFraction = clearPoints / eveningData.length;

	// Group consecutive clear points into windows (strict cloud threshold).
	const clearWindows = [];
	let currentWindow = null;
	for (const d of eveningData) {
		const isClear = d.cloudcover <= CLEAR_CLOUD_INDEX && d.prec_type === 'none';
		if (isClear) {
			if (!currentWindow) {
				currentWindow = { startHour: d.localHour, endHour: d.localHour, cloudCover: [], seeing: [], transparency: [] };
			}
			currentWindow.endHour = d.localHour;
			currentWindow.cloudCover.push(d.cloudcover);
			currentWindow.seeing.push(d.seeing);
			currentWindow.transparency.push(d.transparency);
		} else if (currentWindow) {
			clearWindows.push(currentWindow);
			currentWindow = null;
		}
	}
	if (currentWindow) {
		clearWindows.push(currentWindow);
	}

	// Each point covers the 3-hour block that follows it, so the window's end is
	// its last point's hour + one block.
	const viewingWindows = clearWindows.map(window => {
		const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
		const endHour = (window.endHour + HOURS_PER_POINT) % 24;
		return {
			startHour: window.startHour,
			endHour,
			startTime: formatTime12Hour(window.startHour),
			endTime: formatTime12Hour(endHour),
			duration: window.cloudCover.length * HOURS_PER_POINT,
			avgCloudCover: parseFloat(avg(window.cloudCover).toFixed(1)),
			avgSeeing: parseFloat(avg(window.seeing).toFixed(1)),
			avgTransparency: parseFloat(avg(window.transparency).toFixed(1))
		};
	});

	// Quality is driven by the fraction of the night that is actually clear.
	let quality;
	let worthObserving;
	let score;
	const reasons = [];

	// Cloud/coverage wording is intentionally NOT added to `reasons` -- that
	// story is told by `verdict` (headline) and `summary` (how much is clear).
	// `reasons` carries only supplementary atmospheric detail, so the surfaces
	// never show two near-identical sentences side by side.
	if (hasRain) {
		quality = 'unsuitable';
		worthObserving = false;
		score = 5;
	} else if (clearFraction >= 0.85) {
		quality = 'excellent';
		worthObserving = true;
		score = 0;
	} else if (clearFraction >= 0.65) {
		quality = 'good';
		worthObserving = true;
		score = 1;
	} else if (clearPoints > 0) {
		// A real clear window exists, but a meaningful part of the night is
		// clouded -- this is the "clear early, then cloudy" case.
		quality = 'partial';
		worthObserving = true;
		score = 2;
	} else if (avgCloudCover >= 7) {
		quality = 'unsuitable';
		worthObserving = false;
		score = 4;
	} else {
		quality = 'poor';
		worthObserving = false;
		score = 3;
	}

	// Seeing / transparency only refine a mostly-clear sky, and can nudge
	// "excellent" down a notch -- never rescue a clouded-out night. On a partial
	// night the headline is the limited window, so this detail is just noise.
	if (quality === 'excellent' || quality === 'good') {
		if (avgSeeing >= 6) {
			reasons.push('somewhat unsteady atmosphere');
			if (quality === 'excellent') quality = 'good';
		} else if (avgSeeing <= 3) {
			reasons.push('steady atmosphere');
		}

		if (avgTransparency >= 6) {
			reasons.push('some haze');
			if (quality === 'excellent') quality = 'good';
		} else if (avgTransparency <= 3 && !(air && air.dimsView)) {
			// Only claim excellent transparency when the aerosol load agrees.
			// 7timer's index misses wildfire smoke entirely, so on its own it
			// will happily call a smoke-filled sky "excellent".
			reasons.push('excellent transparency');
		}

		// Aerosols are a separate story from water vapour and get their own say.
		//
		// `significant` lands on 'partial' rather than 'good': the sky may be
		// cloudless all night, but only part of it is usable -- high targets are
		// fine while anything low is washed out. That is partial viewing, and it
		// matches what an observer actually experiences (2026-08-04: high stars
		// fine, low Saturn invisible, on a night this called "good").
		if (air && air.dimsView) {
			reasons.push(air.label.toLowerCase());
			if (air.level === 'significant' && (quality === 'excellent' || quality === 'good')) {
				quality = 'partial';
				score = 2;
			} else if (air.level === 'moderate' && quality === 'excellent') {
				quality = 'good';
				score = 1;
			}
		}
	}

	// Heavy smoke washes out all but the brightest objects no matter how clear
	// the sky is, so it can sink an otherwise fine night on its own. Rain still
	// outranks it -- no point telling someone about smoke in a downpour.
	if (air && air.level === 'heavy' && quality !== 'unsuitable') {
		quality = 'poor';
		worthObserving = false;
		score = Math.max(score, 3);
		if (!reasons.includes(air.label.toLowerCase())) {
			reasons.push(air.label.toLowerCase());
		}
	}

	console.log(`[Weather] Quality: ${quality}, clear ${clearHours}/${nightHours}h, avgCloud ${avgCloudCover.toFixed(1)}`);

	const result = {
		quality,
		score,
		worthObserving,
		avgCloudCover: parseFloat(avgCloudCover.toFixed(1)),
		avgSeeing: parseFloat(avgSeeing.toFixed(1)),
		avgTransparency: parseFloat(avgTransparency.toFixed(1)),
		cloudCoverPct: cloudIndexToPct(avgCloudCover),
		seeingText: qualityWord(avgSeeing),
		transparencyText: aerosolAwareTransparency(avgTransparency, air),
		clearHours,
		nightHours,
		clearFraction: parseFloat(clearFraction.toFixed(2)),
		hasRain,
		reasons
	};

	// Additive: absent when the air quality upstream was unreachable, so every
	// consumer must treat it as optional.
	if (air) {
		result.airQuality = air;
	}

	// Add viewing windows if any exist. The "best" window is the longest one,
	// tie-broken by lowest average cloud cover.
	if (viewingWindows.length > 0) {
		result.viewingWindows = viewingWindows;
		result.bestWindow = viewingWindows.reduce((best, current) => {
			if (current.duration !== best.duration) {
				return current.duration > best.duration ? current : best;
			}
			return current.avgCloudCover < best.avgCloudCover ? current : best;
		});
	}

	// Human-friendly copy, computed once here so every surface (web, iOS,
	// TRMNL) renders consistent language without re-deriving it.
	result.verdict = buildVerdict(quality, hasRain, result.bestWindow, viewingLevel, air);
	result.summary = buildClearSummary(clearHours, nightHours, clearFraction);

	// Presentation directives. Additive: older clients ignore these and keep
	// deriving their own styling from `quality`, so this can ship to production
	// ahead of any app update.
	const severity = buildSeverity(quality, air);
	result.display = {
		heading: buildHeading(quality),
		targetsHeading: buildTargetsHeading(quality, worthObserving, air),
		severity,
		severityRank: severityRank(severity),
		icon: buildIcon(quality, air)
	};
	result.notices = buildNotices(air, quality);

	return result;
}

// Report the worse of 7timer's water-vapour transparency and the aerosol load,
// so smoke can never be papered over by a clear-but-hazy forecast.
function aerosolAwareTransparency(avgTransparency, air) {
	const base = qualityWord(avgTransparency);
	if (!air) return base;

	const aerosolCap = {
		pristine: 'excellent',
		none: 'excellent',
		slight: 'good',
		moderate: 'fair',
		significant: 'poor',
		heavy: 'poor'
	}[air.level];
	if (!aerosolCap) return base;

	const order = ['excellent', 'good', 'fair', 'poor'];
	return order[Math.max(order.indexOf(base), order.indexOf(aerosolCap))];
}

// Extra sentence appended to the headline when the air is what decides the
// night. Silent when aerosols are not the story.
function buildAerosolClause(air, quality) {
	// Rain already told the user not to bother.
	if (quality === 'unsuitable') return null;

	// The aerosol is named by `airQuality.label` and by the notice icon, so the
	// clause only has to say what it does to the view -- repeating "heavy smoke
	// haze" here is what made the old verdict run to three lines.
	const noun = aerosolNoun(air.aerosolType);
	switch (air.level) {
		case 'heavy':
			return `${noun} is washing the sky out.`;
		case 'significant':
			return `${noun} will wash out anything low.`;
		case 'moderate':
			return `${noun} is taking the edge off.`;
		default:
			return null;
	}
}

// Plain-language headline verdict for the night. Copy adapts to the viewing
// level so naked-eye observers don't get telescope-specific wording.
function buildVerdict(quality, hasRain, bestWindow, viewingLevel, air = null) {
	const usesTelescope = viewingLevel && viewingLevel !== 'naked-eye';

	// When the air is what decides the night, lead with it rather than implying
	// cloud -- the sky may well be cloudless. Otherwise "A good night for
	// stargazing" ends up sitting next to "heavy smoke haze", which reads badly
	// even though both halves are true.
	if (air && air.level === 'heavy' && quality === 'poor') {
		return fitCopy(`${air.label} — the sky is washed out. Wait for cleaner air.`,
			COPY_LIMITS.verdict, 'verdict');
	}
	// Smoke-led, and specific about WHERE to look: the usable part of the sky is
	// overhead. Note this fires on 'partial' too, which significant smoke now
	// produces -- without it the partial branch below would talk about clear
	// windows on what may be a cloudless night.
	if (air && air.level === 'significant'
		&& (quality === 'excellent' || quality === 'good' || quality === 'partial')) {
		return fitCopy(`Clear, but ${air.label.toLowerCase()} — favour targets high overhead.`,
			COPY_LIMITS.verdict, 'verdict');
	}

	let headline;
	switch (quality) {
		case 'excellent':
			headline = 'Great night for stargazing!';
			break;
		case 'good':
			headline = 'A good night for stargazing.';
			break;
		case 'partial':
			headline = bestWindow
				? `Clear ${bestWindow.startTime}–${bestWindow.endTime}, cloudy otherwise.`
				: 'A short clear window, then cloudy.';
			break;
		case 'unsuitable':
			if (hasRain) {
				headline = usesTelescope
					? 'Rain tonight — no telescope weather.'
					: 'Rain tonight — skip stargazing.';
			} else {
				headline = usesTelescope
					? 'Clouded out — not worth setting up.'
					: 'Clouded out — not worth heading out.';
			}
			break;
		default:
			headline = 'Mostly cloudy — not great for stargazing.';
	}

	const aerosolClause = air ? buildAerosolClause(air, quality) : null;
	const verdict = aerosolClause ? `${headline} ${aerosolClause}` : headline;
	return fitCopy(verdict, COPY_LIMITS.verdict, 'verdict');
}

// ---------------------------------------------------------------------------
// Presentation directives
// ---------------------------------------------------------------------------
// Everything below exists so that tuning the weather model does not require
// rebuilding the client apps -- which for iOS means a new App Store review.
//
// The contract: the API owns all user-visible text and every severity decision.
// Clients own exactly two lookup tables, both of which are stable:
//   severity -> colour        (5 entries, below)
//   icon token -> glyph/asset (a handful of entries)
//
// `severity` is deliberately about HOW ALARMED TO LOOK rather than what is
// wrong, so it does not need to change when the domain model does. Adding a new
// `quality` value or aerosol tier changes only which severity is emitted, not
// the vocabulary itself.
const SEVERITY_RANKS = {
	positive: 0,
	neutral: 1,
	caution: 2,
	warning: 3,
	critical: 4
};

// Icon tokens name what they DEPICT, so each surface can map them to its own
// asset (SF Symbol, emoji, e-ink PNG) without knowing anything about weather.
const QUALITY_ICONS = {
	excellent: 'sparkles',
	good: 'star',
	partial: 'partly-cloudy',
	poor: 'cloudy',
	unsuitable: 'rain'
};

const QUALITY_SEVERITIES = {
	excellent: 'positive',
	good: 'positive',
	partial: 'caution',
	poor: 'warning',
	unsuitable: 'critical'
};

function severityRank(severity) {
	return SEVERITY_RANKS[severity] !== undefined ? SEVERITY_RANKS[severity] : SEVERITY_RANKS.neutral;
}

function worseSeverity(a, b) {
	return severityRank(a) >= severityRank(b) ? a : b;
}

// Headline severity for the night, escalated when aerosols outrank the cloud
// story. Without the escalation a smoke-hazed night the model still calls "good"
// would render bright green next to a smoke warning.
function buildSeverity(quality, air) {
	let severity = QUALITY_SEVERITIES[quality] || 'neutral';
	if (!air || !air.dimsView) return severity;

	if (air.level === 'heavy') {
		severity = worseSeverity(severity, 'critical');
	} else if (air.level === 'significant') {
		severity = worseSeverity(severity, 'warning');
	} else if (air.level === 'moderate') {
		severity = worseSeverity(severity, 'caution');
	}
	return severity;
}

// Icon for the night. Aerosols take over the icon once they, not cloud, are the
// limiting factor -- a cloud glyph on a cloudless smoky night is just wrong.
// Rain still outranks smoke, matching buildVerdict: a smoke glyph on a rained-out
// night is equally wrong.
function buildIcon(quality, air) {
	if (quality !== 'unsuitable' && air && air.dominatesView) {
		return air.aerosolType === 'dust' ? 'dust' : 'smoke';
	}
	return QUALITY_ICONS[quality] || 'partly-cloudy';
}

function buildHeading(quality) {
	const known = QUALITY_SEVERITIES[quality] !== undefined;
	const word = known ? quality : 'unknown';
	return fitCopy(`${word.charAt(0).toUpperCase()}${word.slice(1)} Conditions`,
		COPY_LIMITS.heading, 'heading');
}

// Heading for the targets list. On a smoke-limited night it is altitude, not
// timing, that constrains you, so the clear-window wording would mislead.
function buildTargetsHeading(quality, worthObserving, air) {
	// Rain outranks smoke here too -- see buildIcon.
	let heading;
	if (quality !== 'unsuitable' && air && air.dominatesView) {
		heading = worthObserving
			? 'Best Targets High Overhead'
			: 'Best Targets Despite the Smoke';
	} else if (quality === 'partial') {
		heading = 'Best Targets in Clear Windows';
	} else {
		heading = worthObserving
			? 'Best Targets Tonight'
			: 'Best Targets Despite Conditions';
	}
	return fitCopy(heading, COPY_LIMITS.heading, 'targetsHeading');
}

// A generic, ordered list of advisories. This is the field that buys the most
// future freedom: any new advisory added here (moon washout, wind, dew point)
// renders on every surface with no client change, because clients loop it
// blindly rather than reading named fields.
function buildNotices(air, quality) {
	const notices = [];
	if (!air) return notices;

	// What smoke costs you optically is irrelevant in a downpour, but the health
	// reading still matters if you step outside at all -- so only the aerosol
	// notice is suppressed.
	if (quality !== 'unsuitable' && air.dimsView && air.transparencyImpact) {
		notices.push({
			kind: 'aerosol',
			severity: buildSeverity('excellent', air) === 'positive' ? 'neutral' : buildSeverity('excellent', air),
			icon: air.aerosolType === 'dust' ? 'dust' : 'smoke',
			text: air.transparencyImpact
		});
	}

	if (air.healthAdvisory) {
		const healthSeverity = {
			sensitive: 'caution',
			unhealthy: 'warning',
			'very-unhealthy': 'critical',
			hazardous: 'critical'
		}[air.healthCategory] || 'caution';
		notices.push({
			kind: 'health',
			severity: healthSeverity,
			icon: 'health',
			text: air.healthAdvisory
		});
	}

	return notices;
}

// One-line summary of how much of the night is actually clear.
function buildClearSummary(clearHours, nightHours, clearFraction) {
	if (!nightHours || nightHours <= 0) return null;

	const clear = Math.round(clearHours);
	const night = Math.round(nightHours);
	const fraction = (clearFraction === undefined || clearFraction === null)
		? clearHours / nightHours
		: clearFraction;

	let text;
	if (clearHours <= 0) {
		text = 'No clear skies expected tonight.';
	} else if (fraction >= 0.95) {
		text = 'Clear all night.';
	} else if (fraction >= 0.75) {
		text = `Clear most of the night (~${clear} of ${night}h).`;
	} else if (fraction >= 0.45) {
		text = `Clear about half the night (~${clear} of ${night}h).`;
	} else {
		text = `Only ~${clear} of ${night}h look clear.`;
	}
	return fitCopy(text, COPY_LIMITS.summary, 'summary');
}

// Get weather conditions from 7timer
async function getWeatherConditions(latitude, longitude, retries = 2) {
	const apiUrl = `https://www.7timer.info/bin/astro.php?` +
		`lon=${longitude}&lat=${latitude}&ac=0&lang=en&unit=imperial&output=json&tzshift=0`;

	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			console.log(`[Weather API] Fetching data for lat=${latitude}, lon=${longitude} (attempt ${attempt + 1})`);
			const parsedUrl = url.parse(apiUrl);

			const result = await new Promise((resolve, reject) => {
				https.get({
					hostname: parsedUrl.hostname,
					path: parsedUrl.path,
					method: 'GET'
				}, (res) => {
					let data = '';
					res.on('data', (chunk) => {
						data += chunk;
					});
					res.on('end', () => {
						if (res.statusCode === 200) {
							console.log('[Weather API] Successfully retrieved weather data');
							console.log(`[Weather API] Response length: ${data.length} bytes`);

							try {
								const parsedData = JSON.parse(data);
								resolve(parsedData);
							} catch (parseError) {
								console.error('[Weather API] Failed to parse JSON:', parseError.message);
								reject(new Error('Weather API returned invalid JSON'));
							}
						} else {
							console.error(`[Weather API] Request failed with status ${res.statusCode}`);
							reject(new Error(`Weather API request failed with status ${res.statusCode}`));
						}
					});
				}).on('error', (err) => {
					console.error('[Weather API] Request error:', err.message);
					reject(err);
				});
			});

			return result; // Success, return immediately

		} catch (error) {
			console.error(`[Weather API] Attempt ${attempt + 1} failed:`, error.message);

			if (attempt === retries) {
				// Final attempt failed
				throw new Error(`Failed to fetch weather data after ${retries + 1} attempts: ${error.message}`);
			}

			// Wait a bit before retrying
			await new Promise(resolve => setTimeout(resolve, 1000));
		}
	}
}

// Rating criteria for viewing quality. `magnitudePenalty` is tonight's aerosol
// extinction: it raises the effective faint limit without touching the
// advertised viewingCapabilities, which describe the gear rather than the air
// (and whose maxMagnitude consumers decode as an integer).
function getViewingRating(body, viewingCaps, viewingLevel, magnitudePenalty = 0) {
	const altitude = parseFloat(body.position.horizontal.altitude.degrees);
	const magnitude = body.extraInfo.magnitude;

	// Scale the aerosol penalty by the airmass at THIS altitude rather than
	// applying a flat zenith figure. A low target looks through several times
	// more smoke than one overhead, and treating them alike is what let an
	// invisible low Saturn keep an "excellent" rating.
	const extinction = magnitudePenalty > 0
		? extinctionAtAltitude(magnitudePenalty, altitude)
		: 0;
	const faintLimit = viewingCaps.maxMagnitude - extinction;

	if (altitude < 0) return { rating: 'not-visible', reason: 'Below horizon' };
	if (altitude < viewingCaps.minAltitude) return { rating: 'poor', reason: 'Too low on horizon' };
	if (magnitude !== null && magnitude > faintLimit) {
		// Distinguish "your gear cannot" from "tonight's air cannot".
		if (extinction > 0 && magnitude <= viewingCaps.maxMagnitude) {
			return { rating: 'too-faint', reason: 'Too faint through the haze' };
		}
		return { rating: 'too-faint', reason: `Too faint for ${viewingLevel === 'naked-eye' ? 'naked eye' : 'your telescope'}` };
	}

	let rating = 'fair';
	let reason = '';

	if (altitude > 45) {
		rating = 'excellent';
		reason = 'High in the sky, steady air';
	} else if (altitude > 30) {
		rating = 'good';
		reason = 'Good viewing angle';
	} else {
		reason = 'Visible but low in the sky';
	}

	if (magnitude !== null) {
		if (magnitude < 0) {
			reason += ', very bright';
		} else if (magnitude > 5) {
			rating = rating === 'excellent' ? 'good' : 'fair';
			reason += ', faint';
		}
	}

	// Smoke also ruins targets far too bright to ever hit the faint limit -- the
	// Moon and Saturn will never be "too faint", but low in heavy haze they are
	// genuinely hard or impossible to pick out. Demote on the extinction actually
	// suffered at this altitude.
	if (extinction >= 1.5) {
		rating = 'poor';
		reason += ', badly dimmed by haze';
	} else if (extinction >= 0.8) {
		rating = rating === 'excellent' ? 'good' : 'fair';
		reason += ', dimmed by haze';
	}

	return { rating, reason: fitCopy(reason, COPY_LIMITS.reason, 'target reason') };
}

// Make HTTPS request with Basic Auth
function makeRequest(urlString) {
	return new Promise((resolve, reject) => {
		const parsedUrl = url.parse(urlString);
		const auth = Buffer.from(`${config.appId}:${config.appSecret}`).toString('base64');

		const options = {
			hostname: parsedUrl.hostname,
			path: parsedUrl.path,
			method: 'GET',
			headers: {
				'Authorization': `Basic ${auth}`
			}
		};

		https.get(options, (res) => {
			let data = '';

			res.on('data', (chunk) => {
				data += chunk;
			});

			res.on('end', () => {
				if (res.statusCode === 200) {
					resolve(JSON.parse(data));
				} else {
					console.error(`[Astronomy API] Request failed with status ${res.statusCode}`);
					reject(new Error(`API request failed with status ${res.statusCode}: ${data}`));
				}
			});
		}).on('error', (err) => {
			console.error('[Astronomy API] Request error:', err.message);
			reject(err);
		});
	});
}

// Format time for API (HH:MM:SS)
function formatTime(hour) {
	return `${hour.toString().padStart(2, '0')}:00:00`;
}

// Get current date in YYYY-MM-DD format
function getCurrentDate() {
	const now = new Date();
	return now.toISOString().split('T')[0];
}

// Analyze targets for a specific time
async function analyzeTargets(date, time, latitude, longitude, elevation, viewingLevel, magnitudePenalty = 0) {
	const apiUrl = `https://api.astronomyapi.com/api/v2/bodies/positions?` +
		`latitude=${latitude}&longitude=${longitude}&elevation=${elevation}` +
		`&from_date=${date}&to_date=${date}&time=${time}`;

	console.log(`[Astronomy API] Fetching positions for ${time}`);

	try {
		const response = await makeRequest(apiUrl);
		const viewingCaps = viewingCapabilities[viewingLevel];
		const results = [];

		for (const row of response.data.table.rows) {
			const body = row.cells[0];

			if (body.id === 'sun' || body.id === 'earth') continue;

			const viewingInfo = getViewingRating(body, viewingCaps, viewingLevel, magnitudePenalty);

			results.push({
				name: body.name,
				rating: viewingInfo.rating,
				reason: viewingInfo.reason,
				altitude: parseFloat(body.position.horizontal.altitude.degrees),
				azimuth: parseFloat(body.position.horizontal.azimuth.degrees),
				magnitude: body.extraInfo.magnitude,
				constellation: body.position.constellation.name,
				distance: body.distance.fromEarth,
				lightDistance: convertToLightDistance(parseFloat(body.distance.fromEarth.km)),
				extraInfo: body.extraInfo
			});
		}

		console.log(`[Astronomy API] Found ${results.length} celestial bodies for ${time}`);
		return results;
	} catch (error) {
		console.error(`[Astronomy API] Failed to fetch data for ${time}:`, error.message);
		throw new Error(`Failed to fetch data for ${time}: ${error.message}`);
	}
}

// Calculate viewability score for sorting
function calculateViewabilityScore(target) {
	let score = target.magnitude !== null ? target.magnitude : 15;

	if (target.peakAltitude) {
		const altitudeBonus = Math.min(5, target.peakAltitude / 10);
		score -= altitudeBonus;
	}

	const name = target.name.toLowerCase();
	if (name === 'moon') {
		score -= 15;
	} else if (name === 'saturn') {
		score -= 3;
	} else if (name === 'jupiter') {
		score -= 2;
	} else if (name === 'mars') {
		score -= 1;
	}

	return score;
}

// Convert azimuth to compass direction
function getDirection(azimuth) {
	const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
	const index = Math.round(azimuth / 22.5) % 16;
	return directions[index];
}

// Main function to get viewing data
async function getViewingData(latitude, longitude, elevation, viewingLevel, eveningStartHour, eveningEndHour) {
	console.log(`[Main] Starting analysis for lat=${latitude}, lon=${longitude}, elevation=${elevation}, level=${viewingLevel}`);
	console.log(`[Main] Evening hours: ${eveningStartHour}:00 - ${eveningEndHour}:00`);

	const viewingCaps = viewingCapabilities[viewingLevel];
	const date = getCurrentDate();

	console.log(`[Main] Date: ${date}`);

	// Get location name
	const locationName = await getLocationName(latitude, longitude);

	const result = {
		date,
		location: {
			name: locationName,
			latitude,
			longitude,
			elevation
		},
		viewingLevel,
		viewingCapabilities: viewingCaps,
		weather: null,
		targets: {
			excellent: [],
			good: [],
			fair: []
		}
	};

	// Get weather conditions. Air quality is fetched alongside it (and never
	// throws), so a smoke reading costs no extra wall-clock time and its absence
	// leaves the weather interpretation exactly as it was before.
	let air = null;
	try {
		const [weatherData, airData] = await Promise.all([
			getWeatherConditions(latitude, longitude),
			getAirQuality(latitude, longitude)
		]);
		air = interpretAirQuality(airData, eveningStartHour, eveningEndHour);
		result.weather = interpretWeatherConditions(weatherData, eveningStartHour, eveningEndHour, longitude, viewingLevel, air);
	} catch (error) {
		console.error('[Main] Weather data error:', error.message);
		result.weather = {
			error: 'Weather data unavailable',
			message: error.message
		};
	}

	// Smoke raises the effective faint limit, so targets are re-rated against
	// tonight's air rather than the gear's nominal reach.
	const magnitudePenalty = air ? air.extinctionMagnitudes : 0;
	if (magnitudePenalty > 0) {
		console.log(`[Main] Applying ${magnitudePenalty} mag aerosol extinction penalty to target ratings`);
	}

	// Generate hours to check
	const hours = [];
	let currentHour = eveningStartHour;
	while (true) {
		hours.push(currentHour);
		currentHour = (currentHour + 1) % 24;
		if (currentHour === (eveningEndHour + 1) % 24) break;
		if (hours.length > 12) break;
	}

	console.log(`[Main] Analyzing ${hours.length} hours: ${hours.join(', ')}`);

	// Collect data for all hours
	const targetsByName = new Map();

	for (const hour of hours) {
		const time = formatTime(hour);

		try {
			const targets = await analyzeTargets(date, time, latitude, longitude, elevation, viewingLevel, magnitudePenalty);

			for (const target of targets) {
				if (!targetsByName.has(target.name)) {
					targetsByName.set(target.name, {
						name: target.name,
						magnitude: target.magnitude,
						constellation: target.constellation,
						distance: target.distance,
						lightDistance: target.lightDistance,
						hourlyData: []
					});
				}

				targetsByName.get(target.name).hourlyData.push({
					hour: hour,
					altitude: target.altitude,
					azimuth: target.azimuth,
					rating: target.rating,
					reason: target.reason
				});
			}
		} catch (error) {
			console.error(`[Main] Error fetching data for ${time}:`, error.message);
		}
	}

	console.log(`[Main] Tracked ${targetsByName.size} unique celestial bodies`);

	// Analyze and display results
	const nightSummary = [];

	for (const [name, data] of targetsByName) {
		const visibleHours = data.hourlyData.filter(h => h.altitude > 0);

		if (visibleHours.length === 0) {
			continue;
		}

		const peakHour = visibleHours.reduce((best, current) =>
			current.altitude > best.altitude ? current : best
		);

		const ratingPriority = { 'excellent': 0, 'good': 1, 'fair': 2, 'poor': 3, 'too-faint': 4, 'not-visible': 5 };
		const bestRatingHour = visibleHours.reduce((best, current) =>
			ratingPriority[current.rating] < ratingPriority[best.rating] ? current : best
		);

		if (ratingPriority[bestRatingHour.rating] <= 2) {
			nightSummary.push({
				name: data.name,
				bestRating: bestRatingHour.rating,
				reason: bestRatingHour.reason,
				magnitude: data.magnitude,
				constellation: data.constellation,
				peakAltitude: parseFloat(peakHour.altitude.toFixed(1)),
				peakHour: peakHour.hour,
				peakTime: formatTime12Hour(peakHour.hour),
				peakAzimuth: parseFloat(peakHour.azimuth.toFixed(1)),
				peakDirection: getDirection(peakHour.azimuth),
				visibleHours: visibleHours.length,
				totalHours: data.hourlyData.length,
				distance: data.distance,
				lightDistance: data.lightDistance
			});
		}
	}

	// Sort by rating priority first, then by viewability score
	const ratingPriority = { 'excellent': 0, 'good': 1, 'fair': 2, 'poor': 3, 'too-faint': 4, 'not-visible': 5 };
	nightSummary.sort((a, b) => {
		const priorityDiff = ratingPriority[a.bestRating] - ratingPriority[b.bestRating];
		if (priorityDiff !== 0) return priorityDiff;
		return calculateViewabilityScore(a) - calculateViewabilityScore(b);
	});

	// Categorize targets
	result.targets.excellent = nightSummary.filter(t => t.bestRating === 'excellent');
	result.targets.good = nightSummary.filter(t => t.bestRating === 'good');
	result.targets.fair = nightSummary.filter(t => t.bestRating === 'fair');

	console.log(`[Main] Results: ${result.targets.excellent.length} excellent, ${result.targets.good.length} good, ${result.targets.fair.length} fair targets`);

	return result;
}

// Create HTTP server
// Create HTTP server
const server = http.createServer(async (req, res) => {
	const parsedUrl = url.parse(req.url, true);

	// Log incoming request
	console.log(`[Request] ${req.method} ${req.url} from ${req.socket.remoteAddress}`);

	// Set CORS headers
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

	// Handle OPTIONS request for CORS preflight
	if (req.method === 'OPTIONS') {
		res.writeHead(200);
		res.end();
		return;
	}

	// Health check endpoint
	if (parsedUrl.pathname === '/health') {
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
		return;
	}

	// Main viewing data endpoint
	if (parsedUrl.pathname === '/viewing-data' && req.method === 'GET') {
		try {
			// Validate API configuration
			if (!config.appId || !config.appSecret) {
				console.error('[Config] Missing API credentials');
				res.writeHead(500, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({
					error: 'Configuration error',
					message: 'ASTRONOMY_API_APP_ID and ASTRONOMY_API_APP_SECRET must be set'
				}));
				return;
			}

			// Parse query parameters
			let query = parsedUrl.query;

			console.log('[Request] Raw query parameters:', JSON.stringify(query));

			// Check if parameters are sent as JSON object in URL
			// This happens when the query string looks like: ?{"latitude": 47.6694,...}
			const queryKeys = Object.keys(query);
			if (queryKeys.length === 1 && queryKeys[0].startsWith('{')) {
				try {
					// The entire JSON object is the key, decode and parse it
					const jsonString = decodeURIComponent(queryKeys[0]);
					query = JSON.parse(jsonString);
					console.log('[Request] Detected JSON-encoded parameters, parsed successfully');
				} catch (e) {
					console.error('[Request] Failed to parse JSON-encoded parameters:', e.message);
					res.writeHead(400, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({
						error: 'Invalid parameters',
						message: 'Failed to parse JSON-encoded query parameters'
					}));
					return;
				}
			}

			console.log('[Request] Query parameters:', JSON.stringify(query));

			// Required parameters
			const latitude = parseFloat(query.latitude);
			const longitude = parseFloat(query.longitude);
			const elevation = parseFloat(query.elevation);

			console.log(`[Request] Parsed coordinates: lat=${latitude}, lon=${longitude}, elevation=${elevation}`);

			// Validate required parameters
			if (isNaN(latitude) || isNaN(longitude) || isNaN(elevation)) {
				console.error('[Request] Invalid or missing required parameters');
				res.writeHead(400, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({
					error: 'Invalid parameters',
					message: 'latitude, longitude, and elevation are required and must be valid numbers',
					example: '/viewing-data?latitude=47.6062&longitude=-122.3321&elevation=50'
				}));
				return;
			}

			// Validate latitude range
			if (latitude < -90 || latitude > 90) {
				console.error(`[Request] Latitude out of range: ${latitude}`);
				res.writeHead(400, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({
					error: 'Invalid latitude',
					message: 'latitude must be between -90 and 90'
				}));
				return;
			}

			// Validate longitude range
			if (longitude < -180 || longitude > 180) {
				console.error(`[Request] Longitude out of range: ${longitude}`);
				res.writeHead(400, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({
					error: 'Invalid longitude',
					message: 'longitude must be between -180 and 180'
				}));
				return;
			}

			// Optional parameters with defaults
			// Handle viewing level mapping - check if it contains descriptions
			let viewingLevel = query.viewingLevel || config.viewingLevel;

			// Map descriptive viewing levels to simple keys
			if (typeof viewingLevel === 'string') {
				const lowerLevel = viewingLevel.toLowerCase();
				if (lowerLevel.includes('entry') || lowerLevel.includes('60-80mm')) {
					viewingLevel = 'entry';
				} else if (lowerLevel.includes('intermediate') || lowerLevel.includes('100-150mm')) {
					viewingLevel = 'intermediate';
				} else if (lowerLevel.includes('advanced') || lowerLevel.includes('200mm')) {
					viewingLevel = 'advanced';
				} else if (lowerLevel.includes('naked')) {
					viewingLevel = 'naked-eye';
				}
			}

			const eveningStartHour = query.eveningStartHour ? parseInt(query.eveningStartHour, 10) : config.eveningStartHour;
			const eveningEndHour = query.eveningEndHour ? parseInt(query.eveningEndHour, 10) : config.eveningEndHour;

			console.log(`[Request] Viewing level: ${viewingLevel}, Hours: ${eveningStartHour}-${eveningEndHour}`);

			// Validate viewing level
			if (!viewingCapabilities[viewingLevel]) {
				console.error(`[Request] Invalid viewing level: ${viewingLevel}`);
				res.writeHead(400, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({
					error: 'Invalid viewing level',
					message: 'viewingLevel must be one of: naked-eye, entry, intermediate, advanced'
				}));
				return;
			}

			// Validate hours
			if (isNaN(eveningStartHour) || eveningStartHour < 0 || eveningStartHour > 23) {
				console.error(`[Request] Invalid eveningStartHour: ${eveningStartHour}`);
				res.writeHead(400, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({
					error: 'Invalid eveningStartHour',
					message: 'eveningStartHour must be between 0 and 23'
				}));
				return;
			}

			if (isNaN(eveningEndHour) || eveningEndHour < 0 || eveningEndHour > 23) {
				console.error(`[Request] Invalid eveningEndHour: ${eveningEndHour}`);
				res.writeHead(400, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({
					error: 'Invalid eveningEndHour',
					message: 'eveningEndHour must be between 0 and 23'
				}));
				return;
			}

			console.log('[Request] All validations passed, fetching viewing data...');

			const data = await getViewingData(latitude, longitude, elevation, viewingLevel, eveningStartHour, eveningEndHour);

			console.log('[Request] Successfully generated viewing data, sending response');

			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify(data, null, 2));
		} catch (error) {
			console.error('[Request] Error processing request:', error);
			res.writeHead(500, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({
				error: 'Internal server error',
				message: error.message
			}));
		}
		return;
	}

	// 404 for all other routes
	console.log(`[Request] 404 - Route not found: ${parsedUrl.pathname}`);
	res.writeHead(404, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify({
		error: 'Not found',
		message: 'Available endpoints: /viewing-data, /health'
	}));
});

// Start server only when run directly (so the module can be imported in tests)
if (require.main === module) {
	server.listen(config.port, () => {
		console.log(`[Server] Astronomy Buddy API running on port ${config.port}`);
		console.log(`[Server] Example: http://localhost:${config.port}/viewing-data?latitude=47.6062&longitude=-122.3321&elevation=50`);
		console.log(`[Server] Health check: http://localhost:${config.port}/health`);
	});

	// Handle graceful shutdown
	process.on('SIGTERM', () => {
		console.log('[Server] SIGTERM received, closing server...');
		server.close(() => {
			console.log('[Server] Server closed');
			process.exit(0);
		});
	});
}

module.exports = {
	COPY_LIMITS,
	fitCopy,
	aerosolLabel,
	buildVerdict,
	buildClearSummary,
	buildTransparencyImpact,
	buildHealthAdvisory,
	interpretWeatherConditions,
	approxUtcOffset,
	cloudIndexToPct,
	qualityWord,
	interpretAirQuality,
	aerosolAwareTransparency,
	aodLevel,
	aodToMagnitudes,
	airmass,
	extinctionAtAltitude,
	getViewingRating,
	usAqiCategory,
	getAirQuality,
	buildSeverity,
	buildIcon,
	buildHeading,
	buildTargetsHeading,
	buildNotices,
	severityRank
};
