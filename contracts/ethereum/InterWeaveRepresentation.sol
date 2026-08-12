// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

contract InterWeaveRepresentation is ERC20, AccessControl {
    bytes32 public constant GATEWAY_ROLE = keccak256("GATEWAY_ROLE");
    uint8 private immutable _assetDecimals;
    error InvalidRepresentationConfiguration();

    constructor(string memory name_, string memory symbol_, uint8 decimals_, address admin, address gateway) ERC20(name_, symbol_) {
        if (admin == address(0) || gateway == address(0)) revert InvalidRepresentationConfiguration();
        _assetDecimals = decimals_; _grantRole(DEFAULT_ADMIN_ROLE, admin); _grantRole(GATEWAY_ROLE, gateway);
    }
    function decimals() public view override returns (uint8) { return _assetDecimals; }
    function protocolMint(address receiver, uint256 amount) external onlyRole(GATEWAY_ROLE) { _mint(receiver, amount); }
    function protocolBurn(address owner, uint256 amount) external onlyRole(GATEWAY_ROLE) { _burn(owner, amount); }
}
