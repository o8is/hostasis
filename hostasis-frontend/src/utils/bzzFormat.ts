/**
 * BZZ token uses 16 decimals (not 18 like most ERC20 tokens)
 * The atomic unit is PLUR: 1 PLUR = 10^-16 BZZ
 */

const BZZ_DECIMALS = 16n;
const BZZ_DECIMALS_MULTIPLIER = 10n ** BZZ_DECIMALS;

/**
 * Format BZZ amount from PLUR (smallest unit) to human-readable BZZ
 * @param plur Amount in PLUR (10^-16 BZZ)
 * @returns String representation of BZZ amount
 */
export function formatBZZ(plur: bigint): string {
  const bzz = Number(plur) / Number(BZZ_DECIMALS_MULTIPLIER);
  return bzz.toString();
}

/**
 * Parse BZZ amount from human-readable string to PLUR (smallest unit)
 * @param bzz Amount in BZZ as a string
 * @returns Amount in PLUR (bigint)
 */
export function parseBZZ(bzz: string): bigint {
  const parts = bzz.split('.');
  const whole = BigInt(parts[0] || '0');
  const fraction = parts[1] || '';

  // Pad or trim fraction to 16 decimals
  const paddedFraction = fraction.padEnd(16, '0').slice(0, 16);
  const fractionBigInt = BigInt(paddedFraction);

  return whole * BZZ_DECIMALS_MULTIPLIER + fractionBigInt;
}

/**
 * Convert PLUR amount to number for display (lossy conversion, use formatBZZ for string)
 * @param plur Amount in PLUR
 * @returns Number representation in BZZ
 */
export function plurToBZZ(plur: bigint): number {
  return Number(plur) / Number(BZZ_DECIMALS_MULTIPLIER);
}

/**
 * Convert BZZ number to PLUR amount
 * @param bzz Amount in BZZ as a number
 * @returns Amount in PLUR (bigint)
 */
export function bzzToPlur(bzz: number): bigint {
  return BigInt(Math.floor(bzz * Number(BZZ_DECIMALS_MULTIPLIER)));
}
