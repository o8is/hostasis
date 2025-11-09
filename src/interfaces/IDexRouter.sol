// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IDexRouter
/// @notice Generic DEX router interface for token swaps on Gnosis Chain
/// @dev Compatible with Honeyswap, Swapr, and other Uniswap V2-style DEXes
interface IDexRouter {
    /// @notice Swap exact tokens for tokens with minimum output protection
    /// @param amountIn Amount of input tokens to swap
    /// @param amountOutMin Minimum amount of output tokens to receive
    /// @param path Array of token addresses representing the swap path
    /// @param to Recipient address for output tokens
    /// @param deadline Unix timestamp after which the transaction will revert
    /// @return amounts Array of amounts for each step in the swap path
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    /// @notice Get expected output amount for a given input amount
    /// @param amountIn Amount of input tokens
    /// @param path Array of token addresses representing the swap path
    /// @return amounts Array of amounts for each step in the swap path
    function getAmountsOut(
        uint256 amountIn,
        address[] calldata path
    ) external view returns (uint256[] memory amounts);
}
