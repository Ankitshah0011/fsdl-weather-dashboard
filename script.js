/* =========================================================
   WeatherViz — Interactive Weather Dashboard
   - Open-Meteo (Forecast + Geocoding) — no API key
   - Chart.js for charts
   - Features: autocomplete, geolocation, unit toggle,
     24h charts (temp/rain/wind), 7-day forecast,
     loading + error handling
========================================================= */

const el = (id) => document.getElementById(id);

const cityInput = el("cityInput");
const suggestions = el("suggestions");
const searchBtn = el("searchBtn");
const geoBtn = el("geoBtn");
const unitBtn = el("unitBtn");

const placePill = el("placePill");
const timePill = el("timePill");
const statusPill = el("statusPill");

const loading = el("loading");
const errorBox = el("errorBox");
const errorTitle = el("errorTitle");
const errorSub = el("errorSub");

const tempNow = el("tempNow");
const tempFeel = el("tempFeel");
const windNow = el("windNow");
const humNow = el("humNow");
const rainNow = el("rainNow");
const precipNow = el("precipNow");

const tempUnit = el("tempUnit");
const feelUnit = el("feelUnit");
const windUnit = el("windUnit");
const rainUnit = el("rainUnit");

const conditionBadge = el("conditionBadge");
const wxIcon = el("wxIcon");
const wxMain = el("wxMain");
const wxSub = el("wxSub");

const forecastGrid = el("forecastGrid");
const forecastChip = el("forecastChip");

// Unit state
let unit = "C"; // "C" or "F"
let currentPlace = { name: "—", lat: null, lon: null, tz: "auto" };

// Charts
let tempChart, rainChart, windChart;

// For autocomplete
let debounceTimer = null;
let lastSuggestions = [];

/* -----------------------------
   Helpers
------------------------------ */
function setLoading(isLoading){
  loading.classList.toggle("hidden", !isLoading);
  statusPill.textContent = isLoading ? "Loading…" : "Ready";
}

function showError(title, subtitle){
  errorBox.classList.remove("hidden");
  errorTitle.textContent = title;
  errorSub.textContent = subtitle;
  statusPill.textContent = "Error";
}

function clearError(){
  errorBox.classList.add("hidden");
}

function formatLocalTime(isoString){
  try{
    const d = new Date(isoString);
    return d.toLocaleString(undefined, { weekday:"short", hour:"2-digit", minute:"2-digit" });
  }catch{
    return "—";
  }
}

// Weather code mapping (Open-Meteo WMO)
function decodeWeatherCode(code){
  const map = {
    0:  {t:"Clear sky", i:"☀️"},
    1:  {t:"Mainly clear", i:"🌤️"},
    2:  {t:"Partly cloudy", i:"⛅"},
    3:  {t:"Overcast", i:"☁️"},
    45: {t:"Fog", i:"🌫️"},
    48: {t:"Depositing rime fog", i:"🌫️"},
    51: {t:"Light drizzle", i:"🌦️"},
    53: {t:"Drizzle", i:"🌦️"},
    55: {t:"Dense drizzle", i:"🌧️"},
    56: {t:"Freezing drizzle", i:"🌧️"},
    57: {t:"Freezing drizzle", i:"🌧️"},
    61: {t:"Slight rain", i:"🌧️"},
    63: {t:"Rain", i:"🌧️"},
    65: {t:"Heavy rain", i:"⛈️"},
    66: {t:"Freezing rain", i:"🌧️"},
    67: {t:"Freezing rain", i:"🌧️"},
    71: {t:"Slight snow", i:"🌨️"},
    73: {t:"Snow", i:"🌨️"},
    75: {t:"Heavy snow", i:"❄️"},
    77: {t:"Snow grains", i:"🌨️"},
    80: {t:"Rain showers", i:"🌦️"},
    81: {t:"Rain showers", i:"🌦️"},
    82: {t:"Violent showers", i:"⛈️"},
    85: {t:"Snow showers", i:"🌨️"},
    86: {t:"Heavy snow showers", i:"❄️"},
    95: {t:"Thunderstorm", i:"⛈️"},
    96: {t:"Thunderstorm w/ hail", i:"⛈️"},
    99: {t:"Thunderstorm w/ hail", i:"⛈️"}
  };
  return map[code] || {t:"Unknown", i:"🌡️"};
}

function applyRipple(e){
  const btn = e.currentTarget;
  const rect = btn.getBoundingClientRect();
  btn.style.setProperty("--x", `${e.clientX - rect.left}px`);
  btn.style.setProperty("--y", `${e.clientY - rect.top}px`);
  btn.classList.remove("rippling");
  void btn.offsetWidth; // reflow
  btn.classList.add("rippling");
}

/* -----------------------------
   IMPORTANT: Chart.js check
   Fixes: "Chart is not defined"
------------------------------ */
function ensureChartJs(){
  if(!window.Chart){
    showError(
      "Could not load charts",
      "Chart.js is not available (CDN blocked / offline). Change CDN in index.html or use another network."
    );
    return false;
  }
  return true;
}

/* -----------------------------
   API Calls
------------------------------ */

// Open-Meteo Geocoding API
async function geocode(query){
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=7&language=en&format=json`;
  const res = await fetch(url);
  if(!res.ok) throw new Error("Geocoding request failed.");
  return res.json();
}

// Open-Meteo Forecast API
async function forecast(lat, lon, tz="auto"){
  const tempUnitParam = unit === "F" ? "fahrenheit" : "celsius";
  const windUnitParam = "kmh";

  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&timezone=${encodeURIComponent(tz)}` +
    `&temperature_unit=${tempUnitParam}` +
    `&windspeed_unit=${windUnitParam}` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m` +
    `&hourly=temperature_2m,precipitation_probability,precipitation,wind_speed_10m` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,weather_code` +
    `&forecast_days=7`;

  const res = await fetch(url);
  if(!res.ok) throw new Error("Forecast request failed.");
  return res.json();
}

/* -----------------------------
   UI Updates
------------------------------ */
function setPlace(name, lat, lon, tz="auto"){
  currentPlace = { name, lat, lon, tz };
  placePill.textContent = name;
}

function setTimePill(nowIso){
  timePill.textContent = `Updated: ${formatLocalTime(nowIso)}`;
}

function getClosestHourly(data, key){
  try{
    const now = data.current.time;
    const idx = data.hourly.time.indexOf(now);
    if(idx >= 0) return data.hourly[key][idx];
    return data.hourly[key][0];
  }catch{
    return null;
  }
}

function setTodayCard(data){
  const c = data.current;
  const w = decodeWeatherCode(c.weather_code);

  wxIcon.textContent = w.i;
  wxMain.textContent = w.t;
  conditionBadge.textContent = w.t;

  tempNow.textContent = Math.round(c.temperature_2m);
  tempFeel.textContent = Math.round(c.apparent_temperature);
  windNow.textContent = Math.round(c.wind_speed_10m);

  humNow.textContent = (c.relative_humidity_2m ?? "—");
  precipNow.textContent = (c.precipitation ?? 0).toFixed(1);

  const rainProb = getClosestHourly(data, "precipitation_probability");
  rainNow.textContent = rainProb != null ? Math.round(rainProb) : "—";

  tempUnit.textContent = unit === "F" ? "°F" : "°C";
  feelUnit.textContent = unit === "F" ? "°F" : "°C";
  windUnit.textContent = "km/h";
  rainUnit.textContent = "%";

  wxSub.textContent = `Lat ${currentPlace.lat.toFixed(2)} • Lon ${currentPlace.lon.toFixed(2)}`;
}

function buildForecastCards(data){
  const days = data.daily.time;
  const tmin = data.daily.temperature_2m_min;
  const tmax = data.daily.temperature_2m_max;
  const psum = data.daily.precipitation_sum;
  const pmax = data.daily.precipitation_probability_max;
  const wcode = data.daily.weather_code;

  forecastGrid.innerHTML = "";

  for(let i=0;i<days.length;i++){
    const d = new Date(days[i]);
    const dayName = d.toLocaleDateString(undefined, { weekday:"short" });
    const dateName = d.toLocaleDateString(undefined, { month:"short", day:"numeric" });
    const w = decodeWeatherCode(wcode[i]);

    const card = document.createElement("div");
    card.className = "fcard";
    card.innerHTML = `
      <div class="fTop">
        <div>
          <div class="fDay">${dayName}</div>
          <div class="fMeta">${dateName}</div>
        </div>
        <div class="fIcon" title="${w.t}">${w.i}</div>
      </div>
      <div class="fTemps">
        ${Math.round(tmin[i])}${unit === "F" ? "°F" : "°C"} • ${Math.round(tmax[i])}${unit === "F" ? "°F" : "°C"}
      </div>
      <div class="fMeta">Rain: ${pmax[i] ?? "—"}% • Precip: ${(psum[i] ?? 0).toFixed(1)} mm</div>
    `;
    forecastGrid.appendChild(card);
  }

  forecastChip.textContent = `Daily • ${unit === "F" ? "°F" : "°C"}`;
}

function next24HoursSeries(data){
  const t = data.hourly.time.slice(0, 24);
  const labels = t.map(x => {
    const d = new Date(x);
    return d.toLocaleTimeString(undefined, { hour:"2-digit", minute:"2-digit" });
  });

  const temps = data.hourly.temperature_2m.slice(0,24);
  const rainP = data.hourly.precipitation_probability.slice(0,24);
  const wind = data.hourly.wind_speed_10m.slice(0,24);

  return { labels, temps, rainP, wind };
}

/* -----------------------------
   Charts (Chart.js) — updated colors
------------------------------ */
function destroyCharts(){
  tempChart?.destroy(); rainChart?.destroy(); windChart?.destroy();
}

function makeCharts(series){
  if(!ensureChartJs()) return;
  destroyCharts();

  // new palette for charts
  const SKY  = "rgba(77,201,255,.95)";
  const CYAN = "rgba(0,245,255,.90)";
  const LIME = "rgba(166,255,0,.85)";
  const RED  = "rgba(255,59,92,.85)";

  // tick colors updated for new UI
  const tickColor = "rgba(236,244,255,.78)";
  const gridColor = "rgba(255,255,255,.08)";

  const common = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: { enabled: true }
    },
    scales: {
      x: { ticks: { color: tickColor }, grid: { color: gridColor } },
      y: { ticks: { color: tickColor }, grid: { color: gridColor } }
    }
  };

  // Temperature line (Sky/Cyan)
  tempChart = new Chart(el("tempChart"), {
    type: "line",
    data: {
      labels: series.labels,
      datasets: [{
        label: "Temp",
        data: series.temps,
        tension: 0.35,
        borderWidth: 2,
        pointRadius: 2,
        borderColor: SKY,
        pointBackgroundColor: CYAN,
        fill: true,
        backgroundColor: "rgba(77,201,255,.14)"
      }]
    },
    options: {
      ...common,
      scales: {
        ...common.scales,
        y: {
          ...common.scales.y,
          title: { display: true, text: unit === "F" ? "°F" : "°C", color: tickColor }
        }
      }
    }
  });

  // Rain probability bar (Red/Coral)
  rainChart = new Chart(el("rainChart"), {
    type: "bar",
    data: {
      labels: series.labels,
      datasets: [{
        label: "Rain %",
        data: series.rainP.map(v => v ?? 0),
        borderWidth: 1,
        borderColor: "rgba(255,59,92,.65)",
        backgroundColor: "rgba(255,59,92,.18)",
        borderRadius: 10
      }]
    },
    options: {
      ...common,
      scales: {
        ...common.scales,
        y: {
          ...common.scales.y,
          suggestedMax: 100,
          title: { display: true, text: "%", color: tickColor }
        }
      }
    }
  });

  // Wind line (Lime/Cyan)
  windChart = new Chart(el("windChart"), {
    type: "line",
    data: {
      labels: series.labels,
      datasets: [{
        label: "Wind",
        data: series.wind,
        tension: 0.35,
        borderWidth: 2,
        pointRadius: 2,
        borderColor: LIME,
        pointBackgroundColor: CYAN,
        fill: true,
        backgroundColor: "rgba(0,245,255,.10)"
      }]
    },
    options: {
      ...common,
      scales: {
        ...common.scales,
        y: {
          ...common.scales.y,
          title: { display: true, text: "km/h", color: tickColor }
        }
      }
    }
  });
}

/* -----------------------------
   Main Flow
------------------------------ */
async function loadWeatherByCoords(lat, lon, label="Selected location", tz="auto"){
  clearError();
  setLoading(true);
  try{
    setPlace(label, lat, lon, tz);

    const data = await forecast(lat, lon, tz);

    setTimePill(data.current.time);
    setTodayCard(data);
    buildForecastCards(data);

    const series = next24HoursSeries(data);
    makeCharts(series);

    statusPill.textContent = "Updated";
  }catch(err){
    showError("Could not load weather", err?.message || "Check your internet and try again.");
  }finally{
    setLoading(false);
  }
}

async function loadWeatherByCityName(name){
  clearError();
  setLoading(true);
  try{
    const g = await geocode(name);

    if(!g?.results || g.results.length === 0){
      showError("No results", "Try a different city name (example: Pune, Kathmandu, Patna).");
      return;
    }

    const r = g.results[0];
    const label = `${r.name}${r.admin1 ? ", " + r.admin1 : ""}${r.country ? ", " + r.country : ""}`;
    await loadWeatherByCoords(r.latitude, r.longitude, label, "auto");
  }catch(err){
    showError("City search failed", err?.message || "Try again.");
  }finally{
    setLoading(false);
  }
}

/* -----------------------------
   Autocomplete
------------------------------ */
function hideSuggestions(){
  suggestions.classList.remove("show");
  suggestions.setAttribute("aria-hidden","true");
}

function showSuggestions(items){
  lastSuggestions = items;
  suggestions.innerHTML = "";

  if(!items || items.length === 0){
    hideSuggestions();
    return;
  }

  items.forEach((r) => {
    const div = document.createElement("div");
    div.className = "suggItem";
    div.innerHTML = `
      <div>
        <div class="suggName">${r.name}</div>
        <div class="suggMeta">${[r.admin1, r.country].filter(Boolean).join(", ")}</div>
      </div>
      <div class="suggMeta">${Math.round(r.latitude*100)/100}, ${Math.round(r.longitude*100)/100}</div>
    `;
    div.addEventListener("click", () => {
      cityInput.value = `${r.name}${r.country ? ", " + r.country : ""}`;
      hideSuggestions();
      loadWeatherByCoords(
        r.latitude,
        r.longitude,
        `${r.name}${r.admin1 ? ", " + r.admin1 : ""}${r.country ? ", " + r.country : ""}`,
        "auto"
      );
    });
    suggestions.appendChild(div);
  });

  suggestions.classList.add("show");
  suggestions.setAttribute("aria-hidden","false");
}

async function handleAutocomplete(){
  const q = cityInput.value.trim();
  if(q.length < 2){
    hideSuggestions();
    return;
  }
  try{
    const g = await geocode(q);
    showSuggestions(g?.results || []);
  }catch{
    hideSuggestions();
  }
}

/* -----------------------------
   Events
------------------------------ */
[searchBtn, geoBtn, unitBtn].forEach(btn => {
  btn.addEventListener("pointerdown", applyRipple);
});

searchBtn.addEventListener("click", () => {
  const q = cityInput.value.trim();
  if(!q){
    showError("Type a city name", "Example: Pune, Kathmandu, Patna, New York.");
    return;
  }
  hideSuggestions();
  loadWeatherByCityName(q);
});

cityInput.addEventListener("input", () => {
  clearError();
  if(debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(handleAutocomplete, 280);
});

cityInput.addEventListener("keydown", (e) => {
  if(e.key === "Enter"){
    e.preventDefault();
    searchBtn.click();
  }
  if(e.key === "Escape"){
    hideSuggestions();
  }
});

document.addEventListener("click", (e) => {
  if(!suggestions.contains(e.target) && e.target !== cityInput){
    hideSuggestions();
  }
});

geoBtn.addEventListener("click", () => {
  clearError();
  if(!navigator.geolocation){
    showError("Geolocation not supported", "Your browser does not support location access.");
    return;
  }
  setLoading(true);
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      loadWeatherByCoords(latitude, longitude, "My location", "auto");
    },
    (err) => {
      setLoading(false);
      showError("Location denied", err?.message || "Allow location permission and try again.");
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

unitBtn.addEventListener("click", async () => {
  unit = unit === "C" ? "F" : "C";
  unitBtn.textContent = unit === "F" ? "°F" : "°C";

  if(currentPlace.lat != null && currentPlace.lon != null){
    await loadWeatherByCoords(currentPlace.lat, currentPlace.lon, currentPlace.name, currentPlace.tz);
  }else{
    statusPill.textContent = `Unit: ${unit === "F" ? "°F" : "°C"}`;
  }
});

/* -----------------------------
   Initial Load
------------------------------ */
(function init(){
  loadWeatherByCityName("Kathmandu");
})();
