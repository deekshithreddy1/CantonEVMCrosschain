// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
interface IPausableGateway { function pause() external; function unpause() external; }
contract EmergencyController is AccessControl {
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    event EmergencyAction(address indexed gateway, bool paused, address indexed actor);
    error InvalidEmergencyConfiguration();
    constructor(address admin, address emergencyOperator) { if (admin == address(0) || emergencyOperator == address(0)) revert InvalidEmergencyConfiguration(); _grantRole(DEFAULT_ADMIN_ROLE, admin); _grantRole(EMERGENCY_ROLE, emergencyOperator); }
    function pauseGateway(IPausableGateway gateway) external onlyRole(EMERGENCY_ROLE) { gateway.pause(); emit EmergencyAction(address(gateway), true, msg.sender); }
    function unpauseGateway(IPausableGateway gateway) external onlyRole(EMERGENCY_ROLE) { gateway.unpause(); emit EmergencyAction(address(gateway), false, msg.sender); }
}
