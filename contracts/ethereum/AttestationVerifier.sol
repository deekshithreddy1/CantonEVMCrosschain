// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract AttestationVerifier is AccessControl {
    using ECDSA for bytes32;
    bytes32 public constant VALIDATOR_ADMIN_ROLE = keccak256("VALIDATOR_ADMIN_ROLE");
    bytes32 public constant EXECUTION_DOMAIN = keccak256("INTERWEAVE_EVM_EXECUTION_V1");
    mapping(address validator => bool) public isValidator;
    uint256 public threshold;
    event ValidatorStatusChanged(address indexed validator, bool enabled);
    event ThresholdChanged(uint256 threshold);
    error InvalidVerifierConfiguration(); error InvalidThreshold(); error DuplicateOrUnsortedSigner(); error UnauthorizedValidator(address signer); error InvalidAttestationTime();

    constructor(address admin, address validatorAdmin, address[] memory validators, uint256 threshold_) {
        if (admin == address(0) || validatorAdmin == address(0)) revert InvalidVerifierConfiguration();
        _grantRole(DEFAULT_ADMIN_ROLE, admin); _grantRole(VALIDATOR_ADMIN_ROLE, validatorAdmin);
        for (uint256 i; i < validators.length; ++i) _setValidator(validators[i], true);
        _setThreshold(threshold_);
    }
    function setValidator(address validator, bool enabled) external onlyRole(VALIDATOR_ADMIN_ROLE) { _setValidator(validator, enabled); }
    function setThreshold(uint256 threshold_) external onlyRole(VALIDATOR_ADMIN_ROLE) { _setThreshold(threshold_); }
    function executionDigest(bytes32 attestationDigest, bytes32 operationId, uint8 effect, bytes32 assetId, address receiver, uint256 amount, uint48 validFrom, uint48 expiresAt) public view returns (bytes32) {
        return keccak256(abi.encode(EXECUTION_DOMAIN, block.chainid, address(this), attestationDigest, operationId, effect, assetId, receiver, amount, validFrom, expiresAt));
    }
    function verify(bytes32 attestationDigest, bytes32 operationId, uint8 effect, bytes32 assetId, address receiver, uint256 amount, uint48 validFrom, uint48 expiresAt, bytes[] calldata signatures) external view returns (bytes32 digest) {
        if (block.timestamp < validFrom || block.timestamp >= expiresAt || validFrom >= expiresAt) revert InvalidAttestationTime();
        if (signatures.length < threshold) revert InvalidThreshold();
        digest = executionDigest(attestationDigest, operationId, effect, assetId, receiver, amount, validFrom, expiresAt);
        address previous;
        for (uint256 i; i < signatures.length; ++i) {
            address signer = digest.recover(signatures[i]);
            if (signer <= previous) revert DuplicateOrUnsortedSigner();
            if (!isValidator[signer]) revert UnauthorizedValidator(signer);
            previous = signer;
        }
    }
    function _setValidator(address validator, bool enabled) internal { if (validator == address(0)) revert InvalidVerifierConfiguration(); isValidator[validator] = enabled; emit ValidatorStatusChanged(validator, enabled); }
    function _setThreshold(uint256 threshold_) internal { if (threshold_ == 0) revert InvalidThreshold(); threshold = threshold_; emit ThresholdChanged(threshold_); }
}
