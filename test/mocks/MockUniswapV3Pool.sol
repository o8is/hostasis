// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IUniswapV3Pool} from "../../src/interfaces/IUniswapV3Pool.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IUniswapV3SwapCallback {
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external;
}

/// @title MockUniswapV3Pool
/// @notice Mock implementation of Uniswap V3 Pool for testing
contract MockUniswapV3Pool is IUniswapV3Pool {
    uint160 public sqrtPriceX96;
    address public token0;
    address public token1;

    // Mock exchange rate: how much token0 per token1 (scaled by 1e18)
    uint256 public mockRate = 1e18; // 1:1 by default

    constructor(address _token0, address _token1, uint160 _sqrtPriceX96) {
        token0 = _token0;
        token1 = _token1;
        sqrtPriceX96 = _sqrtPriceX96;
    }

    /// @notice Set sqrt price for testing
    function setSqrtPriceX96(uint160 _sqrtPriceX96) external {
        sqrtPriceX96 = _sqrtPriceX96;
    }

    /// @notice Set mock exchange rate for swap
    function setMockRate(uint256 _rate) external {
        mockRate = _rate;
    }

    /// @notice Mock swap function
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160, /* sqrtPriceLimitX96 */
        bytes calldata data
    ) external override returns (int256 amount0Delta, int256 amount1Delta) {
        // For simplicity, we only handle exact input swaps (amountSpecified > 0)
        require(amountSpecified > 0, "Only exact input supported");

        uint256 amountIn = uint256(amountSpecified);
        uint256 amountOut;

        if (zeroForOne) {
            // token0 -> token1
            // amountOut = amountIn * 1e18 / mockRate (since mockRate is token0 per token1)
            amountOut = (amountIn * 1e18) / mockRate;
            amount0Delta = int256(amountIn); // positive = we receive
            amount1Delta = -int256(amountOut); // negative = we send

            // Transfer output tokens to recipient
            IERC20(token1).transfer(recipient, amountOut);
        } else {
            // token1 -> token0
            // amountOut = amountIn * mockRate / 1e18
            amountOut = (amountIn * mockRate) / 1e18;
            amount1Delta = int256(amountIn); // positive = we receive
            amount0Delta = -int256(amountOut); // negative = we send

            // Transfer output tokens to recipient
            IERC20(token0).transfer(recipient, amountOut);
        }

        // Call the swap callback to receive payment
        IUniswapV3SwapCallback(msg.sender).uniswapV3SwapCallback(amount0Delta, amount1Delta, data);
    }

    /// @notice Return mock slot0 data
    function slot0()
        external
        view
        override
        returns (
            uint160 _sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        )
    {
        return (sqrtPriceX96, 0, 0, 1, 1, 0, true);
    }
}
