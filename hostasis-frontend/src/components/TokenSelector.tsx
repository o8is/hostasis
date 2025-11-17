import { type TokenType } from '../hooks/useTokenConversion';
import TokenAmount from './TokenAmount';

interface TokenSelectorProps {
  availableTokens: TokenType[];
  currentToken: TokenType | null;
  onSelectToken: (token: TokenType) => void;
  getBalance: (token: TokenType | null) => bigint;
  getTokenLabel: (token: TokenType | null) => string;
  disabled?: boolean;
}

export default function TokenSelector({
  availableTokens,
  currentToken,
  onSelectToken,
  getBalance,
  getTokenLabel,
  disabled = false,
}: TokenSelectorProps) {
  if (availableTokens.length <= 1) {
    return null; // No need to show selector if only one option
  }

  return (
    <div style={{ marginBottom: '1rem' }}>
      <p className="description" style={{ marginBottom: '0.5rem', fontSize: '0.9rem' }}>
        Select token to use:
      </p>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {availableTokens.map((token) => (
          <button
            key={token}
            onClick={() => onSelectToken(token)}
            disabled={disabled}
            style={{
              padding: '0.5rem 0.75rem',
              borderRadius: '6px',
              border: currentToken === token ? '2px solid #4a9eff' : '1px solid #3a3a3a',
              background: currentToken === token ? 'rgba(74, 158, 255, 0.1)' : 'transparent',
              color: currentToken === token ? '#4a9eff' : '#b0b0b0',
              cursor: disabled ? 'not-allowed' : 'pointer',
              fontSize: '0.85rem',
              transition: 'all 0.2s ease',
              opacity: disabled ? 0.6 : 1,
            }}
          >
            <div style={{ fontWeight: 500 }}>{getTokenLabel(token)}</div>
            <div style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
              <TokenAmount value={getBalance(token)} symbol="" decimals={2} />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
