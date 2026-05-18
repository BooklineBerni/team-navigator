// =============================================================================
// data/holidays.js
// ---------------------------------------------------------------------------
// Spain national + Catalonia + Barcelona public holidays.  Pure data — gets
// loaded BEFORE the inline app script so the holiday helpers in inline
// (holidayName, isNonWorkingDay, etc.) can read it at parse time.
//
// Holidays are looked up by ISO date string ("YYYY-MM-DD").  Custom holidays
// added by the user override these and live in STORE.customHolidays.
// =============================================================================

// ---- Holidays (Spain national + Catalonia + Barcelona) ----
const HOLIDAYS = {
  '2025-01-01': 'Año Nuevo',
  '2025-01-06': 'Reyes',
  '2025-04-18': 'Viernes Santo',
  '2025-04-21': 'Lunes de Pascua',
  '2025-05-01': 'Día del Trabajo',
  '2025-06-09': 'Pasqua Granada',
  '2025-06-24': 'Sant Joan',
  '2025-08-15': 'Asunción',
  '2025-09-11': 'Diada',
  '2025-09-24': 'La Mercè',
  '2025-10-12': 'Hispanidad',
  '2025-11-01': 'Todos los Santos',
  '2025-12-06': 'Constitución',
  '2025-12-08': 'Inmaculada',
  '2025-12-25': 'Navidad',
  '2025-12-26': 'Sant Esteve',
  '2026-01-01': 'Año Nuevo',
  '2026-01-06': 'Reyes',
  '2026-04-03': 'Viernes Santo',
  '2026-04-06': 'Lunes de Pascua',
  '2026-05-01': 'Día del Trabajo',
  '2026-05-25': 'Pasqua Granada',
  '2026-06-24': 'Sant Joan',
  '2026-09-11': 'Diada',
  '2026-09-24': 'La Mercè',
  '2026-10-12': 'Hispanidad',
  '2026-12-07': 'Constitución',
  '2026-12-08': 'Inmaculada',
  '2026-12-25': 'Navidad',
  '2027-01-01': 'Año Nuevo',
  '2027-01-06': 'Reyes',
  '2027-03-26': 'Viernes Santo',
  '2027-03-29': 'Lunes de Pascua',
  '2027-05-01': 'Día del Trabajo',
  '2027-05-17': 'Pasqua Granada',
  '2027-06-24': 'Sant Joan',
  '2027-09-24': 'La Mercè',
  '2027-10-12': 'Hispanidad',
  '2027-11-01': 'Todos los Santos',
  '2027-12-06': 'Constitución',
  '2027-12-08': 'Inmaculada',
  '2027-12-25': 'Navidad'
};

