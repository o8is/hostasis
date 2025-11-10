// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "lib/forge-std/src/interfaces/IERC20.sol";

/// @title ISavingsDai
/// @notice Interface for Sky's Savings USDS (sUSDS) token
interface ISavingsDai is IERC20 {
    /// @notice Preview the amount of assets redeemable for a given amount of shares
    /// @param shares Amount of sUSDS shares
    /// @return assets Amount of USDS that would be received
    function previewRedeem(uint256 shares) external view returns (uint256 assets);

    /// @notice Preview the amount of shares that would be minted for a given amount of assets
    /// @param assets Amount of USDS to deposit
    /// @return shares Amount of sUSDS shares that would be received
    function previewDeposit(uint256 assets) external view returns (uint256 shares);

    /// @notice Deposit USDS and receive sUSDS shares
    /// @param assets Amount of USDS to deposit
    /// @param receiver Address to receive the shares
    /// @return shares Amount of sUSDS shares minted
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);

    /// @notice Redeem sUSDS shares for USDS
    /// @param shares Amount of sUSDS shares to redeem
    /// @param receiver Address to receive the USDS
    /// @param owner Owner of the shares
    /// @return assets Amount of USDS received
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets);

    /// @notice Get the current exchange rate (assets per share)
    /// @return rate Current exchange rate
    function convertToAssets(uint256 shares) external view returns (uint256 rate);

    /// @notice Get the current exchange rate (shares per asset)
    /// @return rate Current exchange rate
    function convertToShares(uint256 assets) external view returns (uint256 rate);

    /// @notice EIP-2612 permit function for gasless approvals
    /// @param owner Token owner address
    /// @param spender Spender address
    /// @param value Amount to approve
    /// @param deadline Signature deadline
    /// @param v Signature v component
    /// @param r Signature r component
    /// @param s Signature s component
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external;

    /// @notice Get the current nonce for permit signatures
    /// @param owner Token owner address
    /// @return nonce Current nonce
    function nonces(address owner) external view returns (uint256 nonce);

    /// @notice Get the domain separator for EIP-712
    /// @return separator Domain separator
    function DOMAIN_SEPARATOR() external view returns (bytes32 separator);
}
