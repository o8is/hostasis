import { formatTokenAmount, formatTokenAmountFull } from '../utils/formatters';

interface TokenAmountProps {
  value: bigint | undefined;
  symbol?: string;
  decimals?: number;
  showTooltip?: boolean;
}

/**
 * Display token amounts with truncated precision and optional tooltip
 */
export default function TokenAmount({
  value,
  symbol,
  decimals = 2,
  showTooltip = true
}: TokenAmountProps) {
  const formatted = formatTokenAmount(value, decimals);
  const fullValue = formatTokenAmountFull(value);

  // Only show tooltip if the values differ (i.e., precision was truncated)
  const shouldShowTooltip = showTooltip && formatted !== fullValue;

  return (
    <span title={shouldShowTooltip ? fullValue : undefined} style={{ cursor: shouldShowTooltip ? 'help' : 'default' }}>
      {formatted}
      {symbol && ` ${symbol}`}
    </span>
  );
}
