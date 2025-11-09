// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IPostageStamp
/// @notice Interface for Swarm's Postage Stamp contract
/// @dev Used to top up postage batches with BZZ tokens for decentralized storage
interface IPostageStamp {
    /// @notice Top up a postage batch with BZZ tokens
    /// @param batchId The ID of the batch to top up
    /// @param amount Amount of BZZ tokens to add to the batch
    function topUp(bytes32 batchId, uint256 amount) external;

    /// @notice Get the remaining balance of a postage batch
    /// @param batchId The ID of the batch to query
    /// @return balance Remaining BZZ balance in the batch
    function remainingBalance(bytes32 batchId) external view returns (uint256 balance);

    /// @notice Check if a batch exists
    /// @param batchId The ID of the batch to check
    /// @return exists True if the batch exists
    function batchExists(bytes32 batchId) external view returns (bool exists);
}
