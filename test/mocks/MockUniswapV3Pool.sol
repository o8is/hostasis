// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IUniswapV3Pool} from "../../src/interfaces/IUniswapV3Pool.sol";

/// @title MockUniswapV3Pool
/// @notice Mock implementation of Uniswap V3 Pool for testing
contract MockUniswapV3Pool is IUniswapV3Pool {
    uint160 public sqrtPriceX96;
    address public token0;
    address public token1;

    constructor(address _token0, address _token1, uint160 _sqrtPriceX96) {
        token0 = _token0;
        token1 = _token1;
        sqrtPriceX96 = _sqrtPriceX96;
    }

    /// @notice Set sqrt price for testing
    function setSqrtPriceX96(uint160 _sqrtPriceX96) external {
        sqrtPriceX96 = _sqrtPriceX96;
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
