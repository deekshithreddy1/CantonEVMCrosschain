// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {InterWeaveRepresentation} from "./InterWeaveRepresentation.sol";

contract RepresentationFactory is AccessControl {
    bytes32 public constant DEPLOYER_ROLE = keccak256("DEPLOYER_ROLE");
    mapping(bytes32 assetId => address) public representationOf;
    event RepresentationDeployed(bytes32 indexed assetId, address indexed representation, address indexed gateway);
    error InvalidDeployment(); error RepresentationAlreadyExists(bytes32 assetId);

    constructor(address admin, address deployer) {
        if (admin == address(0) || deployer == address(0)) revert InvalidDeployment();
        _grantRole(DEFAULT_ADMIN_ROLE, admin); _grantRole(DEPLOYER_ROLE, deployer);
    }
    function deploy(bytes32 assetId, string calldata name, string calldata symbol, uint8 decimals, address tokenAdmin, address gateway) external onlyRole(DEPLOYER_ROLE) returns (address deployed) {
        if (assetId == bytes32(0) || tokenAdmin == address(0) || gateway == address(0)) revert InvalidDeployment();
        if (representationOf[assetId] != address(0)) revert RepresentationAlreadyExists(assetId);
        deployed = address(new InterWeaveRepresentation(name, symbol, decimals, tokenAdmin, gateway));
        representationOf[assetId] = deployed; emit RepresentationDeployed(assetId, deployed, gateway);
    }
}
