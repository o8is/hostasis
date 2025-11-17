import { formatTokenAmountFull } from './formatters';
import type { TokenType } from '../hooks/useTokenConversion';

/**
 * Get the max amount string for a given token balance
 * Returns the full precision string suitable for input fields
 */
export function getMaxAmountString(balance: bigint | undefined): string {
  return formatTokenAmountFull(balance);
}

/**
 * Get balance and label for the current token type
 * Useful for displaying max amount with appropriate token symbol
 */
export interface MaxAmountInfo {
  balance: bigint;
  label: string;
  maxAmountString: string;
}

export function getMaxAmountInfo(
  tokenType: TokenType | null,
  nativeBalance: bigint | undefined,
  daiBalance: bigint | undefined,
  sdaiBalance: bigint | undefined
): MaxAmountInfo {
  let balance = 0n;
  let label = 'tokens';

  if (tokenType === 'SDAI') {
    balance = sdaiBalance || 0n;
    label = 'sDAI';
  } else if (tokenType === 'WRAPPED_DAI') {
    balance = daiBalance || 0n;
    label = 'wxDAI';
  } else if (tokenType === 'NATIVE_XDAI') {
    balance = nativeBalance || 0n;
    label = 'xDAI';
  }

  return {
    balance,
    label,
    maxAmountString: getMaxAmountString(balance),
  };
}
