/** mCare brand constants — shared by the animated logo and printed documents so both show the same mark. */

/** Realistic single-lead ECG: flat baseline, P wave, QRS complex, T wave. viewBox 0 0 200 40. */
export const EKG_PATH =
  'M0,20 L46,20 ' +                     // isoelectric baseline
  'C52,20 54,14 58,14 C62,14 64,20 70,20 ' + // P wave (atrial)
  'L76,20 L80,24 L86,3 L92,36 L97,17 L102,20 ' + // QRS complex
  'L112,20 ' +
  'C120,20 122,11 130,11 C138,11 140,20 148,20 ' + // T wave (repolarization)
  'L200,20'

/** "Care" is always brand violet; the "m" and trace take the pulse colour (teal when static). */
export const BRAND_VIOLET = '#6d5cf5'
export const BRAND_TEAL = '#0f766e'
