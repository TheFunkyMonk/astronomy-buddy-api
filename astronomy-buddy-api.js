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
// Air quality / aerosols
// ---------------------------------------------------------------------------
// 7timer's transparency index is driven by water vapour aloft and does NOT see
// wildfire smoke, so a smoke-choked night could still be reported as
// "excellent transparency". Aerosol optical depth (AOD at 550nm) is the metric
// that actually matters for stargazing: it measures how much the whole air
// column dims and scatters starlight.
//
// Rough AOD reference points:
//   < 0.10       pristine
//   0.10 - 0.20  normal continental background
//   0.20 - 0.35  visible haze
//   0.35 - 0.55  moderate smoke/haze
//   0.55 - 0.90  significant smoke
//   > 0.90       heavy smoke
//
// Note that US AQI is a *health* metric and is a poor proxy for this: a night
// can sit at AQI 60 ("moderate") while AOD is 0.7 and half the visible stars
// are gone. The two are tracked separately and used for different things.
const AOD_LEVELS = [
	{ max: 0.10, level: 'pristine' },
	{ max: 0.20, level: 'none' },
	{ max: 0.35, level: 'slight' },
	{ max: 0.55, level: 'moderate' },
	{ max: 0.90, level: 'significant' },
	{ max: Infinity, level: 'heavy' }
];

// Levels at which aerosols visibly dim the sky. Below this, saying anything
// about the air would just be noise.
const DIMMING_LEVELS = new Set(['slight', 'moderate', 'significant', 'heavy']);

const AIR_QUALITY_TIMEOUT_MS = 5000;

function aodLevel(aod) {
	return AOD_LEVELS.find(entry => aod < entry.max).level;
}

// Extinction at the zenith for a given optical depth:
//   dm = 2.5 * log10(e^tau) = 1.086 * tau   (per unit airmass)
// Low in the sky this roughly doubles, but the zenith figure is the honest
// headline number.
function aodToMagnitudes(aod) {
	return 1.086 * aod;
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

// One sentence on what the aerosol load does to the view.
function buildTransparencyImpact(level, type, magnitudes) {
	const noun = type === 'haze' ? 'haze' : type;
	const dimming = magnitudes.toFixed(1);
	switch (level) {
		case 'pristine':
			return 'Exceptionally transparent air tonight — faint objects should show well.';
		case 'none':
			return null;
		case 'slight':
			return `A little ${noun} in the air, costing roughly ${dimming} magnitudes — barely noticeable.`;
		case 'moderate':
			return `${aerosolLabel(level, type)} is costing roughly ${dimming} magnitudes at the zenith, so fainter objects will be harder to pick out.`;
		case 'significant':
			return `${aerosolLabel(level, type)} is costing roughly ${dimming} magnitudes at the zenith — expect fainter stars to be washed out, though the Moon and bright planets cut through fine.`;
		case 'heavy':
			return `${aerosolLabel(level, type)} is costing roughly ${dimming} magnitudes at the zenith and more low in the sky, washing out all but the brightest objects.`;
		default:
			return null;
	}
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
	switch (category) {
		case 'good':
		case 'moderate':
			return null;
		case 'sensitive':
			return `Air quality is unhealthy for sensitive groups (AQI ${aqi}) — go easy if smoke bothers you.`;
		case 'unhealthy':
			return `Air quality is unhealthy (AQI ${aqi}) — keep the session short or wear a mask.`;
		case 'very-unhealthy':
			return `Air quality is very unhealthy (AQI ${aqi}) — better to sit this one out.`;
		case 'hazardous':
			return `Air quality is hazardous (AQI ${aqi}) — stay inside tonight.`;
		default:
			return null;
	}
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
		dimsView: DIMMING_LEVELS.has(level)
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
		if (air && air.dimsView) {
			reasons.push(air.label.toLowerCase());
			if ((air.level === 'moderate' || air.level === 'significant') && quality === 'excellent') {
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

	switch (air.level) {
		case 'heavy':
			return `${air.label} is washing the sky out — worth saving for a clearer night.`;
		case 'significant':
			return `${air.label} will wash out fainter stars, though the Moon and bright planets still cut through.`;
		case 'moderate':
			return `${air.label} is taking the edge off — fainter objects will be harder to pick out.`;
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
		return `${air.label} tonight — the sky may be clear, but it is washed out. Worth waiting for cleaner air.`;
	}
	if (air && air.level === 'significant' && (quality === 'excellent' || quality === 'good')) {
		return `Clear skies, but ${air.label.toLowerCase()} will wash out fainter stars — the Moon and bright planets still look good.`;
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
				? `Your clear window is ${bestWindow.startTime}–${bestWindow.endTime}; mostly cloudy otherwise.`
				: 'A short clear window tonight, then mostly cloudy.';
			break;
		case 'unsuitable':
			if (hasRain) {
				headline = usesTelescope
					? 'Rain expected — not a night for the telescope.'
					: 'Rain expected — not a night for stargazing.';
			} else {
				headline = usesTelescope
					? 'Clouded out — not worth setting up tonight.'
					: 'Clouded out — not worth heading out tonight.';
			}
			break;
		default:
			headline = 'Mostly cloudy tonight — not ideal for stargazing.';
	}

	const aerosolClause = air ? buildAerosolClause(air, quality) : null;
	return aerosolClause ? `${headline} ${aerosolClause}` : headline;
}

// One-line summary of how much of the night is actually clear.
function buildClearSummary(clearHours, nightHours, clearFraction) {
	if (!nightHours || nightHours <= 0) return null;
	if (clearHours <= 0) return 'No clear skies expected during your window tonight.';

	const clear = Math.round(clearHours);
	const night = Math.round(nightHours);
	const fraction = (clearFraction === undefined || clearFraction === null)
		? clearHours / nightHours
		: clearFraction;

	if (fraction >= 0.95) return 'Clear skies the entire night.';
	if (fraction >= 0.75) return `Clear for most of the night — about ${clear} of ${night} hours.`;
	if (fraction >= 0.45) return `Clear for roughly half the night — about ${clear} of ${night} hours.`;
	return `About ${clear} of the ${night}-hour window looks clear.`;
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
	const faintLimit = viewingCaps.maxMagnitude - magnitudePenalty;

	if (altitude < 0) return { rating: 'not-visible', reason: 'Below horizon' };
	if (altitude < viewingCaps.minAltitude) return { rating: 'poor', reason: 'Too low on horizon' };
	if (magnitude !== null && magnitude > faintLimit) {
		// Distinguish "your gear cannot" from "tonight's air cannot".
		if (magnitudePenalty > 0 && magnitude <= viewingCaps.maxMagnitude) {
			return { rating: 'too-faint', reason: 'Too faint through tonight\'s haze' };
		}
		return { rating: 'too-faint', reason: `Too faint for ${viewingLevel === 'naked-eye' ? 'naked eye' : 'your telescope'}` };
	}

	let rating = 'fair';
	let reason = '';

	if (altitude > 45) {
		rating = 'excellent';
		reason = 'High in sky, minimal atmospheric interference';
	} else if (altitude > 30) {
		rating = 'good';
		reason = 'Good viewing angle';
	} else {
		reason = 'Viewable but lower in sky';
	}

	if (magnitude !== null) {
		if (magnitude < 0) {
			reason += ', very bright';
		} else if (magnitude > 5) {
			rating = rating === 'excellent' ? 'good' : 'fair';
			reason += ', relatively faint';
		}
	}

	return { rating, reason };
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
	interpretWeatherConditions,
	approxUtcOffset,
	cloudIndexToPct,
	qualityWord,
	interpretAirQuality,
	aerosolAwareTransparency,
	aodLevel,
	aodToMagnitudes,
	usAqiCategory,
	getAirQuality
};
