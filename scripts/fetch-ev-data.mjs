import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CARS_FILE = join(__dirname, '..', 'src', 'data', 'cars.json');
const API_BASE = 'https://www.fueleconomy.gov/ws/rest';

const EV_BRANDS = [
  'Tesla', 'BMW', 'Mercedes-Benz', 'Audi', 'Porsche',
  'Hyundai', 'Kia', 'Ford', 'Chevrolet', 'GMC',
  'Rivian', 'Lucid', 'Nissan', 'Volkswagen', 'Toyota',
  'Honda', 'Subaru', 'Mazda', 'Volvo', 'Polestar',
  'Genesis', 'Cadillac', 'Chrysler', 'Dodge', 'Jeep',
  'Lexus', 'Acura', 'Infiniti', 'Mini', 'Fiat',
  'BYD', 'Vinfast', 'Fisker', 'Lotus', 'Maserati',
  'Rolls-Royce', 'Scout', 'Smart',
];

const CATEGORY_MAP = {
  'Two Seaters': 'sedan',
  'Minicompact Cars': 'sedan',
  'Subcompact Cars': 'sedan',
  'Compact Cars': 'sedan',
  'Midsize Cars': 'sedan',
  'Large Cars': 'sedan',
  'Small Station Wagons': 'sedan',
  'Midsize Station Wagons': 'sedan',
  'Small Sport Utility Vehicle': 'suv',
  'Standard Sport Utility Vehicle': 'suv',
  'Midsize Sport Utility Vehicle': 'suv',
  'Sport Utility Vehicle - 2WD': 'suv',
  'Sport Utility Vehicle - 4WD': 'suv',
  'Minivan - 2WD': 'suv',
  'Minivan - 4WD': 'suv',
  'Small Pickup Trucks': 'truck',
  'Standard Pickup Trucks': 'truck',
  'Small Pickup Trucks - 2WD': 'truck',
  'Standard Pickup Trucks - 2WD': 'truck',
  'Standard Pickup Trucks 2WD': 'truck',
  'Standard Pickup Trucks 4WD': 'truck',
  'Vans': 'truck',
  'Vans Passenger': 'suv',
};

const LUXURY_BRANDS = ['BMW', 'Mercedes-Benz', 'Audi', 'Porsche', 'Lucid', 'Genesis', 'Cadillac', 'Lexus', 'Rolls-Royce', 'Maserati', 'Lotus'];

async function fetchJSON(url) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return null;
  return res.json();
}

function toArray(item) {
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

function parseMotorHP(evMotor) {
  if (!evMotor) return 0;
  const match = evMotor.match(/(\d+)\s*kW/i);
  if (match) return Math.round(parseInt(match[1]) * 1.341);
  return 0;
}

function parseDriveType(drive) {
  if (!drive) return 'FWD';
  if (drive.includes('All-Wheel') || drive.includes('4-Wheel') || drive.includes('AWD')) return 'AWD';
  if (drive.includes('Rear')) return 'RWD';
  return 'FWD';
}

function makeId(brand, model, year) {
  return `${brand}-${model}-${year}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function estimateBatteryKWh(rangeMiles, combE) {
  if (combE && rangeMiles) {
    return Math.round((combE * rangeMiles) / 100);
  }
  return 0;
}

async function fetchEVsForYear(year) {
  const vehicles = [];
  console.log(`Fetching EVs for ${year}...`);

  for (const brand of EV_BRANDS) {
    const modelsData = await fetchJSON(
      `${API_BASE}/vehicle/menu/model?year=${year}&make=${brand}`
    );
    if (!modelsData?.menuItem) continue;

    const models = toArray(modelsData.menuItem);

    for (const model of models) {
      const optionsData = await fetchJSON(
        `${API_BASE}/vehicle/menu/options?year=${year}&make=${brand}&model=${model.value}`
      );
      if (!optionsData?.menuItem) continue;

      const options = toArray(optionsData.menuItem);
      const vehicleData = await fetchJSON(`${API_BASE}/vehicle/${options[0].value}`);

      if (!vehicleData || vehicleData.fuelType !== 'Electricity') continue;

      const rangeMiles = vehicleData.range || vehicleData.rangeA || 0;
      const hp = parseMotorHP(vehicleData.evMotor);
      const driveType = parseDriveType(vehicleData.drive);
      const batteryKWh = estimateBatteryKWh(rangeMiles, vehicleData.combE);
      let category = CATEGORY_MAP[vehicleData.VClass] || 'suv';
      if (LUXURY_BRANDS.includes(brand) && category !== 'truck') category = 'luxury';

      vehicles.push({
        id: makeId(brand, model.value, year),
        brand: brand,
        model: model.value,
        year: year,
        category,
        priceUSD: 0,
        rangeMiles,
        rangeKm: Math.round(rangeMiles * 1.609),
        batteryKWh,
        chargingTimeHrs: vehicleData.charge240 || 0,
        fastChargeMins: 0,
        topSpeedMph: 0,
        acceleration060: 0,
        horsePower: hp,
        torqueNm: 0,
        driveType,
        seats: 5,
        cargoLiters: 0,
        weight: 0,
        warranty: '',
        batteryWarranty: '',
        rating: 0,
        pros: [],
        cons: [],
        image: `https://placehold.co/600x400/0a0a1a/00d4aa?text=${encodeURIComponent(brand + ' ' + model.value)}`,
        bestFor: '',
        featured: false,
        source: 'fueleconomy.gov',
        fuelEconomyId: vehicleData.id,
      });

      console.log(`  Found: ${brand} ${model.value} (${rangeMiles} mi, ${hp} hp, ${driveType})`);
    }
  }

  return vehicles;
}

async function main() {
  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear + 1];

  let existingCars = [];
  try {
    existingCars = JSON.parse(readFileSync(CARS_FILE, 'utf-8'));
  } catch {
    console.log('No existing cars.json found, starting fresh.');
  }

  const existingById = new Map(existingCars.map(c => [c.id, c]));
  const fetchedVehicles = [];

  for (const year of years) {
    const vehicles = await fetchEVsForYear(year);
    fetchedVehicles.push(...vehicles);
  }

  console.log(`\nFetched ${fetchedVehicles.length} EVs total.`);

  const merged = [];
  const seenIds = new Set();

  for (const fetched of fetchedVehicles) {
    const existing = existingById.get(fetched.id);

    if (existing) {
      merged.push({
        ...fetched,
        priceUSD: existing.priceUSD || fetched.priceUSD,
        fastChargeMins: existing.fastChargeMins || fetched.fastChargeMins,
        topSpeedMph: existing.topSpeedMph || fetched.topSpeedMph,
        acceleration060: existing.acceleration060 || fetched.acceleration060,
        torqueNm: existing.torqueNm || fetched.torqueNm,
        seats: existing.seats || fetched.seats,
        cargoLiters: existing.cargoLiters || fetched.cargoLiters,
        weight: existing.weight || fetched.weight,
        warranty: existing.warranty || fetched.warranty,
        batteryWarranty: existing.batteryWarranty || fetched.batteryWarranty,
        rating: existing.rating || fetched.rating,
        pros: existing.pros?.length ? existing.pros : fetched.pros,
        cons: existing.cons?.length ? existing.cons : fetched.cons,
        image: existing.image?.includes('placehold.co') ? fetched.image : existing.image,
        bestFor: existing.bestFor || fetched.bestFor,
        featured: existing.featured || fetched.featured,
      });
    } else {
      merged.push(fetched);
    }
    seenIds.add(fetched.id);
  }

  for (const existing of existingCars) {
    if (!seenIds.has(existing.id)) {
      merged.push(existing);
    }
  }

  merged.sort((a, b) => {
    if (a.featured !== b.featured) return b.featured ? 1 : -1;
    if (a.rating !== b.rating) return b.rating - a.rating;
    return a.brand.localeCompare(b.brand);
  });

  writeFileSync(CARS_FILE, JSON.stringify(merged, null, 2) + '\n');
  console.log(`\nWrote ${merged.length} EVs to cars.json`);
  console.log(`  - Updated from API: ${fetchedVehicles.length}`);
  console.log(`  - Preserved existing: ${merged.length - fetchedVehicles.length}`);
}

main().catch(err => {
  console.error('Error fetching EV data:', err);
  process.exit(1);
});
