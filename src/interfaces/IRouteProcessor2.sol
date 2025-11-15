// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IRouteProcessor2
/// @notice Interface for SushiSwap RouteProcessor2 on Gnosis Chain
/// @dev Used for swapping tokens through encoded routes
interface IRouteProcessor2 {
    /// @notice Processes a swap route generated off-chain or hard-coded
    /// @param tokenIn Input token address
    /// @param amountIn Amount of input tokens
    /// @param tokenOut Output token address
    /// @param amountOutMin Minimum acceptable output amount (slippage protection)
    /// @param to Recipient address for output tokens
    /// @param route Encoded route instructions for the swap
    /// @return amountOut Actual amount of output tokens received
    function processRoute(
        address tokenIn,
        uint256 amountIn,
        address tokenOut,
        uint256 amountOutMin,
        address to,
        bytes memory route
    ) external payable returns (uint256 amountOut);
}
