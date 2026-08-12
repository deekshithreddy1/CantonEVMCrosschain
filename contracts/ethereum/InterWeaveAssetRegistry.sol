// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

contract InterWeaveAssetRegistry is AccessControl {
    bytes32 public constant REGISTRY_ADMIN_ROLE = keccak256("REGISTRY_ADMIN_ROLE");
    struct AssetConfig { address representation; address underlying; bool enabled; }
    mapping(bytes32 assetId => AssetConfig) private _assets;
    event AssetConfigured(bytes32 indexed assetId, address indexed representation, address indexed underlying, bool enabled);
    error InvalidAssetConfiguration();

    constructor(address admin, address registryAdmin) {
        if (admin == address(0) || registryAdmin == address(0)) revert InvalidAssetConfiguration();
        _grantRole(DEFAULT_ADMIN_ROLE, admin); _grantRole(REGISTRY_ADMIN_ROLE, registryAdmin);
    }
    function configure(bytes32 assetId, address representation, address underlying, bool enabled) external onlyRole(REGISTRY_ADMIN_ROLE) {
        if (assetId == bytes32(0) || (representation == address(0) && underlying == address(0))) revert InvalidAssetConfiguration();
        _assets[assetId] = AssetConfig(representation, underlying, enabled);
        emit AssetConfigured(assetId, representation, underlying, enabled);
    }
    function asset(bytes32 assetId) external view returns (AssetConfig memory) { return _assets[assetId]; }
}
