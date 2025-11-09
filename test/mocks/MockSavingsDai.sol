// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Mock sDAI contract for testing
/// @dev Simulates ERC4626 vault with configurable exchange rate
contract MockSavingsDai is ERC20 {
    using SafeERC20 for IERC20;

    IERC20 public immutable asset; // DAI
    uint256 public exchangeRate; // Assets per share (18 decimals)

    constructor(address _asset, uint256 _initialRate) ERC20("Savings DAI", "sDAI") {
        asset = IERC20(_asset);
        exchangeRate = _initialRate;
    }

    /// @notice Set new exchange rate (for testing)
    function setExchangeRate(uint256 _newRate) external {
        exchangeRate = _newRate;
    }

    /// @notice Get assets per share
    function convertToAssets(uint256 shares) public view returns (uint256) {
        return (shares * exchangeRate) / 1e18;
    }

    /// @notice Get shares per asset
    function convertToShares(uint256 assets) public view returns (uint256) {
        return (assets * 1e18) / exchangeRate;
    }

    /// @notice Preview redeem
    function previewRedeem(uint256 shares) external view returns (uint256) {
        return convertToAssets(shares);
    }

    /// @notice Preview deposit
    function previewDeposit(uint256 assets) external view returns (uint256) {
        return convertToShares(assets);
    }

    /// @notice Deposit assets, receive shares
    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        shares = convertToShares(assets);
        asset.safeTransferFrom(msg.sender, address(this), assets);
        _mint(receiver, shares);
    }

    /// @notice Redeem shares for assets
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets) {
        if (msg.sender != owner) {
            _spendAllowance(owner, msg.sender, shares);
        }

        assets = convertToAssets(shares);
        _burn(owner, shares);
        asset.safeTransfer(receiver, assets);
    }
}
