// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IReplayProtectedExecutor} from "./IReplayProtectedExecutor.sol";
import {AttestationVerifier} from "./AttestationVerifier.sol";
import {InterWeaveAssetRegistry} from "./InterWeaveAssetRegistry.sol";
import {InterWeaveRepresentation} from "./InterWeaveRepresentation.sol";

contract InterWeaveGateway is AccessControl, Pausable, ReentrancyGuard, IReplayProtectedExecutor {
    using SafeERC20 for IERC20;
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    uint8 public constant EFFECT_MINT = 1; uint8 public constant EFFECT_RELEASE = 2; uint8 public constant EFFECT_BURN = 3;
    AttestationVerifier public immutable verifier; InterWeaveAssetRegistry public immutable registry;
    mapping(bytes32 operationId => mapping(uint8 effect => bool)) private _processed;
    event OperationExecuted(bytes32 indexed operationId, uint8 indexed effect, bytes32 indexed assetId, address receiver, uint256 amount, bytes32 attestationDigest);
    event RepresentationBurned(bytes32 indexed operationId, bytes32 indexed assetId, address indexed owner, uint256 amount, bytes32 destinationReceiver);
    error InvalidGatewayConfiguration(); error OperationAlreadyProcessed(bytes32 operationId, uint8 effect); error AssetUnavailable(bytes32 assetId); error InvalidAmount();

    constructor(address admin, address pauser, AttestationVerifier verifier_, InterWeaveAssetRegistry registry_) {
        if (admin == address(0) || pauser == address(0) || address(verifier_) == address(0) || address(registry_) == address(0)) revert InvalidGatewayConfiguration();
        verifier = verifier_; registry = registry_; _grantRole(DEFAULT_ADMIN_ROLE, admin); _grantRole(PAUSER_ROLE, pauser);
    }
    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }
    function isOperationProcessed(bytes32 operationId, uint8 effect) external view returns (bool) { return _processed[operationId][effect]; }
    function executeMint(bytes32 attestationDigest, bytes32 operationId, bytes32 assetId, address receiver, uint256 amount, uint48 validFrom, uint48 expiresAt, bytes[] calldata signatures) external whenNotPaused nonReentrant {
        InterWeaveAssetRegistry.AssetConfig memory config = registry.asset(assetId);
        if (!config.enabled || config.representation == address(0)) revert AssetUnavailable(assetId);
        _authorizeAndConsume(attestationDigest, operationId, assetId, receiver, amount, validFrom, expiresAt, EFFECT_MINT, signatures);
        InterWeaveRepresentation(config.representation).protocolMint(receiver, amount);
    }
    function executeRelease(bytes32 attestationDigest, bytes32 operationId, bytes32 assetId, address receiver, uint256 amount, uint48 validFrom, uint48 expiresAt, bytes[] calldata signatures) external whenNotPaused nonReentrant {
        InterWeaveAssetRegistry.AssetConfig memory config = registry.asset(assetId);
        if (!config.enabled || config.underlying == address(0)) revert AssetUnavailable(assetId);
        _authorizeAndConsume(attestationDigest, operationId, assetId, receiver, amount, validFrom, expiresAt, EFFECT_RELEASE, signatures);
        IERC20(config.underlying).safeTransfer(receiver, amount);
    }
    function burnRepresentation(bytes32 operationId, bytes32 assetId, uint256 amount, bytes32 destinationReceiver) external whenNotPaused nonReentrant {
        if (amount == 0) revert InvalidAmount();
        InterWeaveAssetRegistry.AssetConfig memory config = registry.asset(assetId);
        if (!config.enabled || config.representation == address(0)) revert AssetUnavailable(assetId);
        if (_processed[operationId][EFFECT_BURN]) revert OperationAlreadyProcessed(operationId, EFFECT_BURN);
        _processed[operationId][EFFECT_BURN] = true;
        InterWeaveRepresentation(config.representation).protocolBurn(msg.sender, amount);
        emit RepresentationBurned(operationId, assetId, msg.sender, amount, destinationReceiver);
    }
    function _authorizeAndConsume(bytes32 attestationDigest, bytes32 operationId, bytes32 assetId, address receiver, uint256 amount, uint48 validFrom, uint48 expiresAt, uint8 effect, bytes[] calldata signatures) internal {
        if (amount == 0) revert InvalidAmount();
        if (_processed[operationId][effect]) revert OperationAlreadyProcessed(operationId, effect);
        verifier.verify(attestationDigest, operationId, effect, assetId, receiver, amount, validFrom, expiresAt, signatures);
        _processed[operationId][effect] = true;
        emit OperationExecuted(operationId, effect, assetId, receiver, amount, attestationDigest);
    }
}
