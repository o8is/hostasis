import { formatEther } from 'viem';

/**
 * Format token amounts for display with sensible precision
 * @param value - BigInt value in wei
 * @param decimals - Number of decimal places to show (default: 2)
 * @returns Formatted string with commas and limited decimals
 */
export function formatTokenAmount(value: bigint | undefined, decimals: number = 2): string {
  if (!value) return '0';

  const formatted = formatEther(value);
  const num = parseFloat(formatted);

  // For very small numbers, show more precision
  if (num > 0 && num < 0.0001) {
    return num.toFixed(6);
  }

  // For normal numbers, use specified decimals
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

/**
 * Get the full unformatted value for tooltips
 * @param value - BigInt value in wei
 * @returns Full precision string
 */
export function formatTokenAmountFull(value: bigint | undefined): string {
  if (!value) return '0';
  return formatEther(value);
}
