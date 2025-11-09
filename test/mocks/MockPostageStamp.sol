// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Mock Swarm Postage Stamp contract for testing
contract MockPostageStamp {
    mapping(bytes32 => uint256) public batchBalances;
    mapping(bytes32 => bool) public batchExists;

    event BatchCreated(bytes32 indexed batchId);
    event BatchToppedUp(bytes32 indexed batchId, uint256 amount);

    /// @notice Create a new batch (for testing)
    function createBatch(bytes32 batchId) external {
        batchExists[batchId] = true;
        emit BatchCreated(batchId);
    }

    /// @notice Top up a postage batch
    function topUp(bytes32 batchId, uint256 amount) external {
        require(batchExists[batchId], "Batch does not exist");
        batchBalances[batchId] += amount;
        emit BatchToppedUp(batchId, amount);
    }

    /// @notice Get remaining balance
    function remainingBalance(bytes32 batchId) external view returns (uint256) {
        return batchBalances[batchId];
    }
}
