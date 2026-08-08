// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

/// Phase 9 protocol boundary. Implementations arrive with the Phase 15 gateway.
interface IReplayProtectedExecutor {
    function isOperationProcessed(bytes32 operationId, uint8 effect) external view returns (bool);
}
