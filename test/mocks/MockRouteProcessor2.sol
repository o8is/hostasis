// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IRouteProcessor2} from "../../src/interfaces/IRouteProcessor2.sol";

/// @title MockRouteProcessor2
/// @notice Mock implementation of SushiSwap RouteProcessor2 for testing
contract MockRouteProcessor2 is IRouteProcessor2 {
    /// @notice Exchange rate for swaps (default 1:1)
    /// @dev Represented as amountOut = (amountIn * rate) / 1e18
    uint256 public exchangeRate = 1e18;

    /// @notice Set a custom exchange rate for testing
    /// @param rate New exchange rate (1e18 = 1:1)
    function setExchangeRate(uint256 rate) external {
        exchangeRate = rate;
    }

    /// @notice Mock processRoute that performs a simple token swap
    /// @param tokenIn Input token address
    /// @param amountIn Amount of input tokens
    /// @param tokenOut Output token address
    /// @param amountOutMin Minimum acceptable output amount
    /// @param to Recipient address
    /// @param route Encoded route (ignored in mock)
    /// @return amountOut Amount of output tokens sent
    function processRoute(
        address tokenIn,
        uint256 amountIn,
        address tokenOut,
        uint256 amountOutMin,
        address to,
        bytes memory route
    ) external payable override returns (uint256 amountOut) {
        // Transfer tokens from caller
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);

        // Calculate output amount based on exchange rate
        amountOut = (amountIn * exchangeRate) / 1e18;

        // Enforce slippage protection
        require(amountOut >= amountOutMin, "MockRouteProcessor2: Insufficient output");

        // Transfer output tokens to recipient
        IERC20(tokenOut).transfer(to, amountOut);
    }
}
