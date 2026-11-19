// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Zero-value demonstration token. No backing, redemption, or market value.
/// @dev Minting is restricted to a fixed demo operator and a fixed supply cap.
contract DemoUSD is ERC20 {
    error UnauthorizedMinter();
    error DemoSupplyExceeded();
    error InvalidMinter();

    address public immutable demoMinter;
    uint256 public constant MAX_SUPPLY = 1_000_000 * 1e6;

    constructor(address minter) ERC20("emeter Demo USD (no value)", "DEMO") {
        if (minter == address(0)) revert InvalidMinter();
        demoMinter = minter;
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != demoMinter) revert UnauthorizedMinter();
        if (amount > MAX_SUPPLY - totalSupply()) revert DemoSupplyExceeded();
        _mint(to, amount);
    }
}
