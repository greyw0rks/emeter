// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract TestContractWallet {
    address public immutable owner;
    constructor(address owner_) { owner = owner_; }
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        (address signer, ECDSA.RecoverError error,) = ECDSA.tryRecover(hash, signature);
        return error == ECDSA.RecoverError.NoError && signer == owner ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
}

contract TestFeeToken is ERC20 {
    bool public feeEnabled;
    constructor() ERC20("Test fee token", "TEST") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function setFee(bool enabled) external { feeEnabled = enabled; }
    function _update(address from, address to, uint256 amount) internal override {
        if (feeEnabled && from != address(0) && to != address(0)) {
            uint256 fee = amount / 10;
            super._update(from, address(0), fee);
            super._update(from, to, amount - fee);
        } else super._update(from, to, amount);
    }
}
