// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Mock DEX router for testing
contract MockDexRouter {
    using SafeERC20 for IERC20;

    address public immutable dai;
    address public immutable bzz;

    // Simple 1:2 exchange rate for testing (1 DAI = 2 BZZ)
    uint256 public constant EXCHANGE_RATE = 2;

    constructor(address _dai, address _bzz) {
        dai = _dai;
        bzz = _bzz;
    }

    /// @notice Simulate swap DAI -> BZZ
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 /* deadline */
    ) external returns (uint256[] memory amounts) {
        require(path.length == 2, "Invalid path");
        require(path[0] == dai && path[1] == bzz, "Invalid tokens");

        // Transfer DAI from sender
        IERC20(dai).safeTransferFrom(msg.sender, address(this), amountIn);

        // Calculate BZZ output (1 DAI = 2 BZZ)
        uint256 amountOut = amountIn * EXCHANGE_RATE;
        require(amountOut >= amountOutMin, "Slippage too high");

        // Mint BZZ to recipient (in real DEX, this would come from liquidity pool)
        // For testing, we'll just mint it
        MockERC20(bzz).mint(to, amountOut);

        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = amountOut;
    }

    /// @notice Get expected output amounts
    function getAmountsOut(
        uint256 amountIn,
        address[] calldata path
    ) external pure returns (uint256[] memory amounts) {
        require(path.length == 2, "Invalid path");

        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = amountIn * EXCHANGE_RATE;
    }
}

/// @dev Helper interface for minting in mock router
interface MockERC20 {
    function mint(address to, uint256 amount) external;
}
