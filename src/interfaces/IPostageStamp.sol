// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IPostageStamp
/// @notice Interface for Swarm's Postage Stamp contract on Gnosis Chain
/// @dev Used to create and top up postage batches with BZZ tokens for decentralized storage
/// @dev Contract address: 0x45a1502382541Cd610CC9068e88727426b696293
interface IPostageStamp {
    /// @notice Create a new postage batch
    /// @param _owner The owner of the new batch
    /// @param _initialBalancePerChunk Initial balance of BZZ per chunk (determines TTL)
    /// @param _depth Depth of the batch (determines storage capacity: 2^depth chunks)
    /// @param _bucketDepth Bucket depth for collision resistance (typically 16)
    /// @param _nonce Random value to generate unique batch ID
    /// @param _immutable Whether the batch is immutable (true) or mutable (false)
    /// @return batchId The ID of the created batch
    /// @dev At least `_initialBalancePerChunk * 2^_depth` tokens must be approved before calling
    function createBatch(
        address _owner,
        uint256 _initialBalancePerChunk,
        uint8 _depth,
        uint8 _bucketDepth,
        bytes32 _nonce,
        bool _immutable
    ) external returns (bytes32 batchId);

    /// @notice Top up a postage batch with BZZ tokens
    /// @param batchId The ID of the batch to top up
    /// @param topupAmountPerChunk Amount of BZZ tokens to add per chunk (total = topupAmountPerChunk * 2^depth)
    /// @dev At least `topupAmountPerChunk * 2^depth` tokens must be approved before calling
    function topUp(bytes32 batchId, uint256 topupAmountPerChunk) external;

    /// @notice Get the depth of a postage batch
    /// @param batchId The ID of the batch to query
    /// @return depth The depth of the batch (determines number of chunks = 2^depth)
    function batchDepth(bytes32 batchId) external view returns (uint8 depth);

    /// @notice Get the remaining balance of a postage batch
    /// @param batchId The ID of the batch to query
    /// @return balance Remaining BZZ balance in the batch
    function remainingBalance(bytes32 batchId) external view returns (uint256 balance);

    /// @notice Check if a batch exists
    /// @param batchId The ID of the batch to check
    /// @return exists True if the batch exists
    function batchExists(bytes32 batchId) external view returns (bool exists);

    /// @notice Get the current price per chunk per block
    /// @return price Price in BZZ per chunk per block
    function lastPrice() external view returns (uint64 price);
}
